-- =====================================================================
-- 056 — o KM aceita casas decimais
-- ---------------------------------------------------------------------
-- SEM ESTA MIGRAÇÃO: o KM continua inteiro no banco. O painel já manda o
-- número certo (3087,48 chega como 3087.48), e o banco corta os decimais:
-- grava 3087, e o frete sai 3087 × tarifa — R$ 5,58 a menos numa carga de
-- R$ 36 mil a R$ 11,66/km. Nada existente para de funcionar: inteiro cabe
-- em NUMERIC sem mudar de valor.
--
-- Pedido do dono (28/09/2026): "a quilometragem quando é colocada de forma
-- exata precisa poder ter quebra com vírgulas... pagou 36 mil reais, o
-- valor do km foi 11,66, o número que precisa estar lá precisa ser o
-- número exato".
--
-- O QUE ESTAVA ACONTECENDO, reproduzido antes de mexer:
--   painel   "3087,48" → 308748 km   (a vírgula era jogada fora: 100×)
--   servidor "3087.48" → 3087 km     (Math.trunc)
--
-- DUAS CASAS, não mais. O KM multiplica uma tarifa de quatro casas e o
-- resultado é arredondado no centavo; uma terceira casa de KM não muda
-- centavo nenhum em frete de caminhão, e deixaria a tela mostrar um número
-- que ninguém digitou. `frete_destinos.km` acompanha pela mesma régua: é
-- ele que preenche o KM da carga, e régua diferente nos dois cortaria em
-- silêncio o que o outro aceita. Pelo mesmo motivo `km_destino`, a cópia
-- do KM do destino que a carga e a linha da Montagem guardam, vai junto.
--
-- Nenhuma view depende destas colunas (conferido em information_schema e
-- pg_depend) — por isso o ALTER TYPE é direto.
-- =====================================================================

ALTER TABLE fact_viagens
  ALTER COLUMN km_destino      TYPE NUMERIC(10,2),
  ALTER COLUMN km_deslocamento TYPE NUMERIC(10,2),
  ALTER COLUMN frete_manual_km TYPE NUMERIC(10,2);

ALTER TABLE programacao_montagem
  ALTER COLUMN km_destino      TYPE NUMERIC(10,2),
  ALTER COLUMN km_deslocamento TYPE NUMERIC(10,2),
  ALTER COLUMN frete_manual_km TYPE NUMERIC(10,2);

ALTER TABLE frete_destinos
  ALTER COLUMN km TYPE NUMERIC(10,2);
