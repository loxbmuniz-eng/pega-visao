-- ====================================================================
-- APURAÇÃO PARA A DIRETORIA — o que o sistema produziu desde 10/08/2026
-- ====================================================================
--
-- POR QUE ESTE ARQUIVO EXISTE. Os números de OPERAÇÃO (quantas cargas,
-- quanto tempo em cada etapa, se o pátio ficou mais rápido) só existem
-- na base de PRODUÇÃO. O ambiente onde o painel é desenvolvido não
-- alcança essa base — a política de rede recusa a conexão. Então a
-- apuração vira um arquivo que roda LÁ e devolve o resultado, em vez de
-- virar estimativa.
--
-- É SOMENTE LEITURA, POR CONSTRUÇÃO. A primeira linha abre uma transação
-- READ ONLY: qualquer INSERT/UPDATE/DELETE que escapasse aqui dentro
-- seria RECUSADO pelo próprio PostgreSQL. Não é promessa, é trava.
--
-- LGPD. Nenhuma consulta abaixo seleciona motorista, CPF, nome de
-- operador ou nome de cliente pessoa física. Tudo é contagem e mediana.
-- O que sai daqui pode circular na diretoria sem expor ninguém.
--
-- COMO RODAR (no servidor, como root):
--     su postgres -c "psql -d embarque_suinco -f ESTE_ARQUIVO.sql"
--
-- O resultado sai em blocos marcados com «###». Copie do primeiro «###»
-- até o fim e cole de volta.
-- ====================================================================

BEGIN;
SET TRANSACTION READ ONLY;

\pset pager off
\pset border 0
\pset footer off

-- Recorte único de toda a apuração. Mudar aqui muda tudo abaixo.
\set INICIO '2026-08-10'

-- ---------------------------------------------------------------- 1
\echo '### 1 JANELA E VOLUME TOTAL'
SELECT
  (SELECT count(*)                 FROM fact_viagens
     WHERE criado_em >= DATE :'INICIO')                        AS cargas,
  (SELECT count(*)                 FROM fact_statusfrota
     WHERE data_evento >= DATE :'INICIO')                      AS movimentacoes,
  (SELECT count(DISTINCT placa)    FROM fact_viagens
     WHERE criado_em >= DATE :'INICIO')                        AS placas_distintas,
  (SELECT count(DISTINCT rota_codigo) FROM fact_viagens
     WHERE criado_em >= DATE :'INICIO')                        AS rotas_distintas,
  (SELECT min(data_evento)::date   FROM fact_statusfrota
     WHERE data_evento >= DATE :'INICIO')                      AS primeiro_evento,
  (SELECT max(data_evento)::date   FROM fact_statusfrota)      AS ultimo_evento,
  (SELECT coalesce(sum(peso_kg),0) FROM fact_viagens
     WHERE criado_em >= DATE :'INICIO')                        AS peso_total_kg;

-- ---------------------------------------------------------------- 2
\echo ''
\echo '### 2 VOLUME POR SEMANA (carga criada)'
SELECT to_char(date_trunc('week', criado_em), 'YYYY-MM-DD') AS semana,
       count(*)                                            AS cargas,
       count(DISTINCT rota_codigo)                          AS rotas,
       coalesce(sum(peso_kg), 0)                            AS peso_kg,
       coalesce(sum(qtd_entregas), 0)                        AS entregas
  FROM fact_viagens
 WHERE criado_em >= DATE :'INICIO'
 GROUP BY 1 ORDER BY 1;

-- ---------------------------------------------------------------- 3
-- A duração de cada etapa. Para cada carga, o tempo entre um carimbo de
-- status e o seguinte, na ordem em que aconteceram. É daqui que sai
-- "melhorou em qual etapa".
\echo ''
\echo '### 3 TEMPO POR ETAPA — GERAL (minutos)'
WITH passo AS (
  SELECT carga_id,
         lag(status_novo)  OVER (PARTITION BY carga_id ORDER BY data_evento) AS de,
         status_novo                                                          AS para,
         lag(data_evento)  OVER (PARTITION BY carga_id ORDER BY data_evento) AS t0,
         data_evento                                                          AS t1
    FROM fact_statusfrota
   WHERE data_evento >= DATE :'INICIO'
), limpo AS (
  SELECT de, para,
         EXTRACT(EPOCH FROM (t1 - t0)) / 60.0 AS min
    FROM passo
   WHERE de IS NOT NULL
     AND t1 > t0
     AND EXTRACT(EPOCH FROM (t1 - t0)) / 60.0 < 10080   -- descarta > 7 dias
)
SELECT de || ' -> ' || para                                              AS etapa,
       count(*)                                                          AS n,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY min)::numeric, 1) AS mediana_min,
       round(avg(min)::numeric, 1)                                        AS media_min,
       round(percentile_cont(0.9) WITHIN GROUP (ORDER BY min)::numeric, 1) AS p90_min
  FROM limpo
 GROUP BY 1
HAVING count(*) >= 5
 ORDER BY n DESC;

