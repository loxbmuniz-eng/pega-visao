-- =====================================================================
-- 068 — CANCELADA e OK (AVULSO) entram; SUMIU DO B2B sai (15/10/2026)
-- ---------------------------------------------------------------------
-- Pedido trazido pelo dono: "incluir também OK (AVULSO) e excluir esse
-- SUMIU DO B2B. Colocar como regra, CANCELADA, OK, DEVOLUÇÃO, E OK
-- (AVULSO) liberada para pagamento. Não considerar como pagamento, somente
-- SEM TRATATIVA". A trava do banco (CHECK em pgfrete_pendencias.tratativa)
-- lista as palavras; sem trocá-la, gravar CANCELADA é recusado.
--
-- O QUE ELA FAZ, na ordem:
--   1. solta a trava da 060;
--   2. registra no histórico de cada nota que estava SUMIU DO B2B a volta a
--      "falta olhar" (pgfrete_eventos, ação 'tratativa', por "Atualização
--      do servidor (068)") — quem marcou antes continua no histórico;
--   3. essas notas voltam a '' (falta olhar), sem data e sem nome do status
--      — resposta A do dono: alguém olha de novo com a lista nova. Nenhuma
--      delas libera pagamento, nem antes nem depois (SUMIU DO B2B também não
--      liberava), então nenhuma carga muda de "A PAGAR";
--   4. põe a trava nova com as cinco palavras.
-- Não apaga linha nenhuma. As outras notas não mudam.
--
-- SEM ESTA MIGRAÇÃO: o servidor novo oferece CANCELADA e OK (AVULSO) na
-- lista, e gravar uma delas é recusado pela trava antiga. A ordem do
-- instalar.sh (migrações antes de reiniciar) não deixa isso acontecer.
-- =====================================================================
ALTER TABLE pgfrete_pendencias DROP CONSTRAINT IF EXISTS pgfrete_pendencias_tratativa_check;
INSERT INTO pgfrete_eventos (numero_carga, nota, acao, detalhe, por_nome)
  SELECT numero_carga, nota, 'tratativa',
         jsonb_build_object('tratativa', jsonb_build_object('de', 'SUMIU DO B2B', 'para', ''), 'migracao', '068'),
         'Atualização do servidor (068)'
    FROM pgfrete_pendencias WHERE tratativa = 'SUMIU DO B2B';
UPDATE pgfrete_pendencias SET tratativa = '', tratativa_em = NULL, tratativa_por = ''
  WHERE tratativa = 'SUMIU DO B2B';
ALTER TABLE pgfrete_pendencias ADD CONSTRAINT pgfrete_pendencias_tratativa_check
  CHECK (tratativa IN ('', 'SEM TRATATIVA', 'DEVOLUÇÃO', 'OK', 'OK (AVULSO)', 'CANCELADA'));
