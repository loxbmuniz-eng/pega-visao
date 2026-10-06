-- =====================================================================
-- 062 — Pagamento de Frete: excluir carga do controle (06/10/2026)
-- ---------------------------------------------------------------------
-- SEM ESTA MIGRAÇÃO: a aba continua funcionando como antes; o botão
-- Excluir responde "o servidor ainda não tem esta função" (503 explicado).
--
-- Pedido do dono: "eu preciso conseguir excluir carga do pagamento de
-- fretes". Decisão dele (06/10/2026): a carga SAI DA LISTA E FICA NO
-- HISTÓRICO — some da aba, da planilha e do PDF, mas continua no banco com
-- quem excluiu, quando e por quê (motivo obrigatório). Pagamentos e
-- tratativas ficam intactos. Se o PDF dela for importado de novo, ela volta
-- (a prévia avisa antes) — e há "Restaurar" na lista das excluídas.
--
-- Migração própria: a 058/059/060 já estão publicadas.
-- =====================================================================
ALTER TABLE pgfrete_cargas
  ADD COLUMN IF NOT EXISTS excluida_em     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS excluida_por    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS excluida_motivo TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS ix_pgfrete_cargas_excluidas ON pgfrete_cargas (excluida_em) WHERE excluida_em IS NOT NULL;
