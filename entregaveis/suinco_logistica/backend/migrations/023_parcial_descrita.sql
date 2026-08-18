-- 023 — A PARCIAL escrita, pedido de 18/08/2026:
-- "há notas que contêm duas parciais: uma que retorna e outra que não
--  retorna. Também pode haver duas parciais na mesma nota, ambas
--  retornando. Ao escolher parcial, abre-se um campo para escrevê-la."
--
-- A mesma nota passa a poder ter várias linhas (o painel repete o
-- cabeçalho da nota com o botão "mesma nota"), e cada linha diz QUAL
-- parcial é — em texto livre, do jeito que a capa de papel traz.

ALTER TABLE devolucao_itens ADD COLUMN IF NOT EXISTS parcial_desc TEXT;
