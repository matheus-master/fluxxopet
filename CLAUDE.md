# CLAUDE.md — Fluxxo Pet Captura de Leads

## Cloudflare
- Conta: `Contato@fluxxopet.com.br's Account` (account_id `f16ea8ca4078c392b4d2474aee275842`)
- **Projeto de produção:** `fluxxopet` (Pages **conectado ao GitHub** — auto-deploy).
- **Deploy:** automático a cada `git push origin main` (NÃO usar mais `wrangler pages deploy`).
- Banco D1: `fluxxo-pet-tracking` (id `b1dfad2f-6637-43ea-bfb9-8289f4405466`) — binding `DB`
  vem do `wrangler.toml`, aplicado no build do git automaticamente.
- Perfil cf p/ comandos manuais (d1, secrets): `cf-on fluxxo-pet-novo` … `cf-off`.

> Migrado em 2026-06-11: conta antiga (`e4a039cf…`) → conta nova acima; git antigo
> (`matheusercolani/fluxxo-pet`) → novo (`matheus-master/fluxxopet`, remote `origin`;
> o antigo ficou como remote `backup-ercolani`).
> O projeto direct-upload `fluxxo-pet` (`fluxxo-pet-288.pages.dev`) criado durante a
> migração é redundante e pode ser apagado.

## Projeto
- Repositório GitHub: https://github.com/matheus-master/fluxxopet
- Hospedagem: Cloudflare Pages (projeto `fluxxopet`, git-connected)
- URL Pages: https://fluxxopet.pages.dev
- **Domínio de produção:** https://diagnostico.fluxxopet.com.br (custom domain do Pages;
  CNAME `diagnostico` -> `fluxxopet.pages.dev`, proxied).
- Zona Cloudflare `fluxxopet.com.br` (id `14bec166115f98ea5c3ac266ccfbb362`). O apex e o `www`
  continuam apontando pro site/e-mail da Hostinger — NÃO mexer.
- DKIM do ActiveCampaign (`acdkim1/acdkim2._domainkey`) ajustado para DNS-only (proxy off)
  para a autenticação de envio funcionar.

## Rotas — DOIS funis separados, não misturar
**Funil do META** (pixel `fbq` 1338198531534558, zero Google Ads):

| Rota | Arquivo | O que é |
|---|---|---|
| `/` | `index.html` | Quiz de diagnóstico — **é o link do bot e dos anúncios do Meta** |
| `/obrigado` | `obrigado.html` | Obrigado do quiz |
| `/resultado` | `resultado.html` | Resultado do simulador |
| `/novo` | `novo.html` | Quiz com o **layout novo** (escuro, qualificação em 3 passos), link alternativo para teste — `noindex`, mesmo pixel e mesma `/api/submit`; leads saem com `source_url` …/novo |

**Funil do GOOGLE** (gtag `AW-18311780308` + GA4, zero pixel do Meta):

| Rota | Arquivo | O que é |
|---|---|---|
| `/lp` | `lp.html` | LP dos anúncios do Google Ads |
| `/lp-obrigado` | `lp-obrigado.html` | Obrigado da LP + botão do WhatsApp |

| `/admin` | `admin.html` | Painel admin (comum aos dois) |

> ⚠️ **A raiz `/` pertence ao Meta.** Em 2026-08-06 a LP do Google ocupou a raiz por
> algumas horas e o quiz foi pra `/diagnostico` — foi revertido no mesmo dia, porque
> os anúncios do Meta e o bot apontam para a raiz. `/diagnostico` ficou como 301 → `/`.
> Ao mexer numa LP, conferir em qual funil ela está: `grep -c 'fbq(' arquivo.html`.

## LP do Google Ads (`lp.html` → `/lp`)
- **O formulário fica na primeira dobra**, dentro do hero (`<form id="form" class="form-card">`),
  ao lado da headline no desktop e logo abaixo dela no mobile.
  Campos: nome, WhatsApp (com máscara), e-mail, pet shop, faturamento mensal.
- Os CTAs do meio/fim da página rolam de volta para `#form`.
- Submit → `POST /api/submit` (grava em D1 + sincroniza ActiveCampaign) → redireciona
  para `/lp-obrigado` (`lp-obrigado.html`), que tem o botão do WhatsApp.
- Número do WhatsApp: `5571982346881` (fica em `WA_NUMBER` no `lp-obrigado.html`).
- O `lead_data` do `sessionStorage` alimenta a saudação e a mensagem pré-preenchida do zap.

