-- =====================================================================
-- 063 — Pagamento de Frete: cada nota pendente com os seus campos (06/10/2026)
-- ---------------------------------------------------------------------
-- SEM ESTA MIGRAÇÃO: a aba continua como antes (campos só na 1ª linha da
-- carga); pagar uma nota ou editar a transportadora/CT-E de uma nota
-- respondem "o servidor ainda não tem esta função" (503 explicado).
--
-- Pedido do dono: "tem que ter a data de pagamento para cada uma das
-- pendências (...) pode ser que a primeira eu pague hoje, a outra no próximo
-- pagamento" e "ter os campos editáveis pra toda pendência da carga".
-- Decisões dele (06/10/2026):
--   · pagar uma nota SOMA UMA NOTA no % Pago da carga — é um pagamento como
--     os outros (entra no Fechamento do mês, anula-se no Histórico), ligado
--     à nota pela coluna `nota`;
--   · transportadora e CT-E por nota: em branco = os da carga; preenchidos =
--     a exceção daquela nota (reentrega por outra, CT-E complementar).
--   · nada aqui é valor em R$: a aba é controle e organização.
-- =====================================================================
ALTER TABLE pgfrete_pendencias
  ADD COLUMN IF NOT EXISTS transportadora TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cte            TEXT NOT NULL DEFAULT '';
ALTER TABLE pgfrete_pagamentos
  ADD COLUMN IF NOT EXISTS nota TEXT;
-- Uma nota não se paga duas vezes: só um pagamento VÁLIDO por nota.
CREATE UNIQUE INDEX IF NOT EXISTS ux_pgfrete_pag_nota
  ON pgfrete_pagamentos (numero_carga, nota) WHERE nota IS NOT NULL AND anulado_em IS NULL;
