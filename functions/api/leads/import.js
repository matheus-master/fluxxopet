export async function onRequestPost(context) {
  const { env, request } = context;

  let body = {};
  try { body = await request.json(); } catch {}

  const leads = Array.isArray(body.leads) ? body.leads : [];
  if (!leads.length) return json({ ok: true, inserted: 0 });

  // pagina 'manual': cadastrado no admin (Novo contato / importação), não por uma página do site
  const stmts = () => leads.map(l => env.DB.prepare(
    `INSERT INTO leads (nome, whatsapp, email, faturamento, etapa, created_at, pagina)
     VALUES (?, ?, ?, ?, ?, ?, 'manual')`
  ).bind(
    l.nome        || '—',
    l.whatsapp    || '',
    l.email       || '',
    l.faturamento || '',
    l.etapa       || 'Sem contato',   // sem etapa = entrada; o painel mostra na 1ª etapa do CRM
    l.timestamp
      ? new Date(l.timestamp).toISOString().replace('T', ' ').slice(0, 19)
      : new Date().toISOString().replace('T', ' ').slice(0, 19)
  ));

  try { await env.DB.batch(stmts()); }
  catch (e) {
    if (!/no such column|has no column named/i.test(e.message)) throw e;
    // banco ainda sem a migration 0017
    try { await env.DB.prepare("ALTER TABLE leads ADD COLUMN pagina TEXT DEFAULT ''").run(); } catch (x) { if (!/duplicate column/i.test(x.message)) throw x; }
    await env.DB.batch(stmts());
  }
  return json({ ok: true, inserted: leads.length });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