-- ---------------------------------------------------------------- 4
-- A MESMA medida, quebrada por semana. Duas colunas lidas lado a lado
-- (primeira semana x última) é a prova de melhora — ou a prova de que
-- não houve, que também é informação.
\echo ''
\echo '### 4 TEMPO POR ETAPA, POR SEMANA (mediana em minutos)'
WITH passo AS (
  SELECT carga_id,
         lag(status_novo) OVER (PARTITION BY carga_id ORDER BY data_evento) AS de,
         status_novo                                                         AS para,
         lag(data_evento) OVER (PARTITION BY carga_id ORDER BY data_evento) AS t0,
         data_evento                                                         AS t1
    FROM fact_statusfrota
   WHERE data_evento >= DATE :'INICIO'
), limpo AS (
  SELECT date_trunc('week', t1) AS semana, de, para,
         EXTRACT(EPOCH FROM (t1 - t0)) / 60.0 AS min
    FROM passo
   WHERE de IS NOT NULL AND t1 > t0
     AND EXTRACT(EPOCH FROM (t1 - t0)) / 60.0 < 10080
)
SELECT to_char(semana, 'YYYY-MM-DD')                                       AS semana,
       de || ' -> ' || para                                                AS etapa,
       count(*)                                                            AS n,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY min)::numeric, 1) AS mediana_min
  FROM limpo
 GROUP BY 1, 2
HAVING count(*) >= 3
 ORDER BY 2, 1;

-- ---------------------------------------------------------------- 5
-- O ciclo inteiro: da primeira aparição da carga até "Seguiu Viagem".
-- É o número que a diretoria entende sem explicação: quanto tempo o
-- caminhão passa conosco.
\echo ''
\echo '### 5 CICLO COMPLETO ATE SEGUIU VIAGEM, POR SEMANA (horas)'
WITH ciclo AS (
  SELECT f.carga_id,
         min(s.data_evento) AS entrou,
         max(s.data_evento) FILTER (WHERE s.status_novo = 'Seguiu Viagem') AS saiu
    FROM fact_viagens f
    JOIN fact_statusfrota s ON s.carga_id = f.carga_id
   WHERE f.criado_em >= DATE :'INICIO'
   GROUP BY f.carga_id
), dur AS (
  SELECT date_trunc('week', entrou) AS semana,
         EXTRACT(EPOCH FROM (saiu - entrou)) / 3600.0 AS h
    FROM ciclo
   WHERE saiu IS NOT NULL AND saiu > entrou
     AND EXTRACT(EPOCH FROM (saiu - entrou)) / 3600.0 < 168   -- descarta > 7 dias
)
SELECT to_char(semana, 'YYYY-MM-DD')                                     AS semana,
       count(*)                                                          AS cargas,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY h)::numeric, 2) AS mediana_h,
       round(avg(h)::numeric, 2)                                         AS media_h,
       round(percentile_cont(0.9) WITHIN GROUP (ORDER BY h)::numeric, 2) AS p90_h
  FROM dur
 GROUP BY 1 ORDER BY 1;

-- ---------------------------------------------------------------- 6
\echo ''
\echo '### 6 MOVIMENTACOES POR SETOR'
SELECT CASE WHEN setor = '' THEN '(sem setor)' ELSE setor END AS setor,
       count(*)                                               AS movimentacoes,
       count(DISTINCT carga_id)                               AS cargas_tocadas,
       min(data_evento)::date                                 AS desde,
       max(data_evento)::date                                 AS ate
  FROM fact_statusfrota
 WHERE data_evento >= DATE :'INICIO'
 GROUP BY 1 ORDER BY 2 DESC;

-- ---------------------------------------------------------------- 7
\echo ''
\echo '### 7 VOLUME POR ROTA (15 maiores)'
SELECT coalesce(rota_codigo, '(sem rota)') AS rota,
       count(*)                            AS cargas,
       coalesce(sum(peso_kg), 0)           AS peso_kg,
       coalesce(sum(qtd_entregas), 0)      AS entregas
  FROM fact_viagens
 WHERE criado_em >= DATE :'INICIO'
 GROUP BY 1 ORDER BY 2 DESC LIMIT 15;

-- ---------------------------------------------------------------- 8
\echo ''
\echo '### 8 VOLUME POR TRANSPORTADORA (15 maiores)'
SELECT CASE WHEN transportadora = '' THEN '(em branco)' ELSE transportadora END AS transportadora,
       count(*)                       AS cargas,
       count(DISTINCT placa)          AS placas,
       coalesce(sum(peso_kg), 0)      AS peso_kg
  FROM fact_viagens
 WHERE criado_em >= DATE :'INICIO'
 GROUP BY 1 ORDER BY 2 DESC LIMIT 15;

-- ---------------------------------------------------------------- 9
\echo ''
\echo '### 9 MODALIDADE E SITUACAO ATUAL'
SELECT pra_onde, status_atual, count(*) AS cargas
  FROM fact_viagens
 WHERE criado_em >= DATE :'INICIO'
 GROUP BY 1, 2 ORDER BY 1, 3 DESC;

