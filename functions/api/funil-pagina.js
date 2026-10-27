// Etapas do cadastro por página (/ = atual, /novo = novo) no período, para a aba Funil do /trafego.
// GET ?since=YYYY-MM-DD&until=YYYY-MM-DD (datas de Brasília). JWT pelo middleware.
// Conta visitantes distintos por etapa; dados vêm de /api/etapa (tabela funil_etapas).

export async function onRequestGet({ request, env }) {
  const u = new URL(request.url);
  const ok = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const since = u.searchParams.get('since'), until = u.searchParams.get('until');
  if (!ok(since) || !ok(until)) return json({ ok: false, error: 'since/until inválidos' }, 400);

  const q = () => env.DB.prepare(
    "SELECT pagina, etapa, COUNT(*) AS n FROM funil_etapas WHERE date(created_at, '-3 hours') BETWEEN ? AND ? GROUP BY pagina, etapa"
  ).bind(since, until).all();
  let r;
  try { r = await q(); }
  catch (e) {
    if (!/no such table/i.test(e.message)) return json({ ok: false, error: e.message }, 500);
    await criarTabela(env.DB);
    r = await q();
  }
  const paginas = {};
  (r.results || []).forEach(x => { (paginas[x.pagina] = paginas[x.pagina] || {})[x.etapa] = x.n; });

  let inicio = null;
  try { inicio = (await env.DB.prepare("SELECT date(MIN(created_at), '-3 hours') AS d FROM funil_etapas").first()).d; } catch {}
  return json({ ok: true, since, until, inicio, paginas });
}

// (cópia da de etapa.js) mesma estrutura de migrations/0013_funil_etapas.sql
async function criarTabela(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS funil_etapas (sid TEXT NOT NULL, pagina TEXT NOT NULL, etapa TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (sid, pagina, etapa))").run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_funil_etapas_data ON funil_etapas (created_at)').run();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
