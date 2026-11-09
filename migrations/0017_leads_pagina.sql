-- Página de onde o lead veio ('/', '/novo', '/analise', '/lp'…), para separar e medir cada página no CRM.
-- A /api/submit grava (a página que o formulário manda ou, sem isso, a do Referer) e cria a coluna se faltar.
-- Leads anteriores ficam vazios; a /api/leads deduz a página deles pelas etapas do funil ou pelo gclid.
ALTER TABLE leads ADD COLUMN pagina TEXT DEFAULT '';
