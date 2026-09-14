-- 052 — ITEM DE DEVOLUÇÃO SAI DA VISTA, MAS NÃO SOME SEM RASTRO
--
-- SEM ESTA MIGRAÇÃO: excluir um item do checklist continua sendo
-- `DELETE FROM devolucao_itens` — a linha some do banco e ninguém consegue
-- saber o que estava escrito nela nem quem apagou. E a filial, que passa a
-- excluir o próprio checklist (pedido do dono, 14/09/2026), ganharia uma
-- exclusão irreversível de lançamento.
--
-- PEDIDO DO DONO, 14/09/2026: "filial pode excluir checklist e editar". Ao
-- ser mostrado que excluir CHECKLIST já era macio (excluida_em) mas excluir
-- ITEM apagava de vez — inclusive para a Logística, hoje —, a decisão foi
-- "macia para todo mundo, e a filial ganha".
--
-- POR QUE ISSO JÁ ERA UM DEFEITO, antes da filial entrar na história: o
-- checklist é a prova do que a devolução trouxe. Uma linha apagada sem
-- registro é uma nota que existiu e não existe mais, sem ninguém para
-- responder por ela. É a mesma regra que a 051 aplicou ao pátio — o que sai
-- da operação continua registrado, dizendo para onde foi.
--
-- A leitura passa a filtrar `excluido_em IS NULL` em todo lugar que lê itens.
ALTER TABLE devolucao_itens
    ADD COLUMN IF NOT EXISTS excluido_em    TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS excluido_por   TEXT,
    ADD COLUMN IF NOT EXISTS excluido_setor TEXT;

COMMENT ON COLUMN devolucao_itens.excluido_em IS
  'Marca de exclusão macia (migração 052). Não há DELETE na aplicação: a '
  'linha sai da vista e guarda quem apagou e de qual setor. O checklist é a '
  'prova do que a devolução trouxe — linha apagada sem registro é nota que '
  'existiu e ninguém responde por ela.';

-- O índice cobre a leitura que roda em toda abertura de checklist: os itens
-- vivos de uma devolução.
CREATE INDEX IF NOT EXISTS ix_dev_itens_vivos
    ON devolucao_itens (devolucao_id) WHERE excluido_em IS NULL;
