-- =====================================================================
-- 036 — TRANSPORTADORA NA MONTAGEM (25/08/2026)
-- ---------------------------------------------------------------------
-- Pedido do dono, junto com o da sequência: "transportadora também".
--
-- Até aqui a transportadora era SÓ da Frota: a placa dizia quem era, e a
-- tela mostrava sem deixar mexer. A razão era boa — duas verdades sobre o
-- mesmo caminhão é pior que uma incompleta.
--
-- Mas a operação tem um caso que essa regra não cobre: a mesma placa roda
-- por outra transportadora num dia específico (subcontratação, freteiro,
-- veículo emprestado). Nesses dias o cadastro está certo e o dia é a
-- exceção — e quem monta a carga sabe disso antes de o caminhão chegar.
--
-- A coluna guarda só o que for DIFERENTE do cadastro: vazio significa "o
-- que a Frota diz", e é o caso normal. Assim o cadastro continua sendo a
-- fonte, e o dia registra a exceção sem apagá-la.
-- =====================================================================

ALTER TABLE programacao_montagem
  ADD COLUMN IF NOT EXISTS transportadora TEXT NOT NULL DEFAULT '';
