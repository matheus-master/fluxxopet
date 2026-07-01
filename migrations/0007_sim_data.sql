-- Dados do simulador (diagnóstico) preenchidos pelo lead
ALTER TABLE leads ADD COLUMN sim_fat REAL;
ALTER TABLE leads ADD COLUMN sim_racao REAL;
ALTER TABLE leads ADD COLUMN sim_med REAL;
ALTER TABLE leads ADD COLUMN perda_icms REAL;
ALTER TABLE leads ADD COLUMN perda_pis REAL;
ALTER TABLE leads ADD COLUMN perda_mensal REAL;
ALTER TABLE leads ADD COLUMN perda_anual REAL;
