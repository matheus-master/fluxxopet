// Funil comercial: reuniões (planilha publicada do Google) + fechamentos (lançados no painel, D1).
// Protegido por JWT (middleware de /api).
//
// GET    /api/comercial              → { ok, reunioes: [{cliente, data}], fechamentos: [{id, data, cliente, valor}], reunioesErro }
// POST   /api/comercial              { data: 'YYYY-MM-DD', cliente, valor? } → registra um fechamento
// DELETE /api/comercial?id=123       → remove um fechamento
//
// A planilha é a de "reuniões concluídas" (Cliente, Data, Status). Conta como reunião
// a linha com data válida e status "Concluída" (ou "Fechou"/"Fechado", que também foi reunião).
// URL pode ser trocada pelo secret/var COMERCIAL_SHEET_CSV.

const SHEET_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTtck_-1HSKf8Ril9eiogMBCHQ5mviihUWTNUmeLCrNe2Chex_kf2fKIo3_YPqbIRp5lPOFGRJXrdgJ/pub?output=csv';
const MESES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestGet({ env }) {
  const [sheet, fech] = await Promise.all([readSheet(env), listFechamentos(env)]);
  return json({ ok: true, reunioes: sheet.rows, reunioesErro: sheet.error || null, fechamentos: fech });
}

export async function onRequestPost({ env, request }) {
  if (!env.DB) return json({ ok: false, error: 'Banco indisponível' }, 500);
  let b;
  try { b = await request.json(); } catch { return json({ ok: false, error: 'JSON inválido' }, 400); }
  const data = String(b.data || '');
  const cliente = String(b.cliente || '').trim().slice(0, 120);
  const valor = b.valor === '' || b.valor == null ? null : Number(b.valor);
  if (!YMD.test(data)) return json({ ok: false, error: 'Data inválida' }, 400);
  if (!cliente) return json({ ok: false, error: 'Informe o cliente' }, 400);
  if (valor !== null && (!isFinite(valor) || valor < 0)) return json({ ok: false, error: 'Valor inválido' }, 400);
  await ensureTable(env.DB);
  const r = await env.DB.prepare('INSERT INTO comercial_fechamentos (data, cliente, valor) VALUES (?, ?, ?)').bind(data, cliente, valor).run();
  return json({ ok: true, id: r.meta?.last_row_id ?? null });
}

export async function onRequestDelete({ env, request }) {
  if (!env.DB) return json({ ok: false, error: 'Banco indisponível' }, 500);
  const id = parseInt(new URL(request.url).searchParams.get('id'), 10);
  if (!id) return json({ ok: false, error: 'id inválido' }, 400);
  await ensureTable(env.DB);
  await env.DB.prepare('DELETE FROM comercial_fechamentos WHERE id = ?').bind(id).run();
  return json({ ok: true });
}

// ── fechamentos ──────────────────────────────────────────
async function listFechamentos(env) {
  if (!env.DB) return [];
  await ensureTable(env.DB);
  const r = await env.DB.prepare('SELECT id, data, cliente, valor FROM comercial_fechamentos ORDER BY data DESC, id DESC').all();
  return r.results || [];
}

// também em migrations/0011_comercial_fechamentos.sql
async function ensureTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS comercial_fechamentos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, cliente TEXT NOT NULL, valor REAL,
    created_at TEXT DEFAULT (datetime('now')))`).run();
}

// ── planilha de reuniões ─────────────────────────────────
async function readSheet(env) {
  try {
    const res = await fetch(env.COMERCIAL_SHEET_CSV || SHEET_CSV, { cf: { cacheTtl: 120 } });
    if (!res.ok) return { rows: [], error: 'Planilha respondeu ' + res.status };
    const lines = parseCSV(await res.text());
    const head = (lines.shift() || []).map(s => s.trim().toLowerCase());
    const iCli = head.indexOf('cliente'), iData = head.indexOf('data'), iSt = head.indexOf('status');
    if (iCli < 0 || iData < 0) return { rows: [], error: 'Planilha sem as colunas Cliente e Data' };
    const rows = [];
    for (const l of lines) {
      const cliente = (l[iCli] || '').trim(), data = parseDate(l[iData]);
      const status = iSt >= 0 ? (l[iSt] || '').toLowerCase() : 'concluída';
      if (!cliente || !data) continue;
      if (!/conclu|fech/.test(status)) continue;
      rows.push({ cliente, data });
    }
    return { rows };
  } catch (e) {
    return { rows: [], error: 'Não consegui ler a planilha: ' + e.message };
  }
}

// "04 jul. 2026", "4/7/2026" ou "2026-07-04" → "2026-07-04"
function parseDate(s) {
  s = String(s || '').trim().toLowerCase();
  let m = s.match(/^(\d{1,2})\s+([a-zç]{3})[a-zç]*\.?\s+(\d{4})$/);
  if (m && MESES[m[2]]) return m[3] + '-' + pad(MESES[m[2]]) + '-' + pad(m[1]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
  return YMD.test(s) ? s : null;
}
function pad(n) { return String(n).padStart(2, '0'); }

// CSV com aspas ("a, b") e aspas escapadas ("")
function parseCSV(text) {
  const out = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); out.push(row); row = []; cur = '';
    } else cur += c;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
