export async function onRequestPost(context) {
  const { request, env } = context;

  let body = {};
  try { body = await request.json(); } catch {}

  if (!body.password || body.password !== env.ADMIN_PASSWORD) {
    return json({ ok: false, error: 'Senha incorreta' }, 401);
  }

  const token = await createJWT(env.JWT_SECRET);
  return json({ ok: true, token });
}

async function createJWT(secret) {
  const header  = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64u(JSON.stringify({ exp: Date.now() + 28800000 })); // 8h
  const sig     = await hmac(`${header}.${payload}`, secret);
  return `${header}.${payload}.${sig}`;
}

async function hmac(data, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return b64u(String.fromCharCode(...new Uint8Array(buf)));
}

function b64u(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