## Rastreamento Google (Ads `AW-18311780308` + GA4 `G-3L4M9LVX7W`)
| Evento | Onde dispara | Destino |
|---|---|---|
| `form_start` | primeiro foco em qualquer campo | GA4 |
| `form_error` | validação barra o envio (param `campos` diz quais) | GA4 |
| `form_api_error` | `/api/submit` falhou (≠ desistência do usuário) | GA4 |
| `conversion` | load da `/lp-obrigado` | **Google Ads** — ação "Lead" |
| `generate_lead` | load da `/lp-obrigado` (param `faturamento`) | GA4 |
| `contato_whatsapp` | clique no botão do zap da `/lp-obrigado` | GA4 |

- Os eventos de GA4 usam `send_to: G-3L4M9LVX7W` explícito, pra não jogar evento
  não-conversão dentro do Google Ads.
- **A conversão do Ads dispara na `/lp-obrigado`**, não no clique do botão.
  Dedupe por e-mail no `sessionStorage` (recarregar a página não conta de novo).
- Ação em uso: **"Lead"** — `AW-18311780308/ImNoCNC7od0cENSv3ptE`
  (começa com **I maiúsculo**, não `l` nem `1`).
  Substituiu `Jg8ECMyt7tQcENSv3ptE` (a ação antiga de "clique no botão do WhatsApp")
  em 2026-08-06. As duas na mesma página fariam cada lead contar 2 conversões.
  A antiga só parou de disparar — o histórico dela segue intacto no relatório.
- **Conversões aprimoradas:** a `/lp-obrigado` faz `gtag('set','user_data', …)` com
  e-mail, telefone em E.164 (`+55` + DDD) e nome, **antes** do `config`/`conversion`.
  O gtag aplica SHA-256 sozinho — nada sai em texto puro. Telefone com tamanho
  inválido é omitido em vez de enviado torto.
  ⚠️ Só passa a valer depois de ligar **"Conversões aprimoradas para leads"** na ação
  de conversão dentro do Google Ads — é passo de UI, não dá pra fazer por código.
- `value: 0` no `generate_lead`: se um dia quiser lances por valor, é aqui que entra
  o valor do lead por faixa de faturamento.
- `gclid`/`utm_*` já são gravados pelo `functions/_middleware.js` na tabela `sessions`,
  e o lead referencia a sessão por `session_id` — dá pra fazer importação de conversão
  offline no Ads a partir disso.

## Dashboard de Tráfego (`/trafego` → `trafego.html`)
- Painel com 7 abas (`#saude`, `#geral`, `#leads`, `#seguidores`, `#funil`, `#pagina`, `#comercial`). Períodos em
  **Mês = mês atual** (dia 1 até hoje, comparado com o mesmo trecho do mês anterior);
  o resto é **janela móvel** (Semana = 7 dias, Trimestre = 90, Semestre = 180, Ano = 365)
  + Personalizado, comparado com a janela anterior do mesmo tamanho. A lista "Escolher mês"
  mostra os meses de 2026 (janeiro até o atual, `ANO_LISTA`) e compara com o mês anterior inteiro.
  Mesmo login do `/admin` (JWT em `sessionStorage.vt_token`).
- API única: `functions/api/meta-trafego.js` (insights por campanha/dia; o
  agrupamento por semana/mês/... é feito na página).
- Classificação **fixa** das campanhas (não depende do nome):
  Leads = objetivo `OUTCOME_LEADS`; Seguidores = conjunto otimizado para
  `PROFILE_VISIT`; resto = Outros. Geral = conta inteira.
- Leads = ação `lead` atribuída pelo Meta (evento Lead do pixel), não o total do CRM.
- Visitas ao perfil = `link_click` das campanhas de seguidores.
- **Funil de tráfego** (`#funil`, só campanhas de leads): impressões → `link_click` →
  `landing_page_view` → leads. CTR = cliques ÷ impressões; connect rate =
  visualizações ÷ cliques; conversão = leads ÷ visualizações. Variações de taxa em
  **p.p.**. Connect rate diário pode passar de 100% (o Meta atribui a visualização
  à data do clique, recarregamentos etc.) — é dado do Meta, não bug.
