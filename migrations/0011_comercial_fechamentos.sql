-- Fechamentos (vendas) lançados no painel /trafego#comercial, um por cliente.
-- Usado no funil comercial: investimento → leads → reuniões → fechamentos.
-- (functions/api/comercial.js também cria a tabela se ela não existir.)
CREATE TABLE IF NOT EXISTS comercial_fechamentos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  data       TEXT NOT NULL,   -- YYYY-MM-DD
  cliente    TEXT NOT NULL,
  valor      REAL,            -- opcional (R$)
  created_at TEXT DEFAULT (datetime('now'))
);
