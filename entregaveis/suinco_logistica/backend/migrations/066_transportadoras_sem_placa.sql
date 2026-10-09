-- =====================================================================
-- 066 — Transportadora sem placa na Frota (09/10/2026, #129)
-- ---------------------------------------------------------------------
-- Pedido do dono: "nem toda transportadora tem placa vinculada". O
-- Pagamento de Frete só aceitava transportadora de alguma placa da Frota
-- (dim_veiculos) — e a AG Sestini, que opera as rotas 520 e 536, não tem
-- placa cadastrada: a Daniela não conseguia lançar a carga 119072.
--
-- Uma lista no servidor, igual em todo computador. O Pagamento de Frete
-- aceita as transportadoras da Frota MAIS as desta lista. Excluir não apaga
-- a linha: marca quando e quem (as cargas que já usam o nome continuam com
-- ele, e o registro fica).
--
-- Só cria a tabela. Nenhuma linha de outra tabela muda.
-- SEM ESTA MIGRAÇÃO: cadastrar transportadora sem placa responde "o servidor
-- ainda não tem o cadastro" (503) e o Pagamento de Frete segue aceitando só
-- as da Frota, como hoje. A ordem do instalar.sh (migrações antes de
-- reiniciar) não deixa isso acontecer.
-- =====================================================================
CREATE TABLE IF NOT EXISTS transportadoras (
  id            bigserial PRIMARY KEY,
  nome          text        NOT NULL,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  criado_por    text,
  excluida_em   timestamptz,
  excluida_por  text
);
-- Um nome ativo por vez; o mesmo nome pode voltar depois de excluído.
CREATE UNIQUE INDEX IF NOT EXISTS transportadoras_nome_ativo
  ON transportadoras (nome) WHERE excluida_em IS NULL;
