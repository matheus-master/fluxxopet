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

## Rotas
| Rota | Arquivo | O que é |
|---|---|---|
| `/` | `index.html` | **LP do Google Ads** (era `lp.html`) |
| `/lp` | — | 301 → `/` (via `_redirects`, preserva `gclid`/`utm_*`) |
| `/lp-obrigado` | `lp-obrigado.html` | Obrigado da LP + botão do WhatsApp |
| `/diagnostico` | `diagnostico.html` | Quiz de diagnóstico (era `index.html`, na raiz) |
| `/obrigado` | `obrigado.html` | Obrigado do quiz |
| `/resultado` | `resultado.html` | Resultado do simulador do quiz |
| `/admin` | `admin.html` | Painel admin |

> ⚠️ Em 2026-08-06 a LP assumiu a raiz `/`. **O link que o bot do BotConversa manda aos
> leads era a raiz do domínio** — precisa ser trocado para `/diagnostico`, senão o lead
> cai na LP em vez do quiz.

## LP do Google Ads (`index.html` → `/`)
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
| `conversion` | load da `/lp-obrigado` | **Google Ads** |
| `generate_lead` | load da `/lp-obrigado` (param `faturamento`) | GA4 |
| `contato_whatsapp` | clique no botão do zap da `/lp-obrigado` | GA4 |

- Os eventos de GA4 usam `send_to: G-3L4M9LVX7W` explícito, pra não jogar evento
  não-conversão dentro do Google Ads.
- **A conversão do Ads dispara na `/lp-obrigado`**, não no clique do botão.
  Dedupe por e-mail no `sessionStorage` (recarregar a página não conta de novo).
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
`ADMIN_PASSWORD`, `JWT_SECRET`, `BC_WEBHOOK_SECRET`, `AC_*` (ver acima).
Tracking Meta/GA (`META_CAPI_TOKEN`, `META_ADS_TOKEN`, `META_ADS_ACCOUNT_ID`, `GA4_API_SECRET`)
**não** foram migrados — setar de novo se quiser reativar o envio de eventos.
