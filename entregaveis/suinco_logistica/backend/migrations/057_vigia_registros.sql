-- =====================================================================
-- 057 — o que os vigias do servidor viram por último
-- ---------------------------------------------------------------------
-- SEM ESTA MIGRAÇÃO: os vigias do servidor (scripts/vigia_servidor.mjs)
-- continuam conferindo e avisando no celular, mas não têm onde anotar o
-- resultado — a caixa "Vigias do sistema" na aba Usuários mostra "o
-- servidor ainda não foi atualizado" no lugar da lista. Nada da operação
-- (carga, pátio, devolução) muda ou para.
--
-- Pedido do dono (02/10/2026): "no raio-X, tudo que fala 'se quebrar', você
-- vai criar uma prevenção de quebra pra cada possibilidade apontada".
--
-- UMA LINHA POR VERIFICAÇÃO, sobrescrita a cada rodada: a pergunta que a
-- tabela responde é "como está AGORA, e desde quando", não o histórico de
-- cada minuto (o vigia de travamento roda 1.440 vezes por dia). Quando
-- algo dá problema, `problema_desde` guarda o primeiro instante — é dele
-- que sai o "fora há 2 horas" — e volta a NULL quando normaliza.
--
-- Só ACRESCENTA uma tabela. Nenhum dado existente é lido, alterado ou
-- apagado.
-- =====================================================================
CREATE TABLE IF NOT EXISTS vigia_registros (
  verificacao   TEXT PRIMARY KEY,
  ok            BOOLEAN NOT NULL,
  detalhe       TEXT NOT NULL DEFAULT '',
  conferido_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  problema_desde TIMESTAMPTZ
);
