-- =====================================================================
-- 045 — O Faturamento não espera mais a Expedição (08/09/2026)
-- ---------------------------------------------------------------------
-- Relato do dono, depois de rodar o processo com o Faturamento:
--
--   "o faturamento precisa conseguir dar continuidade antes da expedicao"
--   "Não tem que ser os dois sequenciados (...) No sistema está
--    sequenciado mas quando a gente faz na prática ele não está."
--
-- A ordem das etapas mudou no código (dominio/devolucoes.js): as duas
-- balanças passaram a ser seguidas, e o OK da Expedição vem depois.
--
--   ANTES:  chegada → Expedição → peso final → Controles → Notas
--   AGORA:  chegada → peso final → Expedição → Controles → Notas
--
-- ESTA MIGRAÇÃO EXISTE POR CAUSA DAS QUE ESTÃO NO MEIO DO CAMINHO.
-- Uma devolução parada em "Descarga Conferida" SEM peso final já tinha o
-- OK da Expedição e ainda não tinha ido à balança. Na ordem nova, o passo
-- seguinte de "Descarga Conferida" é a destinação — ou seja, ela seguiria
-- adiante com a PESAGEM FINAL PULADA, e o peso devolvido daquele checklist
-- nunca mais existiria. É exatamente o risco que ficou anotado em 02/09 ao
-- decidir mexer só na tela.
--
-- Por isso elas voltam um passo, para o Faturamento pesar. O carimbo da
-- Expedição NÃO é apagado: quando o peso final entrar, a rota reconhece a
-- assinatura que já existe e dá o passo dela junto, com o nome e a hora
-- originais (rotas/devolucoes.js). Ninguém assina duas vezes.
--
-- A SOBRA NÃO É TOCADA. Ela encerra no OK da Expedição e nunca volta à
-- balança — "Descarga Conferida" é o fim dela, não um passo no meio.
-- Mexer nela seria reabrir devolução já concluída.
--
-- SEM ESTA MIGRAÇÃO: o código novo sobe e as devoluções que estavam em
-- "Descarga Conferida" sem pesagem seguem para a destinação sem nunca
-- passar pela balança final. Não dá erro em tela nenhuma — o peso
-- devolvido simplesmente fica vazio para sempre naqueles checklists, e
-- ninguém é avisado. As demais devoluções e o resto do sistema seguem
-- iguais.
-- =====================================================================

UPDATE devolucoes
   SET status = 'Conferida no Faturamento',
       atualizado_em = now(),
       versao = versao + 1
 WHERE status = 'Descarga Conferida'
   AND peso_final IS NULL
   AND excluida_em IS NULL
   AND tipo IS DISTINCT FROM 'SOBRA';
