-- =====================================================================
-- 020 — Destinação MÚLTIPLA por item
-- ---------------------------------------------------------------------
-- Pedido do usuário (18/08/2026): "tem 3 caixas de produtos, 1 vai pra
-- estoque, outra pra descarte — temos que ter a opção de colocar mais de
-- uma destinação". A escolha única vira três contagens de caixas, uma
-- por destino. A coluna antiga `destinacao` fica para os registros já
-- feitos (histórico), mas a tela passa a usar as três quantidades.
-- =====================================================================

ALTER TABLE devolucao_itens ADD COLUMN IF NOT EXISTS dest_estoque    NUMERIC(10,2);
ALTER TABLE devolucao_itens ADD COLUMN IF NOT EXISTS dest_descarte   NUMERIC(10,2);
ALTER TABLE devolucao_itens ADD COLUMN IF NOT EXISTS dest_reprocesso NUMERIC(10,2);
