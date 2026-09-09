-- =====================================================================
-- 047 — A tabela de frete, os dois KM e o valor da carga (09/09/2026)
-- ---------------------------------------------------------------------
-- Pedido do dono, com a tabela oficial em PDF
-- (Tarifas_de_frete_KM_CROSS_E_TRANSF_16.06.2026):
--
--   "criar tabela de frete no embarquesuinco.com.br, cadastro possa ser
--    editavel e criada da mesma forma que funcionam os cadastros (...) na
--    verdade vao ser dois campos de KM, um de KM DESTINO, e KM
--    DESLOCAMENTO (precisa ser o valor certinho do valor que sera pago no
--    frete)"
--   "valor kilometragem é por modalidade de veiculo"
--   "transportadora suinco ou FOB nao tem valor de frete"
--   "vamos incluir um campo de kilometragem obrigatoria na criacao de
--    qualquer carga KM"  → decisão final, confirmada: trava a CONTRATAÇÃO
--    (colocar a placa), não a criação da carga.
--
-- A TABELA DO PDF É UMA CONTA, NÃO UMA LISTA.
--
-- Conferidas as 23 linhas × 5 tipos = 115 células do PDF: TODAS são
-- `km × tarifa do tipo de veículo`, sem uma exceção.
--
--   BRASILIA (RN TRANSP E VERSATTO)  475 km × 5,04  = 2.394,00   (3/4)
--   SALVADOR (COM DESVIO)           1570 km × 11,66 = 18.306,20  (CARRETA)
--   GOIANIA                          583 km × 7,75  = 4.518,25   (TRUCK)
--
-- Por isso esta migração NÃO guarda as 115 células. Guarda 5 tarifas e o
-- km de cada destino, e o valor sai calculado. Guardar o resultado de uma
-- conta é guardar algo que envelhece: quando a tarifa subir, alguém teria
-- de redigitar 115 números e errar um. Assim são cinco.
--
-- DOIS KM, E NÃO UM. `km_destino` é a referência da tabela para aquele
-- destino; `km_deslocamento` é o que de fato será pago. Eles divergem
-- quando a viagem tem desvio, retorno ou coleta no caminho — e é o
-- deslocamento que multiplica a tarifa. Guardar um só obrigaria a escolher
-- entre "a tabela diz" e "o que foi pago", e as duas perguntas existem.
-- É o mesmo padrão da transportadora da carga × a da Frota (ocorrência
-- #32): referência e efetivo, com a diferença visível.
--
-- SEM ESTA MIGRAÇÃO: o painel novo mostra os campos de KM, o cadastro de
-- tarifas e destinos, e a coluna de valor no relatório de fretes — e o
-- servidor RECUSA tudo com erro de coluna inexistente. A trava de placa
-- por KM não vale, e o relatório sai sem valor. Nenhum setor existente é
-- afetado; carga, devolução e pátio seguem iguais.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. As cinco tarifas por modalidade de veículo.
--
--    `tipo_veiculo` casa com o que a Frota já usa (dim_veiculos.tipo_veiculo)
--    — o dono confirmou que os cinco da tabela batem com os do cadastro.
--    Tipo que não estiver aqui simplesmente não calcula valor; a carga
--    continua existindo e a coluna sai vazia com aviso, em vez de o painel
--    recusar um caminhão por causa de uma tabela de preço.
--
--    `vigente_desde` existe porque tarifa muda: guardar a data em que
--    passou a valer é o que permite conferir um frete antigo com a tarifa
--    daquela época, em vez de recalcular o passado com o preço de hoje.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS frete_tarifas (
  tipo_veiculo    TEXT PRIMARY KEY,
  valor_por_km    NUMERIC(10,4) NOT NULL CHECK (valor_por_km >= 0),
  vigente_desde   DATE NOT NULL DEFAULT CURRENT_DATE,
  operador        TEXT NOT NULL DEFAULT '',
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO frete_tarifas (tipo_veiculo, valor_por_km, vigente_desde, operador) VALUES
  ('3/4',      5.04,  DATE '2026-04-10', 'tabela oficial 10/04/2026'),
  ('Toco',     6.09,  DATE '2026-04-10', 'tabela oficial 10/04/2026'),
  ('Truck',    7.75,  DATE '2026-04-10', 'tabela oficial 10/04/2026'),
  ('Bitruck',  8.97,  DATE '2026-04-10', 'tabela oficial 10/04/2026'),
  ('Carreta', 11.66,  DATE '2026-04-10', 'tabela oficial 10/04/2026')
ON CONFLICT (tipo_veiculo) DO NOTHING;

-- ---------------------------------------------------------------------
-- 2. Os destinos, com o km de referência.
--
--    O nome vem exatamente como está na tabela oficial, inclusive as
--    variantes — "MONTES CLAROS (COM DESVIO)" e "(SEM DESVIO)" são
--    destinos DIFERENTES porque têm km diferentes, e "BRASILIA (RN TRANSP)"
--    e "(VERSATTO)" idem. Normalizar isso para "MONTES CLAROS" perderia
--    justamente a informação que decide o valor.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS frete_destinos (
  destino        TEXT PRIMARY KEY,
  km             INTEGER NOT NULL CHECK (km > 0),
  ativo          BOOLEAN NOT NULL DEFAULT TRUE,
  operador       TEXT NOT NULL DEFAULT '',
  atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO frete_destinos (destino, km, operador) VALUES
  ('BRASILIA (RN TRANSP E VERSATTO)',    475,  'tabela oficial 16/06/2026'),
  ('BRASILIA (RN TRANSP)',               450,  'tabela oficial 16/06/2026'),
  ('BRASILIA (VERSATTO)',                450,  'tabela oficial 16/06/2026'),
  ('CONTAGEM',                           410,  'tabela oficial 16/06/2026'),
  ('DUQUE DE CAXIAS (FLORESTA)',         740,  'tabela oficial 16/06/2026'),
  ('GOIANIA',                            583,  'tabela oficial 16/06/2026'),
  ('GOV. VALADARES',                     725,  'tabela oficial 16/06/2026'),
  ('JUIZ DE FORA',                       655,  'tabela oficial 16/06/2026'),
  ('MONTES CLAROS (COM DESVIO)',         585,  'tabela oficial 16/06/2026'),
  ('MONTES CLAROS (SEM DESVIO)',         445,  'tabela oficial 16/06/2026'),
  ('OSASCO',                             768,  'tabela oficial 16/06/2026'),
  ('PASSOS',                             445,  'tabela oficial 16/06/2026'),
  ('PASSOS E VARGINHA',                  575,  'tabela oficial 16/06/2026'),
  ('RIB. PRETO',                         425,  'tabela oficial 16/06/2026'),
  ('RIB. PRETO E MARILIA',               710,  'tabela oficial 16/06/2026'),
  ('RIO DE JANEIRO',                     830,  'tabela oficial 16/06/2026'),
  ('SALVADOR (COM DESVIO)',             1570,  'tabela oficial 16/06/2026'),
  ('SALVADOR (SEM DESVIO)',             1430,  'tabela oficial 16/06/2026'),
  ('SERRA',                              950,  'tabela oficial 16/06/2026'),
  ('UBERLANDIA',                         220,  'tabela oficial 16/06/2026'),
  ('VARGINHA',                           473,  'tabela oficial 16/06/2026'),
  ('VITORIA DA CONQUISTA (COM DESVIO)', 1090,  'tabela oficial 16/06/2026'),
  ('VITORIA DA CONQUISTA (SEM DESVIO)',  900,  'tabela oficial 16/06/2026')
ON CONFLICT (destino) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. Os campos na carga.
--
--    NULL ≠ ZERO, e aqui isso é dinheiro: km 0 e "km não informado" são
--    coisas diferentes, e `Number(0) || null` já apagou capacidade de
--    veículo neste projeto. Por isso nenhum destes campos tem DEFAULT 0.
--
--    `frete_destino` é TEXT e NÃO tem chave estrangeira para
--    frete_destinos de propósito: o destino de uma carga já gravada é
--    registro do que aconteceu, e apagar uma linha do cadastro não pode
--    apagar o passado nem impedir a leitura da carga. O vínculo é
--    conferido na escrita, pela rota.
--
--    `frete_valor` é GRAVADO, não calculado na leitura: a tarifa muda com
--    o tempo, e recalcular um frete de três meses atrás com a tarifa de
--    hoje faria o relatório mentir. O valor é congelado no momento em que
--    a carga é contratada, junto com a tarifa que o produziu.
-- ---------------------------------------------------------------------
ALTER TABLE fact_viagens
  ADD COLUMN IF NOT EXISTS frete_destino        TEXT,
  ADD COLUMN IF NOT EXISTS km_destino           INTEGER,
  ADD COLUMN IF NOT EXISTS km_deslocamento      INTEGER,
  ADD COLUMN IF NOT EXISTS frete_valor          NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS frete_tarifa_usada   NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS frete_documento      TEXT;

COMMENT ON COLUMN fact_viagens.frete_destino IS
  'Destino da tabela de frete (frete_destinos.destino). Sem FK: carga gravada é registro.';
COMMENT ON COLUMN fact_viagens.km_destino IS
  'KM de referência do destino, copiado do cadastro no momento da escolha.';
COMMENT ON COLUMN fact_viagens.km_deslocamento IS
  'KM que de fato será pago. É este que multiplica a tarifa. Sem ele não se contrata a placa.';
COMMENT ON COLUMN fact_viagens.frete_valor IS
  'km_deslocamento x tarifa do tipo do veículo, congelado na contratação. NULL para SUINCO e FOB.';
COMMENT ON COLUMN fact_viagens.frete_tarifa_usada IS
  'A tarifa (R$/km) que produziu frete_valor. Guardada para conferir frete antigo com o preço da época.';
COMMENT ON COLUMN fact_viagens.frete_documento IS
  'Número do documento de frete. Preenchido pela Administração, fora do sistema, na planilha.';

CREATE INDEX IF NOT EXISTS idx_viagens_frete_destino ON fact_viagens (frete_destino);
