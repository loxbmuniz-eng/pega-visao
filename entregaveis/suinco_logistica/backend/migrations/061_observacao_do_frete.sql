-- =====================================================================
-- 061 — A OBSERVAÇÃO DO FRETE, obrigatória para contratar (06/10/2026)
-- ---------------------------------------------------------------------
-- Decisão do dono, com as palavras dele: "o valor do frete não pode ser
-- alterável, somente o KM pode ser editável e ele faz a conta sozinho pra
-- trazer como referência para o relatório de adm de fretes; o que seguir
-- o valor da tabela vai ser colocado na observação como tabela, e o que
-- não seguir a tabela vai ser colocado o valor combinado" — e "só consegue
-- contratar carga com frete combinado (...) sempre, sem exceções".
--
-- UMA COLUNA, DUAS PALAVRAS. `frete_observacao` diz o que vale:
--   TABELA     — o valor calculado (KM × tarifa) é o do contrato;
--   COMBINADO  — foi negociado outro valor, guardado em frete_valor_manual
--                (a coluna da 054, que já existia nas duas tabelas e que a
--                carga nunca chegou a ler — o combinado digitado na
--                Montagem morria ao virar carga).
-- O valor calculado continua em frete_valor e NÃO é digitado por ninguém.
--
-- NAS DUAS TABELAS, pelo mesmo motivo da 054: a linha da Montagem é onde
-- se decide; a carga é onde a decisão tem de sobreviver.
--
-- A TRAVA NÃO MORA AQUI. A coluna aceita vazio, porque carga sem placa
-- ainda não foi contratada e as cargas que já estão no pátio nasceram antes
-- da regra (decisão do dono: ficam com o selo "frete a definir" e seguem
-- andando). Quem recusa contratar sem observação é a rota
-- (dominio/frete.js → conferirFreteParaContratar).
--
-- O QUE QUEBRA SEM ESTA MIGRAÇÃO: o servidor não sobe (código à frente do
-- banco). Nada do que existe é alterado: as colunas são novas e opcionais.
-- =====================================================================
ALTER TABLE fact_viagens
  ADD COLUMN IF NOT EXISTS frete_observacao TEXT;
ALTER TABLE programacao_montagem
  ADD COLUMN IF NOT EXISTS frete_observacao TEXT;

ALTER TABLE fact_viagens DROP CONSTRAINT IF EXISTS fact_viagens_frete_observacao_check;
ALTER TABLE fact_viagens ADD CONSTRAINT fact_viagens_frete_observacao_check
  CHECK (frete_observacao IS NULL OR frete_observacao IN ('TABELA', 'COMBINADO'));
ALTER TABLE programacao_montagem DROP CONSTRAINT IF EXISTS programacao_montagem_frete_observacao_check;
ALTER TABLE programacao_montagem ADD CONSTRAINT programacao_montagem_frete_observacao_check
  CHECK (frete_observacao IS NULL OR frete_observacao IN ('TABELA', 'COMBINADO'));

COMMENT ON COLUMN fact_viagens.frete_observacao IS
  'TABELA = vale o valor calculado (km × tarifa); COMBINADO = vale frete_valor_manual. Obrigatória para contratar (placa) desde 06/10/2026.';
COMMENT ON COLUMN programacao_montagem.frete_observacao IS
  'Mesma regra da carga: decidida na linha da Montagem e levada para a carga ao criá-la.';
