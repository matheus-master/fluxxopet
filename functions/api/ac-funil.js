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
//   • oportunidade = negócio criado no período cujo lead do site informou faturamento ACIMA de
//       R$ 50 mil E que andou no funil: está em "Pré-Qualificação" ou etapa posterior (fora
//       "Desqualificado") ou tem tarefa de Reunião. Coorte pela data de criação, etapa atual.
//       Negócio sem lead do site (ex.: bot) não tem faturamento e não conta;
//   • cruzamento: contato do negócio × lead do site, por e-mail e, se não bater, WhatsApp.
//
// Pages Functions tem limite de subrequisições por chamada: as leituras ficam dentro
// de ORCAMENTO. A data de cada fechamento, depois de achada no histórico, fica no D1
// (ac_fechamento_data, migration 0016): ela não muda, então o histórico só é lido uma vez.
//
// A API do ActiveCampaign leva de 1 a 3 s por chamada: negócios e tarefas são lidos ao mesmo
// tempo, e contatos e históricos 3 por vez, no ritmo do clienteAC (até ~4 chamadas por segundo;
// o limite deles é 5/s). A regra e o código dos fechamentos são os do /api/ac-vendas (aba Saúde).
//
// Cache na borda (comCache, em ac-vendas.js): até 10 min a resposta é servida direto; de 10 min a
// 24 h é servida na hora e atualizada em segundo plano (a página busca de novo em alguns segundos).
// ?fresh=1 lê na hora.

import { clienteAC, comCache, datarFechamentos, emParalelo, etapasFechamento } from './ac-vendas.js';

const DESDE = '2026-07-01';
const ORCAMENTO = 45;
const NOSHOW = /(nao|n)\s*compareceu|no[\s-]?show|nao apareceu|faltou/;
const PRE_QUALIF = /pre[\s-]*qualifica/;
const DESQUALIF = /desqualif/;
const REUNIAO = /reuni/;

export async function onRequestGet({ request, env, waitUntil }) {
  const u = new URL(request.url);
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(u.searchParams.get('desde') || '') ? u.searchParams.get('desde') : DESDE;
  if (!env.AC_API_URL || !env.AC_API_TOKEN) return json({ ok: false, error: 'ActiveCampaign não configurado (AC_API_URL / AC_API_TOKEN)' });
  // "v" muda quando a regra muda, para não servir resposta antiga do cache
  return comCache({ waitUntil, chave: u.origin + '/__cache/ac-funil?v=5&desde=' + desde, fresh: u.searchParams.get('fresh') === '1', gerar: () => montar(env, desde) });
}

