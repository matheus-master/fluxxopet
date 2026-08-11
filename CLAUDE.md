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
