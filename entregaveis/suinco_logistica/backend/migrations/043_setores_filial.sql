-- =====================================================================
-- 043 — Os três setores de filial (02/09/2026)
-- ---------------------------------------------------------------------
-- Pedido do dono: "isso é um setor novo, so vai ter acesso a aba
-- devolucoes e escopo de devolucoes, e vai poder so criar checklists e
-- acompanhar historico de devolucoes somente que competem a eles, ou
-- seja, quem for filial so acompanha dev filial (...) o processo de dev é
-- feito aqui normalmente, porem as permissoes da filial sao restritas a
-- isso". E, à pergunta de quantas: "crie 3 setores filial 105 BSB, 106
-- BAHIA, 107 ES". Depois, confirmando os dois lados da regra: "cada setor
-- so acompanha o historico de checklists da sua filial" e "nós da
-- logistica e administracao temos acesso a tudo normalmente".
--
-- A tabela `operadores` tem uma CHECK que lista os setores aceitos. Sem
-- mexer nela, criar o usuário da filial pela tela de Usuários seria
-- recusado pelo BANCO — com erro de constraint, que não diz nada a quem
-- está cadastrando.
--
-- TRÊS SETORES E NÃO UM COM SUBDIVISÃO: a 105 não pode ver a devolução da
-- 106, e `setor` já é a chave que separa tudo no sistema. A tabela
-- `devolucoes` guarda `criada_setor` desde a migração 010 — a separação
-- sai de graça, sem coluna nova. Um campo de "qual filial" ao lado do
-- setor seria uma segunda chave para a mesma pergunta, e duas chaves para
-- a mesma pergunta divergem.
--
-- NENHUMA PERMISSÃO DE FLUXO. As filiais não entram em `PODE` (fluxo.js):
-- não avançam etapa de carga nem de devolução. Criam o checklist e
-- acompanham o que criaram; o ciclo é rodado pela matriz, como hoje.
--
-- SEM ESTA MIGRAÇÃO: o painel oferece os três setores na tela de Usuários,
-- mas o banco RECUSA o cadastro com erro de constraint — e a mensagem que
-- chega em quem cadastra não explica nada. Nenhum setor existente é
-- afetado; quem já usa o sistema continua igual.
-- =====================================================================

ALTER TABLE operadores DROP CONSTRAINT IF EXISTS operadores_setor_check;

ALTER TABLE operadores ADD CONSTRAINT operadores_setor_check
  CHECK (setor = ANY (ARRAY[
    'Logística', 'Portaria', 'Expedição', 'Faturamento', 'Administração',
    'Comercial', 'Controles Internos', 'Central de Notas',
    'Filial 105 BSB', 'Filial 106 BAHIA', 'Filial 107 ES'
  ]));
