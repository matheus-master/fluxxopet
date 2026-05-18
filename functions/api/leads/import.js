export async function onRequestPost(context) {
  const { env, request } = context;

  let body = {};
  try { body = await request.json(); } catch {}

  const leads = Array.isArray(body.leads) ? body.leads : [];
  if (!leads.length) return json({ ok: true, inserted: 0 });

  const stmts = leads.map(l => env.DB.prepare(
    `INSERT INTO leads (nome, whatsapp, email, faturamento, etapa, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    l.nome        || '—',
    l.whatsapp    || '',
    l.email       || '',
    l.faturamento || '',
    l.etapa       || 'Contato inicial',
    l.timestamp
      ? new Date(l.timestamp).toISOString().replace('T', ' ').slice(0, 19)
      : new Date().toISOString().replace('T', ' ').slice(0, 19)
  ));

  await env.DB.batch(stmts);
  return json({ ok: true, inserted: leads.length });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
