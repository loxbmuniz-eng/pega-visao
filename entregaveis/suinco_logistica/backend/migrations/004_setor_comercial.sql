-- =====================================================================
-- 004 — Setor Comercial (só leitura)
-- ---------------------------------------------------------------------
-- Pedido do usuário (08/08/2026): visão de tudo que Logística/Administração
-- vê (torre, histórico, relatórios), sem poder alterar nada — para o
-- Comercial parar de precisar perguntar pra Logística/Administração onde
-- está cada carga.
--
-- Só adiciona um valor permitido na trava de setor de `operadores`. Não
-- concede nenhum poder de escrita: nenhuma função de permissão em
-- dominio/fluxo.js (podeCriarCarga, podeRegistrarSaida, exigirSetor...)
-- inclui 'Comercial' — allowlist nega por padrão quem não está na lista.
-- =====================================================================

ALTER TABLE operadores
  DROP CONSTRAINT IF EXISTS operadores_setor_check;

ALTER TABLE operadores
  ADD CONSTRAINT operadores_setor_check
  CHECK (setor IN ('Logística','Portaria','Expedição','Faturamento','Administração','Comercial'));
