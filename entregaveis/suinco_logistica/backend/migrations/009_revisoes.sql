-- Revisões de carga: o estado ANTERIOR de cada alteração, guardado sempre.
--
-- Motivo (semana de 14–15/08/2026): dados sobrescritos por eco de
-- sincronização tiveram que ser restaurados A PARTIR DE UM PDF, porque
-- nenhum log guardava os valores antigos completos. Isto fecha esse buraco
-- e alimenta o "Restaurar" da Administração no painel.
--
-- É um TRIGGER, e não código nas rotas, de propósito: captura TODO update —
-- inclusive SQL manual no psql, que foi vetor de dano em 15/08. Se a
-- escrita aconteceu, a revisão existe.
CREATE TABLE IF NOT EXISTS carga_revisoes (
    revisao_id   BIGSERIAL PRIMARY KEY,
    carga_id     TEXT NOT NULL,
    -- Estado COMPLETO da linha antes da mudança. JSONB inteiro em vez de
    -- colunas espelhadas: colunas novas em fact_viagens entram sozinhas,
    -- sem ninguém precisar lembrar de mexer aqui (a lição da semana:
    -- campo esquecido em um ponto some em silêncio).
    dados        JSONB NOT NULL,
    gravada_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Quem fez a mudança que APOSENTOU este estado (vem da linha nova).
    mudada_por   TEXT NOT NULL DEFAULT '',
    mudada_setor TEXT NOT NULL DEFAULT ''
);
COMMENT ON TABLE carga_revisoes IS
  'Estado anterior de fact_viagens a cada UPDATE com mudança real. '
  'Alimenta o Restaurar da Administração. Sem FK de propósito: a revisão '
  'precisa sobreviver mesmo se a carga sumir.';

CREATE INDEX IF NOT EXISTS idx_carga_revisoes_carga
    ON carga_revisoes (carga_id, revisao_id DESC);

CREATE OR REPLACE FUNCTION fn_grava_revisao_carga() RETURNS trigger AS $$
BEGIN
  -- Só mudança REAL gera revisão. atualizado_em e versao mudam em todo eco
  -- de sincronização (dezenas por hora, visto em produção: 109 cargas nos
  -- mesmos dois instantes) — guardá-los encheria a tabela de ruído idêntico.
  IF (to_jsonb(OLD) - 'atualizado_em' - 'versao')
     IS DISTINCT FROM (to_jsonb(NEW) - 'atualizado_em' - 'versao') THEN
    INSERT INTO carga_revisoes (carga_id, dados, mudada_por, mudada_setor)
    VALUES (OLD.carga_id, to_jsonb(OLD),
            COALESCE(NEW.operador_nome, ''), COALESCE(NEW.operador_setor, ''));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_revisao_carga ON fact_viagens;
CREATE TRIGGER trg_revisao_carga
    BEFORE UPDATE ON fact_viagens
    FOR EACH ROW EXECUTE FUNCTION fn_grava_revisao_carga();
