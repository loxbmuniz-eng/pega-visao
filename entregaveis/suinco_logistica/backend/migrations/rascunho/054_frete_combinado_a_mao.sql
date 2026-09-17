-- =====================================================================
-- 054 — o frete combinado à mão, e o KM em que ele foi combinado
-- ---------------------------------------------------------------------
-- Pedido do dono (17/09/2026): "Caso eu precise alterar o valor do frete,
-- ele também deve ser editável."
--
-- POR QUE O VALOR NÃO ERA EDITÁVEL, E POR QUE ISSO ESTAVA CERTO.
--
-- `dominio/frete.js` carrega a regra em letras maiúsculas: a conta é
-- `km × tarifa`, ela mora num lugar só, e o painel NÃO a refaz — "duas
-- contas de dinheiro escritas em dois lugares divergem no primeiro caso de
-- borda, e a divergência aparece como um frete pago errado". Na Montagem o
-- valor nem é gravado: sai calculado na leitura, porque valor guardado em
-- rascunho é valor que envelhece calado.
--
-- POR QUE DESTRAVAR MESMO ASSIM. Frete combinado no telefone não é frete
-- de tabela. Hoje o painel não tem onde guardar o combinado, e quem
-- negocia escreve num campo de observação — que é o mesmo lugar que a
-- ocorrência #77 acabou de desentupir.
--
-- A SAÍDA NÃO É ESCOLHER UMA DAS DUAS VERDADES: É MARCAR QUAL É QUAL.
-- A conta continua sendo feita e continua valendo para quem não digita
-- nada. Quem digita ganha uma coluna própria, e o calculado permanece
-- calculável — a conferência compara o combinado com a tabela em vez de
-- perder a tabela.
--
-- `frete_manual_km` É O CORAÇÃO DESTA MIGRAÇÃO, e existe por uma decisão
-- do dono. Perguntado o que fazer quando alguém muda o KM DEPOIS de o
-- valor ter sido digitado, ele respondeu (a): o valor digitado FICA, e a
-- linha avisa que o KM mudou e o frete não acompanhou. Para avisar é
-- preciso saber em que quilometragem o combinado foi fechado — senão o
-- painel não tem como distinguir "combinado ainda válido" de "combinado
-- de outra viagem". Sem esta coluna a decisão (a) é impossível de honrar.
--
-- É a mesma família da troca de transportadora à mão, que fica marcada e
-- registrada em vez de ser sobrescrita pelo cadastro: número que alguém
-- digitou é decisão, e decisão não se apaga por efeito colateral.
--
-- NAS DUAS TABELAS. A linha da Montagem é onde se digita; a carga é onde
-- o combinado tem de sobreviver depois de efetivada, senão o valor
-- negociado se perde exatamente no momento em que vira contrato.
--
-- O QUE QUEBRA SEM ESTA MIGRAÇÃO: o campo de frete na Montagem recusa a
-- gravação (coluna inexistente) e a linha continua só de leitura. Nada
-- existente para de funcionar — as colunas são todas opcionais.
-- =====================================================================

ALTER TABLE programacao_montagem
  ADD COLUMN IF NOT EXISTS frete_valor_manual NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS frete_manual_km    INTEGER,
  ADD COLUMN IF NOT EXISTS frete_manual_por   TEXT,
  ADD COLUMN IF NOT EXISTS frete_manual_em    TIMESTAMPTZ;

ALTER TABLE fact_viagens
  ADD COLUMN IF NOT EXISTS frete_valor_manual NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS frete_manual_km    INTEGER,
  ADD COLUMN IF NOT EXISTS frete_manual_por   TEXT,
  ADD COLUMN IF NOT EXISTS frete_manual_em    TIMESTAMPTZ;

COMMENT ON COLUMN programacao_montagem.frete_valor_manual IS
  'Frete combinado à mão. NULL = vale a conta km x tarifa. Nunca sobrescrito por recálculo.';
COMMENT ON COLUMN programacao_montagem.frete_manual_km IS
  'KM de deslocamento no instante em que o valor foi digitado. Se o KM mudar depois, a linha avisa que o combinado é de outra quilometragem — decisão (a) do dono, 17/09/2026.';
COMMENT ON COLUMN fact_viagens.frete_valor_manual IS
  'Frete combinado à mão, copiado da linha da Montagem ao efetivar. Carga gravada é registro: o combinado não pode se perder ao virar contrato.';
COMMENT ON COLUMN fact_viagens.frete_manual_km IS
  'KM de deslocamento no instante em que o valor foi digitado.';

-- Índice parcial: a conferência de frete procura justamente as linhas que
-- fogem da tabela, e elas são a minoria. Índice sobre a exceção é barato e
-- responde "o que foi combinado fora da tabela neste mês?" sem varrer o
-- histórico inteiro.
CREATE INDEX IF NOT EXISTS idx_montagem_frete_manual
  ON programacao_montagem (frete_manual_em)
  WHERE frete_valor_manual IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cargas_frete_manual
  ON fact_viagens (frete_manual_em)
  WHERE frete_valor_manual IS NOT NULL;
