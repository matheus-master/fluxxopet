-- Etapas do cadastro nas páginas do quiz (/ e /novo), uma linha por visitante e etapa.
-- Gravado por functions/api/etapa.js (que também cria a tabela se ela não existir);
-- lido por functions/api/funil-pagina.js para a aba Funil do /trafego.
-- sid = cookie _krob_sid; created_at em UTC.
CREATE TABLE IF NOT EXISTS funil_etapas (
  sid        TEXT NOT NULL,
  pagina     TEXT NOT NULL,
  etapa      TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (sid, pagina, etapa)
);
CREATE INDEX IF NOT EXISTS idx_funil_etapas_data ON funil_etapas (created_at);
