-- Devoluções: o checklist de papel vira dado (aprovado em 18/08/2026).
--
-- O processo hoje: a Logística redige um checklist, IMPRIME e leva à
-- Portaria; faltas e produtos que chegam fora da lista são anotados à
-- caneta na folha. Estas tabelas espelham o documento real (foto de
-- 10/08/2026) — cabeçalho com rota/transportadora/lacres/assinaturas e
-- tabela de itens por nota fiscal.
--
-- Fase 1: só Logística e Administração usam (alimentação e auditoria do
-- processo, decisão da reunião com o gestor). O modelo já nasce pronto
-- para a fase 2 (Portaria/Faturamento/Expedição/Controles Internos/
-- Central de Notas), que é abertura de acesso, não mudança de schema.

-- Número sequencial do checklist — o "gerador de número" pedido na
-- reunião: identifica o documento para humanos (a rota identifica na
-- conferência; o número identifica no arquivo e no relatório).
CREATE SEQUENCE IF NOT EXISTS devolucao_numero_seq;

CREATE TABLE IF NOT EXISTS devolucoes (
    devolucao_id    TEXT PRIMARY KEY,
    numero          BIGINT NOT NULL DEFAULT nextval('devolucao_numero_seq'),
    data_dev        DATE NOT NULL,
    -- Rota obrigatória: é ela que identifica o checklist na conferência
    -- (decisão da reunião — substitui o "salvar com o próprio nome").
    -- Mesma FK das cargas: rota inexistente é erro de digitação, não rota.
    rota_codigo     TEXT NOT NULL REFERENCES dim_rotas(codigo),
    regiao          TEXT NOT NULL DEFAULT '',
    transportadora  TEXT NOT NULL DEFAULT '',
    nota_transferencia TEXT NOT NULL DEFAULT '',
    placa           TEXT NOT NULL DEFAULT '',
    motorista       TEXT NOT NULL DEFAULT '',
    -- Preenchidos pela etapa da Portaria (o porteiro imputa na chegada).
    carga_numero    TEXT NOT NULL DEFAULT '',
    lacre1          TEXT NOT NULL DEFAULT '',
    lacre2          TEXT NOT NULL DEFAULT '',
    -- Preenchido pela etapa do Faturamento. NULL é legítimo: às vezes a
    -- balança só confere visualmente que a mercadoria está lá.
    peso_final      NUMERIC(12,3),
    status          TEXT NOT NULL DEFAULT 'Lançada',
    -- Autoria do checklist — "cada menina tem o seu" é requisito, não
    -- detalhe: sai no painel e em todo relatório.
    criada_por      TEXT NOT NULL DEFAULT '',
    criada_setor    TEXT NOT NULL DEFAULT '',
    -- Quem fez a ÚLTIMA mudança (alimenta a atribuição das revisões).
    operador_nome   TEXT NOT NULL DEFAULT '',
    operador_setor  TEXT NOT NULL DEFAULT '',
    -- As "assinaturas" do papel viram carimbos: operador + instante de
    -- cada etapa. NULL = etapa ainda não aconteceu.
    portaria_por    TEXT,  portaria_em    TIMESTAMPTZ,
    faturamento_por TEXT,  faturamento_em TIMESTAMPTZ,
    expedicao_por   TEXT,  expedicao_em   TIMESTAMPTZ,
    controles_por   TEXT,  controles_em   TIMESTAMPTZ,
    notas_por       TEXT,  notas_em       TIMESTAMPTZ,
    -- Observações dos Controles Internos — saem no relatório (pedido da
    -- reunião).
    obs_controles   TEXT NOT NULL DEFAULT '',
    observacoes     TEXT NOT NULL DEFAULT '',
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    excluida_em     TIMESTAMPTZ,
    versao          INTEGER NOT NULL DEFAULT 1
);
COMMENT ON TABLE devolucoes IS
  'Checklist de devolução (cabeçalho). Espelho digital do documento de '
  'papel da Logística; itens em devolucao_itens.';

CREATE INDEX IF NOT EXISTS idx_devolucoes_dia
    ON devolucoes (data_dev) WHERE excluida_em IS NULL;

