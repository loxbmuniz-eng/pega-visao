-- =====================================================================
-- 065 — Tentativas da senha da parte de gerenciar usuários (08/10/2026)
-- ---------------------------------------------------------------------
-- Pedido do dono: senha na aba Usuários. Quem erra segue a regra do login
-- (dominio/tentativas.js: cinco erros em 30 minutos, espera de 15) — mas
-- com contagem PRÓPRIA: errar a senha da aba não pode trancar o login da
-- pessoa, nem o login errado gastar as tentativas da aba.
--
-- Só acrescenta colunas, com padrão. Nenhuma linha muda de valor.
-- SEM ESTA MIGRAÇÃO: a rota de destrancar responde erro 500 e a parte de
-- gerenciar fica trancada enquanto houver senha gravada no .env. A ordem do
-- instalar.sh (migrações antes de reiniciar) não deixa isso acontecer.
-- =====================================================================
ALTER TABLE operadores
  ADD COLUMN IF NOT EXISTS usuarios_falhas       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS usuarios_falhas_desde timestamptz,
  ADD COLUMN IF NOT EXISTS usuarios_espera_ate   timestamptz;
