-- =====================================================================
-- 040 — O OK da Expedição e o OK da Destinação, item a item (31/08/2026)
-- ---------------------------------------------------------------------
-- O PEDIDO, do dono, olhando a tela e apontando as colunas:
--
--   "precisa que expedição, destinação fica igual da central de nota,
--    so colocar um ok"
--
-- A Central de Notas já era assim desde a migração 018: um booleano por
-- item (`nota_final`), marcado com um tique. A Expedição e os Controles
-- Internos não tinham o equivalente — a Expedição digitava a quantidade
-- recebida e os Controles distribuíam caixas em três campos (E/D/R). Para
-- quem está no pátio com o caminhão esperando, isso é trabalho de escrita
-- onde bastava uma confirmação.
--
-- O QUE ESTA MIGRAÇÃO NÃO FAZ, e é de propósito:
--
--   Ela NÃO apaga `qtd_recebida` nem `dest_estoque`/`dest_descarte`/
--   `dest_reprocesso`. Duas razões:
--
--   1. dado gravado não some porque a tela mudou. Checklist de um mês
--      atrás precisa continuar mostrando o que foi registrado naquele dia
--      — a mesma regra do "Gerou RDC?" (27/08) e do que a ocorrência #23
--      cobrou caro por eu ter esquecido;
--   2. a FALTA nasce de `cx - qtd_recebida`. O dono decidiu manter a
--      coluna Falta, então a quantidade continua sendo oferecida ao lado
--      do tique: quem quiser conferir caixa a caixa aponta a falta, quem
--      não quiser só dá o OK.
--
-- SEM ESTA MIGRAÇÃO: a tela nova mostra os dois tiques e o servidor recusa
-- a gravação deles (coluna inexistente). A conferência por quantidade e a
-- destinação por caixas continuam funcionando normalmente; o resto do
-- sistema segue igual.
-- =====================================================================

ALTER TABLE devolucao_itens
  ADD COLUMN IF NOT EXISTS ok_expedicao  BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE devolucao_itens
  ADD COLUMN IF NOT EXISTS ok_destinacao BOOLEAN NOT NULL DEFAULT FALSE;

-- ITEM QUE JÁ FOI CONFERIDO NASCE MARCADO. Sem isto, todo checklist
-- anterior apareceria como "não conferido" no dia seguinte à publicação —
-- e a operação leria isso como trabalho a refazer, que é pior do que não
-- ter a coluna. Quem já tem quantidade recebida foi conferido; quem já tem
-- caixa em algum destino foi destinado.
UPDATE devolucao_itens
   SET ok_expedicao = TRUE
 WHERE qtd_recebida IS NOT NULL AND ok_expedicao = FALSE;

UPDATE devolucao_itens
   SET ok_destinacao = TRUE
 WHERE (COALESCE(dest_estoque, 0) + COALESCE(dest_descarte, 0)
        + COALESCE(dest_reprocesso, 0)) > 0
   AND ok_destinacao = FALSE;
