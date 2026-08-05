-- =====================================================================
-- 002 — exclusão de carga programada
-- ---------------------------------------------------------------------
-- Até aqui, excluir uma carga só apagava a linha no navegador de quem
-- clicou. O servidor nunca ficava sabendo, e a sincronia seguinte trazia a
-- carga de volta — o operador excluía, ela reaparecia, e a única saída era
-- ignorar o botão.
--
-- A exclusão é MARCADA, não apagada. Três motivos:
--
-- 1. A leitura incremental do painel busca "o que mudou desde X". Uma linha
--    apagada não aparece em lugar nenhum, então nenhum outro terminal teria
--    como saber que ela sumiu. Marcada, ela chega na próxima leitura com o
--    aviso de exclusão e some da tela de todo mundo — inclusive de quem
--    estava sem rede na hora.
--
-- 2. A trilha de auditoria continua respondendo "quem excluiu a carga da
--    placa X, e quando".
--
-- 3. Apagar de verdade levaria junto os eventos de fact_statusfrota (a FK
--    é ON DELETE CASCADE), e essa é a tabela fato do Power BI.
--
-- As views do BI passam a filtrar as excluídas, então o relatório continua
-- vendo exatamente o que via antes.
-- =====================================================================

ALTER TABLE fact_viagens
    ADD COLUMN IF NOT EXISTS excluida_em      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS excluida_por     TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN fact_viagens.excluida_em IS
  'Preenchido quando a carga programada é excluída. Nulo = carga ativa. '
  'A linha permanece para a leitura incremental conseguir avisar os outros '
  'terminais de que ela saiu.';

-- Índice parcial: a esmagadora maioria das linhas tem excluida_em nulo, e é
-- justamente essa a consulta quente.
CREATE INDEX IF NOT EXISTS ix_viagens_ativas
    ON fact_viagens (atualizado_em DESC) WHERE excluida_em IS NULL;

-- Views do Power BI: carga excluída nunca existiu operacionalmente.
CREATE OR REPLACE VIEW vw_dim_carga AS
SELECT
    v.carga_id                              AS "Id",
    v.numero_carga                          AS "NumeroCarga",
    v.placa                                 AS "Placa",
    v.transportadora                        AS "Transportadora",
    v.tipo_veiculo                          AS "TipoVeiculo",
    v.motorista                             AS "Motorista",
    v.cliente                               AS "Cliente",
    v.destino                               AS "Destino",
    ''::TEXT                                AS "Produto",
    v.peso_kg                               AS "PesoKg",
    v.doca                                  AS "Doca",
    COALESCE(v.rota_codigo,'')              AS "RotaCodigo",
    COALESCE(r.nome,'')                     AS "RotaNome",
    COALESCE(r.operador,'')                 AS "RotaOperador",
    v.sequencia                             AS "Sequencia",
    v.pra_onde                              AS "PraOnde",
    CASE WHEN v.paletizada THEN 'Sim' ELSE 'Não' END AS "Paletizada",
    v.qtd_ganchos                           AS "QtdGanchos",
    v.qtd_entregas                          AS "QtdEntregas",
    v.status_atual                          AS "StatusAtual",
    v.criado_em                             AS "CriadoEm",
    v.atualizado_em                         AS "AtualizadoEm"
FROM fact_viagens v
LEFT JOIN dim_rotas r ON r.codigo = v.rota_codigo
WHERE v.excluida_em IS NULL;

-- O evento "Carga programada" de uma carga excluída também sai do BI: ela
-- nunca chegou a virar operação, e contá-la inflaria o volume programado do
-- dia sem que caminhão nenhum tenha existido.
CREATE OR REPLACE VIEW vw_fact_movimentacoes AS
SELECT
    m.carga_id          AS "CargaId",
    m.placa             AS "Placa",
    m.data_evento       AS "Timestamp",
    COALESCE(m.status_anterior,'') AS "StatusAnterior",
    m.status_novo       AS "StatusNovo",
    m.operador_nome     AS "Operador",
    m.setor             AS "Setor",
    v.cliente           AS "Cliente",
    v.motorista         AS "Motorista",
    v.tipo_veiculo      AS "TipoVeiculo",
    v.qtd_entregas      AS "QtdEntregas"
FROM fact_statusfrota m
LEFT JOIN fact_viagens v ON v.carga_id = m.carga_id
WHERE v.excluida_em IS NULL;
