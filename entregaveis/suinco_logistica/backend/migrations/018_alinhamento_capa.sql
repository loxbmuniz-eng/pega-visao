-- =====================================================================
-- 018 — Alinhamento da capa de devolução com o processo real
-- ---------------------------------------------------------------------
-- Ajustes do usuário (18/08/2026), depois do alinhamento com a operação:
--
-- 1. O MONITORAMENTO informa o código do operador sob o qual as
--    devoluções são lançadas → campo no cabeçalho do checklist.
-- 2. A pesagem do FATURAMENTO é por item — é ela que confirma que a
--    devolução passou pela balança (a coluna "Recebido" da conferência
--    passa a se chamar "Expedição" na tela; a pesagem entra ANTES dela).
-- 3. Última coluna do checklist: NOTA FINAL — um tick por item, marcado
--    pela Central de Notas quando o item está finalizado.
-- =====================================================================

ALTER TABLE devolucoes
  ADD COLUMN IF NOT EXISTS operador_codigo TEXT NOT NULL DEFAULT '';

ALTER TABLE devolucao_itens
  ADD COLUMN IF NOT EXISTS peso_faturamento NUMERIC(12,3);

ALTER TABLE devolucao_itens
  ADD COLUMN IF NOT EXISTS nota_final BOOLEAN NOT NULL DEFAULT FALSE;
