// Metas da aba Saúde do /trafego, no D1. Protegido por JWT (middleware de /api).
// - metas_mes (migration 0014): meta de faturamento e ticket-alvo de cada mês. Mês sem linha herda
//   a do último mês anterior que tiver — isso é resolvido na página; aqui só guarda e devolve.
// - metas_periodo (migration 0015): meta anual = um período (ex.: 2026-11 a 2027-12). O total do
//   período é a soma das metas mensais dos meses dele, então salvar o período grava todos os meses.
//
// GET /api/metas → { ok, metas: [{ ym, meta, ticket, updated_at }], periodos: [{ inicio, fim, updated_at }] }
// PUT /api/metas  { ym: 'AAAA-MM', meta, ticket } → grava um mês
// PUT /api/metas  { periodo: { inicio, fim }, meses: [{ ym, meta, ticket }, ...] } → grava o período e
//                 todos os meses dele (um por mês, sem faltar nenhum); períodos que se sobrepõem são trocados

const MAX = 1e9, MAX_MESES = 36;
const YM = /^\d{4}-(0[1-9]|1[0-2])$/;
const UPSERT_MES =
  "INSERT INTO metas_mes (ym, meta, ticket, updated_at) VALUES (?, ?, ?, datetime('now')) " +
  'ON CONFLICT(ym) DO UPDATE SET meta = excluded.meta, ticket = excluded.ticket, updated_at = excluded.updated_at';

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, error: 'Banco indisponível' }, 500);
  await ensureTables(env.DB);
  const [m, p] = await Promise.all([
    env.DB.prepare('SELECT ym, meta, ticket, updated_at FROM metas_mes ORDER BY ym').all(),
    env.DB.prepare('SELECT inicio, fim, updated_at FROM metas_periodo ORDER BY inicio').all(),
  ]);
  return json({ ok: true, metas: m.results || [], periodos: p.results || [] });
}

export async function onRequestPut({ env, request }) {
  if (!env.DB) return json({ ok: false, error: 'Banco indisponível' }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'JSON inválido' }, 400); }
  if (body && body.periodo) return salvarPeriodo(env.DB, body);

  const ym = String(body.ym ?? '');
  const meta = reais(body.meta), ticket = reais(body.ticket);
  if (!YM.test(ym)) return json({ ok: false, error: 'Mês inválido' }, 400);
  if (meta == null || ticket == null) return json({ ok: false, error: 'Meta e ticket-alvo precisam ser valores em R$ maiores que zero' }, 400);

  await ensureTables(env.DB);
  await env.DB.prepare(UPSERT_MES).bind(ym, meta, ticket).run();
  return json({ ok: true });
}

async function salvarPeriodo(db, body) {
  const inicio = String(body.periodo.inicio ?? ''), fim = String(body.periodo.fim ?? '');
  if (!YM.test(inicio) || !YM.test(fim)) return json({ ok: false, error: 'Mês de início ou de fim inválido' }, 400);
  if (fim < inicio) return json({ ok: false, error: 'O período termina antes de começar' }, 400);
  const yms = [];
  for (let ym = inicio; ym <= fim; ym = proximo(ym)) yms.push(ym);
  if (yms.length > MAX_MESES) return json({ ok: false, error: 'O período pode ter no máximo ' + MAX_MESES + ' meses' }, 400);

  const meses = new Map();
  for (const m of Array.isArray(body.meses) ? body.meses : []) {
    const ym = String(m && m.ym || ''), meta = reais(m && m.meta), ticket = reais(m && m.ticket);
    if (!yms.includes(ym) || meses.has(ym)) return json({ ok: false, error: 'Mês fora do período ou repetido: ' + ym }, 400);
    if (meta == null || ticket == null) return json({ ok: false, error: 'Meta e ticket-alvo de ' + ym + ' precisam ser valores em R$ maiores que zero' }, 400);
    meses.set(ym, [meta, ticket]);
  }
  const faltam = yms.filter(ym => !meses.has(ym));
  if (faltam.length) return json({ ok: false, error: 'Faltou a meta de ' + faltam.join(', ') }, 400);

  await ensureTables(db);
  // tudo ou nada: o período e os meses dele
  await db.batch([
    db.prepare('DELETE FROM metas_periodo WHERE inicio <= ? AND fim >= ?').bind(fim, inicio),
    db.prepare("INSERT INTO metas_periodo (inicio, fim, updated_at) VALUES (?, ?, datetime('now'))").bind(inicio, fim),
    ...yms.map(ym => db.prepare(UPSERT_MES).bind(ym, meses.get(ym)[0], meses.get(ym)[1])),
  ]);
  return json({ ok: true });
}

function proximo(ym) {
  const y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  return m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0');
}

// valor em R$ com centavos; null se não for número positivo
function reais(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < MAX ? Math.round(n * 100) / 100 : null;
}

// mesma estrutura de migrations/0014_metas_mes.sql e 0015_metas_periodo.sql
async function ensureTables(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS metas_mes (ym TEXT PRIMARY KEY, meta REAL NOT NULL, ticket REAL NOT NULL, updated_at TEXT DEFAULT (datetime('now')))").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS metas_periodo (inicio TEXT PRIMARY KEY, fim TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')))").run();
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
