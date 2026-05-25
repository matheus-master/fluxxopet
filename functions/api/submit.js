export async function onRequestPost(context) {
  const { request, env } = context;

  let body = {};
  try { body = await request.json(); } catch {}

  const { nome, petshop, whatsapp, email, faturamento } = body;
  if (!nome && !whatsapp) return json({ ok: false, error: 'Dados insuficientes' }, 400);

  // Captura session_id do cookie para vincular o lead à sessão original (fbp, fbc, ga_client_id)
  const cookieHeader = request.headers.get('Cookie') || '';
  const sidMatch     = cookieHeader.match(/_krob_sid=([^;]+)/);
  const session_id   = sidMatch ? decodeURIComponent(sidMatch[1]) : '';

  await env.DB.prepare(
    'INSERT INTO leads (nome, petshop, whatsapp, email, faturamento, session_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(nome || '', petshop || '', whatsapp || '', email || '', faturamento || '', session_id).run();

  return json({ ok: true });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
