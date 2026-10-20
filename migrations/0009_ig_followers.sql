-- Histórico de novos seguidores do Instagram por dia (dashboard /trafego).
-- A API do Instagram só devolve os últimos 30 dias; functions/api/meta-trafego.js
-- grava esses dias a cada acesso para o histórico ir se acumulando.
-- (O endpoint também cria a tabela sozinho se ela não existir.)
CREATE TABLE IF NOT EXISTS ig_followers_daily (
  day           TEXT PRIMARY KEY,   -- YYYY-MM-DD
  new_followers INTEGER NOT NULL,
  updated_at    TEXT DEFAULT (datetime('now'))
);
