// Dashboard de Tráfego (Meta) — Geral, Leads e Seguidores numa resposta só.
// GET /api/meta-trafego?since=YYYY-MM-DD&until=YYYY-MM-DD[&prevSince&prevUntil]
// (protegido por JWT, middleware de /api)
//
// Classificação das campanhas (fixa, não depende do nome):
//   leads      → objetivo de cadastro (OUTCOME_LEADS / LEAD_GENERATION)
//   seguidores → campanhas com conjunto otimizado para visita ao perfil (PROFILE_VISIT)
//   outros     → todo o resto (vendas, engajamento...)
// Leads = ação "lead" atribuída pelo Meta. Visitas ao perfil = link_click das campanhas
// de seguidores (o destino delas é o perfil do Instagram).
//
// Seguidores: métrica follower_count do Instagram (novos seguidores/dia, orgânico + pago).
// A API só devolve os últimos 30 dias, então cada acesso grava esses dias na tabela
// ig_followers_daily (D1) e o histórico vai se acumulando.

const GRAPH = 'https://graph.facebook.com/v21.0';
const LEAD_OBJECTIVES = ['OUTCOME_LEADS', 'LEAD_GENERATION'];
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

  let prevSince = q.get('prevSince'), prevUntil = q.get('prevUntil');
  if (!YMD.test(prevSince || '') || !YMD.test(prevUntil || '')) {
    prevUntil = addDays(since, -1);
    prevSince = addDays(prevUntil, -diffDays(since, until));
  }
  const monthSince     = until.slice(0, 8) + '01';
  const prevMonthSince = shiftMonth(monthSince, -1);
  const prevMonthUntil = minYmd(addDays(prevMonthSince, diffDays(monthSince, until)), addDays(monthSince, -1));

  const act = `${GRAPH}/act_${acct}`;
  const ins = (s, u, daily) => fetchAll(`${act}/insights?level=campaign` +
    `&fields=campaign_id,campaign_name,objective,spend,actions` +
    `&time_range=${enc({ since: s, until: u })}` + (daily ? '&time_increment=1' : '') +
    `&limit=500&access_token=${token}`);

  const [segIds, daily, prev, month, prevMonth, account, ig] = await Promise.all([
    followerCampaignIds(act, token),
    ins(since, until, true),
    ins(prevSince, prevUntil, false),
    ins(monthSince, until, false),
    ins(prevMonthSince, prevMonthUntil, false),
    fetchMeta(`${act}?fields=name&access_token=${token}`),
    instagram(env, token),
  ]);
  if (daily.error) return json({ ok: false, error: daily.error.message }, 400);
  if (segIds.error) return json({ ok: false, error: segIds.error.message }, 400);

  const typeOf = r => LEAD_OBJECTIVES.includes(r.objective) ? 'leads' : segIds.ids.has(r.campaign_id) ? 'seguidores' : 'outros';

  // série diária completa (dias sem veiculação aparecem zerados)
  const byDay = {};
  for (let d = since; d <= until; d = addDays(d, 1)) byDay[d] = emptyDay(d);
  const camps = {};
  daily.data.forEach(r => {
    const day = byDay[r.date_start]; if (!day) return;
    add(day, r, typeOf(r));
    const c = camps[r.campaign_id] ||= { id: r.campaign_id, name: r.campaign_name, type: typeOf(r), spend: 0, leads: 0, visits: 0 };
    c.spend += num(r.spend); c.leads += leadsOf(r); c.visits += act_(r, 'link_click');
  });

  const fol = ig.byDay || {};
  const series = Object.values(byDay).map(d => ({ ...d, followers: fol[d.date] ?? null }));

  const total = (res, s, u) => {
    if (res.error) return null;
    const t = emptyDay(null);
    res.data.forEach(r => add(t, r, typeOf(r)));
    delete t.date;
    t.followers = sumFollowers(fol, s, u);
    return { since: s, until: u, ...t };
  };

  return json({
    ok: true,
    since, until,
    account: account.name || null,
    daily: series,
    prev:      total(prev, prevSince, prevUntil),
    month:     total(month, monthSince, until),
    prevMonth: total(prevMonth, prevMonthSince, prevMonthUntil),
    campaigns: Object.values(camps).filter(c => c.spend > 0).sort((a, b) => b.spend - a.spend),
    ig: { username: ig.username || null, total: ig.total ?? null, firstDay: ig.firstDay || null, error: ig.error || null },
  });
}

function emptyDay(date) {
  return { date, spend: 0, leadsSpend: 0, leads: 0, segSpend: 0, visits: 0, outrosSpend: 0 };
}
function add(t, r, type) {
  const s = num(r.spend);
  t.spend += s;
  if (type === 'leads')           { t.leadsSpend += s; t.leads += leadsOf(r); }
  else if (type === 'seguidores') { t.segSpend += s; t.visits += act_(r, 'link_click'); }
  else                            { t.outrosSpend += s; }
}

