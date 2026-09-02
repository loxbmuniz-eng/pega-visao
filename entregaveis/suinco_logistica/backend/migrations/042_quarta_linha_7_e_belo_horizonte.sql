-- =====================================================================
-- 042 — A linha 7 da quarta é Belo Horizonte, não a rede (02/09/2026)
-- ---------------------------------------------------------------------
-- Correção pedida pelo dono no mesmo dia da 041, depois de ver o modelo
-- funcionando no painel: "supermercados BH ta errado ali, é rota 510 no
-- lugar dele, acabei de ver no teste aqui".
--
-- A planilha de quarta traz, na sétima linha, "Supermercado BH -
-- Contagem". A rota está certa — é a 510, ele confirmou por escrito antes
-- da 041 entrar. O que estava errado era o NOME mostrado: aquela saída é
-- da praça de Belo Horizonte, não de uma rede específica.
--
-- Fica "Belo Horizonte", e não "Belo Horizonte - RP Express" como a linha
-- 8: são duas saídas para a mesma praça na quarta, e o dono escolheu
-- distinguir as duas — a de baixo tem transportadora definida, a de cima
-- não.
--
-- POR QUE UMA MIGRAÇÃO PARA UMA LINHA: o modelo mora no banco, e o banco
-- de produção só muda por migração. Editar pela tela funcionaria, mas o
-- próximo servidor a ser instalado do zero nasceria com o nome errado de
-- novo — e ninguém lembraria por quê.
--
-- SEM ESTA MIGRAÇÃO: a sétima linha da quarta continua aparecendo como
-- "Supermercado BH - Contagem" na Montagem do Dia. A rota é a mesma (510),
-- a carga monta igual e nada quebra — o que muda é só o nome na tela.
-- =====================================================================

UPDATE programacao_modelo
   SET apelido_rota = 'Belo Horizonte', atualizado_em = now()
 WHERE dia_semana = 3
   AND rota_codigo = '510'
   AND apelido_rota = 'Supermercado BH - Contagem';
