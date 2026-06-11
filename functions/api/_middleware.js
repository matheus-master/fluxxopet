const SKIP_AUTH = ['/api/auth', '/api/submit', '/api/botconversa'];

export async function onRequest(context) {
  const url  = new URL(context.request.url);
  const path = url.pathname;

  if (SKIP_AUTH.some(p => path === p || path.startsWith(p + '/'))) {
    return context.next();
  }

  const authHeader = context.request.headers.get('Authorization') || '';
  const token      = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token || !(await verifyJWT(token, context.env.JWT_SECRET))) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return context.next();
}

async function verifyJWT(token, secret) {
  const parts = (token || '').split('.');
  if (parts.length !== 3) return false;
  try {
    const expectedSig = await hmac(`${parts[0]}.${parts[1]}`, secret);
    if (parts[2] !== expectedSig) return false;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp > Date.now();
  } catch { return false; }
}

async function hmac(data, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