// campanhas que têm conjunto otimizado para visita ao perfil (desde sempre)
async function followerCampaignIds(act, token) {
  const filter = [{ field: 'adset.optimization_goal', operator: 'IN', value: ['PROFILE_VISIT'] }];
  const r = await fetchAll(`${act}/insights?level=campaign&fields=campaign_id&date_preset=maximum` +
    `&filtering=${enc(filter)}&limit=500&access_token=${token}`);
  return r.error ? r : { ids: new Set(r.data.map(x => x.campaign_id)) };
}

// ── Instagram ────────────────────────────────────────────
async function instagram(env, token) {
  let igId = env.META_IG_USER_ID;
  if (!igId) {
    const acc = await fetchMeta(`${GRAPH}/me/accounts?fields=instagram_business_account&limit=50&access_token=${token}`);
    if (acc.error) return { error: acc.error.message };
    igId = (acc.data || []).map(p => p.instagram_business_account?.id).find(Boolean);
    if (!igId) return { error: 'Nenhuma conta do Instagram vinculada ao token' };
  }

  // a API aceita no máximo 30 dias, terminando ontem
  const yesterday = addDays(brtToday(), -1), first = addDays(yesterday, -29);
  const [profile, insights] = await Promise.all([
    fetchMeta(`${GRAPH}/${igId}?fields=username,followers_count&access_token=${token}`),
    fetchMeta(`${GRAPH}/${igId}/insights?metric=follower_count&period=day` +
      `&since=${toUnix(first)}&until=${toUnix(addDays(yesterday, 1))}&access_token=${token}`),
  ]);
  if (profile.error) return { error: profile.error.message };

  const byDay = {};
  if (!insights.error) {
    // end_time marca o fim do dia (meia-noite do Pacífico) → o dia é o anterior
    (insights.data?.[0]?.values || []).forEach(v => { byDay[addDays(v.end_time.slice(0, 10), -1)] = num(v.value); });
  }

  // guarda no D1 e lê o histórico acumulado
  if (env.DB) {
    try {
      await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ig_followers_daily (
        day TEXT PRIMARY KEY, new_followers INTEGER NOT NULL, updated_at TEXT DEFAULT (datetime('now')))`).run();
      const up = env.DB.prepare(`INSERT INTO ig_followers_daily (day, new_followers) VALUES (?, ?)
        ON CONFLICT(day) DO UPDATE SET new_followers = excluded.new_followers, updated_at = datetime('now')`);
      const days = Object.keys(byDay);
      if (days.length) await env.DB.batch(days.map(d => up.bind(d, byDay[d])));
      const all = await env.DB.prepare('SELECT day, new_followers FROM ig_followers_daily').all();
      (all.results || []).forEach(r => { if (!(r.day in byDay)) byDay[r.day] = r.new_followers; });
    } catch (e) { /* sem histórico: segue só com os 30 dias da API */ }
  }

  const known = Object.keys(byDay).sort();
  return {
    username: profile.username,
    total: profile.followers_count,
    byDay,
    firstDay: known[0] || null,
    error: insights.error ? insights.error.message : null,
  };
}

// o Instagram leva 1–2 dias para consolidar, então tolera até 2 dias faltando;
// mais que isso, o período está incompleto e não serve para comparação
function sumFollowers(byDay, s, u) {
  let t = 0, missing = 0;
  for (let d = s; d <= u; d = addDays(d, 1)) {
    if (byDay[d] == null) missing++;
    else t += byDay[d];
  }
  return missing > 2 ? null : t;
}

// ── helpers ──────────────────────────────────────────────
function leadsOf(r) {
  for (const k of LEAD_ACTIONS) {
    const v = act_(r, k);
    if (v) return v;
  }
  return 0;
}
function act_(r, key) { return num((r.actions || []).find(a => a.action_type === key)?.value); }

async function fetchAll(url) {
  const data = [];
  for (let next = url, i = 0; next && i < 30; i++) {
    const r = await fetchMeta(next);
    if (r.error) return r;
    data.push(...(r.data || []));
    next = r.paging?.next;
  }
  return { data };
}

function enc(o) { return encodeURIComponent(JSON.stringify(o)); }
function brtToday() { return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10); }
function addDays(ymd, n) { return new Date(Date.parse(ymd + 'T00:00:00Z') + n * DAY_MS).toISOString().slice(0, 10); }
function diffDays(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS); }
function shiftMonth(ymd, n) { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); }
function minYmd(a, b) { return a < b ? a : b; }
function toUnix(ymd) { return Math.floor(Date.parse(ymd + 'T03:00:00Z') / 1000); }
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
