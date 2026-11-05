// Vendas novas (fechamentos) do ActiveCampaign — leitura leve para a aba Saúde do /trafego.
// Protegido por JWT (middleware de /api). Só leitura no ActiveCampaign.
//
// GET /api/ac-vendas[?fresh=1] → { ok, desde, geradoEm, fechamentos: [{ data, valor, aprox, cliente, deal, etapa }], avisos }
//
// Mesma regra de fechamento do /api/ac-funil (que usa as funções daqui): negócio na etapa "Boas-vindas"
// ou em etapa posterior do mesmo funil; data = entrada na etapa pelo histórico do negócio (fica no D1,
// ac_fechamento_data, porque não muda); sem histórico, a última atualização, marcada como aproximada.
//
// Por que existe: a API do ActiveCampaign leva de 1 a 3 s por chamada e o ac-funil faz ~40 (negócios,
// tarefas, contatos…) — a primeira leitura chegou a 2 min. Aqui são só as etapas e os negócios das
// etapas de fechamento (filtro por etapa na própria API): 2 a 6 chamadas.
//
// Cache na borda (comCache): até 10 min serve direto; de 10 min a 24 h serve na hora e atualiza em
// segundo plano; sem cache, lê na hora — e, se a página desistir de esperar, a leitura continua e fica
// guardada. ?fresh=1 lê na hora.

export const DESDE = '2026-07-01';
const BOAS_VINDAS = /boas[\s-]*vindas/;
const MAX_REQ = 30;
const FRESCO_S = 600, VELHO_S = 86400;

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.AC_API_URL || !env.AC_API_TOKEN) return json({ ok: false, error: 'ActiveCampaign não configurado (AC_API_URL / AC_API_TOKEN)' });
  const u = new URL(request.url);
  return comCache({ waitUntil, chave: u.origin + '/__cache/ac-vendas?v=1', fresh: u.searchParams.get('fresh') === '1', gerar: () => montarVendas(env) });
}

async function montarVendas(env, desde = DESDE) {
  const avisos = [];
  const get = clienteAC(env, MAX_REQ);
  const etapas = (await get('dealStages?limit=100')).dealStages || [];
  const fechStage = etapasFechamento(etapas);
  if (!fechStage.size) avisos.push('Nenhuma etapa "Boas-vindas" encontrada. Etapas: ' + etapas.map(s => s.title).join(', ') + '.');
  const nomeEtapa = {};
  etapas.forEach(s => { nomeEtapa[s.id] = s.title; });

  // negócios de cada etapa de fechamento (a API filtra; se ela ignorar o filtro, a leitura completa do
  // ac-funil é que serve — a página cai para ela quando esta responde com erro)
  const listas = await Promise.all([...fechStage].map(async id => {
    const itens = [];
    for (let off = 0; ; off += 100) {
      const d = await get('deals?filters[stage]=' + id + '&limit=100&offset=' + off);
      const pag = d.deals || [];
      if (pag.some(x => String(x.stage) !== String(id))) throw new Error('O ActiveCampaign não filtrou os negócios por etapa');
      itens.push(...pag);
      const total = +(d.meta && d.meta.total) || 0;
      if (pag.length < 100 || (total && itens.length >= total)) break;
    }
    return itens;
  }));
  const deals = [].concat(...listas);

  const { fechamentos, avisos: av } = await datarFechamentos({ env, get, deals, fechStage, desde, nomeEtapa });
  return { ok: true, desde, geradoEm: new Date().toISOString(), fechamentos, avisos: avisos.concat(av), conferencia: { requisicoes: get.usadas() } };
}

// ── compartilhado com o ac-funil ──────────────────────────────────────────────────────────────

