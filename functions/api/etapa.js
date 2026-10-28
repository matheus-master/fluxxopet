// Etapas do cadastro nas páginas do quiz: visita → começou o formulário → … → lead salvo.
// Só grava no D1 (tabela funil_etapas) — não repassa nada ao Meta nem ao GA4, para não
// encher o pixel de eventos. Pública (está no SKIP_AUTH), como /tracker e /api/submit:
// aceita só as páginas e etapas abaixo e conta cada etapa uma vez por visitante.
// A aba Funil do /trafego lê isso por /api/funil-pagina.

const PAGINAS = { '/': 'atual', '/novo': 'novo' };
// simulador … wa_resultado vêm das telas depois do cadastro (/obrigado, /resultado), no funil da página de origem
const ETAPAS = ['visita', 'inicio', 'etapa1', 'dados', 'lead', 'qualif_dif', 'qualif_urg', 'qualif_fim',
  'simulador', 'resultado', 'obrigado', 'wa_resultado', 'wa_obrigado'];

export async function onRequestPost(context) {
  const { request, env } = context;
  const ua = request.headers.get('User-Agent') || '';
  if (isBot(ua) || !env.DB) return new Response(null, { status: 204 });

  let body = {};
  try { body = JSON.parse(await request.text()); } catch {}
  const pagina = PAGINAS[String(body.pagina || '').replace(/\/+$/, '') || '/'];
  const etapa = String(body.etapa || '');
  const sid = parseCookies(request.headers.get('Cookie') || '')._krob_sid || String(body.sid || '');
  if (!pagina || !ETAPAS.includes(etapa) || !/^[a-f0-9]{32}$/.test(sid)) return new Response(null, { status: 204 });

  const run = () => env.DB.prepare('INSERT OR IGNORE INTO funil_etapas (sid, pagina, etapa) VALUES (?, ?, ?)').bind(sid, pagina, etapa).run();
  context.waitUntil(run().catch(async e => {
    if (!/no such table/i.test(e.message)) throw e;
    await criarTabela(env.DB);   // banco ainda sem a migration 0013
    await run();
  }).catch(() => {}));
  return new Response(null, { status: 204 });
}

// mesma estrutura de migrations/0013_funil_etapas.sql
async function criarTabela(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS funil_etapas (sid TEXT NOT NULL, pagina TEXT NOT NULL, etapa TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (sid, pagina, etapa))").run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_funil_etapas_data ON funil_etapas (created_at)').run();
}

function parseCookies(header) {
  const out = {};
  header.split(';').forEach(p => { const [k, ...v] = p.trim().split('='); if (k) out[k] = v.join('='); });
  return out;
}

// mesmo filtro do /tracker
function isBot(ua) {
  return /bot|crawl|spider|facebookexternalhit|Facebot|linkedinbot|slurp|mediapartners|adsbot|AdsBot|Googlebot|bingbot|yandex|DuckDuckBot|Baidu|python-requests|python-urllib|curl|wget|axios|node-fetch|okhttp|go-http-client|scrapy|headless/i.test(ua);
}
