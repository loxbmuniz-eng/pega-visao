-- =====================================================================
-- EMBARQUE SUINCO — schema inicial (PostgreSQL)
-- Migration 001 · 04/08/2026
-- =====================================================================
--
-- DECISÃO DE NOMENCLATURA
-- -----------------------
-- Existiam duas nomenclaturas para os mesmos dados no projeto: a do export
-- CSV (Fact_Movimentacoes, Dim_Carga...) e a das Listas do SharePoint
-- (fact_Viagens, fact_StatusFrota...). Adotar uma e descartar a outra
-- quebraria o Power BI se a escolha fosse errada.
--
-- Solução: as TABELAS usam a nomenclatura das Listas (alinhada ao modelo do
-- BI), e VIEWS no fim deste arquivo reproduzem EXATAMENTE os cabeçalhos do
-- export CSV. O Power BI funciona lendo qualquer uma das duas — não é preciso
-- decidir agora, e nenhum relatório existente quebra.
--
-- CONVENÇÕES
-- ----------
-- - Identificadores de negócio (carga_id, movimentacao_id) são TEXTO, gerados
--   pelo cliente. Isso é deliberado: o painel grava offline e sincroniza
--   depois, então o id precisa existir antes de o servidor ver o registro.
--   Um SERIAL do banco impediria a fila offline de funcionar.
-- - Toda tabela carrega quem fez e quando (trilha de auditoria).
-- - Timestamps em TIMESTAMPTZ. O pátio é UTC-3, mas guardar com fuso evita
--   o problema clássico de horário de verão no histórico.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- OPERADORES
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS operadores (
    id              SERIAL PRIMARY KEY,
    email           TEXT NOT NULL UNIQUE,
    nome            TEXT NOT NULL,
    setor           TEXT NOT NULL CHECK (setor IN ('Logística','Portaria','Expedição','Faturamento','Administração')),
    senha_hash      TEXT NOT NULL,
    ativo           BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    ultimo_acesso   TIMESTAMPTZ
);
COMMENT ON COLUMN operadores.setor IS
  'Define quais abas o operador enxerga E o que a API deixa ele alterar. '
  'Diferente da versão anterior, aqui o setor é validado NO SERVIDOR — '
  'o cliente não consegue mais assumir outro setor editando o navegador.';