// cliente da API v3 com orçamento de requisições e ritmo: no máximo ~4 chamadas começando por segundo
// (o limite do ActiveCampaign é 5/s por conta), para poder rodar várias ao mesmo tempo sem levar 429
export function clienteAC(env, orcamento) {
  const base = env.AC_API_URL.replace(/\/$/, '');
  let usadas = 0, proxima = 0;
  const get = async path => {
    if (usadas >= orcamento) throw new Error('LIMITE');
    usadas++;
    const agora = Date.now(), vez = Math.max(agora, proxima);
    proxima = vez + 250;
    if (vez > agora) await new Promise(r => setTimeout(r, vez - agora));
    const r = await fetch(base + '/api/3/' + path, { headers: { 'Api-Token': env.AC_API_TOKEN, Accept: 'application/json' } });
    if (r.status === 403 || r.status === 401) throw new Error('A chave do ActiveCampaign não tem permissão para ler ' + path.split('?')[0] + ' (HTTP ' + r.status + ')');
    if (!r.ok) throw new Error('ActiveCampaign respondeu ' + r.status + ' em ' + path.split('?')[0]);
    return r.json();
  };
  get.usadas = () => usadas;
  get.sobra = () => orcamento - usadas;
  return get;
}

// roda fn em cada item, no máximo n ao mesmo tempo (o ritmo do clienteAC segura a taxa)
export async function emParalelo(itens, n, fn) {
  const out = new Array(itens.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, itens.length) }, async () => {
    while (i < itens.length) { const k = i++; out[k] = await fn(itens[k], k); }
  }));
  return out;
}

// etapas que contam como fechamento: "Boas-vindas" e as posteriores do mesmo funil
export function etapasFechamento(etapas) {
  const fech = new Set();
  etapas.filter(s => BOAS_VINDAS.test(norm(s.title)))
    .forEach(b => etapas.forEach(s => { if (s.group === b.group && (+s.order || 0) >= (+b.order || 0)) fech.add(s.id); }));
  return fech;
}

// data de cada fechamento: D1 (já achada antes) → histórico do negócio (só os novos, 3 por vez, dentro
// do orçamento) → última atualização (aproximada). Negócio cujo histórico não tem a entrada na etapa
// também fica no D1 (data vazia) e só é conferido de novo depois de 7 dias — senão toda leitura gastaria
// uma chamada com ele. extra(d) acrescenta campos (o ac-funil põe o lead do site).
export async function datarFechamentos({ env, get, deals, fechStage, desde, nomeEtapa, extra }) {
  const avisos = [];
  const fechDeals = deals.filter(d => fechStage.has(d.stage));
  const salvas = await datasSalvas(env.DB), novas = [];
  const historico = {};
  const conferir = fechDeals.filter(d => { const s = salvas[String(d.id)]; return !s || (!s.data && s.velho); });
  await emParalelo(conferir, 3, async d => {
    if (get.sobra() <= 0) return;
    try {
      const a = await get('deals/' + d.id + '/dealActivities?limit=100');
      let data = null;
      (a.dealActivities || []).forEach(x => {
        if (fechStage.has(String(x.d_stageid)) && x.cdate) { const ds = dia(x.cdate); if (!data || ds < data) data = ds; }
      });
      if (data) historico[String(d.id)] = data;
      novas.push([String(d.id), data || '']);
    } catch (e) { if (e.message !== 'LIMITE') throw e; }
  });
  await salvarDatas(env.DB, novas);
  const datas = {};
  Object.keys(salvas).forEach(id => { if (salvas[id].data) datas[id] = salvas[id].data; });

  // o site cria todo negócio com AC_DEAL_VALUE; se o comercial não atualiza, o valor não é real
  const padrao = parseInt(env.AC_DEAL_VALUE || '0', 10) || 0;
  let aprox = 0, valorPadrao = 0;
  const fechamentos = [];
  for (const d of fechDeals) {
    let data = datas[String(d.id)] || historico[String(d.id)] || null;
    const semHistorico = !data;
    if (semHistorico) data = dia(d.mdate || d.cdate);
    if (data < desde) continue;
    if (semHistorico) aprox++;
    const centavos = +d.value || 0;
    if (padrao && centavos === padrao) valorPadrao++;
    // o ActiveCampaign guarda o valor em centavos
    fechamentos.push(Object.assign({ data, valor: centavos / 100, aprox: semHistorico || undefined, cliente: d.title, deal: d.id, etapa: nomeEtapa[d.stage] || null }, extra ? extra(d) : {}));
  }
  if (aprox) avisos.push(aprox + ' fechamento' + (aprox > 1 ? 's estão' : ' está') + ' com data aproximada (última atualização do negócio), sem histórico de etapa disponível.');
  if (valorPadrao) avisos.push(valorPadrao + ' fechamento' + (valorPadrao > 1 ? 's estão' : ' está') + ' com o valor padrão do site (' + (padrao / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) + '): atualize o valor do negócio no ActiveCampaign para o total ficar certo.');
  // mais recente primeiro; no mesmo dia, pelo número do negócio (ordem estável entre as leituras)
  fechamentos.sort((a, b) => b.data.localeCompare(a.data) || String(a.deal).localeCompare(String(b.deal)));
  return { fechamentos, avisos };
}

