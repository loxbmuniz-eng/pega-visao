-- =====================================================================
-- 021 — SOBRAS: o checklist enxuto que só entra
-- ---------------------------------------------------------------------
-- Pedido do usuário (18/08/2026): a sobra é lançada com o que o
-- MONITORAMENTO passa — só caixa, peso, produto e motivo. Não tem
-- vínculo com carga nem rota. O ciclo é curto: a Portaria dá o OK de que
-- entrou, o Faturamento dá o OK e a Expedição dá o OK — acabou (não
-- passa por Controles Internos nem Central de Notas).
--
-- Vira um TIPO do mesmo checklist de devoluções, não uma tabela nova:
-- toda a esteira, filas SUA VEZ, tempo real, revisões e relatório já
-- funcionam — a sobra só anda menos etapas e exige menos campos.
-- =====================================================================

ALTER TABLE devolucoes
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'DEVOLUCAO';

ALTER TABLE devolucoes DROP CONSTRAINT IF EXISTS devolucoes_tipo_check;
ALTER TABLE devolucoes
  ADD CONSTRAINT devolucoes_tipo_check CHECK (tipo IN ('DEVOLUCAO','SOBRA'));

-- O motivo oficial das sobras entra no catálogo.
INSERT INTO dim_motivos_devolucao (motivo) VALUES ('652 — Sobras')
ON CONFLICT DO NOTHING;
