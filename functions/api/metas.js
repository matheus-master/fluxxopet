// Metas mensais da aba Saúde do /trafego, no D1 (tabela metas_mes, migration 0014).
// Protegido por JWT (middleware de /api). Mês sem linha herda a meta do último mês
// anterior que tiver — isso é resolvido na página; aqui só guarda e devolve.
//
// GET /api/metas → { ok, metas: [{ ym, meta, ticket, updated_at }] } (em ordem de mês)
// PUT /api/metas  { ym: 'AAAA-MM', meta, ticket } → grava as duas (R$, maiores que zero)

const MAX = 1e9;

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, error: 'Banco indisponível' }, 500);
  await ensureTable(env.DB);
  const r = await env.DB.prepare('SELECT ym, meta, ticket, updated_at FROM metas_mes ORDER BY ym').all();
  return json({ ok: true, metas: r.results || [] });
}

export async function onRequestPut({ env, request }) {
  if (!env.DB) return json({ ok: false, error: 'Banco indisponível' }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'JSON inválido' }, 400); }

  const ym = String(body.ym ?? '');
  const meta = reais(body.meta), ticket = reais(body.ticket);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) return json({ ok: false, error: 'Mês inválido' }, 400);
  if (meta == null || ticket == null) return json({ ok: false, error: 'Meta e ticket-alvo precisam ser valores em R$ maiores que zero' }, 400);

  await ensureTable(env.DB);
  await env.DB.prepare(
    "INSERT INTO metas_mes (ym, meta, ticket, updated_at) VALUES (?, ?, ?, datetime('now')) " +
    'ON CONFLICT(ym) DO UPDATE SET meta = excluded.meta, ticket = excluded.ticket, updated_at = excluded.updated_at'
  ).bind(ym, meta, ticket).run();
  return json({ ok: true });
}

// valor em R$ com centavos; null se não for número positivo
function reais(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < MAX ? Math.round(n * 100) / 100 : null;
}

// mesma estrutura de migrations/0014_metas_mes.sql
async function ensureTable(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS metas_mes (ym TEXT PRIMARY KEY, meta REAL NOT NULL, ticket REAL NOT NULL, updated_at TEXT DEFAULT (datetime('now')))").run();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
