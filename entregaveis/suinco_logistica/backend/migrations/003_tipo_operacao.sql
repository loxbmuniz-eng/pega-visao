-- =====================================================================
-- 003 — Tipo de Operação: 3 categorias em vez de 4
-- ---------------------------------------------------------------------
-- Pedido direto do gestor (Alysson, via WhatsApp, 08/08/2026): "Exclua
-- esse frota propria. E altere o dedicada para entrega direta. E deixe
-- somente esses tres: Cross / Entrega Direta / Ret Frigo."
--
-- FROTA PRÓPRIA some como categoria — caminhão da própria Suinco fazendo
-- entrega direta é operacionalmente a mesma coisa que um terceiro
-- dedicado fazendo entrega direta, então as duas se juntam em ENTREGA
-- DIRETA (renomeação de DEDICADA).
--
-- Dado já gravado migra junto: sem isso a carga antiga ficaria com um
-- valor que o painel não sabe mais desenhar (option some do <select>) e
-- que o relatório não sabe mais rotular.
-- =====================================================================

-- A trava precisa sair ANTES do UPDATE: o valor novo (ENTREGA DIRETA)
-- não é aceito pela trava ANTIGA, que só conhecia FROTA PROPRIA/DEDICADA.
ALTER TABLE fact_viagens
  DROP CONSTRAINT IF EXISTS fact_viagens_pra_onde_check;

UPDATE fact_viagens
   SET pra_onde = 'ENTREGA DIRETA'
 WHERE pra_onde IN ('FROTA PROPRIA', 'DEDICADA');

ALTER TABLE fact_viagens
  ALTER COLUMN pra_onde SET DEFAULT 'ENTREGA DIRETA';

ALTER TABLE fact_viagens
  ADD CONSTRAINT fact_viagens_pra_onde_check
  CHECK (pra_onde IN ('CROSS-DOCKING', 'ENTREGA DIRETA', 'RET FRIGO'));
