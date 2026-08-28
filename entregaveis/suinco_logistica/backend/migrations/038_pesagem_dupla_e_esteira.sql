-- =====================================================================
-- 038 — AS DUAS PESAGENS E O RESTO DA ESTEIRA (27/08/2026)
-- SEM ESTA MIGRAÇÃO: o peso de entrada e as observações das duas últimas etapas não têm onde ser gravados. O painel novo mostra os campos, a gravação é recusada pelo servidor com erro, e a etapa "Faturamento (peso final)" não existe — o checklist trava depois da Expedição. As devoluções ficam sem andar; o resto do sistema segue igual.
-- ---------------------------------------------------------------------
-- O FLUXO REAL, contado pelo dono no dia:
--
--   "caminhão chega com devoluções, pesa na balança, vai pra expedição,
--    descarrega, depois volta pra balança pra pesar vazio (...) faturamento
--    colocar o peso final depois que descarregou, porque depois que
--    descarrega o motorista volta pra balança e pesa o peso final com o
--    caminhão vazio (...) de lá vai pra controles internos e central de
--    notas, que precisa só de um campo pro CHECK do checklist pra confirmar
--    a etapa, e observações para que eles possam comunicar com a próxima
--    etapa".
--
-- A BALANÇA É USADA DUAS VEZES, e o painel só tinha um campo de peso. Sem o
-- peso de entrada não existe conta nenhuma: é a diferença entre as duas
-- pesagens que diz QUANTO voltou de verdade, e é ela que se compara com a
-- soma do que foi lançado no checklist. Sem isso, divergência entre o
-- lançado e o que desceu do caminhão não aparece em lugar nenhum.
--
-- O QUE MUDA AQUI:
--
--   1. `peso_entrada`  — o caminhão CHEIO, na chegada (Faturamento).
--      NULL é legítimo: nem toda devolução passa pela balança.
--   2. carimbo `pesofinal_por` / `pesofinal_em` — a etapa NOVA, depois da
--      Expedição. É a segunda ida do Faturamento à balança, e precisa de
--      assinatura própria: a primeira pesagem e a segunda são dois
--      momentos diferentes e duas responsabilidades diferentes.
--   3. `obs_notas` — o recado da Central de Notas para quem vem depois.
--      Os Controles Internos já tinham o deles (`obs_controles`).
--
-- O status novo ('Peso Final Registrado') NÃO precisa de coluna: `status` é
-- TEXT e a máquina de estados mora em dominio/devolucoes.js. Mas os
-- checklists que já existem ficam no status antigo e continuam válidos —
-- nenhuma linha é reescrita aqui, de propósito: mexer no status de
-- checklist em andamento é mexer no que já aconteceu.
-- =====================================================================

ALTER TABLE devolucoes ADD COLUMN IF NOT EXISTS peso_entrada    NUMERIC(12,3);
ALTER TABLE devolucoes ADD COLUMN IF NOT EXISTS pesofinal_por   TEXT;
ALTER TABLE devolucoes ADD COLUMN IF NOT EXISTS pesofinal_em    TIMESTAMPTZ;
ALTER TABLE devolucoes ADD COLUMN IF NOT EXISTS obs_notas       TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN devolucoes.peso_entrada IS
  'Peso do caminhão CHEIO na chegada, em kg (balança, Faturamento). NULL = não pesou.';
COMMENT ON COLUMN devolucoes.peso_final IS
  'Peso do caminhão VAZIO depois da descarga, em kg (balança, Faturamento). '
  'O devolvido é peso_entrada - peso_final, e o painel compara com o lançado.';
COMMENT ON COLUMN devolucoes.pesofinal_por IS
  'Quem assinou a etapa do peso final (segunda ida à balança).';
COMMENT ON COLUMN devolucoes.obs_notas IS
  'Recado da Central de Notas — comunica com quem vem depois. Sai no relatório.';
