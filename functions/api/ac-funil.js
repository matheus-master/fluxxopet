// Funil comercial direto do ActiveCampaign, cruzado com os leads do site (D1).
// Protegido por JWT (middleware de /api). Só leitura no ActiveCampaign.
//
// GET /api/ac-funil[?desde=AAAA-MM-DD][&fresh=1]
//
// Regras (KR do comercial):
//   • reunião  = tarefa do tipo "Reunião" (dealTasks), pela data marcada;
//       com a nota "lead não compareceu" (na observação ou no título) → no-show;
//       sem a nota e com data já passada → realizada; data futura → agendada;
//   • fechamento = negócio na etapa "Boas-vindas" ou em etapa posterior do mesmo funil.
//       A data é a da entrada na etapa (histórico do negócio); sem histórico, usa a
//       última atualização do negócio e marca como aproximada.
//   • cruzamento: contato do negócio × lead do site, por e-mail e, se não bater, WhatsApp.
//
// Pages Functions tem limite de subrequisições por chamada: as leituras ficam dentro
// de ORCAMENTO e o resultado vai para o cache por 10 min.

const DESDE = '2026-07-01';
const ORCAMENTO = 45;
const CACHE_S = 600;
const NOSHOW = /(nao|n)\s*compareceu|no[\s-]?show|nao apareceu|faltou/;
const BOAS_VINDAS = /boas[\s-]*vindas/;
const REUNIAO = /reuni/;

export async function onRequestGet({ request, env, waitUntil }) {
  const u = new URL(request.url);
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('desde') || '') ? u.searchParams.get('desde') : DESDE;
  if (!env.AC_API_URL || !env.AC_API_TOKEN) return json({ ok: false, error: 'ActiveCampaign não configurado (AC_API_URL / AC_API_TOKEN)' });

  const cacheKey = new Request(u.origin + '/__cache/ac-funil?desde=' + desde);
  const cache = caches.default;
  if (u.searchParams.get('fresh') !== '1') {
    const hit = await cache.match(cacheKey);
    if (hit) return new Response(hit.body, hit);
  }

  try {
    const out = await montar(env, desde);
    const res = json(out);
    const toCache = new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=' + CACHE_S } });
    waitUntil(cache.put(cacheKey, toCache));
    return res;
  } catch (e) {
    return json({ ok: false, error: e.message || String(e) });
  }
}

