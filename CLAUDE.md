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
  CNAME `diagnostico` -> `fluxxopet.pages.dev`, proxied). É o link que o bot manda aos leads.
- Zona Cloudflare `fluxxopet.com.br` (id `14bec166115f98ea5c3ac266ccfbb362`). O apex e o `www`
  continuam apontando pro site/e-mail da Hostinger — NÃO mexer.
- DKIM do ActiveCampaign (`acdkim1/acdkim2._domainkey`) ajustado para DNS-only (proxy off)
  para a autenticação de envio funcionar.
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
