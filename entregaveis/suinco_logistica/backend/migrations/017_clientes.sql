-- =====================================================================
-- 017 — Cadastro de Clientes (cód. cliente → RCA → supervisor)
-- ---------------------------------------------------------------------
-- Pedido do usuário (18/08/2026): digitar o código do cliente no
-- checklist deve puxar o vínculo automaticamente, na mesma lógica da
-- placa que puxa a transportadora da Frota.
--
-- Nenhum arquivo com essa relação foi enviado ainda, então a base nasce
-- VAZIA e aprende de dois jeitos: cadastro manual na aba Cadastros, e
-- aprendizado automático — todo item de checklist gravado com cliente +
-- RCA/supervisor ensina o vínculo (último registro vence). Quando a
-- planilha oficial de clientes existir, entra por migração como as
-- outras bases.
-- =====================================================================

CREATE TABLE IF NOT EXISTS dim_clientes (
    codigo        TEXT PRIMARY KEY,
    nome          TEXT NOT NULL DEFAULT '',
    vendedor      TEXT NOT NULL DEFAULT '',   -- RCA
    supervisor    TEXT NOT NULL DEFAULT '',
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE dim_clientes IS
  'Clientes das devoluções: código → RCA → supervisor. Alimentada pela '
  'tela de Cadastros e pelo aprendizado automático dos itens de checklist.';
