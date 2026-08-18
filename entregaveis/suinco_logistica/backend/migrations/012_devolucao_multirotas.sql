-- =====================================================================
-- 012 — Checklist de devolução com MAIS DE UMA rota
-- ---------------------------------------------------------------------
-- Correção de modelo pedida pelo usuário (18/08/2026): "tem checklist que
-- tem mais de uma rota — utilizar NOME DA REGIÃO e CÓDIGO DE ROTA". O 010
-- nasceu com uma rota só por checklist; a realidade da operação junta
-- rotas da mesma região num checklist único.
--
-- Vira tabela própria (não texto "519, 542" numa coluna): cada código
-- continua validado contra dim_rotas — rota inexistente segue sendo erro
-- de digitação barrado na entrada, exatamente como nas cargas.
-- =====================================================================

CREATE TABLE IF NOT EXISTS devolucao_rotas (
    devolucao_id TEXT NOT NULL REFERENCES devolucoes(devolucao_id) ON DELETE CASCADE,
    rota_codigo  TEXT NOT NULL REFERENCES dim_rotas(codigo),
    PRIMARY KEY (devolucao_id, rota_codigo)
);

-- Checklists já criados com o modelo antigo: a rota única vira a primeira
-- linha da tabela nova — nada se perde.
INSERT INTO devolucao_rotas (devolucao_id, rota_codigo)
SELECT devolucao_id, rota_codigo FROM devolucoes
WHERE rota_codigo IS NOT NULL
ON CONFLICT DO NOTHING;

-- A coluna antiga sai de cena. Ficar com as duas criaria o pior dos
-- mundos: dois lugares dizendo qual é a rota, podendo divergir (a mesma
-- classe de erro que o cálculo de falta evita ao nunca ser gravado).
-- Revisões antigas em devolucao_revisoes ainda mostram rota_codigo no
-- JSONB — são retrato fiel da época, e a restauração não mexe em rotas.
ALTER TABLE devolucoes DROP COLUMN IF EXISTS rota_codigo;
