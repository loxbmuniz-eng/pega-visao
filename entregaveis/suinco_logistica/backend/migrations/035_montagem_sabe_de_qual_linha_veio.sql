-- =====================================================================
-- 035 — A MONTAGEM SABE DE QUAL LINHA DO MODELO VEIO (25/08/2026)
-- ---------------------------------------------------------------------
-- Relato do dono: "tá tudo duplicado ainda na montagem do dia".
--
-- A causa não é o template: é como o "já montado" era decidido. O botão
-- "Puxar rotas do modelo" contava quantas cargas daquele CÓDIGO já
-- existiam no dia e oferecia o resto. Isso funciona enquanto código e
-- destino são a mesma coisa.
--
-- Não são. Na terça, Arinos/Buritis, João Pinheiro, Paracatu, Riachinho e
-- Unaí são todos o código 504 — a praça cadastrada cobre o circuito
-- inteiro. Contando por código, o painel sabe que "faltam 2 de 504", mas
-- não sabe QUAIS 2. Puxa duas quaisquer, e o dia fica com João Pinheiro
-- repetido e Unaí faltando.
--
-- Contagem não resolve ambiguidade: identidade resolve. Cada montagem
-- passa a guardar a LINHA do modelo que a originou, e o botão passa a
-- perguntar "esta linha já virou carga?" em vez de "quantas de 504 já
-- existem?".
--
-- NULL é válido e significa "não veio do modelo": carga avulsa, frete
-- extra, e todas as montagens criadas antes desta migração. ON DELETE SET
-- NULL porque apagar uma rota do modelo não pode apagar a carga que já
-- foi montada a partir dela — a carga do dia é fato, o modelo é plano.
-- =====================================================================

ALTER TABLE programacao_montagem
  ADD COLUMN IF NOT EXISTS modelo_id BIGINT
    REFERENCES programacao_modelo(modelo_id) ON DELETE SET NULL;

-- Consulta quente: "quais linhas do modelo já viraram carga neste dia?"
CREATE INDEX IF NOT EXISTS ix_prog_montagem_modelo
  ON programacao_montagem (data_prog, modelo_id)
  WHERE modelo_id IS NOT NULL;
