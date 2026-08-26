-- =====================================================================
-- APURAÇÃO — as quatro cargas que se desconfiguraram em 25/08/2026
-- ---------------------------------------------------------------------
-- Relato do Alysson, por áudio: "as últimas cargas ficaram desconfiguradas;
-- pode ser um conflito entre o painel da programação diária e a marcação do
-- carro. Refiz todos os dados e está tudo ok, mas amanhã precisamos revisar
-- para entender o que aconteceu."
--
-- O QUE OS TRÊS RELATÓRIOS JÁ MOSTRAM, sem precisar de banco:
--
--   21:13 (Wemerson) — 22 cargas, todas numeradas, 171,70 t.
--   23:51 (Alysson)  — 18 numeradas + 4 vazias. As de sequência 13, 14, 16
--                      e 22 sumiram, e no lugar apareceram quatro linhas
--                      "AGUARDANDO CARGA": sem número, sem rota, peso 0,00,
--                      1 entrega — mas com a PLACA e com o STATUS avançado
--                      (Embarque Iniciado / Aguardando Embarque). 153,10 t.
--   00:14 (Alysson)  — as 22 de volta, porque ele redigitou tudo.
--
-- As quatro placas: SIY0G43, RNS3G28, OPQ3989, SIY0G36. Todas da frota
-- própria (Suinco 3/4 e Toco), todas ENTREGA DIRETA nas rotas 502/503/504.
--
-- POR QUE ESSAS CONSULTAS, E NÃO UM PALPITE. O padrão "sem número, sem
-- rota, peso 0, 1 entrega" é EXATAMENTE o que registrarChegadaPortaria
-- grava quando um caminhão chega sem programação (data.js). Isso deixa
-- duas explicações possíveis, e elas pedem correções diferentes:
--
--   (A) ECO DE SINCRONIZAÇÃO. A carga é a MESMA (mesmo carga_id), e um
--       aparelho com a cópia ANTIGA — de antes de a Logística preencher —
--       subiu por cima e apagou os campos. Foi o que aconteceu em 14–15/08
--       com cinco cargas. Se for isto, carga_revisoes tem a versão cheia
--       guardada e o nome de quem sobrescreveu.
--
--   (B) CARGA NOVA. São OUTROS carga_id: as programadas foram excluídas ou
--       encerradas e o portão criou registros novos para as mesmas placas.
--       Se for isto, aparecem dois carga_id por placa, e o excluida_por
--       diz quem tirou as boas.
--
-- A diferença entre (A) e (B) é a diferença entre corrigir a trava de eco
-- e corrigir o fluxo de chegada. Por isso a apuração vem antes do conserto.
--
-- COMO RODAR, no servidor:
--     sudo -u postgres psql -d embarque_suinco \
--       -f /opt/suinco-src/entregaveis/suinco_logistica/backend/scripts/apurar_25ago.sql
--
-- É SÓ LEITURA. Nenhum INSERT, UPDATE ou DELETE.
-- =====================================================================

\pset pager off
\timing off

\echo ''
\echo '=== 1. AS CARGAS DESSAS QUATRO PLACAS (inclusive as excluídas) ==='
\echo '--- Duas linhas para a mesma placa = hipótese (B). Uma só = (A). ---'
SELECT placa,
       carga_id,
       numero_carga,
       rota_codigo            AS rota,
       peso_kg                AS peso,
       qtd_entregas           AS entr,
       sequencia              AS seq,
       status_atual           AS status,
       aguardando_carga       AS agdo_carga,
       to_char(criado_em     AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS criada,
       to_char(atualizado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS alterada,
       operador_nome          AS ult_operador,
       operador_setor         AS ult_setor,
       to_char(excluida_em   AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS excluida,
       excluida_por
  FROM fact_viagens
 WHERE placa IN ('SIY0G43', 'RNS3G28', 'OPQ3989', 'SIY0G36')
   AND criado_em >= '2026-08-25 00:00-03'
 ORDER BY placa, criado_em;

\echo ''
\echo '=== 2. O HISTÓRICO DE VERSÕES — o que cada campo era ANTES de mudar ==='
\echo '--- É aqui que aparece a versão cheia sendo trocada pela vazia. ---'
SELECT v.placa,
       r.carga_id,
       to_char(r.gravada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI:SS') AS quando,
       r.mudada_por    AS quem,
       r.mudada_setor  AS setor,
       r.dados ->> 'numero_carga' AS num_antes,
       r.dados ->> 'rota_codigo'  AS rota_antes,
       r.dados ->> 'peso_kg'      AS peso_antes,
       r.dados ->> 'status_atual' AS status_antes
  FROM carga_revisoes r
  JOIN fact_viagens v ON v.carga_id = r.carga_id
 WHERE v.placa IN ('SIY0G43', 'RNS3G28', 'OPQ3989', 'SIY0G36')
   AND r.gravada_em >= '2026-08-25 00:00-03'
 ORDER BY v.placa, r.gravada_em;

\echo ''
\echo '=== 3. A TRILHA DE AÇÕES — quem fez o quê, e de qual setor ==='
SELECT placa,
       to_char(data_evento AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI:SS') AS quando,
       setor,
       operador_nome AS quem,
       left(acao, 90) AS acao
  FROM log_eventos
 WHERE placa IN ('SIY0G43', 'RNS3G28', 'OPQ3989', 'SIY0G36')
   AND data_evento >= '2026-08-25 00:00-03'
 ORDER BY placa, data_evento;

\echo ''
\echo '=== 4. AS MUDANÇAS DE ETAPA — para casar com o horário do estrago ==='
SELECT placa,
       to_char(data_evento AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI:SS') AS quando,
       coalesce(status_anterior, '(nova)') AS de,
       status_novo AS para,
       setor,
       operador_nome AS quem
  FROM fact_statusfrota
 WHERE placa IN ('SIY0G43', 'RNS3G28', 'OPQ3989', 'SIY0G36')
   AND data_evento >= '2026-08-25 00:00-03'
 ORDER BY placa, data_evento;

\echo ''
\echo '=== 5. ESSAS PLACAS VIERAM DA MONTAGEM DO DIA? ==='
\echo '--- Se carga_id estiver preenchido, a linha virou carga por ali. ---'
SELECT placa,
       montagem_id,
       carga_id,
       rota_codigo AS rota,
       numero_carga,
       sequencia AS seq,
       to_char(efetivada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS efetivada,
       to_char(cancelada_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI') AS cancelada
  FROM programacao_montagem
 WHERE data_prog = '2026-08-25'
 ORDER BY sequencia NULLS LAST, criado_em;

\echo ''
\echo '=== FIM — copie a saída inteira e mande de volta ==='
