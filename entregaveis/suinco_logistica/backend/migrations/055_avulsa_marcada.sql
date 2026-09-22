-- =====================================================================
-- 055 — a carga avulsa se declara avulsa
-- ---------------------------------------------------------------------
-- SEM ESTA MIGRAÇÃO: a linha criada fora do modelo na Montagem do Dia
-- passa a consumir a linha prevista do modelo. A saída some da lista de
-- "rotas que faltam" sem ninguém ver, e é uma rota que não embarca.
--
-- POR QUE UMA COLUNA, E NÃO UMA CONTA COM O QUE JÁ EXISTE.
--
-- `linhasDoModeloQueFaltam()` casa a montagem com o modelo por duas
-- chaves: `modelo_id` quando existe, e rota+apelido quando não existe. A
-- segunda existe para a linha ANTIGA, criada antes de o `modelo_id`
-- aparecer (28/08/2026).
--
-- Até 21/09 a carga avulsa escapava dessa contagem por ACIDENTE: nascia
-- sem apelido, e a chave do modelo tem um ("rt:504¦Unaí"), então as duas
-- nunca casavam. Naquele dia o dono pediu que a linha nova parasse de sair
-- como "Alto Paranaíba" e passasse a dizer a cidade — e a avulsa ganhou
-- apelido. A partir dali ela casaria, e engoliria a linha prevista.
--
-- O problema é que linha antiga do modelo e avulsa nova ficam IDÊNTICAS no
-- dado: as duas com `modelo_id` nulo e apelido preenchido. Nenhuma conta
-- separa as duas — tentei por heurística e a bateria reprovou, certa.
--
-- `false` no padrão é o que preserva as linhas antigas: elas continuam
-- casando por destino, como sempre casaram. Só o que nascer pelo caminho
-- avulso a partir de agora se marca.
-- =====================================================================

ALTER TABLE programacao_montagem
  ADD COLUMN IF NOT EXISTS avulsa BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN programacao_montagem.avulsa IS
  'true = linha criada fora do modelo, na própria Montagem do Dia. Não '
  'consome linha prevista do modelo, mesmo carregando o mesmo destino. '
  'false = veio do modelo, ou é anterior a 21/09/2026.';
