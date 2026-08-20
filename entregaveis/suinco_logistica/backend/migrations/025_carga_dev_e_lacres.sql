-- 025 — Duas correções vindas da operação em 20/08/2026.
--
-- ---------------------------------------------------------------------
-- 1. Nº DEV e Nº DA CARGA DE DEVOLUÇÃO são DOIS NÚMEROS DIFERENTES
-- ---------------------------------------------------------------------
-- Relato do gestor: "o código da DEV que vem no checklist das meninas
-- precisa ser o código da DEV. Depois que o porteiro abre o SIS ATAK,
-- gera-se OUTRO código de carga, o número de carga de devolução".
--
-- Ou seja, são dois momentos e dois donos:
--
--   · num_dev   — o código da devolução, que já vem no papel e é lançado
--                 pela Logística junto com a nota. JÁ EXISTE, não muda.
--   · carga_dev — o número que o SIS ATAK gera para AQUELA DEV quando o
--                 porteiro a abre no sistema. NASCE AQUI.
--
-- Guardar os dois no mesmo campo faria o relatório mentir para os dois
-- lados: quem procura pela DEV não acharia, e quem procura pela carga
-- tampouco. Campo separado é a única forma de os dois números
-- sobreviverem.
ALTER TABLE devolucao_itens
  ADD COLUMN IF NOT EXISTS carga_dev TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN devolucao_itens.carga_dev IS
  'Número da carga de devolução gerado pelo SIS ATAK quando a Portaria '
  'abre esta DEV. Diferente de num_dev, que é o código da devolução '
  'lançado no checklist pela Logística.';

-- O cabeçalho (devolucoes.carga_numero) continua sendo o número do
-- CAMINHÃO inteiro — o porteiro gera um por chegada. Os dois convivem: um
-- descreve o veículo, o outro descreve cada devolução dentro dele.

-- ---------------------------------------------------------------------
-- 2. Até TRÊS lacres na saída do caminhão
-- ---------------------------------------------------------------------
-- Mesmo relato: "pode haver mais de um (ou dois, no máximo três) lacres
-- na saída do caminhão".
--
-- Até aqui a saída guardava um lacre só, e quem lacrava com dois ou três
-- ou escolhia qual anotar, ou empilhava tudo no mesmo campo separado por
-- barra — em ambos os casos o número deixava de ser pesquisável.
--
-- `lacre` continua sendo o PRIMEIRO: nenhuma linha existente precisa ser
-- convertida, e todo relatório que já lê `lacre` continua correto.
ALTER TABLE fact_viagens ADD COLUMN IF NOT EXISTS lacre_2 TEXT NOT NULL DEFAULT '';
ALTER TABLE fact_viagens ADD COLUMN IF NOT EXISTS lacre_3 TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN fact_viagens.lacre_2 IS 'Segundo lacre da saída, quando o caminhão sai com mais de um.';
COMMENT ON COLUMN fact_viagens.lacre_3 IS 'Terceiro lacre da saída — o máximo praticado no pátio.';

-- Na CHEGADA da devolução o caminhão pode trazer os mesmos três.
ALTER TABLE devolucoes ADD COLUMN IF NOT EXISTS lacre3 TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN devolucoes.lacre3 IS
  'Terceiro lacre informado pela Portaria na chegada da devolução.';
