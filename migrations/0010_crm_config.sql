-- Configuração compartilhada do CRM (etapas do kanban e lista de tags).
-- Antes ficava só no localStorage de cada navegador. Valores em JSON:
--   key = 'stages' → ["Contato inicial", "Em conversa", ...]
--   key = 'tags'   → ["Lead LTDA", "Lead MEI", ...]
-- (functions/api/crm-config.js também cria a tabela se ela não existir.)
CREATE TABLE IF NOT EXISTS crm_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
