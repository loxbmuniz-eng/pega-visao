-- 022 — RDC (Romaneio) na destinação, pedido de 18/08/2026:
-- "na destinação o controle interno precisa ter um campo para informar
--  se gerou RDC (ROMANEIO)".
--
-- É um campo do cabeçalho do checklist (o romaneio cobre a devolução
-- inteira, não item a item), de escopo EXCLUSIVO dos Controles Internos
-- (Logística/Administração cobrem, como em tudo). Três estados:
--   NULL  = ainda não informado
--   TRUE  = gerou RDC
--   FALSE = não gerou

ALTER TABLE devolucoes ADD COLUMN IF NOT EXISTS gerou_rdc BOOLEAN;