- **Etapas do cadastro na página** (card na aba Funil): contagem do próprio site, por
  página (`/` = atual, `/novo` = layout novo), visitantes únicos (`_krob_sid`).
  - As páginas chamam `etapa('...')` → `POST /api/etapa` (pública, no SKIP_AUTH; só grava
    na tabela `funil_etapas` do D1, **não** vai ao pixel nem ao GA4; robôs e
    `navigator.webdriver` ficam de fora; cada etapa 1× por visitante).
  - Etapas: `visita`, `inicio` (abriu o form / focou campo), `etapa1` e `dados` (só `/`,
    form em 2 passos), `lead` (lead salvo: faturamento escolhido em `/`, envio em `/novo`),
    `qualif_dif`, `qualif_urg`, `qualif_fim` (só `/novo`). Lista fixa em `functions/api/etapa.js`.
  - Depois do cadastro (desde 2026-10-28, só `/`): ao salvar o lead a `/` grava `fx_pag` no
    sessionStorage; `/obrigado` e `/resultado` usam isso (`fxEtapa`) para contar no funil da `/`:
    `simulador` (form do topo abriu o simulador), `resultado`, `wa_resultado` (clique em qualquer
    `.js-wa`), `obrigado`, `wa_obrigado`. Sem `fx_pag` (ex.: veio da `/simulacao`) não conta.
    `bot` não vem do site: a `/api/funil-pagina` liga o lead (`leads.session_id` + e-mail) ao
    `webhook_log` do BotConversa (resultado 200, depois do lead).
  - Leitura: `GET /api/funil-pagina?since&until[&prevSince&prevUntil]` (JWT, datas de Brasília):
    totais, por dia, período anterior e origem (join com `sessions`: Meta = fbclid ou utm
    facebook/fb/ig/instagram/meta; Google = gclid ou utm google*; resto = Outros). Medição começou em 2026-10-27.
  - Visitas incluem tráfego fora dos anúncios: não batem com `landing_page_view` do Meta.
- **Aba Página** (`#pagina`): só a página atual (`/`), as 5 etapas (visita → começou →
  nome e e-mail → WhatsApp e pet shop → lead). Resumo, 4 KPIs, funil com passagem entre
  etapas, visitas × leads por dia/semana e tabela de origem. Comparação com o período
  anterior só aparece se ele inteiro já estava sendo medido.
  - **Histórico (desde 17/06):** funil dos anúncios = visualizações da página (Meta, `lpv`) →
    rolaram 1/4 (`ScrollDepth25`) → WhatsApp e pet shop (`Lead`) → lead (`Lead<faixa>`), eventos
    da tabela `events` da raiz, só sessões do Meta (fbclid/utm). Tabela mês a mês desde junho
    (busca o Meta desde 2026-06-01). Começou o formulário / nome e e-mail só existem desde 27/10 (GA4 tem desde ago).
  - **Depois do cadastro · caminho até o WhatsApp:** leads → simulador → simulação → clique, e
    leads → obrigado → clique; total de cliques e quem deixou o e-mail no bot. Usa só dias desde
    2026-10-28 (`WA_DESDE`), para leads antigos sem essas etapas não puxarem as taxas.
- **Funil comercial** (`#comercial`): investimento → leads (Meta, campanhas de
  cadastro) → reuniões → fechamentos, com taxa de passagem e custo por etapa.
  - Reuniões: planilha publicada do Google (CSV, colunas Cliente/Data/Status; conta
    status "Concluída" ou "Fechou"). URL no código, trocável pela var
    `COMERCIAL_SHEET_CSV`. API `functions/api/comercial.js`.
  - Fechamentos: **coluna Fechamentos do resumo mensal da mesma planilha** (Mês,
    Reuniões, Fechamentos). São por mês, sem data: o período conta os meses que toca
    **inteiros** (avisado na tela), célula em branco = "não informado" (não é zero), e
    a variação de fechamentos só aparece se os dois períodos cobrem meses inteiros e
    informados (senão o mesmo mês entraria nos dois lados).
  - A tabela D1 `comercial_fechamentos` (migration 0011) ficou sem uso: o lançamento
    pelo painel foi trocado pela planilha em 2026-10-23 (estava vazia).
  - A planilha não tem WhatsApp/e-mail: reunião e lead do CRM não são ligados um a
    um (só por nome, para o selo "fechou").
- Seguidores = `follower_count` do Instagram (orgânico + pago; o Meta não atribui
  seguidor a anúncio). A API só dá 30 dias, então cada acesso grava os dias na
  tabela D1 `ig_followers_daily` (migration 0009) e o histórico vai crescendo.
