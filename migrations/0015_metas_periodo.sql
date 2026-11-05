-- Meta anual da aba Saúde do /trafego: um período de meses (ex.: 2026-11 a 2027-12).
-- O total do período é a soma das metas mensais (metas_mes) dos meses dele.
CREATE TABLE IF NOT EXISTS metas_periodo (
  inicio TEXT PRIMARY KEY,        -- 'AAAA-MM'
  fim TEXT NOT NULL,              -- 'AAAA-MM', inclusive
  updated_at TEXT DEFAULT (datetime('now'))
);