-- ---------------------------------------------------------------------
-- dim_Veiculos — cadastro de frota
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dim_veiculos (
    placa               TEXT PRIMARY KEY,
    transportadora      TEXT NOT NULL DEFAULT '',
    tipo_veiculo        TEXT NOT NULL DEFAULT '',
    capacidade_kg       INTEGER,
    uf                  CHAR(2),
    precisa_revisao     BOOLEAN NOT NULL DEFAULT FALSE,
    origem              TEXT NOT NULL DEFAULT 'seed',
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE dim_veiculos IS
  'A trava de frota do painel depende desta tabela: placa que não está aqui '
  'não vira carga. Alimentada pelo seed de 749 placas oficiais.';

CREATE INDEX IF NOT EXISTS ix_veiculos_transportadora ON dim_veiculos (transportadora);

-- ---------------------------------------------------------------------
-- dim_Rotas — 32 rotas oficiais
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dim_rotas (
    codigo      TEXT PRIMARY KEY,
    nome        TEXT NOT NULL,
    detalhe     TEXT NOT NULL DEFAULT '',
    operador    TEXT NOT NULL DEFAULT ''
);
COMMENT ON TABLE dim_rotas IS
  'Era constante no código do painel. Vira tabela para a Logística cadastrar '
  'as rotas que faltam sem depender de publicar versão nova.';

-- ---------------------------------------------------------------------
-- fact_Viagens — UMA linha por carga, atualizada
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fact_viagens (
    carga_id            TEXT PRIMARY KEY,
    numero_carga        TEXT NOT NULL DEFAULT '',
    placa               TEXT NOT NULL,
    transportadora      TEXT NOT NULL DEFAULT '',
    tipo_veiculo        TEXT NOT NULL DEFAULT '',
    motorista           TEXT NOT NULL DEFAULT '',
    cliente             TEXT NOT NULL DEFAULT '',
    destino             TEXT NOT NULL DEFAULT '',
    peso_kg             INTEGER NOT NULL DEFAULT 0,
    doca                TEXT NOT NULL DEFAULT '',
    rota_codigo         TEXT REFERENCES dim_rotas(codigo),
    sequencia           INTEGER,
    pra_onde            TEXT NOT NULL DEFAULT 'FROTA PROPRIA'
                        CHECK (pra_onde IN ('FROTA PROPRIA','CROSS-DOCKING','DEDICADA','RET FRIGO')),
    paletizada          BOOLEAN NOT NULL DEFAULT FALSE,
    qtd_ganchos         INTEGER NOT NULL DEFAULT 0,
    qtd_entregas        INTEGER NOT NULL DEFAULT 1,
    observacoes         TEXT NOT NULL DEFAULT '',
    status_atual        TEXT NOT NULL DEFAULT 'Aguardando Veículo'
                        CHECK (status_atual IN ('Aguardando Veículo','Aguardando Embarque',
                               'Embarque Iniciado','Embarque Finalizado','Faturado','Seguiu Viagem')),
    aguardando_carga    BOOLEAN NOT NULL DEFAULT FALSE,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    operador_id         TEXT NOT NULL DEFAULT '',
    operador_nome       TEXT NOT NULL DEFAULT '',
    operador_setor      TEXT NOT NULL DEFAULT '',
    versao              INTEGER NOT NULL DEFAULT 1
);
COMMENT ON COLUMN fact_viagens.status_atual IS
  'O CHECK replica no banco a máquina de estados do painel. Ele não valida a '
  'TRANSIÇÃO (isso é da aplicação), mas garante que nenhum valor inventado '
  'entre na tabela — inclusive por script ou carga manual.';
COMMENT ON COLUMN fact_viagens.versao IS
  'Incrementada a cada gravação. Permite bloqueio otimista: o cliente envia a '
  'versão que leu e o servidor recusa se já mudou. Substitui o "última escrita '
  'vence" da versão SharePoint, onde não havia como detectar o conflito.';

CREATE INDEX IF NOT EXISTS ix_viagens_status      ON fact_viagens (status_atual);
CREATE INDEX IF NOT EXISTS ix_viagens_placa       ON fact_viagens (placa);
CREATE INDEX IF NOT EXISTS ix_viagens_atualizado  ON fact_viagens (atualizado_em DESC);
CREATE INDEX IF NOT EXISTS ix_viagens_criado      ON fact_viagens (criado_em DESC);
-- Cargas em aberto são a consulta mais frequente (toda tela do painel).
CREATE INDEX IF NOT EXISTS ix_viagens_abertas ON fact_viagens (atualizado_em DESC)
    WHERE status_atual <> 'Seguiu Viagem';

-- ---------------------------------------------------------------------
-- fact_StatusFrota — UMA linha por mudança de status (append-only)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fact_statusfrota (
    movimentacao_id     TEXT PRIMARY KEY,
    carga_id            TEXT NOT NULL REFERENCES fact_viagens(carga_id) ON DELETE CASCADE,
    placa               TEXT NOT NULL,
    status_anterior     TEXT,
    status_novo         TEXT NOT NULL,
    setor               TEXT NOT NULL DEFAULT '',
    data_evento         TIMESTAMPTZ NOT NULL DEFAULT now(),
    operador_id         TEXT NOT NULL DEFAULT '',
    operador_nome       TEXT NOT NULL DEFAULT ''
);
COMMENT ON TABLE fact_statusfrota IS
  'Tabela FATO do Power BI e base de todo indicador de tempo. Append-only: '
  'não há UPDATE nem DELETE na aplicação.';

CREATE INDEX IF NOT EXISTS ix_status_carga  ON fact_statusfrota (carga_id);
CREATE INDEX IF NOT EXISTS ix_status_data   ON fact_statusfrota (data_evento DESC);
CREATE INDEX IF NOT EXISTS ix_status_placa  ON fact_statusfrota (placa);

-- ---------------------------------------------------------------------
-- LOG_EVENTOS — trilha de auditoria imutável
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS log_eventos (
    evento_id       TEXT PRIMARY KEY,
    carga_id        TEXT,
    placa           TEXT NOT NULL DEFAULT '',
    acao            TEXT NOT NULL,
    setor           TEXT NOT NULL DEFAULT '',
    data_evento     TIMESTAMPTZ NOT NULL DEFAULT now(),
    operador_id     TEXT NOT NULL DEFAULT '',
    operador_nome   TEXT NOT NULL DEFAULT '',
    operador_verificado BOOLEAN NOT NULL DEFAULT FALSE,
    ip_origem       INET
);
COMMENT ON TABLE log_eventos IS
  'Responde "quem autorizou a saída da placa X às 14h?". Sem FK para carga_id '
  'de propósito: o log precisa sobreviver mesmo que a carga seja removida.';
COMMENT ON COLUMN log_eventos.operador_verificado IS
  'Distingue identidade autenticada de nome auto-declarado. Um log que não '
  'separa os dois casos não serve para auditoria.';

CREATE INDEX IF NOT EXISTS ix_log_data  ON log_eventos (data_evento DESC);
CREATE INDEX IF NOT EXISTS ix_log_carga ON log_eventos (carga_id);

-- ---------------------------------------------------------------------
-- GATILHO: versão e timestamp automáticos
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_viagem_antes_update() RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em := now();
    NEW.versao := OLD.versao + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_viagem_update ON fact_viagens;
CREATE TRIGGER tg_viagem_update BEFORE UPDATE ON fact_viagens
    FOR EACH ROW EXECUTE FUNCTION fn_viagem_antes_update();

-- =====================================================================
-- VIEWS PARA O POWER BI
-- ---------------------------------------------------------------------
-- Reproduzem EXATAMENTE os cabeçalhos que o export CSV gera hoje, para o
-- relatório existente continuar funcionando sem refazer medida nenhuma.
-- O Power BI conecta direto no PostgreSQL e lê estas views.
-- =====================================================================

CREATE OR REPLACE VIEW vw_dim_carga AS
SELECT
    v.carga_id                              AS "Id",
    v.numero_carga                          AS "NumeroCarga",
    v.placa                                 AS "Placa",
    v.transportadora                        AS "Transportadora",
    v.tipo_veiculo                          AS "TipoVeiculo",
    v.motorista                             AS "Motorista",
    v.cliente                               AS "Cliente",
    v.destino                               AS "Destino",
    ''::TEXT                                AS "Produto",
    v.peso_kg                               AS "PesoKg",
    v.doca                                  AS "Doca",
    COALESCE(v.rota_codigo,'')              AS "RotaCodigo",
    COALESCE(r.nome,'')                     AS "RotaNome",
    COALESCE(r.operador,'')                 AS "RotaOperador",
    v.sequencia                             AS "Sequencia",
    v.pra_onde                              AS "PraOnde",
    CASE WHEN v.paletizada THEN 'Sim' ELSE 'Não' END AS "Paletizada",
    v.qtd_ganchos                           AS "QtdGanchos",
    v.qtd_entregas                          AS "QtdEntregas",
    v.status_atual                          AS "StatusAtual",
    v.criado_em                             AS "CriadoEm",
    v.atualizado_em                         AS "AtualizadoEm"
FROM fact_viagens v
LEFT JOIN dim_rotas r ON r.codigo = v.rota_codigo;

CREATE OR REPLACE VIEW vw_fact_movimentacoes AS
SELECT
    m.carga_id          AS "CargaId",
    m.placa             AS "Placa",
    m.data_evento       AS "Timestamp",
    COALESCE(m.status_anterior,'') AS "StatusAnterior",
    m.status_novo       AS "StatusNovo",
    m.operador_nome     AS "Operador",
    m.setor             AS "Setor",
    v.cliente           AS "Cliente",
    v.motorista         AS "Motorista",
    v.tipo_veiculo      AS "TipoVeiculo",
    v.qtd_entregas      AS "QtdEntregas"
FROM fact_statusfrota m
LEFT JOIN fact_viagens v ON v.carga_id = m.carga_id;

CREATE OR REPLACE VIEW vw_dim_frota AS
SELECT
    placa               AS "Placa",
    transportadora      AS "Transportadora",
    tipo_veiculo        AS "TipoVeiculo",
    capacidade_kg       AS "CapacidadeKg",
    uf                  AS "UF",
    NULL::TIMESTAMPTZ   AS "DataUltimaMovimentacao",
    CASE WHEN precisa_revisao THEN 'Sim' ELSE 'Não' END AS "PrecisaRevisao"
FROM dim_veiculos;

CREATE OR REPLACE VIEW vw_dim_transportadora AS
SELECT DISTINCT
    transportadora AS "Id",
    transportadora AS "Nome"
FROM dim_veiculos
WHERE transportadora <> '';

CREATE OR REPLACE VIEW vw_dim_status AS
SELECT * FROM (VALUES
    ('Aguardando Veículo',   1, '#c62828'),
    ('Aguardando Embarque',  2, '#e07b1a'),
    ('Embarque Iniciado',    3, '#f0c33c'),
    ('Embarque Finalizado',  4, '#7fd4a2'),
    ('Faturado',             5, '#34a862'),
    ('Seguiu Viagem',        6, '#14603a')
) AS t("Nome","OrdemNoFluxo","Cor");

CREATE OR REPLACE VIEW vw_dim_rota AS
SELECT codigo AS "Codigo", nome AS "Nome",
       detalhe AS "Detalhe", operador AS "OperadorLogistico"
FROM dim_rotas;

-- Tempo entre etapas — a base dos indicadores de gargalo. Estava calculada no
-- navegador; no banco fica disponível para o Power BI sem recalcular.
CREATE OR REPLACE VIEW vw_tempos_por_etapa AS
WITH eventos AS (
    SELECT carga_id, placa, status_novo, data_evento,
           LEAD(data_evento) OVER (PARTITION BY carga_id ORDER BY data_evento) AS proximo
    FROM fact_statusfrota
)
SELECT
    e.carga_id                                  AS "CargaId",
    e.placa                                     AS "Placa",
    v.transportadora                            AS "Transportadora",
    COALESCE(v.rota_codigo,'')                  AS "RotaCodigo",
    e.status_novo                               AS "Etapa",
    e.data_evento                               AS "EntrouEm",
    e.proximo                                   AS "SaiuEm",
    EXTRACT(EPOCH FROM (e.proximo - e.data_evento))/60 AS "MinutosNaEtapa"
FROM eventos e
LEFT JOIN fact_viagens v ON v.carga_id = e.carga_id
WHERE e.proximo IS NOT NULL;

COMMIT;