-- --------------------------------------------------------------- 10
\echo ''
\echo '### 10 DEVOLUCOES POR SEMANA'
-- A rota da devolução NÃO é coluna de `devolucoes`: a migração 012
-- (devolucao_multirotas) tirou-a de lá, porque um checklist pode cobrir
-- mais de uma rota. Quem sabe a rota é `devolucao_rotas`.
SELECT to_char(date_trunc('week', d.data_dev), 'YYYY-MM-DD') AS semana,
       count(DISTINCT d.devolucao_id)                        AS checklists,
       count(DISTINCT d.devolucao_id)
         FILTER (WHERE d.status = 'Nota Finalizada')         AS finalizados,
       count(DISTINCT r.rota_codigo)                         AS rotas,
       count(DISTINCT d.criada_setor)                        AS setores_que_lancaram
  FROM devolucoes d
  LEFT JOIN devolucao_rotas r ON r.devolucao_id = d.devolucao_id
 WHERE d.data_dev >= DATE :'INICIO'
 GROUP BY 1 ORDER BY 1;

-- --------------------------------------------------------------- 10b
-- O ciclo da devolução, etapa a etapa. Aqui não há tabela de
-- movimentação: cada etapa deixa o próprio carimbo de hora na linha.
\echo ''
\echo '### 10b CICLO DA DEVOLUCAO POR ETAPA (mediana em horas)'
WITH e AS (
  SELECT EXTRACT(EPOCH FROM (faturamento_em - portaria_em))    / 3600.0 AS portaria_ate_faturamento,
         EXTRACT(EPOCH FROM (expedicao_em   - faturamento_em)) / 3600.0 AS faturamento_ate_expedicao,
         EXTRACT(EPOCH FROM (controles_em   - expedicao_em))   / 3600.0 AS expedicao_ate_controles,
         EXTRACT(EPOCH FROM (notas_em       - controles_em))   / 3600.0 AS controles_ate_notas,
         EXTRACT(EPOCH FROM (notas_em       - portaria_em))    / 3600.0 AS ciclo_inteiro
    FROM devolucoes
   WHERE data_dev >= DATE :'INICIO'
), t AS (
  SELECT 'Portaria -> Faturamento'   AS etapa, portaria_ate_faturamento  AS h FROM e
  UNION ALL SELECT 'Faturamento -> Expedicao', faturamento_ate_expedicao FROM e
  UNION ALL SELECT 'Expedicao -> Controles',   expedicao_ate_controles   FROM e
  UNION ALL SELECT 'Controles -> Central Notas', controles_ate_notas     FROM e
  UNION ALL SELECT 'CICLO INTEIRO',           ciclo_inteiro              FROM e
)
SELECT etapa,
       count(*)                                                        AS n,
       round(percentile_cont(0.5) WITHIN GROUP (ORDER BY h)::numeric, 2) AS mediana_h,
       round(percentile_cont(0.9) WITHIN GROUP (ORDER BY h)::numeric, 2) AS p90_h
  FROM t
 WHERE h IS NOT NULL AND h >= 0 AND h < 720
 GROUP BY 1 ORDER BY 1;

-- --------------------------------------------------------------- 11
\echo ''
\echo '### 11 PROGRAMACOES FECHADAS'
SELECT to_char(date_trunc('week', aberta_em), 'YYYY-MM-DD') AS semana,
       count(*)                                             AS programacoes,
       count(*) FILTER (WHERE fechada_em IS NOT NULL)        AS fechadas,
       count(*) FILTER (WHERE forcado)                       AS fechadas_forcadas,
       coalesce(sum(cargas_em_aberto), 0)                    AS cargas_em_aberto_no_fechamento
  FROM programacoes
 WHERE aberta_em >= DATE :'INICIO'
 GROUP BY 1 ORDER BY 1;

-- --------------------------------------------------------------- 12
\echo ''
\echo '### 12 REVISOES DE CARGA (correcao depois de lancada)'
-- A coluna de data aqui é `gravada_em`, não `criado_em`.
SELECT to_char(date_trunc('week', gravada_em), 'YYYY-MM-DD') AS semana,
       count(*)                                              AS revisoes,
       count(DISTINCT carga_id)                               AS cargas_revisadas,
       count(DISTINCT mudada_setor)                           AS setores_que_corrigiram
  FROM carga_revisoes
 WHERE gravada_em >= DATE :'INICIO'
 GROUP BY 1 ORDER BY 1;

-- --------------------------------------------------------------- 13
\echo ''
\echo '### 13 ADOCAO — DIAS COM MOVIMENTO, POR SEMANA'
SELECT to_char(date_trunc('week', data_evento), 'YYYY-MM-DD') AS semana,
       count(DISTINCT data_evento::date)                      AS dias_com_movimento,
       count(*)                                               AS movimentacoes,
       round(count(*)::numeric / nullif(count(DISTINCT data_evento::date), 0), 1) AS mov_por_dia
  FROM fact_statusfrota
 WHERE data_evento >= DATE :'INICIO'
 GROUP BY 1 ORDER BY 1;

\echo ''
\echo '### FIM DA APURACAO'

COMMIT;
