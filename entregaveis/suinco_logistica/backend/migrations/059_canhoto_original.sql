-- =====================================================================
-- 059 — Pagamento de Frete: a caixinha "Canhoto original" por carga
-- ---------------------------------------------------------------------
-- SEM ESTA MIGRAÇÃO: a aba Pagamento de Frete continua funcionando (a
-- grade lê sem as colunas e mostra a caixinha desmarcada), mas marcar o
-- canhoto responde "o servidor ainda não tem esta função" (503 explicado).
-- Nada da operação muda ou para.
--
-- Pedido do dono (05/10/2026): "em cada carga, uma caixinha para dar check
-- se veio o canhoto original ou não: sim ou não. Isso não interfere na
-- questão do fechamento do digital — é só para acompanhamento".
--
-- Por isso são três colunas em pgfrete_cargas e NENHUMA regra: o canhoto não
-- entra na Situação, no % liberado nem no pagamento. Quem marcou e quando
-- ficam guardados, porque é isso que "entender o que foi feito" precisa.
--
-- Migração própria, e não um acréscimo à 058: a 058 já está publicada; se o
-- servidor a aplicar antes de uma edição, a edição nunca roda (migrar.js
-- aplica cada arquivo uma vez).
-- =====================================================================
ALTER TABLE pgfrete_cargas
  ADD COLUMN IF NOT EXISTS canhoto_original BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS canhoto_em       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS canhoto_por      TEXT NOT NULL DEFAULT '';
