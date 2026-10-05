-- =====================================================================
-- 060 — O VOCABULÁRIO DAS TRATATIVAS ENXUGADO (rodada 2, 05/10/2026)
-- ---------------------------------------------------------------------
-- Decisão do dono: "tira o OK B2B e DEV NO SISTEMA e substitui a DEV por
-- DEVOLUÇÃO". A trava do banco (CHECK em pgfrete_pendencias.tratativa)
-- listava as palavras antigas; sem trocá-la, gravar DEVOLUÇÃO é recusado.
--
-- O QUE ELA FAZ, na ordem:
--   1. solta a trava antiga;
--   2. converte o que já estiver gravado: DEV e DEV NO SISTEMA → DEVOLUÇÃO,
--      OK B2B → OK (mesmo sentido: a nota está liberada);
--   3. põe a trava nova com as quatro palavras.
-- Não apaga linha nenhuma. Em 05/10/2026 a tabela nasceu no servidor com a
-- 058 no mesmo dia e ainda não tinha tratativa gravada — a conversão vale
-- para zero linhas; fica aqui porque a regra tem de valer em qualquer banco.
--
-- SEM ESTA MIGRAÇÃO: escolher DEVOLUÇÃO na lista responde 503 explicado
-- ("o servidor ainda não tem esta função"); as outras palavras seguem.
-- =====================================================================
ALTER TABLE pgfrete_pendencias DROP CONSTRAINT IF EXISTS pgfrete_pendencias_tratativa_check;
UPDATE pgfrete_pendencias SET tratativa = 'DEVOLUÇÃO' WHERE tratativa IN ('DEV', 'DEV NO SISTEMA');
UPDATE pgfrete_pendencias SET tratativa = 'OK'        WHERE tratativa = 'OK B2B';
ALTER TABLE pgfrete_pendencias ADD CONSTRAINT pgfrete_pendencias_tratativa_check
  CHECK (tratativa IN ('', 'SEM TRATATIVA', 'DEVOLUÇÃO', 'OK', 'SUMIU DO B2B'));
