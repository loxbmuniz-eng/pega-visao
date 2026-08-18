-- =====================================================================
-- 011 — Setores da devolução + produto com quilo
-- ---------------------------------------------------------------------
-- Pedido do usuário (18/08/2026), na sequência da aba Devoluções: criar
-- já os setores CONTROLES INTERNOS (destina os produtos devolvidos —
-- Estoque/Descarte/Reprocesso — e escreve as observações do romaneio) e
-- CENTRAL DE NOTAS (finaliza a nota fiscal, encerrando o ciclo).
--
-- Mesmo desenho do 004 (Comercial): só entra o valor permitido na trava
-- de setor de `operadores`. Nenhum poder de escrita nas CARGAS vem junto
-- — as allowlists de dominio/fluxo.js não os incluem. Nas DEVOLUÇÕES,
-- cada um ganha exatamente o próprio passo (dominio/devolucoes.js):
-- Controles Internos assina "Destinada" e escolhe a destinação por item;
-- Central de Notas assina "Nota Finalizada". Nada além disso.
-- =====================================================================

ALTER TABLE operadores
  DROP CONSTRAINT IF EXISTS operadores_setor_check;

ALTER TABLE operadores
  ADD CONSTRAINT operadores_setor_check
  CHECK (setor IN ('Logística','Portaria','Expedição','Faturamento',
                   'Administração','Comercial',
                   'Controles Internos','Central de Notas'));

-- Produto com quilo — "produtos: código e kilo" (pedido de 18/08/2026).
-- É o peso de UMA caixa; com ele o lançamento sugere o peso da linha
-- (caixas × kg/caixa) em vez de a operadora calcular de cabeça. NULL é
-- válido: produto sem quilo cadastrado só não sugere nada.
ALTER TABLE dim_produtos
  ADD COLUMN IF NOT EXISTS peso_caixa_kg NUMERIC(10,3);
