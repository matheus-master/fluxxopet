export async function onRequestGet(context) {
  const { env } = context;
  const result = await env.DB.prepare(
    'SELECT * FROM leads ORDER BY created_at DESC'
  ).all();
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
