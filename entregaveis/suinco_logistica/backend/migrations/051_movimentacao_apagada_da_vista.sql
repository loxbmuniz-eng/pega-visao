-- 051 — MOVIMENTAÇÃO APAGADA DA VISTA, COM QUEM, QUANDO E POR QUÊ
--
-- SEM ESTA MIGRAÇÃO: o botão "Apagar registros desta placa" do Histórico
-- (Administração) responde erro de servidor, e os lançamentos repetidos de
-- uma placa que multiplicou por defeito (RYV8G03, 11/09/2026) continuam
-- aparecendo no Histórico, no estado e nos indicadores de todo terminal.
--
-- PEDIDO DO DONO, 11/09/2026, em emergência: "EXCLUA TODOS OS LANÇAMENTOS PRA
-- ESSA PLACA AGORA (...) essa autorização é somente para o meu token".
--
-- POR QUE NÃO É DELETE. fact_statusfrota é declarada append-only desde a 001:
-- é a tabela-fato do Power BI e a base de todo indicador de tempo, e a regra
-- da casa é "pátio não se apaga". Apagar a linha destruiria a prova de que
-- houve o defeito — justamente o que a ocorrência #48 precisa. Então a linha
-- FICA, marcada: sai do Histórico, do estado e dos indicadores, e guarda quem
-- apagou, quando e por quê. Só a Administração marca. A leitura filtra
-- `apagada_em IS NULL` em todo lugar que lê a tabela (estado, histórico,
-- entrada no pátio).
ALTER TABLE fact_statusfrota
    ADD COLUMN IF NOT EXISTS apagada_em     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS apagada_por    TEXT,
    ADD COLUMN IF NOT EXISTS apagada_motivo TEXT;

COMMENT ON TABLE fact_statusfrota IS
  'Tabela FATO do Power BI e base de todo indicador de tempo. Append-only: '
  'não há DELETE na aplicação. A ÚNICA escrita depois do INSERT é a marca '
  'apagada_em/apagada_por/apagada_motivo (migração 051), que tira a linha da '
  'vista sem destruir o registro.';

CREATE INDEX IF NOT EXISTS ix_status_placa_viva
    ON fact_statusfrota (placa) WHERE apagada_em IS NULL;
