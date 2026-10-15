-- =====================================================================
-- 067 — Pedido de correção de etapa (14/10/2026, aprovado: "marcha fio")
-- ---------------------------------------------------------------------
-- Pedido do dono: correção sem telefonema. Hoje, quem avança a etapa por
-- engano (Portaria, Expedição, Faturamento) precisa ligar para a
-- Administração, que vai ao Histórico corrigir. Agora quem errou PEDE pelo
-- painel, com motivo; a Administração recebe no celular e aprova ou recusa.
-- Aprovar é a MESMA correção de etapa de sempre (a da rota corrigir-etapa),
-- com o nome de quem pediu e de quem aprovou na trilha.
--
-- Só cria a tabela. Nenhuma linha de outra tabela muda.
-- Um pedido aberto por carga (o índice único parcial): o segundo pedido
-- para a mesma carga é recusado enquanto o primeiro não for decidido.
-- SEM ESTA MIGRAÇÃO: pedir correção responde "o servidor ainda não tem o
-- pedido de correção" (503) e a correção continua como hoje, pela
-- Administração no Histórico. A ordem do instalar.sh (migrações antes de
-- reiniciar) não deixa isso acontecer.
-- =====================================================================
CREATE TABLE IF NOT EXISTS pedidos_correcao (
  pedido_id       bigserial   PRIMARY KEY,
  carga_id        text        NOT NULL REFERENCES fact_viagens(carga_id) ON DELETE CASCADE,
  de_status       text        NOT NULL,
  para_status     text        NOT NULL,
  motivo          text        NOT NULL CHECK (length(btrim(motivo)) > 0),
  pedido_por_id   text        NOT NULL,
  pedido_por      text        NOT NULL,
  pedido_setor    text        NOT NULL,
  pedido_em       timestamptz NOT NULL DEFAULT now(),
  decisao         text        CHECK (decisao IN ('aprovado', 'recusado')),
  decidido_por_id text,
  decidido_por    text,
  decidido_em     timestamptz,
  obs_decisao     text        NOT NULL DEFAULT ''
);
-- Um pedido aberto por carga.
CREATE UNIQUE INDEX IF NOT EXISTS pedidos_correcao_um_aberto
  ON pedidos_correcao (carga_id) WHERE decisao IS NULL;
CREATE INDEX IF NOT EXISTS pedidos_correcao_abertos
  ON pedidos_correcao (pedido_em) WHERE decisao IS NULL;