// data de entrada na etapa de fechamento, por negócio (mesma estrutura de migrations/0016_ac_fechamento_data.sql;
// data '' = histórico sem a entrada na etapa). Se o D1 falhar, segue sem ele: lê o histórico como antes.
const TABELA_DATAS = "CREATE TABLE IF NOT EXISTS ac_fechamento_data (deal_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now')))";
async function datasSalvas(db) {
  const out = {};
  if (!db) return out;
  try {
    await db.prepare(TABELA_DATAS).run();
    ((await db.prepare("SELECT deal_id, data, updated_at < datetime('now', '-7 days') AS velho FROM ac_fechamento_data").all()).results || [])
      .forEach(r => { out[r.deal_id] = { data: r.data, velho: !!r.velho }; });
  } catch (e) { /* sem cache de datas */ }
  return out;
}
async function salvarDatas(db, novas) {
  if (!db || !novas.length) return;
  try {
    await db.batch(novas.map(([id, data]) => db.prepare(
      "INSERT INTO ac_fechamento_data (deal_id, data) VALUES (?, ?) ON CONFLICT(deal_id) DO UPDATE SET data = excluded.data, updated_at = datetime('now')"
    ).bind(id, data)));
  } catch (e) { /* tenta de novo na próxima leitura */ }
}

// Cache na borda com atualização em segundo plano (stale-while-revalidate). gerar() devolve o objeto
// da resposta ou lança erro (que não vai para o cache).
export async function comCache({ waitUntil, chave, fresh, gerar, fresco = FRESCO_S, velho = VELHO_S }) {
  const cache = caches.default, key = new Request(chave);
  const lock = new Request(chave + (chave.includes('?') ? '&' : '?') + '__lock=1');
  const guardar = out => cache.put(key, new Response(JSON.stringify(out), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + velho, 'X-Gerado': String(Date.now()) } }));
  if (!fresh) {
    const hit = await cache.match(key);
    const idade = hit ? (Date.now() - (+hit.headers.get('X-Gerado') || 0)) / 1000 : Infinity;
    if (idade <= velho) {
      // vencido: entrega o que tem e atualiza em segundo plano (uma atualização por vez)
      if (idade > fresco && !(await cache.match(lock))) {
        waitUntil(cache.put(lock, new Response('1', { headers: { 'Cache-Control': 'max-age=90' } }))
          .then(gerar).then(guardar).then(() => cache.delete(lock)).catch(() => {}));
      }
      return new Response(hit.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Cache': idade > fresco ? 'STALE' : 'HIT' } });
    }
  }
  // sem cache: lê agora; se a página desistir de esperar, a leitura segue e fica guardada
  const p = gerar().then(async out => { await guardar(out); return out; });
  waitUntil(p.catch(() => {}));
  try { return json(await p); }
  catch (e) { return json({ ok: false, error: e.message || String(e) }); }
}

function dia(s) { return String(s || '').slice(0, 10); }
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
