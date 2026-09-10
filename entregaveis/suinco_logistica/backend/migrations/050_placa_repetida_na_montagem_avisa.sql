-- 050 — A MESMA PLACA EM DUAS LINHAS DO DIA DEIXA DE SER ERRO DE BANCO
--
-- SEM ESTA MIGRAÇÃO: a Montagem do Dia RECUSA a segunda linha com a mesma
-- placa (409 PLACA_DUPLICADA) e a carreta que carrega em Ribeirão Preto e em
-- Marília na mesma rota não pode ser montada. Quem está montando tem que
-- apagar a carga e criar outra, ou deixar a segunda praça fora do dia — e
-- apagar carga é justamente o que o painel existe para não precisar fazer.
--
-- O RELATO, 10/09/2026, do dono:
--   "Uma carga em Ribeirão Preto e uma em Marília. Não deixa duplicar as
--    placas. Precisamos que sejam placas duplicadas, porque são duas placas:
--    uma na carreta e uma em Marília, na mesma rota. Então o mesmo veículo
--    vai carregar as duas cargas."
--
-- O índice nasceu em 031 com a intenção certa e a força errada. A intenção
-- era pegar o ACIDENTE: duas pessoas montando o dia ao mesmo tempo põem a
-- mesma placa em duas rotas sem perceber, e isso só aparece na doca. A força
-- errada foi o UNIQUE: ele não distingue o acidente do caso legítimo, e o
-- caso legítimo é rotina — um caminhão que carrega em duas praças.
--
-- A Programação já tinha resolvido isso do jeito certo e a Montagem ficou
-- para trás: lá a placa repetida AVISA, dizendo onde ela já está, e deixa
-- passar com um clique de quem tem autoridade. Aqui passa a ser igual —
-- regra da casa: "botão desabilitado não ensina o caminho, só nega".
--
-- O índice CONTINUA, sem o UNIQUE: ele é o que faz a busca de "onde mais
-- esta placa está hoje" não varrer a tabela. Perder o índice junto com a
-- trava deixaria a tela mais lenta sem necessidade.

DROP INDEX IF EXISTS ux_prog_montagem_placa_dia;

CREATE INDEX IF NOT EXISTS ix_prog_montagem_placa_dia
    ON programacao_montagem (data_prog, placa)
    WHERE placa <> '' AND cancelada_em IS NULL AND efetivada_em IS NULL;

COMMENT ON INDEX ix_prog_montagem_placa_dia IS
  'Placa aberta no dia. Já foi UNIQUE (031) e deixou de ser em 050: a mesma '
  'placa em duas linhas é caso real (carreta que carrega em duas praças), e '
  'quem trata a duplicidade por engano é o aviso da tela, não a recusa do '
  'banco.';
