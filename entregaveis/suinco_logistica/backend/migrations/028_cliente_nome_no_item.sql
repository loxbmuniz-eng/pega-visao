-- 028 — O NOME DO CLIENTE ANDA JUNTO DO CÓDIGO (20/08/2026)
--
-- Relato do gestor: "o código do cliente no relatório não está puxando o
-- nome do cliente, está puxando só o código".
--
-- O item do checklist guardava só `cod_cliente`. Na TELA isso não incomoda:
-- quem digita acabou de ver o nome na lista de sugestões. No relatório
-- incomoda muito — ele vai para a mão de quem não digitou nada, e "13913"
-- não diz a ninguém de qual cliente aquela devolução é.
--
-- A solução é a mesma que o produto já usa desde o começo (`produto_nome`
-- ao lado de `cod_produto`): guardar o nome NO ITEM, no momento em que o
-- código é reconhecido.
--
-- Por que gravar em vez de cruzar com dim_clientes na hora de imprimir:
--
--   1. O relatório é um documento histórico. Se o cadastro do cliente mudar
--      de nome (ou for corrigido) em dezembro, o checklist de agosto tem que
--      continuar dizendo o que dizia em agosto.
--   2. O painel não carrega a base inteira de clientes — são milhares de
--      linhas, e a busca é feita no servidor conforme se digita. Cruzar na
--      impressão exigiria uma consulta por linha do relatório.
--
-- Isso repete a lição de `produto_nome`: dado que sai em papel se guarda
-- junto do registro, não se resolve por referência na hora de imprimir.

ALTER TABLE devolucao_itens ADD COLUMN IF NOT EXISTS cliente_nome TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN devolucao_itens.cliente_nome IS
  'Nome (ou apelido) do cliente no momento do lançamento. Guardado junto '
  'para o relatório não depender do cadastro atual — mesma regra de '
  'produto_nome.';

-- PREENCHIMENTO DO PASSADO: os itens já lançados ganham o nome que o
-- cadastro tem HOJE. Não é a foto do dia do lançamento (essa não existe),
-- mas é a melhor informação disponível e é muito melhor que o código
-- sozinho. O apelido tem preferência porque é o que as capas de papel usam
-- ("SENDAS", "AREAL") — ver migration 019.
UPDATE devolucao_itens i
   SET cliente_nome = COALESCE(NULLIF(c.apelido, ''), c.nome, '')
  FROM dim_clientes c
 WHERE c.codigo = i.cod_cliente
   AND i.cliente_nome = ''
   AND COALESCE(NULLIF(c.apelido, ''), c.nome, '') <> '';
