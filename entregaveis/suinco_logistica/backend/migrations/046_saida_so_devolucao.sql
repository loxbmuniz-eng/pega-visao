-- =====================================================================
-- 046 — A saída do caminhão que só trouxe devolução (08/09/2026)
-- ---------------------------------------------------------------------
-- Pedido do dono, trazendo o que a Portaria relatou:
--
--   "quando a devolução chega em um caminhão que não tá programado pra
--    carregar (...) ele tem que ter a opção só de depois colocar lá que
--    ele saiu, que é só devolução, então ele não vai carregar"
--
-- E, sobre a rotina real: "muitas vezes chega, descarrega e vai embora e
-- muitas vezes chega, descarrega e fica no pátio aguardando carga
-- novamente".
--
-- Até aqui o único caminho para "Seguiu Viagem" era vindo de "Faturado".
-- Um caminhão que entrou só para entregar devolução nunca chega lá — ele
-- não carrega, não fatura — e ficava preso no pátio para sempre, contando
-- como veículo presente na Torre e no tempo de pátio.
--
-- A COLUNA EXISTE PARA O NÚMERO NÃO MENTIR. Sem ela, uma saída sem
-- carregamento fica idêntica a uma viagem normal no histórico, e qualquer
-- leitura de "quantas cargas saíram" passa a contar caminhão que não levou
-- nada. Com ela, os dois casos continuam distinguíveis para sempre.
--
-- DEFAULT FALSE e NOT NULL: toda carga que já existe saiu do jeito normal,
-- e é isso que a coluna deve dizer sobre elas. Nulo aqui viraria "não se
-- sabe", que é diferente de "não" e obrigaria todo leitor a decidir o que
-- fazer com a dúvida.
--
-- SEM ESTA MIGRAÇÃO: o botão de saída só-devolução aparece na tela da
-- Portaria e o servidor recusa a gravação, porque a coluna não existe. O
-- caminhão continua presa no pátio e o porteiro recebe um erro que não
-- explica nada. Nenhuma carga existente é afetada; o resto do sistema
-- segue igual.
-- =====================================================================

ALTER TABLE fact_viagens
  ADD COLUMN IF NOT EXISTS saida_sem_carregar BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN fact_viagens.saida_sem_carregar IS
  'TRUE quando a Portaria encerrou a carga direto de "Aguardando Embarque": '
  'o caminhão entrou, entregou devolução e foi embora sem carregar.';
