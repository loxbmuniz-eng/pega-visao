-- Corrige o preenchimento do passado feito pela migration 007.
--
-- O ERRO (meu, 14/08/2026): a 007 preencheu `programado_em = criado_em`
-- para TODAS as linhas existentes. Para carga programada normalmente isso é
-- verdade. Mas para o caminhão que chega sem programação, `criado_em` é a
-- hora em que ele ENTROU NO PÁTIO — e essas são exatamente as linhas que a
-- coluna nova existe para tratar. O preenchimento cimentou nelas a data de
-- chegada como se fosse a data de programação.
--
-- Efeito prático relatado no mesmo dia: a carga lançada hoje num caminhão
-- que chegou ontem continuou fora do relatório de hoje, mesmo depois da
-- atualização.
--
-- A CORREÇÃO: quem ainda está "Aguardando Carga" NÃO foi programado — não
-- existe data de programação para essas linhas, e inventar uma é o que
-- causou o problema. Voltam a NULL. Quando a carga delas for lançada, o
-- painel grava a data certa (completarCargaAguardando), e a leitura já cai
-- em criado_em enquanto isso (paraPainel usa `programado_em || criado_em`).
--
-- O que NÃO é mexido aqui: linhas já programadas. Para elas o servidor não
-- guarda quando o lançamento aconteceu (só a exclusão gera log), então
-- qualquer valor seria chute. As que ficaram com data errada são poucas e
-- se corrigem uma a uma, com o número da carga na mão.
UPDATE fact_viagens
   SET programado_em = NULL
 WHERE aguardando_carga = TRUE;
