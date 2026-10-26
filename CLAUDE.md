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
- Painel do Meta Ads com 4 abas (`#geral`, `#leads`, `#seguidores`, `#funil`). Períodos em
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

## Aba Comercial ← ActiveCampaign (`functions/api/ac-funil.js`)
- `GET /api/ac-funil` (JWT): lê funis, etapas, negócios, contatos e tarefas do tipo "Reunião" desde
  2026-07-01 com `AC_API_URL`/`AC_API_TOKEN`; cruza o contato de cada negócio com `leads` por e-mail
  e, se não bater, WhatsApp (DDD + 8 dígitos). Cache de 10 min; `?fresh=1` (botão ⟳) ignora.
- Regras: nota "lead não compareceu" na tarefa = no-show; sem a nota e data passada = realizada;
  data futura = agendada. Fechamento = negócio em "Boas-vindas" ou etapa posterior do mesmo funil,
  datado pela entrada na etapa (`dealActivities`); sem histórico → `mdate`, marcado como aproximado.
- Pages Functions limita subrequisições por chamada: tudo cabe em `ORCAMENTO` (45). Se a conta
  crescer, as leituras param e aparecem em `avisos` (exibidos na aba).
- Oportunidades = negócios criados no período (`cdate`) em "Pré-Qualificação" ou etapa posterior,
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