- Design: fundo `#F5F6F8`, destaque `#FF5A1F`, texto `#0E0F11`, fonte Onest.
- Linguagem: cada aba abre com um **resumo em português simples** (gerado dos
  números) e os rótulos evitam jargão ("Investido no período", "R$ X por lead").
  Cores das variações: verde = melhorou, vermelho = piorou, **cinza = investimento**
  (gastar mais não é bom nem ruim). Em `tone()`: `lowerIsBetter` true = custo,
  false = volume, null = neutro.
- **Conta de anúncios em uso: `4038372153047790` ("Pacttus pet")** — trocada em
  2026-10-19. A antiga `1118060079685162` não tem mais acesso.
  `META_ADS_TOKEN` é de **usuário do sistema** ("Dashboardtoken", app "Analise de
  Dados Pactus Pet"), não expira. Ele também enxerga a página e o IG @fluxxopet
  (`17841468174480500`) — dá pra puxar seguidores.

## Aba Saúde (`#saude`) — saúde do negócio no mês
- Responde 4 perguntas para **um mês** (o atual ou o de "Escolher mês"; nos outros períodos mostra o
  mês atual): faturamento do mês, bate a meta?, problema de ticket?, problema de conteúdo?
- **Feita para o CEO bater o olho** (pedido de 2026-11-05). Ordem da tela: navegação de mês (‹ mês ›,
  "Ir para <mês atual>"; os filtros de período do topo ficam escondidos nesta aba, `.v-saude .filters`)
  → card do mês (selo de status, faturamento grande, barra com a marca de onde deveria estar, 3 fatos:
  falta, projeção, mesmo período do mês anterior) + card da meta anual (selo, barra, "precisa vender
  por mês" × "vem vendendo por mês") → "Onde está o problema?" (frase + 4 sinais OK/Problema: leads,
  criativos, conversão, ticket; faturamento = leads × conversão × ticket) → gráfico mensal → "Ver os
  números" e "Editar metas" recolhidos (`<details>`; a edição abre sozinha quando não há meta nenhuma,
  e os botões "Definir…" abrem e rolam até ela). Classes `sz-*`; textos curtos, sem parágrafo de resumo.
  - Conversão = clientes do mês ÷ leads do anúncio do mês; OK se ≥ a taxa dos 3 meses anteriores (a
    mesma usada para calcular os leads necessários).
- **Faturamento = vendas novas**: soma do `valor` dos fechamentos do `/api/ac-funil` (negócio em
  Boas-vindas ou depois), pela data do fechamento. Não é a receita da carteira.
- **Metas** (definição do dono, 2026-11-05): meta de faturamento em R$ e **ticket-alvo** por mês, editáveis
  na própria aba. Tabela D1 `metas_mes` (migration 0014; `functions/api/metas.js`, GET/PUT, JWT, cria a
  tabela se faltar). Mês sem linha usa a do último mês anterior que tiver.
- Bate a meta: mês fechado = faturamento ≥ meta; mês atual = faturamento ≥ meta × dias passados ÷ dias do
  mês ("no ritmo"); projeção linear mostrada como "no ritmo atual, fecha em".
- Problema de ticket = ticket médio do mês (faturamento ÷ clientes) **abaixo do ticket-alvo**.
- Problema de conteúdo = **pouca demanda OU criativos cansados**:
  - demanda: leads do anúncio (Meta, campanhas de cadastro) abaixo do ritmo que a meta pede;
    leads necessários = ⌈meta ÷ ticket-alvo⌉ ÷ taxa de fechamento (clientes ÷ leads do Meta nos 3 meses
    anteriores cobertos pelo ActiveCampaign — mesma comparação da aba Comercial);
  - criativos: CTR (cliques no link ÷ impressões) caiu 15%+ ou custo por lead subiu 20%+ contra os 3 meses
    anteriores (`CTR_QUEDA`, `CPL_ALTA`; abaixo de 3.000 impressões no mês não avalia).
- Se a meta não está no ritmo e ticket/demanda/criativos estão ok mas fecharam menos clientes que o
  necessário, o resumo aponta **conversão no comercial**.
