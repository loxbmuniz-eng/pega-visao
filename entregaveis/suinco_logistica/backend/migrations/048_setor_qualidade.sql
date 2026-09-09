-- =====================================================================
-- 048 — O setor QUALIDADE (09/09/2026)
-- ---------------------------------------------------------------------
-- Pedido do dono: "voce criou um setor no sistema para a QUALIDADE ter
-- acesso aos checklists? ela vai poder exportar relatorios tambem todos".
--
-- Perguntado sobre o escopo exato, ele respondeu:
--   1. "qualidade so acompanha e exporta relatorio"
--   2. "tambem ve a devolucao das filiais, todos os relatorios que
--       competem ao checklist"
--
-- SÓ LEITURA, E É A PRIMEIRA VEZ QUE ISSO EXISTE NA DEVOLUÇÃO. O Comercial
-- já é só leitura, mas nas CARGAS. Aqui o setor entra num ciclo de seis
-- etapas sem executar nenhuma delas: acompanha e exporta. "Só acompanha"
-- não é um estado que se alcança esquecendo de dar permissão — é uma regra
-- que precisa estar escrita, senão a próxima rota de escrita nasce sem ela.
--
-- VÊ TUDO, INCLUSIVE AS FILIAIS. É o contrário da regra da filial (043):
-- a 105 não vê a devolução da 106 porque cada uma responde pela sua. A
-- Qualidade responde pelo produto, que não tem filial — e um problema de
-- qualidade que só aparece na Bahia é exatamente o que ela precisa ver.
-- Na prática isso significa NÃO entrar em SETORES_FILIAL, e nenhum filtro
-- por `criada_setor` alcança quem não é filial.
--
-- NÃO VÊ VALOR DE FRETE. Ele delimitou: "todos os relatorios que competem
-- ao checklist" — o de Administração de Fretes não compete, e a regra de
-- 09/09 já dizia que valor de frete é de Logística e Administração.
--
-- SEM ESTA MIGRAÇÃO: a tela de Usuários oferece "Qualidade" no seletor, a
-- pessoa cadastra, e o banco recusa com erro de CHECK — que na tela vira
-- "Setor inválido" e não explica nada. É exatamente o que aconteceu com as
-- filiais em 02/09/2026, três vezes seguidas, com o dono na frente.
-- Nenhum setor existente é afetado; carga, pátio e devolução seguem iguais.
-- =====================================================================

ALTER TABLE operadores DROP CONSTRAINT IF EXISTS operadores_setor_check;

ALTER TABLE operadores ADD CONSTRAINT operadores_setor_check
  CHECK (setor = ANY (ARRAY[
    'Logística',
    'Portaria',
    'Expedição',
    'Faturamento',
    'Administração',
    'Comercial',
    'Controles Internos',
    'Central de Notas',
    'Qualidade',
    'Filial 105 BSB',
    'Filial 106 BAHIA',
    'Filial 107 ES'
  ]));
