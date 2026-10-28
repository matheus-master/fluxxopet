// Etapas do cadastro por página (/ = atual, /novo = novo) no período, para o /trafego
// (card da aba Funil e aba Página).
// GET ?since=YYYY-MM-DD&until=YYYY-MM-DD[&prevSince=&prevUntil=] (datas de Brasília). JWT pelo middleware.
// Conta visitantes distintos por etapa; dados vêm de /api/etapa (tabela funil_etapas).
// Retorna:
//   paginas  { pagina: { etapa: n } }                 — total do período
//   dias     [{ d, pagina, etapa, n }]                — por dia (data em que o visitante chegou à etapa)
//   prev     { pagina: { etapa: n } } | null          — período de comparação
//   origens  { pagina: { meta|google|outros: { etapa: n } } } — origem pela sessão (cookie _krob_sid)
//   histDias [{ d, etapa, o, n }] / histPrev [{ etapa, o, n }] / histMes [{ m, etapa, o, n }]
//            — histórico da página atual (/) desde jun/2026, antes da medição nova, pela tabela
//              events (/tracker): rolou = ScrollDepth25, dados = Lead (WhatsApp e pet shop),
//              lead = Lead<faixa> (escolheu o faturamento). o = meta | outros. histMes ignora o período.

// origem da visita pela tabela sessions (gravada pelo _middleware na chegada)
const ORIGEM = `CASE
  WHEN s.fbclid != '' OR lower(s.utm_source) IN ('facebook','fb','ig','instagram','meta') THEN 'meta'
  WHEN s.gclid != '' OR lower(s.utm_source) LIKE 'google%' THEN 'google'
  ELSE 'outros' END`;
const DIA = "date(f.created_at, '-3 hours')";

// histórico pelos eventos do /tracker, só da raiz (com ou sem ?fbclid/utm)
const RAIZ = 'https://diagnostico.fluxxopet.com.br/';
const HDIA = "date(e.created_at, '-3 hours')";
const HETAPA = "CASE WHEN e.event_name = 'ScrollDepth25' THEN 'rolou' WHEN e.event_name = 'Lead' THEN 'dados' ELSE 'lead' END";
const HORIG = `CASE WHEN s.fbclid != '' OR lower(s.utm_source) IN ('facebook','fb','ig','instagram','meta') OR e.source_url LIKE '%fbclid=%' THEN 'meta' ELSE 'outros' END`;
const HFROM = `FROM events e LEFT JOIN sessions s ON s.sid = e.session_id
  WHERE (e.event_name IN ('ScrollDepth25', 'Lead') OR e.event_name GLOB 'Lead[0-9]*')
    AND (e.source_url = '${RAIZ}' OR e.source_url LIKE '${RAIZ}?%' OR e.source_url LIKE '${RAIZ}#%')`;
const hist = (db, sel, grp, extra, binds) =>
  db.prepare(`SELECT ${sel}${HETAPA} AS etapa, ${HORIG} AS o, COUNT(DISTINCT e.session_id) AS n ${HFROM}${extra} GROUP BY ${grp}`).bind(...binds).all();

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const since = u.searchParams.get('since'), until = u.searchParams.get('until');
  const prevSince = u.searchParams.get('prevSince'), prevUntil = u.searchParams.get('prevUntil');
  if (!ok(since) || !ok(until)) return json({ ok: false, error: 'since/until inválidos' }, 400);
  const temPrev = ok(prevSince) && ok(prevUntil);

  const consultas = () => Promise.all([
    env.DB.prepare(`SELECT ${DIA} AS d, f.pagina, f.etapa, COUNT(*) AS n FROM funil_etapas f WHERE ${DIA} BETWEEN ? AND ? GROUP BY 1, 2, 3 ORDER BY 1`).bind(since, until).all(),
    env.DB.prepare(`SELECT f.pagina, f.etapa, ${ORIGEM} AS o, COUNT(*) AS n FROM funil_etapas f LEFT JOIN sessions s ON s.sid = f.sid WHERE ${DIA} BETWEEN ? AND ? GROUP BY 1, 2, 3`).bind(since, until).all(),
    temPrev ? env.DB.prepare(`SELECT f.pagina, f.etapa, COUNT(*) AS n FROM funil_etapas f WHERE ${DIA} BETWEEN ? AND ? GROUP BY 1, 2`).bind(prevSince, prevUntil).all() : null,
  ]);
  let r;
  try { r = await consultas(); }
  catch (e) {
    if (!/no such table/i.test(e.message)) return json({ ok: false, error: e.message }, 500);
    await criarTabela(env.DB);
    r = await consultas();
  }
  const [rDias, rOrig, rPrev] = r;

  // histórico (tabela events): se falhar, o resto da resposta continua valendo
  let histDias = [], histPrev = null, histMes = [];
  try {
    const [a, b, c] = await Promise.all([
      hist(env.DB, `${HDIA} AS d, `, '1, 2, 3', ` AND ${HDIA} BETWEEN ? AND ?`, [since, until]),
      temPrev ? hist(env.DB, '', '1, 2', ` AND ${HDIA} BETWEEN ? AND ?`, [prevSince, prevUntil]) : null,
      hist(env.DB, `substr(${HDIA}, 1, 7) AS m, `, '1, 2, 3', ` AND ${HDIA} >= '2026-06-01'`, []),
    ]);
    histDias = a.results || []; histPrev = b ? b.results || [] : null; histMes = c.results || [];
  } catch {}
  const dias = rDias.results || [];
  const paginas = {};
  dias.forEach(x => { const p = paginas[x.pagina] = paginas[x.pagina] || {}; p[x.etapa] = (p[x.etapa] || 0) + x.n; });
  const origens = {};
  (rOrig.results || []).forEach(x => { const p = origens[x.pagina] = origens[x.pagina] || {}; (p[x.o] = p[x.o] || {})[x.etapa] = x.n; });
  let prev = null;
  if (rPrev) { prev = {}; (rPrev.results || []).forEach(x => { (prev[x.pagina] = prev[x.pagina] || {})[x.etapa] = x.n; }); }

  let inicio = null;
  try { inicio = (await env.DB.prepare("SELECT date(MIN(created_at), '-3 hours') AS d FROM funil_etapas").first()).d; } catch {}
  return json({ ok: true, since, until, inicio, paginas, dias, prev, origens, histDias, histPrev, histMes });
}

// (cópia da de etapa.js) mesma estrutura de migrations/0013_funil_etapas.sql
async function criarTabela(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS funil_etapas (sid TEXT NOT NULL, pagina TEXT NOT NULL, etapa TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (sid, pagina, etapa))").run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_funil_etapas_data ON funil_etapas (created_at)').run();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
