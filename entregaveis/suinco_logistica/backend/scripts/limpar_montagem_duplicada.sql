-- =====================================================================
-- LIMPAR AS LINHAS DUPLICADAS DA MONTAGEM DO DIA
-- ---------------------------------------------------------------------
-- Relato do dono (25 e 26/08/2026): "está tudo duplicado ainda na montagem
-- do dia". A apuração de 25/08 confirmou: 53 linhas naquele dia, quase
-- todas vazias e em pares, e uma única virou carga.
--
-- A CAUSA foi corrigida no painel: a de-duplicação dependia da coluna
-- modelo_id (migração 035) e, sem ela, NADA casava — cada clique em "puxar
-- o modelo" recriava o dia inteiro. Agora existe um segundo critério
-- (rota + destino) que funciona sem migração nenhuma.
--
-- Isto aqui é a outra metade: a correção evita duplicatas NOVAS, mas não
-- apaga as que já estão gravadas. Este script apaga.
--
-- O QUE ELE APAGA, e só isso:
--   · linhas da montagem que estão VAZIAS — sem placa, sem número de carga,
--     sem peso e sem motorista;
--   · que NÃO viraram carga (efetivada_em nulo) e NÃO foram canceladas;
--   · e que têm uma irmã mais antiga com a MESMA rota e o MESMO destino no
--     MESMO dia. A mais antiga fica; as repetições saem.
--
-- O QUE ELE NUNCA APAGA: linha com placa, com número, com peso, com
-- motorista, já efetivada ou já cancelada. Se a pessoa digitou qualquer
-- coisa ali, aquilo é trabalho dela e não é duplicata descartável.
--
-- COMO RODAR — em dois passos, de propósito.
--
--   1. VER o que sairia, sem apagar nada:
--        sudo -u postgres psql -d embarque_suinco \
--          -f /opt/suinco-src/entregaveis/suinco_logistica/backend/scripts/limpar_montagem_duplicada.sql
--
--   2. Se a lista fizer sentido, APAGAR de verdade:
--        sudo -u postgres psql -d embarque_suinco -v apagar=1 \
--          -f /opt/suinco-src/entregaveis/suinco_logistica/backend/scripts/limpar_montagem_duplicada.sql
--
-- Sem o `-v apagar=1` ele só MOSTRA. Apagar linha de programação sem olhar
-- antes é como o Excel era, e é o que este painel existe para acabar.
-- =====================================================================

\pset pager off
\set ON_ERROR_STOP on
\if :{?apagar}
\else
  \set apagar 0
\endif

-- As candidatas: vazias, não efetivadas, não canceladas, e com irmã mais
-- antiga de mesma rota e mesmo destino no mesmo dia.
CREATE TEMP VIEW dupes AS
SELECT g.montagem_id, g.data_prog, g.rota_codigo, g.apelido_rota, g.criado_em
  FROM (
    SELECT m.*,
           row_number() OVER (
             PARTITION BY m.data_prog, m.rota_codigo, coalesce(m.apelido_rota, '')
             ORDER BY m.criado_em, m.montagem_id
           ) AS posicao
      FROM programacao_montagem m
     WHERE m.efetivada_em IS NULL
       AND m.cancelada_em IS NULL
       AND coalesce(m.placa, '')        = ''
       AND coalesce(m.numero_carga, '') = ''
       AND coalesce(m.motorista, '')    = ''
       AND coalesce(m.peso, 0)          = 0
  ) g
 WHERE g.posicao > 1;

\echo ''
\echo '=== RESUMO POR DIA ==='
SELECT data_prog AS dia,
       count(*)  AS linhas_a_remover
  FROM dupes
 GROUP BY data_prog
 ORDER BY data_prog;

\echo ''
\echo '=== O QUE SERIA REMOVIDO (as repetições; a mais antiga de cada fica) ==='
SELECT data_prog AS dia, rota_codigo AS rota,
       coalesce(apelido_rota, '(sem destino)') AS destino,
       montagem_id,
       to_char(criado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS criada
  FROM dupes
 ORDER BY data_prog, rota_codigo, criado_em;

\if :apagar
\echo ''
\echo '=== APAGANDO ==='
DELETE FROM programacao_montagem
 WHERE montagem_id IN (SELECT montagem_id FROM dupes);
\echo '=== PRONTO. Confira a Montagem do dia no painel. ==='
\else
\echo ''
\echo '=== NADA FOI APAGADO (modo conferência). ==='
\echo '=== Para apagar de verdade, rode de novo com:  -v apagar=1 ==='
\endif
