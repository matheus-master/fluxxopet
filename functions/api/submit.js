export async function onRequestPost(context) {
  const { request, env } = context;

  let body = {};
  try { body = await request.json(); } catch {}

  const { nome, whatsapp, email, faturamento } = body;
  if (!nome && !whatsapp) return json({ ok: false, error: 'Dados insuficientes' }, 400);

  await env.DB.prepare(
    'INSERT INTO leads (nome, whatsapp, email, faturamento) VALUES (?, ?, ?, ?)'
  ).bind(nome || '', whatsapp || '', email || '', faturamento || '').run();

  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
