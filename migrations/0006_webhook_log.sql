-- Log de diagnóstico das requisições recebidas do BotConversa
CREATE TABLE IF NOT EXISTS webhook_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  raw        TEXT,
  email      TEXT,
  nome       TEXT,
  telefone   TEXT,
  result     TEXT
);
