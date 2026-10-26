-- Qualificação logo depois do cadastro (página /, etapa "Só mais 2 perguntas").
-- dificuldade: 'Falta de lucro' | 'Imposto alto' | 'Contador genérico' | 'Folha errada' | 'Precificação'
-- urgencia:    1..10 (quanto quer resolver ainda este mês)
-- sobre_negocio: texto livre opcional (até 500 caracteres)
-- (functions/api/submit.js também cria as colunas se elas não existirem.)
ALTER TABLE leads ADD COLUMN dificuldade TEXT;
ALTER TABLE leads ADD COLUMN urgencia INTEGER;
ALTER TABLE leads ADD COLUMN sobre_negocio TEXT;
