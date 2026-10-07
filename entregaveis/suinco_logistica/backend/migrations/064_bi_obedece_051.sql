-- =====================================================================
-- 064 — A porta do Power BI obedece à migração 051 (07/10/2026)
-- ---------------------------------------------------------------------
-- SEM ESTA MIGRAÇÃO: o painel não muda nada; só a porta do Power BI
-- (/bi/fact_movimentacoes e /bi/tempos_por_etapa) continua contando a
-- movimentação apagada pela Administração — e o tempo por etapa, também a
-- carga excluída. Quem puxa o Power BI vê um tempo de pátio diferente do
-- painel.
--
-- Achado da skill conciliar-indicador. A 051 decidiu que a movimentação
-- apagada "sai do Histórico, do estado e dos indicadores" e pôs o filtro
-- `apagada_em IS NULL` em todo lugar que lê a tabela — menos nas duas
-- vistas do BI, que são de antes dela (001 e 002). Guarda: bloco 53 do
-- api.test.js.
--
-- As colunas e a ordem são as MESMAS (CREATE OR REPLACE VIEW exige isso, e
-- o modelo do Power BI depende dos nomes). Só entram os filtros:
--   · fact_movimentacoes: sem a movimentação apagada;
--   · tempos_por_etapa: sem a apagada — e o LEAD pula para o próximo
--     carimbo VIVO, então a etapa anterior dura até ele —, e sem a carga
--     excluída (fact_movimentacoes já a tirava desde a 002).
-- =====================================================================

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
WHERE v.excluida_em IS NULL
  AND m.apagada_em IS NULL;

CREATE OR REPLACE VIEW vw_tempos_por_etapa AS
WITH eventos AS (
    SELECT carga_id, placa, status_novo, data_evento,
           LEAD(data_evento) OVER (PARTITION BY carga_id ORDER BY data_evento) AS proximo
    FROM fact_statusfrota
    WHERE apagada_em IS NULL
)
SELECT
    e.carga_id                                  AS "CargaId",
    e.placa                                     AS "Placa",
    v.transportadora                            AS "Transportadora",
    COALESCE(v.rota_codigo,'')                  AS "RotaCodigo",
    e.status_novo                               AS "Etapa",
    e.data_evento                               AS "EntrouEm",
    e.proximo                                   AS "SaiuEm",
    EXTRACT(EPOCH FROM (e.proximo - e.data_evento))/60 AS "MinutosNaEtapa"
FROM eventos e
LEFT JOIN fact_viagens v ON v.carga_id = e.carga_id
WHERE e.proximo IS NOT NULL
  AND v.excluida_em IS NULL;
