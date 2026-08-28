-- =====================================================================
-- 039 — O "OK" DA EXPEDIÇÃO TAMBÉM DEIXA RECADO (28/08/2026)
-- SEM ESTA MIGRAÇÃO: a Expedição continua sem lugar para escrever nada ao dar o OK da descarga. O painel novo mostra o campo, e a gravação é recusada pelo servidor porque a coluna não existe. O resto do sistema segue igual.
-- ---------------------------------------------------------------------
-- O PEDIDO, do dono, no dia:
--
--   "quando o caminhão chega à expedição, eles não conseguem verificar se
--    toda a quantidade chegou nem fazer a destinação imediatamente. Por
--    isso pediram para deixar apenas o 'OKzinho', como na Central de
--    Notas (...) usando apenas o OK que receberam, já que o processo deles
--    leva mais tempo."
--
-- POR QUE UMA COLUNA NOVA, E NÃO REAPROVEITAR `observacoes`:
--
--   `observacoes` é o campo da Logística no cabeçalho, e `obs_controles` /
--   `obs_notas` já existem porque cada etapa fala com a SEGUINTE. Se a
--   Expedição escrevesse no campo de outra etapa, o recado apareceria
--   assinado por quem não o escreveu — e o relatório, que discrimina
--   autoria por etapa, passaria a mentir. Uma etapa, um campo.
--
-- O QUE MUDA AQUI:
--
--   `obs_expedicao` — o recado de quem recebeu a descarga para quem vem
--   depois. NULL/vazio é o normal: o OK sozinho é a informação principal,
--   e o campo é opcional por decisão do dono.
--
-- O QUE **NÃO** MUDA, e é o ponto:
--
--   A conferência de quantidade (`qtd_recebida`) e a destinação
--   (`dest_estoque`/`dest_descarte`/`dest_reprocesso`) CONTINUAM existindo,
--   nas mesmas colunas, com as mesmas permissões. Elas deixam de ser um
--   pré-requisito para o OK — nunca foram obrigatórias no servidor, e
--   agora a tela também diz isso. Quem confere depois continua conferindo,
--   e a "falta" continua sendo apontada. Tirar as colunas apagaria o
--   controle de divergência, que é a razão de o checklist existir.
--
-- REVERSÍVEL: `ALTER TABLE devolucoes DROP COLUMN obs_expedicao;`
-- =====================================================================

ALTER TABLE devolucoes ADD COLUMN IF NOT EXISTS obs_expedicao TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN devolucoes.obs_expedicao IS
  'Recado da Expedição ao dar o OK da descarga, para a etapa seguinte. Opcional.';
