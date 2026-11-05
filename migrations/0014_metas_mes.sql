-- Metas mensais da aba Saúde do /trafego: faturamento do mês e ticket-alvo, em R$.
-- Mês sem linha usa a meta do último mês anterior que tiver (resolvido na página).
CREATE TABLE IF NOT EXISTS metas_mes (
  ym         TEXT PRIMARY KEY,
  meta       REAL NOT NULL,
  ticket     REAL NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);
