// Controle de Marketing — puxa investimento/conversões do Meta (por semana) e
// junta com vendas/faturamento manuais (tabela marketing_weeks). Calcula
// Custo/Conversão e ROAS. Protegido por JWT (middleware de /api).
//
// Métrica de conversão: conversas de WhatsApp iniciadas (campanha de mensagens).
// Para trocar, altere CONV_ACTION.

const CONV_ACTION  = 'onsite_conversion.messaging_conversation_started_7d';
const START        = { y: 2026, m: 6 };            // começa em junho/2026
const MONTH_NAMES  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

export async function onRequestGet(context) {
  const { env } = context;
  const token = env.META_ADS_TOKEN;
  const acct  = env.META_ADS_ACCOUNT_ID;

  // valores manuais salvos
  const manual = {};
  if (env.DB) {
    const r = await env.DB.prepare('SELECT ym, week, vendas, faturamento FROM marketing_weeks').all();
    (r.results || []).forEach(m => { manual[m.ym + '-' + m.week] = m; });
  }

  const todayStr = new Date().toISOString().slice(0, 10);

  // monta a lista de semanas e dispara os fetches do Meta em paralelo
  const monthsDef = ymList();
  const tasks = [];
  monthsDef.forEach(({ y, m }) => {
    const ym = y + '-' + pad(m);
    weekRanges(y, m).forEach(rg => {
      if (token && acct && rg.since <= todayStr) {
        const until = rg.until > todayStr ? todayStr : rg.until;
        tasks.push({ key: ym + '-' + rg.week, promise: fetchWeek(acct, token, rg.since, until) });
      }
    });
  });
  const results = await Promise.all(tasks.map(t => t.promise));
  const metaByKey = {};
  let metaError = null;
  tasks.forEach((t, i) => { metaByKey[t.key] = results[i]; if (results[i].error) metaError = results[i].error; });

  // monta a resposta
  const months = monthsDef.map(({ y, m }) => {
    const ym = y + '-' + pad(m);
    const weeks = weekRanges(y, m).map(rg => {
      const meta = metaByKey[ym + '-' + rg.week] || { spend: 0, conv: 0 };
      const man  = manual[ym + '-' + rg.week] || {};
      const vendas      = man.vendas      != null ? man.vendas      : null;
      const faturamento = man.faturamento != null ? man.faturamento : null;
      const spend = meta.spend || 0, conv = meta.conv || 0;
      return {
        week: rg.week,
        dateLabel: rg.dateLabel,
        spend, conv,
        custoConv: conv > 0 ? spend / conv : 0,
        vendas, faturamento,
        roas: (spend > 0 && faturamento) ? faturamento / spend : 0,
      };
    });
    const t = weeks.reduce((a, w) => ({
      spend: a.spend + w.spend, conv: a.conv + w.conv,
      vendas: a.vendas + (w.vendas || 0), faturamento: a.faturamento + (w.faturamento || 0),
    }), { spend: 0, conv: 0, vendas: 0, faturamento: 0 });
    return {
      ym, label: MONTH_NAMES[m - 1], year: y, weeks,
      total: {
        spend: t.spend, conv: t.conv,
        custoConv: t.conv > 0 ? t.spend / t.conv : 0,
        vendas: t.vendas, faturamento: t.faturamento,
        roas: t.spend > 0 ? t.faturamento / t.spend : 0,
      },
    };
  });

  return json({ ok: true, months, metaOk: !metaError, metaError });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  let body = {};
  try { body = await request.json(); } catch {}
  const ym = body.ym, week = parseInt(body.week, 10);
  if (!ym || !week) return json({ ok: false, error: 'ym e week são obrigatórios' }, 400);
  await env.DB.prepare(
    "INSERT INTO marketing_weeks (ym, week, vendas, faturamento, updated_at) VALUES (?, ?, ?, ?, datetime('now')) " +
    "ON CONFLICT(ym, week) DO UPDATE SET vendas = excluded.vendas, faturamento = excluded.faturamento, updated_at = datetime('now')"
  ).bind(ym, week, numOrNull(body.vendas), numOrNull(body.faturamento)).run();
  return json({ ok: true });
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

async function fetchWeek(acct, token, since, until) {
  try {
    const tr  = encodeURIComponent(JSON.stringify({ since, until }));
    const url = 'https://graph.facebook.com/v21.0/' + acct + '/insights?fields=spend,actions&time_range=' + tr + '&access_token=' + token;
    const res = await fetch(url);
    const data = await res.json();
    if (data.error) return { spend: 0, conv: 0, error: data.error.message };
    const row = (data.data && data.data[0]) || null;
    if (!row) return { spend: 0, conv: 0 };
    let conv = 0;
    (row.actions || []).forEach(a => { if (a.action_type === CONV_ACTION) conv = parseFloat(a.value) || 0; });
    return { spend: parseFloat(row.spend || '0') || 0, conv };
  } catch (e) {
    return { spend: 0, conv: 0, error: String(e && e.message || e) };
  }
}

function ymList() {
  const now = new Date();
  let endY = now.getUTCFullYear();
  let endM = now.getUTCMonth() + 2; // mês atual (1-based) + 1 (um mês à frente para planejamento)
  if (endM > 12) { endM -= 12; endY += 1; }
  const list = [];
  let y = START.y, m = START.m;
  while (y < endY || (y === endY && m <= endM)) {
    list.push({ y, m });
    m++; if (m > 12) { m = 1; y++; }
  }
  return list;
}

function weekRanges(y, m) {
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const ym = y + '-' + pad(m);
  const mk = (wk, d1, d2) => ({
    week: wk, since: ym + '-' + pad(d1), until: ym + '-' + pad(d2),
    dateLabel: pad(d1) + '.' + pad(m) + ' até ' + pad(d2) + '.' + pad(m),
  });
  return [ mk(1, 1, 7), mk(2, 8, 14), mk(3, 15, 21), mk(4, 22, lastDay) ];
}

function pad(n) { return String(n).padStart(2, '0'); }
function numOrNull(v) { const n = parseFloat(v); return isNaN(n) ? null : n; }
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
