// Leads do site agregados para o painel /gestao — sem dados pessoais: só contagens por dia, faixa de
// faturamento, origem e identificadores do anúncio (utm_content / utm_term, que o Meta preenche com os ids).
// Protegido por JWT (middleware de /api).
//
// GET /api/gestao-leads[?desde=AAAA-MM-DD] → { ok, desde, linhas: [{ d, faixa, o, c, t, n }] }
//   d = dia (Brasília), faixa = resposta de faturamento do formulário, n = quantidade
//   o = anuncio_ig | anuncio_fb | meta (clique do Meta sem UTM) | google | organico | outros

const ORIGEM = `CASE
  WHEN lower(s.utm_medium) IN ('paid','cpc','ads','pago') AND lower(s.utm_source) IN ('ig','instagram') THEN 'anuncio_ig'
  WHEN lower(s.utm_medium) IN ('paid','cpc','ads','pago') AND lower(s.utm_source) IN ('fb','facebook','meta') THEN 'anuncio_fb'
  WHEN s.gclid != '' OR lower(s.utm_source) LIKE 'google%' THEN 'google'
  WHEN lower(s.utm_source) IN ('ig','instagram','fb','facebook') OR lower(s.utm_content) = 'link_in_bio' THEN 'organico'
  WHEN s.fbclid != '' THEN 'meta'
  ELSE 'outros' END`;

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: 'Banco indisponível' }, 500);
  const u = new URL(request.url);
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('desde') || '') ? u.searchParams.get('desde') : '2026-06-01';
  try {
    const r = await env.DB.prepare(
      `SELECT date(l.created_at, '-3 hours') AS d, COALESCE(l.faturamento, '') AS faixa, ${ORIGEM} AS o,
              COALESCE(s.utm_content, '') AS c, COALESCE(s.utm_term, '') AS t, COUNT(*) AS n
         FROM leads l LEFT JOIN sessions s ON s.sid = l.session_id
        WHERE date(l.created_at, '-3 hours') >= ?
        GROUP BY 1, 2, 3, 4, 5 ORDER BY 1`
    ).bind(desde).all();
    return json({ ok: true, desde, linhas: r.results || [] });
  } catch (e) {
    return json({ ok: false, error: e.message || String(e) }, 500);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