async function montar(env, desde) {
  const avisos = [];
  const get = clienteAC(env, ORCAMENTO);
  // lista paginada; para depois de "maxPag" páginas e avisa
  async function todas(path, chave, maxPag, parar) {
    const itens = [];
    for (let off = 0, lidas = 0; ; off += 100, lidas++) {
      if (lidas >= maxPag || get.sobra() <= 0) { avisos.push('Leitura de ' + chave + ' parou em ' + itens.length + ' itens (limite de requisições).'); break; }
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
  const fechStage = etapasFechamento(etapas);
  if (!fechStage.size) avisos.push('Nenhuma etapa "Boas-vindas" encontrada. Etapas: ' + etapas.map(s => s.title).join(', ') + '.');

  // oportunidade (lead qualificado): negócio em "Pré-Qualificação" ou etapa posterior do mesmo funil,
  // nunca em "Desqualificado". No ActiveCampaign a etapa "Oportunidade" é a de entrada (todo negócio
  // nasce nela), por isso ela não serve de marco.
  const opStage = new Set(), opGroups = new Set();
  const op = etapas.filter(s => PRE_QUALIF.test(norm(s.title)));
  if (!op.length) avisos.push('Nenhuma etapa "Pré-Qualificação" encontrada. Etapas: ' + etapas.map(s => s.title).join(', ') + '.');
  op.forEach(o => { opGroups.add(o.group); etapas.forEach(s => { if (s.group === o.group && (+s.order || 0) >= (+o.order || 0) && !DESQUALIF.test(norm(s.title))) opStage.add(s.id); }); });

  // 2 e 3. negócios (todos os funis) e tarefas de reunião desde a data inicial, ao mesmo tempo
  const [deals, tarefasPorTipo] = await Promise.all([
    todas('deals?orders[cdate]=DESC', 'deals', 19),
    Promise.all(tipoReuniao.map(t => todas('dealTasks?filters[d_tasktypeid]=' + t.id + '&filters[due_after]=' + desde + '&orders[duedate]=DESC', 'dealTasks', 8))),
  ]);
  let tarefas = [].concat(...tarefasPorTipo);
  // garante o filtro mesmo se a API ignorar algum parâmetro
  const tipoIds = new Set(tipoReuniao.map(t => String(t.id)));
  tarefas = tarefas.filter(t => tipoIds.has(String(t.dealTasktype)) && dia(t.duedate) >= desde);

  // 4. contatos dos negócios (para o cruzamento)
  const dealById = {};
  deals.forEach(d => { dealById[d.id] = d; });
  const contatoIds = [...new Set(deals.map(d => d.contact).filter(Boolean))];
  const contatos = {};
  // lotes de 100, 3 por vez; ficam 6 requisições para o histórico dos fechamentos novos
  const lotes = [];
  for (let i = 0; i < contatoIds.length; i += 100) lotes.push(contatoIds.slice(i, i + 100));
  const cabem = Math.max(0, get.sobra() - 6);
  if (lotes.length > cabem) avisos.push('Cruzamento parcial: ' + cabem * 100 + ' de ' + contatoIds.length + ' contatos lidos.');
  await emParalelo(lotes.slice(0, cabem), 3, async lote => {
    const d = await get('contacts?limit=100&' + lote.map(id => 'ids[]=' + id).join('&'));
    (d.contacts || []).forEach(c => { contatos[c.id] = { email: (c.email || '').trim().toLowerCase(), fone: fone(c.phone) }; });
  });

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

  // 5b. negócios criados desde a data inicial nos funis que têm "Oportunidade":
  //     data de criação + se já chegou a oportunidade (pela etapa atual)
  // todos os funis: se a etapa de referência não existir, o painel ainda mostra quantos foram criados
  const comReuniao = new Set();
  tarefas.forEach(t => {
    if (String(t.reltype).toLowerCase() === 'deal') comReuniao.add(String(t.relid));
    else deals.forEach(d => { if (String(d.contact) === String(t.relid)) comReuniao.add(String(d.id)); });
  });
  const criados = deals.filter(d => dia(d.cdate) >= desde).map(d => {
    const l = leadDoContato(d.contact), f50 = l && acima50(l.faturamento) ? 1 : 0;
    const andou = (opStage.has(d.stage) || comReuniao.has(String(d.id))) ? 1 : 0;
    return { data: dia(d.cdate), op: f50 && andou ? 1 : 0, f50, andou, site: l ? 1 : 0, st: stageById[d.stage] ? stageById[d.stage].title : 'Etapa ' + d.stage };
  });

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

  // 8. fechamentos: mesma regra e mesmo código do /api/ac-vendas (aba Saúde), com o lead do site junto
  const nomeEtapa = {};
  Object.values(stageById).forEach(s => { nomeEtapa[s.id] = s.title; });
  const fech = await datarFechamentos({ env, get, deals, fechStage, desde, nomeEtapa,
    extra: d => { const l = leadDoContato(d.contact); return { site: !!l, fat: l ? l.faturamento || null : null }; } });
  const fechamentos = fech.fechamentos;
  avisos.push(...fech.avisos);

  return {
    ok: true, desde, geradoEm: new Date().toISOString(),
    funis: grupos.map(g => ({ id: g.id, title: g.title })),
    etapas: Object.values(stageById).sort((a, b) => (a.group - b.group) || (a.order - b.order))
      .map(s => Object.assign({}, s, porEtapa[s.id] || { n: 0, site: 0, abertos: 0, fat: {} }, { fech: fechStage.has(s.id) })),
    reunioes, fechamentos,
    criados,
    cruzamento: { negocios: deals.length, comLeadDoSite: comLead, leadsDoSite: leads.length, contatosLidos: Object.keys(contatos).length },
    conferencia: { tipoReuniao: tipoReuniao.map(t => t.title), etapasFechamento: [...fechStage].map(id => stageById[id] && stageById[id].title), etapasOportunidade: [...opStage].map(id => stageById[id] && stageById[id].title), tarefasLidas: tarefas.length, notasNoShow: comNotaNoShow, requisicoes: get.usadas() },
    avisos,
  };
}

function dia(s) { return String(s || '').slice(0, 10); }
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
// telefone comparável: só dígitos, sem 55 e sem o 9 extra do celular → DDD + 8 dígitos
// faixa do formulário acima de R$ 50 mil: "R$100 mil", "R$200 mil", "Mais de R$200 mil"
// ("Até R$50 mil" e "Até R$30 mil" ficam de fora)
function acima50(f) {
  const s = norm(f);
  if (/mais de/.test(s)) return true;
  const n = +((s.match(/(\d+)\s*mil/) || [])[1] || 0);
  return n > 50;
}
function fone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3);
  return d.length === 10 ? d : '';
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