async function montar(env, desde) {
  const base = env.AC_API_URL.replace(/\/$/, '');
  let usadas = 0;
  const avisos = [];
  async function get(path) {
    if (usadas >= ORCAMENTO) throw new Error('LIMITE');
    usadas++;
    const r = await fetch(base + '/api/3/' + path, { headers: { 'Api-Token': env.AC_API_TOKEN, Accept: 'application/json' } });
    if (r.status === 403 || r.status === 401) throw new Error('A chave do ActiveCampaign não tem permissão para ler ' + path.split('?')[0] + ' (HTTP ' + r.status + ')');
    if (!r.ok) throw new Error('ActiveCampaign respondeu ' + r.status + ' em ' + path.split('?')[0]);
    return r.json();
  }
  // lista paginada; para se o orçamento acabar e avisa
  async function todas(path, chave, max, parar) {
    const itens = [];
    for (let off = 0; ; off += 100) {
      if (usadas >= max) { avisos.push('Leitura de ' + chave + ' parou em ' + itens.length + ' itens (limite de requisições).'); break; }
      const d = await get(path + (path.includes('?') ? '&' : '?') + 'limit=100&offset=' + off);
      const pag = d[chave] || [];
      itens.push(...pag);
      const total = +(d.meta && d.meta.total) || 0;
      if (pag.length < 100 || (total && itens.length >= total) || (parar && parar(pag))) break;
    }
    return itens;
  }

  // 1. estrutura
  const [grupos, etapas, tipos] = await Promise.all([
    get('dealGroups?limit=100').then(d => d.dealGroups || []),
    get('dealStages?limit=100').then(d => d.dealStages || []),
    get('dealTasktypes?limit=100').then(d => d.dealTasktypes || []),
  ]);
  const stageById = {};
  etapas.forEach(s => { stageById[s.id] = { id: s.id, title: s.title, group: s.group, order: +s.order || 0 }; });
  const tipoReuniao = tipos.filter(t => REUNIAO.test(norm(t.title)));
  if (!tipoReuniao.length) avisos.push('Nenhum tipo de tarefa com "Reunião" no nome. Tipos encontrados: ' + tipos.map(t => t.title).join(', ') + '.');

  // etapas que contam como fechamento: "Boas-vindas" e as posteriores do mesmo funil
  const fechStage = new Set();
  const bv = etapas.filter(s => BOAS_VINDAS.test(norm(s.title)));
  if (!bv.length) avisos.push('Nenhuma etapa "Boas-vindas" encontrada. Etapas: ' + etapas.map(s => s.title).join(', ') + '.');
  bv.forEach(b => etapas.forEach(s => { if (s.group === b.group && (+s.order || 0) >= (+b.order || 0)) fechStage.add(s.id); }));

  // 2. negócios (todos os funis)
  const deals = await todas('deals?orders[cdate]=DESC', 'deals', 22);

  // 3. tarefas de reunião desde a data inicial
  let tarefas = [];
  for (const t of tipoReuniao) {
    tarefas = tarefas.concat(await todas('dealTasks?filters[d_tasktypeid]=' + t.id + '&filters[due_after]=' + desde + '&orders[duedate]=DESC', 'dealTasks', 30));
  }
  // garante o filtro mesmo se a API ignorar algum parâmetro
  const tipoIds = new Set(tipoReuniao.map(t => String(t.id)));
  tarefas = tarefas.filter(t => tipoIds.has(String(t.dealTasktype)) && dia(t.duedate) >= desde);

  // 4. contatos dos negócios (para o cruzamento)
  const dealById = {};
  deals.forEach(d => { dealById[d.id] = d; });
  const contatoIds = [...new Set(deals.map(d => d.contact).filter(Boolean))];
  const contatos = {};
  for (let i = 0; i < contatoIds.length; i += 100) {
    if (usadas >= ORCAMENTO - 6) { avisos.push('Cruzamento parcial: ' + i + ' de ' + contatoIds.length + ' contatos lidos.'); break; }
    const lote = contatoIds.slice(i, i + 100);
    const d = await get('contacts?limit=100&' + lote.map(id => 'ids[]=' + id).join('&'));
    (d.contacts || []).forEach(c => { contatos[c.id] = { email: (c.email || '').trim().toLowerCase(), fone: fone(c.phone) }; });
  }

  // 5. leads do site
  let leads = [];
  try {
    leads = (await env.DB.prepare('SELECT id, email, whatsapp, faturamento, created_at FROM leads').all()).results || [];
  } catch (e) { avisos.push('Não consegui ler os leads do site: ' + e.message); }
  const porEmail = {}, porFone = {};
  leads.forEach(l => {
    const em = (l.email || '').trim().toLowerCase(), f = fone(l.whatsapp);
    if (em && !porEmail[em]) porEmail[em] = l;
    if (f && !porFone[f]) porFone[f] = l;
  });
  const leadDoContato = cid => {
    const c = contatos[cid]; if (!c) return null;
    return (c.email && porEmail[c.email]) || (c.fone && porFone[c.fone]) || null;
  };

  // 6. etapa atual de cada negócio × lead do site
  const hoje = new Date().toISOString().slice(0, 10);
  const porEtapa = {};
  let comLead = 0;
  deals.forEach(d => {
    const k = String(d.stage);
    const e = porEtapa[k] || (porEtapa[k] = { n: 0, site: 0, abertos: 0, fat: {} });
    e.n++;
    if (String(d.status) === '0') e.abertos++;
    const l = leadDoContato(d.contact);
    if (l) { e.site++; comLead++; const f = l.faturamento || 'Não informado'; e.fat[f] = (e.fat[f] || 0) + 1; }
  });

  // 7. reuniões
  let comNotaNoShow = 0;
  const reunioes = tarefas.map(t => {
    const deal = String(t.reltype).toLowerCase() === 'deal' ? dealById[t.relid] : deals.find(d => String(d.contact) === String(t.relid));
    const texto = norm((t.note || '') + ' ' + (t.title || ''));
    const noshow = NOSHOW.test(texto);
    if (noshow) comNotaNoShow++;
    const data = dia(t.duedate);
    const l = deal ? leadDoContato(deal.contact) : null;
    return {
      data, st: noshow ? 'noshow' : data > hoje ? 'agendada' : 'realizada',
      cliente: deal ? deal.title : (t.title || 'Sem negócio'), deal: deal ? deal.id : null,
      etapa: deal && stageById[deal.stage] ? stageById[deal.stage].title : null,
      site: !!l, fat: l ? l.faturamento || null : null,
    };
  }).sort((a, b) => b.data.localeCompare(a.data));

  // 8. fechamentos (com data de entrada na etapa, pelo histórico, enquanto houver orçamento)
  const fechDeals = deals.filter(d => fechStage.has(d.stage));
  const fechamentos = [];
  let aprox = 0;
  for (const d of fechDeals) {
    let data = null;
    if (usadas < ORCAMENTO) {
      try {
        const a = await get('deals/' + d.id + '/dealActivities?limit=100');
        (a.dealActivities || []).forEach(x => {
          if (fechStage.has(String(x.d_stageid)) && x.cdate) { const ds = dia(x.cdate); if (!data || ds < data) data = ds; }
        });
      } catch (e) { if (e.message !== 'LIMITE') throw e; }
    }
    const semHistorico = !data;
    if (semHistorico) data = dia(d.mdate || d.cdate);
    if (data < desde) continue;
    if (semHistorico) aprox++;
    const l = leadDoContato(d.contact);
    fechamentos.push({ data, aprox: semHistorico || undefined, cliente: d.title, deal: d.id, etapa: stageById[d.stage] ? stageById[d.stage].title : null, site: !!l, fat: l ? l.faturamento || null : null });
  }
  if (aprox) avisos.push(aprox + ' fechamento' + (aprox > 1 ? 's estão' : ' está') + ' com data aproximada (última atualização do negócio), sem histórico de etapa disponível.');
  fechamentos.sort((a, b) => b.data.localeCompare(a.data));

  return {
    ok: true, desde, geradoEm: new Date().toISOString(),
    funis: grupos.map(g => ({ id: g.id, title: g.title })),
    etapas: Object.values(stageById).sort((a, b) => (a.group - b.group) || (a.order - b.order))
      .map(s => Object.assign({}, s, porEtapa[s.id] || { n: 0, site: 0, abertos: 0, fat: {} }, { fech: fechStage.has(s.id) })),
    reunioes, fechamentos,
    cruzamento: { negocios: deals.length, comLeadDoSite: comLead, leadsDoSite: leads.length, contatosLidos: Object.keys(contatos).length },
    conferencia: { tipoReuniao: tipoReuniao.map(t => t.title), etapasFechamento: [...fechStage].map(id => stageById[id] && stageById[id].title), tarefasLidas: tarefas.length, notasNoShow: comNotaNoShow, requisicoes: usadas },
    avisos,
  };
}

function dia(s) { return String(s || '').slice(0, 10); }
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
// telefone comparável: só dígitos, sem 55 e sem o 9 extra do celular → DDD + 8 dígitos
function fone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3);
  return d.length === 10 ? d : '';
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
