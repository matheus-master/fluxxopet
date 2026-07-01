export async function onRequestPost(context) {
  const { request, env } = context;

  let body = {};
  try { body = await request.json(); } catch {}

  // Modo atualização: enriquece um lead existente com os dados do simulador (diagnóstico)
  if (body.id) {
    await env.DB.prepare(
      'UPDATE leads SET sim_fat = ?, sim_racao = ?, sim_med = ?, perda_icms = ?, perda_pis = ?, perda_mensal = ?, perda_anual = ? WHERE id = ?'
    ).bind(
      num(body.sim_fat), num(body.sim_racao), num(body.sim_med),
      num(body.perda_icms), num(body.perda_pis), num(body.perda_mensal), num(body.perda_anual),
      body.id
    ).run();
    return json({ ok: true, id: body.id });
  }

  const { nome, petshop, whatsapp, email, faturamento } = body;
  if (!nome && !whatsapp) return json({ ok: false, error: 'Dados insuficientes' }, 400);

  // Captura session_id do cookie para vincular o lead à sessão original (fbp, fbc, ga_client_id)
  const cookieHeader = request.headers.get('Cookie') || '';
  const sidMatch     = cookieHeader.match(/_krob_sid=([^;]+)/);
  const session_id   = sidMatch ? decodeURIComponent(sidMatch[1]) : '';

  const res = await env.DB.prepare(
    'INSERT INTO leads (nome, petshop, whatsapp, email, faturamento, session_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(nome || '', petshop || '', whatsapp || '', email || '', faturamento || '', session_id).run();

  return json({ ok: true, id: res.meta ? res.meta.last_row_id : null });
}

function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
