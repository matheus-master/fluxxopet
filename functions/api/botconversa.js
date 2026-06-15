// Ponte BotConversa -> ActiveCampaign
// Recebe um webhook do BotConversa (quando o lead deixa o e-mail no bot),
// cria/atualiza o contato no ActiveCampaign e abre um negocio na etapa "Lead".
//
// Variaveis de ambiente necessarias (Cloudflare Pages > Settings > Environment variables / secrets):
//   AC_API_URL        ex: https://suaconta.api-us1.com   (sem barra no fim)
//   AC_API_TOKEN      token da API do ActiveCampaign (Settings > Developer)
//   AC_PIPELINE_ID    id do funil (pipeline / "group") onde fica a etapa LEAD
//   AC_STAGE_ID       id da etapa "LEAD"
//   AC_DEAL_OWNER_ID  id do usuario dono do negocio (obrigatorio na API de deals)
//   BC_WEBHOOK_SECRET segredo que o BotConversa precisa enviar para autenticar
//   AC_DEAL_VALUE     (opcional) valor do negocio em centavos. default 0
//   AC_DEAL_CURRENCY  (opcional) moeda. default "brl"

export async function onRequestPost(context) {
  const { request, env } = context;

  // Le o corpo bruto (uma vez) e tambem parseado
  const rawText = await request.text();
  const body    = parseBody(request, rawText);

  const email = pick(body, ['email', 'Email', 'e-mail', 'mail']);
  const nome  = pick(body, ['nome', 'name', 'full_name', 'fullName', 'first_name', 'firstName']);
  const phone = pick(body, ['telefone', 'whatsapp', 'phone', 'celular', 'fone']);

  // Logger de diagnostico (best-effort, nao bloqueia a resposta)
  const log = (result) => {
    if (!env.DB) return;
    context.waitUntil(
      env.DB.prepare(
        'INSERT INTO webhook_log (raw, email, nome, telefone, result) VALUES (?, ?, ?, ?, ?)'
      ).bind(rawText.slice(0, 2000), email, nome, phone, result).run().catch(() => {})
    );
  };

  // 1. Autenticacao do webhook (segredo via query ?token= ou header X-Webhook-Secret)
  const url        = new URL(request.url);
  const givenToken = url.searchParams.get('token') || request.headers.get('X-Webhook-Secret') || '';
  if (!env.BC_WEBHOOK_SECRET || givenToken !== env.BC_WEBHOOK_SECRET) {
    log('401 unauthorized');
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  if (!email) {
    log('400 email ausente');
    return json({ ok: false, error: 'E-mail ausente no payload' }, 400);
  }

  // Config do ActiveCampaign
  const cfg = {
    apiUrl:   (env.AC_API_URL || '').replace(/\/$/, ''),
    token:    env.AC_API_TOKEN,
    pipeline: env.AC_PIPELINE_ID,
    stage:    env.AC_STAGE_ID,
    owner:    env.AC_DEAL_OWNER_ID,
    value:    parseInt(env.AC_DEAL_VALUE || '0', 10) || 0,
    currency: env.AC_DEAL_CURRENCY || 'brl',
  };
  if (!cfg.apiUrl || !cfg.token || !cfg.pipeline || !cfg.stage || !cfg.owner) {
    log('500 config ausente');
    return json({ ok: false, error: 'Integracao ActiveCampaign nao configurada (faltam variaveis de ambiente)' }, 500);
  }

  try {
    // 3. Cria/atualiza o contato (dedupe por e-mail)
    const firstName = nome ? nome.split(' ')[0] : '';
    const lastName  = nome ? nome.split(' ').slice(1).join(' ') : '';

    const syncRes = await acFetch(cfg, '/api/3/contact/sync', 'POST', {
      contact: { email, firstName, lastName, phone: phone || '' },
    });
    if (!syncRes.ok) {
      log('502 contact/sync ' + JSON.stringify(syncRes.data).slice(0, 300));
      return json({ ok: false, step: 'contact/sync', status: syncRes.status, error: syncRes.data }, 502);
    }
    const contactId = syncRes.data?.contact?.id;
    if (!contactId) {
      log('502 contact/sync sem id');
      return json({ ok: false, step: 'contact/sync', error: 'contactId ausente na resposta' }, 502);
    }

    // 4. Evita negocio duplicado: se ja existe um deal desse contato neste funil, nao cria outro
    const existing = await acFetch(cfg, `/api/3/contacts/${contactId}/deals`, 'GET');
    if (existing.ok && Array.isArray(existing.data?.deals)) {
      const dup = existing.data.deals.find(d => String(d.group) === String(cfg.pipeline));
      if (dup) {
        log('200 deduped deal ' + dup.id);
        return json({ ok: true, contactId, dealId: dup.id, deduped: true });
      }
    }

    // 5. Cria o negocio na etapa LEAD
    const dealRes = await acFetch(cfg, '/api/3/deals', 'POST', {
      deal: {
        title:    nome ? `${nome}` : email,
        contact:  contactId,
        value:    cfg.value,
        currency: cfg.currency,
        group:    cfg.pipeline,
        stage:    cfg.stage,
        owner:    cfg.owner,
      },
    });
    if (!dealRes.ok) {
      log('502 deals ' + JSON.stringify(dealRes.data).slice(0, 300));
      return json({ ok: false, step: 'deals', status: dealRes.status, error: dealRes.data }, 502);
    }

    log('200 ok deal ' + dealRes.data?.deal?.id);
    return json({ ok: true, contactId, dealId: dealRes.data?.deal?.id });
  } catch (err) {
    log('500 ' + String(err && err.message || err));
    return json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

async function acFetch(cfg, path, method, payload) {
  const res = await fetch(cfg.apiUrl + path, {
    method,
    headers: {
      'Api-Token': cfg.token,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

function parseBody(request, rawText) {
  const ct = request.headers.get('Content-Type') || '';
  try {
    if (ct.includes('application/x-www-form-urlencoded')) {
      return Object.fromEntries(new URLSearchParams(rawText).entries());
    }
    // JSON (ou tenta como JSON por padrao)
    return JSON.parse(rawText);
  } catch {
    return {};
  }
}

function pick(obj, keys) {
  for (const k of keys) {
    if (obj && obj[k] != null && String(obj[k]).trim() !== '') return String(obj[k]).trim();
  }
  return '';
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
