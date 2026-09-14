-- =====================================================================
-- 053 — Excluir rota: apaga a que nunca foi usada, aposenta a que já foi
-- ---------------------------------------------------------------------
-- Pedido do dono (14/09/2026): "quero a funcionalidade de excluir rota
-- também na parte do cadastro de rotas" — e, ao escolher o comportamento:
-- "no caso em 3 rotas 538 eu queria conseguir apagar o que tiver repetido,
-- ou se aposentar uma rota e criar uma nova".
--
-- São DOIS pedidos diferentes na mesma frase, e é por isso que o botão faz
-- duas coisas:
--
--   · APAGAR o repetido. Existe repetição de verdade no cadastro oficial:
--     534 e 540 são as duas "Salvador", as duas LogMaster. Rota digitada
--     com código errado, ou duplicada, nunca foi usada por ninguém — essa
--     sai do banco de verdade, e some.
--
--   · APOSENTAR a que rodou. Aí apagar é destruir registro: `rota_codigo`
--     é chave estrangeira de QUATRO tabelas (fact_viagens, devolucao_rotas,
--     programacao_modelo, programacao_montagem). O banco recusaria o DELETE
--     — e se não recusasse, as cargas antigas ficariam com um código órfão,
--     sem nome de praça, no relatório que a Administração lê.
--
-- É a mesma regra da casa que vale para o pátio: o que sai da operação
-- continua no Histórico, dizendo para onde foi. Rota aposentada não aparece
-- mais em seletor nenhum, mas continua resolvendo o nome da praça de toda
-- carga, devolução e viagem que já aconteceu.
--
-- SEM ESTA MIGRAÇÃO: o painel mostra o botão de excluir e o servidor recusa
-- com erro de coluna inexistente. Nenhum setor é afetado enquanto ninguém
-- clicar — cadastro, programação, pátio e devolução seguem iguais.
-- =====================================================================

-- `ativa` nasce TRUE para todas as rotas que já existem: nenhuma foi
-- aposentada até agora, e o padrão tem que ser o estado de hoje.
ALTER TABLE dim_rotas
    ADD COLUMN IF NOT EXISTS ativa           BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS aposentada_em   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS aposentada_por  TEXT;

COMMENT ON COLUMN dim_rotas.ativa IS
  'FALSE = rota aposentada: sai dos seletores mas continua resolvendo o nome '
  'da praça nos registros antigos. Rota nunca usada é APAGADA, não aposentada.';
COMMENT ON COLUMN dim_rotas.aposentada_em IS
  'Quando saiu de circulação. NULL enquanto ativa.';
COMMENT ON COLUMN dim_rotas.aposentada_por IS
  'Quem aposentou — a exclusão é do cadastro que o painel inteiro usa, e '
  'precisa de dono como qualquer outra alteração.';

-- O seletor lê por aqui. Índice parcial, e não índice inteiro: a consulta
-- que importa é sempre "as ativas", e as aposentadas tendem a ser poucas.
CREATE INDEX IF NOT EXISTS ix_dim_rotas_ativas ON dim_rotas (codigo) WHERE ativa;
