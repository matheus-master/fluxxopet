# CLAUDE.md — Fluxxo Pet Captura de Leads

## Cloudflare
- **Perfil deste projeto:** `fluxxo-pet-novo`
- Conta: `Contato@fluxxopet.com.br's Account` (account_id `f16ea8ca4078c392b4d2474aee275842`)
- Antes de qualquer deploy ou comando wrangler: `cf-on fluxxo-pet-novo`
- Após terminar: `cf-off`
- Listar todos os perfis: `cf-list`
- Banco D1: `fluxxo-pet-tracking` (id `b1dfad2f-6637-43ea-bfb9-8289f4405466`)

> Migrado em 2026-06-11 da conta antiga (`e4a039cf…`, perfil `fluxxo-pet`) para a conta nova acima.

## Projeto
- Repositório GitHub: https://github.com/matheusercolani/fluxxo-pet
- Hospedagem: Cloudflare Pages (projeto `fluxxo-pet`, conta nova)
- URL Pages: https://fluxxo-pet-288.pages.dev
- Página principal: `index.html`
- Painel admin: `admin.html` → rota `/admin`

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
