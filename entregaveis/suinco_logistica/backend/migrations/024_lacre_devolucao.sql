-- 024 — "Chegou lacrado?" na devolução, pedido de 18/08/2026:
-- "na parte da devolução, caso chegue lacrado também eles possam informar
--  o número do lacre ou, se não estiver lacrado, informar isso".
--
-- Campo vazio hoje é ambíguo: pode ser "chegou sem lacre" ou "ninguém
-- anotou". Três estados resolvem:
--   NULL  = ainda não informado
--   TRUE  = chegou LACRADO (o número vai em lacre1/lacre2)
--   FALSE = chegou SEM LACRE (informado de propósito)
--
-- É informação, não trava: a devolução anda em qualquer um dos três.

ALTER TABLE devolucoes ADD COLUMN IF NOT EXISTS chegou_lacrado BOOLEAN;
