// Anúncios (Meta Ads, por anúncio) e posts orgânicos do Instagram para a tela Conteúdo do /gestao.
// Protegido por JWT (middleware de /api). Só leitura no Meta.
//
// GET /api/meta-anuncios?since=AAAA-MM-DD&until=AAAA-MM-DD[&fresh=1]
//   → { ok, since, until, geradoEm,
//       anuncios: [{ id, nome, conjunto, conjuntoId, campanha, gasto, impr, cliques, leads, v3s, thruplay, img }],
//       organicos: { ok, itens: [{ id, legenda, tipo, data, link, img, alcance, curtidas, comentarios, salvos, compart, interacoes }], semMetricas } | { ok: false, error } }
//
// Anúncio: insights level=ad. v3s = visualizações de 3 s do vídeo (ação video_view); thruplay = vídeo
// assistido até o fim ou 15 s. Hook rate = v3s ÷ impressões; hold rate = thruplay ÷ v3s (calculados na página).
// Orgânicos: mídias do Instagram publicadas no período, com alcance, salvamentos, compartilhamentos e
// interações; se o token não puder ler as métricas, vêm só curtidas e comentários (semMetricas = true).
// Cache: o mesmo do ac-vendas (comCache: 10 min direto, até 24 h servido na hora e atualizado em segundo plano).

import { comCache } from './ac-vendas.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const LEAD_ACTIONS = ['lead', 'offsite_conversion.fb_pixel_lead'];

export async function onRequestGet({ request, env, waitUntil }) {
  const token = env.META_ADS_TOKEN, acct = env.META_ADS_ACCOUNT_ID || '4038372153047790';
  if (!token) return json({ ok: false, error: 'META_ADS_TOKEN não configurado' }, 500);
  const u = new URL(request.url), since = u.searchParams.get('since'), until = u.searchParams.get('until');
  if (!YMD.test(since || '') || !YMD.test(until || '') || since > until) return json({ ok: false, error: 'Parâmetros since/until inválidos' }, 400);
  return comCache({ waitUntil, chave: u.origin + '/__cache/meta-anuncios?v=1&since=' + since + '&until=' + until,
    fresh: u.searchParams.get('fresh') === '1', gerar: () => montar(env, token, acct, since, until) });
}

async function montar(env, token, acct, since, until) {
  const [ins, organicos] = await Promise.all([
    fetchAll(`${GRAPH}/act_${acct}/insights?level=ad` +
      '&fields=ad_id,ad_name,adset_id,adset_name,campaign_name,spend,impressions,inline_link_clicks,actions,video_thruplay_watched_actions' +
      `&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}&limit=500&access_token=${token}`),
    instagram(env, token, since, until).catch(e => ({ ok: false, error: e.message || String(e) })),
  ]);
  if (ins.error) throw new Error(ins.error.message || 'erro do Meta');
  const anuncios = ins.data.map(r => ({
    id: r.ad_id, nome: r.ad_name || '', conjunto: r.adset_name || '', conjuntoId: r.adset_id || '', campanha: r.campaign_name || '',
    gasto: num(r.spend), impr: num(r.impressions), cliques: num(r.inline_link_clicks),
    leads: LEAD_ACTIONS.map(k => acao(r.actions, k)).find(Boolean) || 0,
    v3s: acao(r.actions, 'video_view'), thruplay: acao(r.video_thruplay_watched_actions, 'video_view'),
  })).filter(a => a.gasto > 0 || a.leads > 0).sort((a, b) => b.gasto - a.gasto);

  // miniatura do criativo (lotes de 50 ids; se falhar, a tela segue sem imagem)
  for (let i = 0; i < anuncios.length; i += 50) {
    const lote = anuncios.slice(i, i + 50);
    const r = await fetchMeta(`${GRAPH}/?ids=${lote.map(a => a.id).join(',')}&fields=creative%7Bthumbnail_url%7D&access_token=${token}`);
    if (!r.error) lote.forEach(a => { a.img = (r[a.id] && r[a.id].creative && r[a.id].creative.thumbnail_url) || null; });
  }
  return { ok: true, since, until, geradoEm: new Date().toISOString(), anuncios, organicos };
}

// posts do Instagram publicados entre since e until (até 4 páginas de 50)
async function instagram(env, token, since, until) {
  let igId = env.META_IG_USER_ID;
  if (!igId) {
    const acc = await fetchMeta(`${GRAPH}/me/accounts?fields=instagram_business_account&limit=50&access_token=${token}`);
    if (acc.error) return { ok: false, error: acc.error.message };
    igId = (acc.data || []).map(p => p.instagram_business_account && p.instagram_business_account.id).find(Boolean);
    if (!igId) return { ok: false, error: 'Nenhuma conta do Instagram vinculada ao token' };
  }
  const base = 'id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count';
  const ler = async campos => {
    const itens = [];
    let next = `${GRAPH}/${igId}/media?fields=${campos}&limit=50&access_token=${token}`;
    for (let i = 0; next && i < 4; i++) {
      const r = await fetchMeta(next);
      if (r.error) return { error: r.error };
      itens.push(...(r.data || []));
      const ultimo = (r.data || []).slice(-1)[0];
      next = ultimo && dia(ultimo.timestamp) >= since ? r.paging && r.paging.next : null;
    }
    return { itens };
  };
  let semMetricas = false;
  let r = await ler(base + ',insights.metric(reach,saved,shares,total_interactions)');
  if (r.error) { semMetricas = true; r = await ler(base); }
  if (r.error) return { ok: false, error: r.error.message || 'erro do Instagram' };
  const itens = r.itens.filter(m => dia(m.timestamp) >= since && dia(m.timestamp) <= until).map(m => {
    const met = {};
    ((m.insights && m.insights.data) || []).forEach(x => { met[x.name] = num(x.values && x.values[0] && x.values[0].value); });
    return {
      id: m.id, legenda: (m.caption || '').split('\n')[0].slice(0, 120), tipo: m.media_product_type === 'REELS' ? 'Reel' : m.media_type === 'CAROUSEL_ALBUM' ? 'Carrossel' : m.media_type === 'VIDEO' ? 'Vídeo' : 'Foto',
      data: dia(m.timestamp), link: m.permalink || null, img: m.thumbnail_url || m.media_url || null,
      alcance: met.reach ?? null, curtidas: num(m.like_count), comentarios: num(m.comments_count),
      salvos: met.saved ?? null, compart: met.shares ?? null, interacoes: met.total_interactions ?? null,
    };
  });
  return { ok: true, itens, semMetricas };
}

// a data do Instagram vem em UTC; o dia do painel é o de Brasília
function dia(ts) { return ts ? new Date(Date.parse(ts) - 3 * 3600000).toISOString().slice(0, 10) : ''; }
function acao(lista, tipo) { const a = (lista || []).find(x => x.action_type === tipo); return a ? num(a.value) : 0; }
function num(v) { return parseFloat(v || 0) || 0; }
async function fetchAll(url) {
  const data = [];
  for (let next = url, i = 0; next && i < 20; i++) {
    const r = await fetchMeta(next);
    if (r.error) return r;
    data.push(...(r.data || []));
    next = r.paging && r.paging.next;
  }
  return { data };
}
async function fetchMeta(url) {
  try { return await (await fetch(url)).json(); }
  catch (e) { return { error: { message: e.message } }; }
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
