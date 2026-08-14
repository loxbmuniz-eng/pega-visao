-- Data em que a CARGA foi lançada, separada da data em que o registro
-- nasceu (criado_em).
--
-- Motivo (14/08/2026, relato do gestor de logística): quando a Portaria dá
-- entrada num caminhão que chegou sem programação, o registro nasce na hora
-- da CHEGADA. A carga desse caminhão costuma ser lançada só no dia
-- seguinte. O relatório filtrava por criado_em, então a carga lançada hoje
-- num caminhão que chegou ontem não aparecia no relatório de hoje.
--
-- criado_em continua intocado de propósito: é o histórico de quando o carro
-- realmente chegou, e não pode ser perdido. São dois fatos diferentes, com
-- duas colunas diferentes.
--
-- O DEFAULT preenche o passado com criado_em, que é o melhor palpite
-- disponível e mantém o comportamento atual para tudo que já existe.
ALTER TABLE fact_viagens
  ADD COLUMN IF NOT EXISTS programado_em TIMESTAMPTZ;

UPDATE fact_viagens SET programado_em = criado_em WHERE programado_em IS NULL;
