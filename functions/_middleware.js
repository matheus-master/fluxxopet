export async function onRequest(context) {
  const { request, next, env } = context;
  const url  = new URL(request.url);
  const path = url.pathname;

  // Skip API routes and static assets
  const isApi   = path.startsWith('/tracker') || path.startsWith('/admin');
  const isAsset = /\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|webp|avif|map)$/.test(path);
  if (isApi || isAsset) return next();

  const response = await next();

  // Use raw URL string to preserve exact fbclid value (Meta requires unmodified click ID)
  const rawSearch = url.search;
  const fbclid = extractRawParam(rawSearch, 'fbclid');
  const gclid  = extractRawParam(rawSearch, 'gclid');

  const utmSource   = url.searchParams.get('utm_source')   || '';
  const utmMedium   = url.searchParams.get('utm_medium')   || '';
  const utmCampaign = url.searchParams.get('utm_campaign') || '';
  const utmContent  = url.searchParams.get('utm_content')  || '';
  const utmTerm     = url.searchParams.get('utm_term')     || '';

  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = parseCookies(cookieHeader);

  const sid = cookies['_krob_sid'] || generateId();
  const eid = cookies['_krob_eid'] || generateId();
  const fbp = cookies['_fbp']      || generateFbp();
  const fbc = fbclid
    ? `fb.1.${Date.now()}.${fbclid}`
    : (cookies['_fbc'] || '');

  const domain     = computeCookieDomain(url.hostname);
  const domainAttr = domain ? `Domain=${domain}; ` : '';
  const cookieBase = `${domainAttr}Path=/; Max-Age=34560000; SameSite=Lax`;

  const newResponse = new Response(response.body, response);
  newResponse.headers.append('Set-Cookie', `_krob_sid=${sid}; ${cookieBase}`);
  newResponse.headers.append('Set-Cookie', `_krob_eid=${eid}; ${cookieBase}`);
  newResponse.headers.append('Set-Cookie', `_fbp=${fbp}; ${cookieBase}`);
  if (fbc) {
    newResponse.headers.append('Set-Cookie', `_fbc=${fbc}; ${cookieBase}`);
  }

  if (env.DB) {
    context.waitUntil(
      env.DB.prepare(`
        INSERT INTO sessions (sid, fbp, fbc, fbclid, gclid, utm_source, utm_medium, utm_campaign, utm_content, utm_term)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET
          fbp          = CASE WHEN excluded.fbp          != '' THEN excluded.fbp          ELSE fbp          END,
          fbc          = CASE WHEN excluded.fbc          != '' THEN excluded.fbc          ELSE fbc          END,
          fbclid       = CASE WHEN excluded.fbclid       != '' THEN excluded.fbclid       ELSE fbclid       END,
          gclid        = CASE WHEN excluded.gclid        != '' THEN excluded.gclid        ELSE gclid        END,
          utm_source   = CASE WHEN excluded.utm_source   != '' THEN excluded.utm_source   ELSE utm_source   END,
          utm_medium   = CASE WHEN excluded.utm_medium   != '' THEN excluded.utm_medium   ELSE utm_medium   END,
          utm_campaign = CASE WHEN excluded.utm_campaign != '' THEN excluded.utm_campaign ELSE utm_campaign END,
          utm_content  = CASE WHEN excluded.utm_content  != '' THEN excluded.utm_content  ELSE utm_content  END,
          utm_term     = CASE WHEN excluded.utm_term     != '' THEN excluded.utm_term     ELSE utm_term     END,
          updated_at   = datetime('now')
      `).bind(sid, fbp, fbc, fbclid, gclid, utmSource, utmMedium, utmCampaign, utmContent, utmTerm).run()
    );
  }

  return newResponse;
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

function parseCookies(header) {
  const cookies = {};
  header.split(';').forEach(part => {
    const [k, ...v] = part.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=').trim();
  });
  return cookies;
}

function generateId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateFbp() {
  return `fb.1.${Date.now()}.${Math.floor(Math.random() * 2147483647)}`;
}

function extractRawParam(search, param) {
  const m = search.match(new RegExp('[?&]' + param + '=([^&]*)'));
  return m ? m[1] : '';
}

function computeCookieDomain(hostname) {
  if (!hostname || hostname === 'localhost') return '';
  const parts  = hostname.split('.');
  const ccTLDs = ['com.br', 'co.uk', 'com.au', 'co.jp', 'com.ar'];
  const last2  = parts.slice(-2).join('.');
  if (ccTLDs.includes(last2) && parts.length > 2) return '.' + parts.slice(-3).join('.');
  if (parts.length <= 2) return '.' + hostname;
  return '.' + parts.slice(-2).join('.');
}