- **Meta anual** (pedido do dono, 2026-11-05: nov/26 a dez/27): um período de meses na tabela D1
  `metas_periodo` (migration 0015; `inicio`/`fim` 'AAAA-MM', criada pela API se faltar). O total é a
  **soma das metas mensais** (`metas_mes`) dos meses do período — não há um total guardado à parte, então
  mudar a meta de um mês muda o total. `PUT /api/metas {periodo:{inicio,fim}, meses:[{ym,meta,ticket}]}`
  grava o período e todos os meses de uma vez (`DB.batch`; exige um item por mês, máx. 36 meses) e troca
  períodos que se sobrepõem.
  - Editor (`#anoForm`): o total digitado se divide pelos meses (`distribuir`: crescimento opcional de
    X% ao mês, arredonda a R$ 100 e acerta a sobra no último mês); editar um mês refaz o total; o
    ticket-alvo digitado vale para todos os meses. Sem período valendo, aparece aberto no topo; com
    ele, recolhido no fim da aba.
  - Card "Bato a meta anual?" (só quando o mês mostrado está dentro do período): vendido no período até
    o mês mostrado × total; "no ritmo" = vendido ≥ metas dos meses anteriores + meta do mês × dias
    passados ÷ dias do mês; "faltam R$ X: R$ Y por mês daqui em diante" = falta ÷ meses restantes.
    O gráfico de faturamento × meta se estende até o fim do período (meses futuros só com a meta).
- Dados: `state.ac` (ActiveCampaign), `mh` (Meta desde 2026-06-01, o mesmo da aba Página) e `state.metas`
  (`metas` e `periodos`). O gráfico usa `drawChart` com `group: 'mes'` e `lineAxis: 'y'` (meta no mesmo
  eixo do faturamento).
- **Velocidade** (2026-11-05, "está muito demorado"): a aba não espera `state.data` (Meta do período,
  que ela não usa) — `render()` segue sem ele para `saude`, e as 3 leituras (`loadAc`, `loadMetas`,
  `loadMh`) saem juntas na abertura. Abre com vendas + metas; os anúncios (`mh`) entram depois
  ("Carregando anúncios…", `semAds`). As leituras usam cache stale-while-revalidate no servidor
  (ac-funil sempre; meta-trafego só com `&swr=1`) e a página, vendo `geradoEm` vencido (`velho()`),
  busca de novo em 5/10/15 s. Dado que chega em segundo plano usa `renderSeguro()`: não redesenha
  com campo em foco ou formulário já digitado (`formSujo`), para não apagar o que está sendo digitado.

## Aba Comercial ← ActiveCampaign (`functions/api/ac-funil.js`)
- `GET /api/ac-funil` (JWT): lê funis, etapas, negócios, contatos e tarefas do tipo "Reunião" desde
  2026-07-01 com `AC_API_URL`/`AC_API_TOKEN`; cruza o contato de cada negócio com `leads` por e-mail
  e, se não bater, WhatsApp (DDD + 8 dígitos). Cache na borda: até 10 min serve direto; de 10 min a
  24 h serve na hora e atualiza em segundo plano (`waitUntil`, trava de 60 s para uma atualização por
  vez; `X-Gerado` no cache); `?fresh=1` (botão ⟳) lê na hora.
- A data de cada fechamento achada no histórico (`dealActivities`) fica no D1 `ac_fechamento_data`
  (migration 0016, criada pela função se faltar): só fechamentos novos gastam requisição de histórico.
- Regras: nota "lead não compareceu" na tarefa = no-show; sem a nota e data passada = realizada;
  data futura = agendada. Fechamento = negócio em "Boas-vindas" ou etapa posterior do mesmo funil,
  datado pela entrada na etapa (`dealActivities`); sem histórico → `mdate`, marcado como aproximado.
- Pages Functions limita subrequisições por chamada: tudo cabe em `ORCAMENTO` (45). Se a conta
  crescer, as leituras param e aparecem em `avisos` (exibidos na aba).
- Oportunidades (número do funil) = negócios criados no período (`cdate`) que andaram no funil;
  embaixo, o recorte com lead do site de faturamento ACIMA de
  R$ 50 mil E que andou no funil: "Pré-Qualificação" ou etapa posterior, ou tarefa de Reunião;
  fora "Desqualificado" ("Oportunidade" no AC é a etapa de entrada, todo negócio nasce nela)
  — coorte pela etapa atual. Taxa acima de 100% vira "—" (reuniões de coortes anteriores).
- Valor dos fechamentos = `value` do negócio (centavos ÷ 100). ROI = (valor fechado − investido em
  leads) ÷ investido em leads. Fechamento com o valor padrão do
  site (`AC_DEAL_VALUE`) gera aviso: o comercial precisa atualizar o valor no ActiveCampaign.
- Se a rota falhar, a aba volta a usar a planilha (`/api/comercial`) e mostra o motivo.

