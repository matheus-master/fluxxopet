export async function onRequestPost(context) {
  const { request, env } = context;

  let body = {};
  try { body = await request.json(); } catch {}

  // Modo atualização: enriquece um lead existente com os dados do simulador (diagnóstico)
  if (body.id) {
    await env.DB.prepare(
      'UPDATE leads SET sim_fat = ?, sim_racao = ?, sim_med = ?, perda_icms = ?, perda_pis = ?, perda_mensal = ?, perda_anual = ? WHERE id = ?'
    ).bind(
      num(body.sim_fat), num(body.sim_racao), num(body.sim_med),
      num(body.perda_icms), num(body.perda_pis), num(body.perda_mensal), num(body.perda_anual),
      body.id
    ).run();
    return json({ ok: true, id: body.id });
  }

  const { nome, petshop, whatsapp, email, faturamento } = body;
  if (!nome && !whatsapp) return json({ ok: false, error: 'Dados insuficientes' }, 400);

  // Captura session_id do cookie para vincular o lead à sessão original (fbp, fbc, ga_client_id)
  const cookieHeader = request.headers.get('Cookie') || '';
  const sidMatch     = cookieHeader.match(/_krob_sid=([^;]+)/);
  const session_id   = sidMatch ? decodeURIComponent(sidMatch[1]) : '';

  const res = await env.DB.prepare(
    'INSERT INTO leads (nome, petshop, whatsapp, email, faturamento, session_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(nome || '', petshop || '', whatsapp || '', email || '', faturamento || '', session_id).run();

  // Envia o lead para o ActiveCampaign em segundo plano (não atrasa a resposta do formulário)
  if (email) {
    context.waitUntil(syncToAC(env, { nome, petshop, email, whatsapp }));
  }

  return json({ ok: true, id: res.meta ? res.meta.last_row_id : null });
}

// ── ACTIVECAMPAIGN ───────────────────────────────────────────────────────────
// Cria/atualiza o contato e abre um negócio na etapa "Lead".
// Dedupe: por e-mail (contato) e por funil (não cria 2º negócio no mesmo funil).

async function syncToAC(env, lead) {
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
    return acLog(env, lead, 'AC nao configurado');
  }
  try {
    const firstName = lead.nome ? lead.nome.split(' ')[0] : '';
    const lastName  = lead.nome ? lead.nome.split(' ').slice(1).join(' ') : '';

    const sync = await acFetch(cfg, '/api/3/contact/sync', 'POST', {
      contact: { email: lead.email, firstName, lastName, phone: lead.whatsapp || '' },
    });
    if (!sync.ok) return acLog(env, lead, '502 contact/sync ' + JSON.stringify(sync.data).slice(0, 200));
    const contactId = sync.data?.contact?.id;
    if (!contactId) return acLog(env, lead, '502 contact/sync sem id');

    const existing = await acFetch(cfg, `/api/3/contacts/${contactId}/deals`, 'GET');
    if (existing.ok && Array.isArray(existing.data?.deals)) {
      const dup = existing.data.deals.find(d => String(d.group) === String(cfg.pipeline));
      if (dup) return acLog(env, lead, '200 deduped deal ' + dup.id);
    }

    const title = lead.nome
      ? (lead.petshop ? `${lead.nome} — ${lead.petshop}` : lead.nome)
      : lead.email;
    const deal = await acFetch(cfg, '/api/3/deals', 'POST', {
      deal: {
        title, contact: contactId, value: cfg.value, currency: cfg.currency,
        group: cfg.pipeline, stage: cfg.stage, owner: cfg.owner,
      },
    });
    if (!deal.ok) return acLog(env, lead, '502 deals ' + JSON.stringify(deal.data).slice(0, 200));
    return acLog(env, lead, '200 ok deal ' + deal.data?.deal?.id);
  } catch (e) {
    return acLog(env, lead, '500 ' + String(e && e.message || e));
  }
}

async function acFetch(cfg, path, method, payload) {
  const res = await fetch(cfg.apiUrl + path, {
    method,
    headers: { 'Api-Token': cfg.token, 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, data };
}

// Log de diagnóstico (mesma tabela usada pela ponte do BotConversa)
function acLog(env, lead, result) {
  if (!env.DB) return;
  return env.DB.prepare(
    'INSERT INTO webhook_log (raw, email, nome, telefone, result) VALUES (?, ?, ?, ?, ?)'
  ).bind('origem: formulario do site', lead.email || '', lead.nome || '', lead.whatsapp || '', result)
   .run().catch(() => {});
}

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
