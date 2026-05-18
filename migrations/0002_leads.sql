CREATE TABLE IF NOT EXISTS leads (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nome         TEXT NOT NULL DEFAULT '',
  whatsapp     TEXT NOT NULL DEFAULT '',
  email        TEXT DEFAULT '',
  faturamento  TEXT DEFAULT '',
  etapa        TEXT DEFAULT 'Sem contato',
  ult_contato  TEXT DEFAULT '',
  prox_contato TEXT DEFAULT '',
  comentarios  TEXT DEFAULT '',
  created_at   TEXT DEFAULT (datetime('now')),
  updated_at   TEXT DEFAULT (datetime('now'))
);
