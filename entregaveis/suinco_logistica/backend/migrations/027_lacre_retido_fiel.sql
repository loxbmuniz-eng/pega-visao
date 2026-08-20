-- 027 — A RETENÇÃO DE LACRE VIRA REGISTRO, NÃO FRASE NA OBSERVAÇÃO
-- (20/08/2026)
--
-- Pedido do gestor: "as informações de lacre dos porteiros — lacres, tanto
-- na saída quanto devoluções, e lacre retido também — saiam como informação
-- para a gente na torre de controle, nos relatórios... grave fielmente no
-- backend e traga as informações fiéis saindo nos relatórios".
--
-- O QUE ESTAVA ERRADO: o número do lacre retido tinha coluna própria
-- (`lacre_retido`), mas o MOTIVO da retenção, QUEM reteve e QUANDO iam para
-- dentro de `observacoes`, concatenados numa frase. Isso funciona para ler
-- na tela e não funciona para mais nada: não dá para contar quantas
-- retenções houve no mês, não dá para filtrar por motivo, e a informação
-- some no dia em que alguém editar a observação. Relatório fiel exige campo,
-- não texto corrido.
--
-- A retenção é um fato da inspeção da saída, com os mesmos quatro elementos
-- de qualquer registro sério: o número, o porquê, o autor e a hora.

ALTER TABLE fact_viagens ADD COLUMN IF NOT EXISTS lacre_retido_motivo TEXT NOT NULL DEFAULT '';
ALTER TABLE fact_viagens ADD COLUMN IF NOT EXISTS lacre_retido_por    TEXT NOT NULL DEFAULT '';
ALTER TABLE fact_viagens ADD COLUMN IF NOT EXISTS lacre_retido_em     TIMESTAMPTZ;

COMMENT ON COLUMN fact_viagens.lacre_retido IS
  'Número do lacre retido na inspeção da saída.';
COMMENT ON COLUMN fact_viagens.lacre_retido_motivo IS
  'Por que o lacre foi retido — carga incorreta, conferência, etc.';
COMMENT ON COLUMN fact_viagens.lacre_retido_por IS 'Quem registrou a retenção.';
COMMENT ON COLUMN fact_viagens.lacre_retido_em IS 'Quando a retenção foi registrada.';

-- Quem já tinha lacre retido gravado ganha ao menos a data: `atualizado_em`
-- é a melhor aproximação existente para essas linhas. O motivo antigo
-- continua onde sempre esteve (dentro de observacoes) — reconstruí-lo aqui
-- exigiria adivinhar qual pedaço do texto era o motivo, e relatório fiel não
-- se faz com adivinhação.
UPDATE fact_viagens
   SET lacre_retido_em = COALESCE(lacre_retido_em, atualizado_em)
 WHERE lacre_retido <> '' AND lacre_retido_em IS NULL;

CREATE INDEX IF NOT EXISTS ix_viagens_lacre_retido
    ON fact_viagens (lacre_retido_em DESC) WHERE lacre_retido <> '';
