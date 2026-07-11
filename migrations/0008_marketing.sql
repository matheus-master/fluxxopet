-- Controle de marketing: valores manuais (vendas/faturamento) por semana.
-- Investimento e conversões vêm da API do Meta em tempo real (não são salvos aqui).
CREATE TABLE IF NOT EXISTS marketing_weeks (
  ym          TEXT    NOT NULL,   -- ano-mês, ex: 2026-06
  week        INTEGER NOT NULL,   -- 1..4
  vendas      REAL,
  faturamento REAL,
  updated_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (ym, week)
);