## CRM do admin (`/admin#crm`)
- Kanban com busca, filtros (faixa, tag, follow-up atrasado/hoje/sem próximo contato,
  salvos no `localStorage` como `crm_filters`), faixa do funil no topo, botão de
  WhatsApp e "Mover para…" em cada card (funciona no celular, onde arrastar não
  funciona), aviso com "Desfazer" ao mover e reversão se o PATCH falhar.
- Ordem dentro da coluna: follow-up atrasado → hoje → mais recentes. 40 cards por
  coluna + "mostrar mais".
- **Etapas e lista de tags ficam no banco** (tabela `crm_config`, migration 0010;
  API `functions/api/crm-config.js`, GET/PUT). Todos os aparelhos veem as mesmas.
  O `localStorage` (`vt_stages`, `vt_tags`) é só cópia de segurança se a API cair.
  Na 1ª abertura com o banco vazio, o painel sobe as etapas/tags daquele navegador
  **somadas às já usadas nos leads** (recupera etapas criadas em outros aparelhos).
  Leads com etapa que não está na lista ainda aparecem em "Outras etapas".
- **Renomear etapa** (lápis no topo da coluna ou duplo clique no nome): o PUT de
  `/api/crm-config` com `rename: {from, to}` troca o nome na lista **e** faz
  `UPDATE leads SET etapa` na mesma transação (D1 batch).
- Lead sem etapa (o site grava `'Sem contato'`, default da coluna) aparece sempre na
  **1ª etapa** da lista, qualquer que seja o nome dela. Não fixar "Contato inicial"
  no código: usar `firstStage()`.
- Ficam no navegador só preferências pessoais: tema (`vt_theme`) e filtros do CRM
  (`crm_filters`). Regra combinada: **dado compartilhado sempre no banco**.

## Integração BotConversa → ActiveCampaign
- Endpoint: `functions/api/botconversa.js` → rota `POST /api/botconversa?token=<BC_WEBHOOK_SECRET>`
- Quando o lead deixa o e-mail no bot, cria/atualiza o contato no ActiveCampaign e abre um
  negócio na etapa **"Lead"** (funil "Fluxxo de relacionamento").
- Dedupe: por e-mail (contato) e por funil (não cria 2º negócio no mesmo funil).
- Secrets configurados no Pages: `AC_API_URL`, `AC_API_TOKEN`, `AC_PIPELINE_ID`,
  `AC_STAGE_ID`, `AC_DEAL_OWNER_ID`, `BC_WEBHOOK_SECRET`.
- Body esperado (JSON): `{ "nome": "...", "email": "...", "telefone": "..." }`.

## Secrets do Pages (não estão no repo)
Inventário conferido em 2026-08-06 via `wrangler pages secret list --project-name fluxxopet`:

| Secret | Status |
|---|---|
| `AC_API_TOKEN`, `AC_API_URL`, `AC_DEAL_OWNER_ID`, `AC_PIPELINE_ID`, `AC_STAGE_ID` | ✅ |
| `ADMIN_PASSWORD`, `JWT_SECRET`, `BC_WEBHOOK_SECRET` | ✅ |
| `META_ADS_TOKEN`, `META_ADS_ACCOUNT_ID` | ✅ |
| **`META_CAPI_TOKEN`** | ❌ **AUSENTE — o CAPI do Meta não envia nada desde a migração de junho** |
| `GA4_API_SECRET` | ❌ ausente (bloco GA4 do `tracker.js` fica inativo; ok se não usar) |

> O `META_PIXEL_ID` é `[vars]` no `wrangler.toml`, então viaja no git e sobreviveu à
> migração. O `META_CAPI_TOKEN` é secret e mora só no painel — ficou na conta antiga.
> Resultado: URL do CAPI saía com `access_token=undefined`, o Facebook rejeitava e o
> `catch` engolia. Hoje o `tracker.js` grava `CONFIG AUSENTE: …` em `events.meta_response`
> em vez de falhar calado.

### Perfis cf nesta máquina
`fluxxo-pet-novo` → conta atual `f16ea8ca…` (**usar este**).
`fluxxo-pet` → conta **antiga** `e4a039cf…` — não usar.
⚠️ Em shell não-interativo o `cf-on` falha com "Profile not found" porque `$CF_TOKENS`
não vem definido. Contornar com:
`export CF_CONFIG="$HOME/.config/cloudflare"; export CF_TOKENS="$CF_CONFIG/tokens"`
