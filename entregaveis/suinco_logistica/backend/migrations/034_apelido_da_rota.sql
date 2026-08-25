-- =====================================================================
-- 034 — O NOME DA PLANILHA SAI DE `observacoes` (25/08/2026)
-- ---------------------------------------------------------------------
-- Na 033, o nome como a operação conhece a rota ("Brasília - Versatto",
-- "Rio de Janeiro - Ômega X") foi guardado em `observacoes`, porque era a
-- única coluna de texto livre que existia. Funcionou para MOSTRAR.
--
-- Deixa de funcionar agora que a linha da montagem vira formulário de
-- carga: `observacoes` é um campo que a Logística preenche ("cliente pediu
-- para carregar por último"), e esse texto viajaria para a carga junto com
-- — ou por cima de — o nome da rota. Um campo, dois donos, e o segundo
-- apaga o primeiro sem avisar.
--
-- `apelido_rota` é do sistema: vem do modelo, ninguém digita, identifica a
-- transportadora dentro da praça. `observacoes` volta a ser da pessoa.
--
-- A migração MOVE o que já está gravado, não duplica: as 101 linhas do
-- modelo e qualquer montagem já criada a partir delas.
-- =====================================================================

ALTER TABLE programacao_modelo
  ADD COLUMN IF NOT EXISTS apelido_rota TEXT NOT NULL DEFAULT '';

ALTER TABLE programacao_montagem
  ADD COLUMN IF NOT EXISTS apelido_rota TEXT NOT NULL DEFAULT '';

-- Só as linhas que vieram das planilhas: ali `observacoes` É o apelido.
-- Observação digitada por gente fica onde está.
UPDATE programacao_modelo
   SET apelido_rota = observacoes, observacoes = ''
 WHERE criado_por = 'planilha 17-21/08'
   AND apelido_rota = ''
   AND observacoes <> '';

-- Montagens ainda não efetivadas que herdaram o apelido do modelo. As já
-- efetivadas ficam como estão: a carga delas já existe na Torre com aquele
-- texto, e reescrever o passado criaria divergência entre a montagem e a
-- carga que ela gerou.
UPDATE programacao_montagem mo
   SET apelido_rota = mo.observacoes, observacoes = ''
 WHERE mo.efetivada_em IS NULL
   AND mo.apelido_rota = ''
   AND mo.observacoes <> ''
   AND EXISTS (SELECT 1 FROM programacao_modelo md
                WHERE md.rota_codigo = mo.rota_codigo
                  AND md.apelido_rota = mo.observacoes);

DO $$
DECLARE n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM programacao_modelo WHERE apelido_rota <> '';
  RAISE NOTICE 'Apelido da rota preenchido em % linha(s) do modelo.', n;
END $$;
