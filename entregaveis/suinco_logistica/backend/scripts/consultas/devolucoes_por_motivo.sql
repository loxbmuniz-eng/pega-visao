-- =====================================================================
-- DEVOLUÇÕES POR MOTIVO, DESDE O PRIMEIRO CHECKLIST (01/10/2026)
-- Pedido do dono: "todos os checklists de devoluções feitos desde que foi
-- implantada essa funcionalidade (...) um relatório por motivos".
--
-- SÓ LEITURA: um SELECT, nada é gravado, apagado ou alterado.
-- Conta o que está vivo — checklist não excluído e item não excluído
-- (exclusão é macia, migração 052). Sobra (tipo SOBRA) sai separada da
-- devolução. "Notas" conta notas fiscais distintas; "caixas" e "peso" são
-- a soma dos itens (peso vazio não vira zero: soma só o que foi pesado).
--
-- No servidor, como root, numa linha só:
--   su -s /bin/bash postgres -c "psql -d embarque_suinco -X -A -F'|'" < /opt/suinco-src/entregaveis/suinco_logistica/backend/scripts/consultas/devolucoes_por_motivo.sql
-- =====================================================================
SET default_transaction_read_only = on;   -- trava: se algo tentar gravar, o banco recusa
SELECT d.tipo,
       COALESCE(NULLIF(trim(i.motivo), ''), '(sem motivo)')        AS motivo,
       count(DISTINCT d.devolucao_id)                               AS checklists,
       count(DISTINCT NULLIF(i.nota, ''))                           AS notas,
       count(*)                                                     AS itens,
       round(sum(i.cx), 2)                                          AS caixas,
       round(sum(i.peso), 1)                                        AS peso_kg,
       min(d.data_dev)                                              AS primeiro,
       max(d.data_dev)                                              AS ultimo
  FROM devolucoes d
  JOIN devolucao_itens i ON i.devolucao_id = d.devolucao_id
 WHERE d.excluida_em IS NULL AND i.excluido_em IS NULL
 GROUP BY d.tipo, 2
 ORDER BY d.tipo, caixas DESC NULLS LAST, itens DESC;
