-- =====================================================================
-- 005 — Motorista no cadastro da Frota
-- ---------------------------------------------------------------------
-- Pedido do usuário (11/08/2026): "adicionar campo motorista ao cadastro
-- de placas" + "DA MESMA FORMA QUE QUANDO O INPUT DA PLACA É FEITO, E
-- ALTERA AUTOMATICAMENTE A TRANSPORTADORA, ALTERAR O NOME DO MOTORISTA
-- CASO JA TENHA NOME CADASTRADO NA PLACA".
--
-- O motorista já existia POR CARGA (fact_viagens.motorista) — quem
-- dirigiu aquele embarque específico. O que faltava era o motorista
-- HABITUAL da placa, que serve de sugestão no momento de programar,
-- exatamente como a transportadora já faz.
--
-- Os dois seguem separados de propósito: trocar o motorista de uma carga
-- não pode reescrever o cadastro da frota, e trocar o cadastro não pode
-- reescrever o histórico de quem realmente dirigiu.
-- =====================================================================

ALTER TABLE dim_veiculos
  ADD COLUMN IF NOT EXISTS motorista TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN dim_veiculos.motorista IS
  'Motorista habitual desta placa. Usado só como sugestão ao programar '
  'a carga (fact_viagens.motorista guarda quem de fato dirigiu).';
