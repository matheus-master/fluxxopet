// Dashboard de Tráfego (Meta) — investimento e leads, por dia, com filtro de campanha.
// GET /api/meta-trafego?since=YYYY-MM-DD&until=YYYY-MM-DD[&prevSince&prevUntil][&campaign=<id>]
// (protegido por JWT, middleware de /api)
//
// Devolve a série diária do período (o agrupamento por semana/mês/trimestre/... é
// feito na página), o total do período anterior para comparação e o mês corrente
// (mês do `until`) contra o mesmo trecho do mês anterior.
//
// Leads: ação "lead" que o Meta atribui aos anúncios (evento Lead do pixel).

const GRAPH = 'https://graph.facebook.com/v21.0';
const LEAD_ACTIONS = ['lead', 'offsite_conversion.fb_pixel_lead'];
const DAY_MS = 86400000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestGet(context) {
  const { env, request } = context;
  const token = env.META_ADS_TOKEN;
  const acct  = env.META_ADS_ACCOUNT_ID || '4038372153047790';
  if (!token) return json({ ok: false, error: 'META_ADS_TOKEN não configurado' }, 500);

  const q = new URL(request.url).searchParams;
  const since = q.get('since'), until = q.get('until');
  if (!YMD.test(since || '') || !YMD.test(until || '') || since > until)
    return json({ ok: false, error: 'Parâmetros since/until inválidos' }, 400);

  const campaign = q.get('campaign');
  if (campaign && !/^\d+$/.test(campaign)) return json({ ok: false, error: 'Campanha inválida' }, 400);
  const node = campaign || `act_${acct}`;

  let prevSince = q.get('prevSince'), prevUntil = q.get('prevUntil');
  if (!YMD.test(prevSince || '') || !YMD.test(prevUntil || '')) {
    const len = diffDays(since, until);
    prevUntil = addDays(since, -1);
    prevSince = addDays(prevUntil, -len);
  }

  // mês corrente até o `until` × mesmo trecho do mês anterior
  const monthSince     = until.slice(0, 8) + '01';
  const prevMonthSince = shiftMonth(monthSince, -1);
  const prevMonthUntil = minYmd(addDays(prevMonthSince, diffDays(monthSince, until)), addDays(monthSince, -1));

  const total = (s, u) => fetchMeta(insightsUrl(node, token, s, u, false)).then(r => r.error ? r : row(r.data?.[0]));

  const [daily, prev, month, prevMonth] = await Promise.all([
    fetchAll(insightsUrl(node, token, since, until, true)),
    total(prevSince, prevUntil),
    total(monthSince, until),
    total(prevMonthSince, prevMonthUntil),
  ]);
  if (daily.error) return json({ ok: false, error: daily.error.message }, 400);

  // série completa: dias sem veiculação aparecem com zero
  const byDay = {};
  daily.data.forEach(r => { byDay[r.date_start] = row(r); });
  const series = [];
  for (let d = since; d <= until; d = addDays(d, 1)) series.push({ date: d, ...(byDay[d] || { spend: 0, leads: 0 }) });

  const ok = r => (r && !r.error ? r : null);
  return json({
    ok: true,
    since, until, campaign: campaign || null,
    daily: series,
    prev:  ok(prev)  && { since: prevSince, until: prevUntil, ...prev },
    month: ok(month) && { since: monthSince, until, ...month },
    prevMonth: ok(prevMonth) && { since: prevMonthSince, until: prevMonthUntil, ...prevMonth },
  });
}

function insightsUrl(node, token, since, until, daily) {
  return `${GRAPH}/${node}/insights?fields=spend,actions` +
    `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}` +
    (daily ? '&time_increment=1&limit=500' : '') + `&access_token=${token}`;
}

function row(r) {
  if (!r) return { spend: 0, leads: 0 };
  const acts = r.actions || [];
  let leads = 0;
  for (const k of LEAD_ACTIONS) {
    const a = acts.find(x => x.action_type === k);
    if (a) { leads = num(a.value); break; }
  }
  return { spend: num(r.spend), leads };
}

// segue a paginação (períodos longos passam de 500 dias)
async function fetchAll(url) {
  const data = [];
  for (let next = url, i = 0; next && i < 20; i++) {
    const r = await fetchMeta(next);
    if (r.error) return r;
    data.push(...(r.data || []));
    next = r.paging?.next;
  }
  return { data };
}

function addDays(ymd, n) { return new Date(Date.parse(ymd + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10); }
function diffDays(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS); }
function shiftMonth(ymd, n) { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); }
function minYmd(a, b) { return a < b ? a : b; }
function num(v) { return parseFloat(v || 0) || 0; }

async function fetchMeta(url) {
  try {
    const r = await fetch(url);
    return r.json();
  } catch (e) {
    return { error: { message: e.message } };
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
