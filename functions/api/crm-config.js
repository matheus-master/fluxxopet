// Configuração compartilhada do CRM: etapas do kanban e lista de tags, no D1.
// Antes ficava no localStorage de cada navegador, então uma etapa criada num
// aparelho não existia nos outros. Protegido por JWT (middleware de /api).
//
// GET /api/crm-config → { ok, stages: [...] | null, tags: [...] | null }
//   null = ainda não salvo no banco (o painel faz a migração na 1ª abertura)
// PUT /api/crm-config  { stages?: [...], tags?: [...] } → grava o que vier
//   + rename?: { from, to } → renomeia a etapa e move os leads dela, na mesma transação

const KEYS = ['stages', 'tags'];
const MAX_ITEMS = 50;
const MAX_LEN = 60;

export async function onRequestGet({ env }) {
  if (!env.DB) return json({ ok: false, error: 'Banco indisponível' }, 500);
  await ensureTable(env.DB);
  const r = await env.DB.prepare('SELECT key, value FROM crm_config').all();
  const out = { ok: true, stages: null, tags: null };
  (r.results || []).forEach(row => {
    if (!KEYS.includes(row.key)) return;
    try { out[row.key] = JSON.parse(row.value); } catch { /* valor corrompido: trata como não salvo */ }
  });
  return json(out);
}

export async function onRequestPut({ env, request }) {
  if (!env.DB) return json({ ok: false, error: 'Banco indisponível' }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'JSON inválido' }, 400); }

  const writes = [];
  for (const k of KEYS) {
    if (body[k] === undefined) continue;
    const list = cleanList(body[k]);
    if (!list) return json({ ok: false, error: `Lista de ${k} inválida` }, 400);
    if (k === 'stages' && !list.length) return json({ ok: false, error: 'O CRM precisa ter ao menos uma etapa' }, 400);
    writes.push([k, JSON.stringify(list)]);
  }
  if (!writes.length) return json({ ok: false, error: 'Nada para salvar' }, 400);

  // renomear etapa: valida e atualiza os leads junto com a lista (tudo ou nada)
  let rename = null;
  if (body.rename !== undefined) {
    const from = String(body.rename?.from ?? '').trim(), to = String(body.rename?.to ?? '').trim();
    const newStages = body.stages && cleanList(body.stages);
    if (!from || !to || to.length > MAX_LEN || from === to) return json({ ok: false, error: 'Nome de etapa inválido' }, 400);
    if (to.toLowerCase() === 'sem contato') return json({ ok: false, error: '"Sem contato" é reservado' }, 400);
    if (!newStages || !newStages.includes(to) || newStages.includes(from)) return json({ ok: false, error: 'A lista de etapas não confere com a renomeação' }, 400);
    rename = { from, to };
  }

  await ensureTable(env.DB);
  const up = env.DB.prepare(`INSERT INTO crm_config (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`);
  const stmts = writes.map(([k, v]) => up.bind(k, v));
  if (rename) stmts.push(env.DB.prepare(`UPDATE leads SET etapa = ?, updated_at = datetime('now') WHERE etapa = ?`).bind(rename.to, rename.from));
  const res = await env.DB.batch(stmts);
  const moved = rename ? (res?.[res.length - 1]?.meta?.changes ?? null) : undefined;
  return json({ ok: true, ...(rename && { moved }) });
}

// a tabela também está em migrations/0010_crm_config.sql; criar aqui evita depender de rodar a migration
async function ensureTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS crm_config (
    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')))`).run();
}

// lista de textos: sem vazios, sem repetidos, com limite de tamanho
function cleanList(arr) {
  if (!Array.isArray(arr) || arr.length > MAX_ITEMS) return null;
  const seen = new Set(), out = [];
  for (const x of arr) {
    const s = String(x ?? '').trim().slice(0, MAX_LEN);
    if (!s || seen.has(s)) continue;
    seen.add(s); out.push(s);
  }
  return out;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