-- Uma linha por nota/produto — as colunas da tabela do papel.
CREATE TABLE IF NOT EXISTS devolucao_itens (
    item_id        BIGSERIAL PRIMARY KEY,
    devolucao_id   TEXT NOT NULL REFERENCES devolucoes(devolucao_id) ON DELETE CASCADE,
    nota           TEXT NOT NULL DEFAULT '',
    parcial        BOOLEAN NOT NULL DEFAULT TRUE,
    supervisor     TEXT NOT NULL DEFAULT '',
    vendedor       TEXT NOT NULL DEFAULT '',
    cod_cliente    TEXT NOT NULL DEFAULT '',
    cx             NUMERIC(10,2) NOT NULL DEFAULT 0,
    peso           NUMERIC(12,3),
    cod_produto    TEXT NOT NULL DEFAULT '',
    produto_nome   TEXT NOT NULL DEFAULT '',
    num_dev        TEXT NOT NULL DEFAULT '',
    data_item      DATE,
    motivo         TEXT NOT NULL DEFAULT '',
    -- Conferência da descarga: NULL = ainda não conferido. A FALTA nunca
    -- é gravada — é sempre calculada (cx - qtd_recebida), para não haver
    -- dois números que possam divergir.
    qtd_recebida   NUMERIC(10,2),
    -- Destinação dada pelos Controles Internos.
    destinacao     TEXT CHECK (destinacao IN ('Estoque','Descarte','Reprocesso')),
    operador_nome  TEXT NOT NULL DEFAULT '',
    operador_setor TEXT NOT NULL DEFAULT '',
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_devolucao_itens_dev
    ON devolucao_itens (devolucao_id);

-- O que chegou FORA do checklist. Regra da reunião: substituição não
-- cancela falta — o item que não veio segue faltando (calculado), o que
-- veio no lugar entra aqui.
CREATE TABLE IF NOT EXISTS devolucao_divergencias (
    divergencia_id BIGSERIAL PRIMARY KEY,
    devolucao_id   TEXT NOT NULL REFERENCES devolucoes(devolucao_id) ON DELETE CASCADE,
    cod_produto    TEXT NOT NULL,
    produto_nome   TEXT NOT NULL DEFAULT '',
    cx             NUMERIC(10,2) NOT NULL DEFAULT 0,
    observacao     TEXT NOT NULL DEFAULT '',
    lancada_por    TEXT NOT NULL DEFAULT '',
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_devolucao_diverg_dev
    ON devolucao_divergencias (devolucao_id);

-- Cadastros para escolher em vez de digitar (pedido da reunião: "cadastro
-- de supervisores, cadastro de produtos, motivo").
CREATE TABLE IF NOT EXISTS dim_supervisores (
    nome      TEXT PRIMARY KEY,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dim_produtos (
    codigo        TEXT PRIMARY KEY,
    nome          TEXT NOT NULL DEFAULT '',
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dim_motivos_devolucao (
    motivo    TEXT PRIMARY KEY,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Revisões: mesmo motor de carga_revisoes (009) — estado ANTERIOR de toda
-- mudança real, por trigger, para capturar até SQL manual. Uma tabela só
-- para cabeçalho e itens; a coluna `tabela` distingue.
CREATE TABLE IF NOT EXISTS devolucao_revisoes (
    revisao_id   BIGSERIAL PRIMARY KEY,
    devolucao_id TEXT NOT NULL,
    tabela       TEXT NOT NULL,
    dados        JSONB NOT NULL,
    gravada_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    mudada_por   TEXT NOT NULL DEFAULT '',
    mudada_setor TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_devolucao_revisoes
    ON devolucao_revisoes (devolucao_id, revisao_id DESC);

CREATE OR REPLACE FUNCTION fn_grava_revisao_devolucao() RETURNS trigger AS $$
BEGIN
  IF (to_jsonb(OLD) - 'atualizado_em' - 'versao')
     IS DISTINCT FROM (to_jsonb(NEW) - 'atualizado_em' - 'versao') THEN
    INSERT INTO devolucao_revisoes (devolucao_id, tabela, dados, mudada_por, mudada_setor)
    VALUES (OLD.devolucao_id, TG_TABLE_NAME, to_jsonb(OLD),
            COALESCE(NEW.operador_nome, ''), COALESCE(NEW.operador_setor, ''));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_revisao_devolucao ON devolucoes;
CREATE TRIGGER trg_revisao_devolucao
    BEFORE UPDATE ON devolucoes
    FOR EACH ROW EXECUTE FUNCTION fn_grava_revisao_devolucao();

DROP TRIGGER IF EXISTS trg_revisao_devolucao_item ON devolucao_itens;
CREATE TRIGGER trg_revisao_devolucao_item
    BEFORE UPDATE ON devolucao_itens
    FOR EACH ROW EXECUTE FUNCTION fn_grava_revisao_devolucao();
