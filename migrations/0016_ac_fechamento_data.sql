-- Data em que cada negócio do ActiveCampaign entrou na etapa de fechamento (Boas-vindas ou posterior),
-- achada no histórico do negócio (dealActivities). Não muda, então /api/ac-funil guarda aqui e só lê o
-- histórico dos fechamentos novos. A API cria a tabela se faltar.
CREATE TABLE IF NOT EXISTS ac_fechamento_data (
  deal_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,             -- 'AAAA-MM-DD'
  updated_at TEXT DEFAULT (datetime('now'))
);
