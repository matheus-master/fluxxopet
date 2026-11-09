// pagina_lead: a página de onde o lead veio. Gravada pela /api/submit desde 2026-11-09 (coluna pagina);
// nos leads de antes, deduzida pela etapa "lead" do funil (desde 27/10) ou pelo clique do Google (→ /lp).
const COM_PAGINA = `SELECT l.*, COALESCE(NULLIF(l.pagina, ''),
    (SELECT CASE f.pagina WHEN 'atual' THEN '/' WHEN 'novo' THEN '/novo' WHEN 'analise' THEN '/analise' END
       FROM funil_etapas f WHERE l.session_id != '' AND f.sid = l.session_id AND f.etapa = 'lead' LIMIT 1),
    (SELECT '/lp' FROM sessions s WHERE l.session_id != '' AND s.sid = l.session_id AND (s.gclid != '' OR lower(s.utm_source) LIKE 'google%') LIMIT 1),
    '') AS pagina_lead
  FROM leads l ORDER BY l.created_at DESC`;

export async function onRequestGet(context) {
  const { env } = context;
  let result;
  try { result = await env.DB.prepare(COM_PAGINA).all(); }
  catch (e) {
    if (/no such column/i.test(e.message)) {
      // banco ainda sem a migration 0017: cria a coluna e tenta de novo
      try { await env.DB.prepare("ALTER TABLE leads ADD COLUMN pagina TEXT DEFAULT ''").run(); } catch (x) { if (!/duplicate column/i.test(x.message)) throw x; }
      result = await env.DB.prepare(COM_PAGINA).all();
    } else if (/no such table/i.test(e.message)) {
      result = await env.DB.prepare("SELECT *, '' AS pagina_lead FROM leads ORDER BY created_at DESC").all();
    } else throw e;
  }
  return json({ ok: true, leads: result.results || [] });
}

export async function onRequestDelete(context) {
  const { env } = context;
  await env.DB.prepare('DELETE FROM leads').run();
  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
