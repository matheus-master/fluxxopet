const GA4_EVENT_MAP = {
  Lead:           'generate_lead',
  Lead20k:        'lead_20k',
  Lead50k:        'lead_50k',
  Lead100k:       'lead_100k',
  Lead200k:       'lead_200k',
  Lead200kMais:   'lead_200k_mais',
  ScrollDepth25:  'scroll_25',
  ScrollDepth50:  'scroll_50',
  ScrollDepth75:  'scroll_75',
  ScrollDepth95:  'scroll_95',
};

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const {
      event_name,
      event_id,
      action_source = 'website',
      user_data     = {},
      custom_data   = {},
      source_url,
      session_id: bodySid,
      fbp: bodyFbp,
      fbc: bodyFbc,
    } = body;

    const isCRM = action_source === 'crm';

    const requestIp        = request.headers.get('CF-Connecting-IP') || '';
    const requestUserAgent = request.headers.get('User-Agent')       || '';

    // Eventos CRM não passam por bot detection (vêm do painel admin)
    if (!isCRM && isBot(requestUserAgent)) {
      return json({ ok: true });
    }

    const cookieHeader = request.headers.get('Cookie') || '';
    const cookies      = parseCookies(cookieHeader);

    // Resolve sessão: para CRM usa session_id do lead; para website usa cookie
    let sessionData = {};
    if (env.DB) {
      const sid = bodySid || cookies['_krob_sid'] || '';
      if (sid) {
        const row = await env.DB.prepare('SELECT * FROM sessions WHERE sid = ?').bind(sid).first();
        if (row) sessionData = row;
      }
    }

    // fbp/fbc: para CRM prioriza sessão original do lead (não cookie do admin)
    const fbp = isCRM
      ? (sessionData.fbp || bodyFbp || '')
      : (bodyFbp || cookies['_fbp'] || sessionData.fbp || '');
    const fbc = isCRM
      ? (sessionData.fbc || bodyFbc || '')
      : (bodyFbc || cookies['_fbc'] || sessionData.fbc || '');

    const fbpSource = fbp ? (sessionData.fbp ? 'session' : 'body') : '';
    const fbcSource = fbc ? (sessionData.fbc ? 'session' : 'body') : '';

    // IP e User-Agent: para CRM não usa dados do admin — usa sessão original se disponível
    const ip        = isCRM ? '' : requestIp;
    const userAgent = isCRM ? (sessionData.ua || '') : requestUserAgent;

    // GA4 client_id: para CRM usa sessão original do lead
    const gaRaw      = isCRM ? '' : (cookies['_ga'] || '');
    const gaClientId = gaRaw.startsWith('GA1.')
      ? gaRaw.split('.').slice(2).join('.')
      : (sessionData.ga_client_id || `${Date.now()}.${Math.random().toString(36).slice(2, 9)}`);

    // Hash PII
    const hashedEmail = user_data.em ? await sha256(user_data.em.trim().toLowerCase()) : '';
    const hashedPhone = user_data.ph ? await sha256(normalizePhone(user_data.ph))      : '';
    const hashedName  = user_data.fn ? await sha256(user_data.fn.trim().toLowerCase().normalize('NFC')) : '';

    // ── META CAPI ─────────────────────────────────────────────────────────────
    const userData = {
      em: hashedEmail ? [hashedEmail] : [],
      ph: hashedPhone ? [hashedPhone] : [],
      fn: hashedName  ? [hashedName]  : [],
      ...(ip        && { client_ip_address: ip }),
      ...(userAgent && { client_user_agent: userAgent }),
      ...(fbp       && { fbp }),
      ...(fbc       && { fbc }),
    };

    const metaPayload = {
      data: [{
        event_name,
        event_time:       Math.floor(Date.now() / 1000),
        event_id,
        event_source_url: source_url || '',
        action_source,
        user_data: userData,
      }],
    };

    let metaStatus = 0, metaBody = '';
    try {
      const r = await fetch(
        `https://graph.facebook.com/v25.0/${env.META_PIXEL_ID}/events?access_token=${env.META_CAPI_TOKEN}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(metaPayload) }
      );
      metaStatus = r.status;
      metaBody   = await r.text();
    } catch (e) { metaBody = e.message; }

    // ── GA4 MEASUREMENT PROTOCOL ──────────────────────────────────────────────
    let ga4Status = 0, ga4Body = '';
    if (event_name !== 'PageView' && env.GA4_MEASUREMENT_ID && env.GA4_API_SECRET) {
      const ga4Payload = {
        client_id: gaClientId,
        events: [{
          name:   GA4_EVENT_MAP[event_name] || event_name.toLowerCase(),
          params: { ...custom_data },
        }],
      };
      try {
        const r = await fetch(
          `https://www.google-analytics.com/mp/collect?measurement_id=${env.GA4_MEASUREMENT_ID}&api_secret=${env.GA4_API_SECRET}`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ga4Payload) }
        );
        ga4Status = r.status;
        ga4Body   = await r.text();
      } catch (e) { ga4Body = e.message; }
    }

    // ── D1 LOGGING ────────────────────────────────────────────────────────────
    if (env.DB && event_name !== 'PageView') {
      const sid = bodySid || cookies['_krob_sid'] || '';
      context.waitUntil(
        env.DB.prepare(`
          INSERT INTO events
            (event_name, event_id, session_id, email_hash, phone_hash, name_hash,
             faturamento, source_url, fbp_source, fbc_source,
             meta_status, meta_response, ga4_status, ga4_response)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          event_name, event_id || '', sid,
          hashedEmail, hashedPhone, hashedName,
          custom_data.faturamento || '',
          source_url || '',
          fbpSource, fbcSource,
          metaStatus, metaBody,
          ga4Status,  ga4Body
        ).run()
      );
    }

    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: err.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function normalizePhone(raw) {
  let p = raw.replace(/\D/g, '');
  if (p.length <= 11) p = '55' + p;
  return p;
}

function parseCookies(header) {
  const cookies = {};
  header.split(';').forEach(part => {
    const [k, ...v] = part.trim().split('=');
    if (k) cookies[k.trim()] = v.join('=').trim();
  });
  return cookies;
}

function isBot(ua) {
  return /bot|crawl|spider|facebookexternalhit|Facebot|linkedinbot|slurp|mediapartners|adsbot|AdsBot|Googlebot|bingbot|yandex|DuckDuckBot|Baidu|python-requests|python-urllib|curl|wget|axios|node-fetch|okhttp|go-http-client|scrapy|headless/i.test(ua);
}
