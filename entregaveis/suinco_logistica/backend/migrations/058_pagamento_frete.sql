-- =====================================================================
-- 058 — Pagamento de Frete: a conferência entrega × nota e o controle do
--       que ficou para pagar
-- ---------------------------------------------------------------------
-- SEM ESTA MIGRAÇÃO: a aba "Pagamento de Frete" do painel responde "o
-- servidor ainda não tem esta função" e nenhuma importação é gravada, e a
-- tela de Usuários não consegue liberar o acesso à aba para ninguém. Nada
-- da operação (carga, pátio, devolução, vigias) muda ou para.
--
-- Pedido da Logística (Daniela, via Alysson, 05/10/2026): o frete é pago
-- POR CARGA, e só o que foi entregue de verdade. Hoje ela exporta dois
-- relatórios por carga (o do DeliveryB2B e o WRVDA501 do Atak), confere num
-- assistente do Copilot, copia o resultado para uma planilha e anota à mão
-- a transportadora, a tratativa, o pagamento e a data. Com 40 cargas na
-- semana são 80 relatórios, e o que fica pendente acumula numa planilha
-- sem idade nem dono.
--
-- O QUE FICA GUARDADO — e o que não:
--   · da carga, as CONTAGENS da conferência (as colunas C a I da planilha
--     dela) e os campos que a pessoa preenche (transportadora, CT-e, obs);
--   · só as PENDÊNCIAS, nota a nota (o que não está Finalizado no B2B, o
--     que está no sistema e não no B2B, e o inverso). A nota finalizada é
--     contada e pronto: reconstruí-la só serviria para guardar 100 linhas
--     iguais por carga. Quando uma pendência finaliza numa conferência
--     seguinte, ela sai da fila sozinha e fica marcada como resolvida;
--   · os PAGAMENTOS como um livro: cada um com percentual, data (que pode
--     ficar em branco — "não tem uma data específica"), quem registrou e,
--     se foi anulado, por quê. Pagamento não se apaga, se anula;
--   · uma trilha de auditoria de tudo que mexe nos dados acima.
--
-- NÃO GUARDA valor em R$ nem peso: o dono pediu que a aba seja um
-- checklist de controle ("valor agora não"). Também não guarda CNPJ/CPF
-- de ninguém.
--
-- O ACESSO É POR PESSOA, e não por setor ("só a Daniela, a Ana Paula, a
-- Karen e a Andressa"): a coluna operadores.acesso_frete é marcada pela
-- Administração na tela de Usuários. A Administração entra sempre.
--
-- Só ACRESCENTA: uma coluna com padrão FALSE e cinco tabelas novas. Nenhum
-- dado existente é lido, alterado ou apagado.
-- =====================================================================

ALTER TABLE operadores ADD COLUMN IF NOT EXISTS acesso_frete BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS pgfrete_cargas (
  numero_carga        TEXT PRIMARY KEY,
  primeira_consulta   DATE NOT NULL,
  data_consulta       DATE NOT NULL,          -- a conferência mais recente
  qtd_sist            INTEGER NOT NULL DEFAULT 0,
  qtd_b2b             INTEGER NOT NULL DEFAULT 0,
  finalizadas         INTEGER NOT NULL DEFAULT 0,
  aguardando          INTEGER NOT NULL DEFAULT 0,
  nao_entregue        INTEGER NOT NULL DEFAULT 0,
  outros              INTEGER NOT NULL DEFAULT 0,
  -- Finalizadas que também estão no sistema: é a base do "% entregue".
  -- Igual a `finalizadas` quando as contagens batem; menor quando o B2B
  -- traz nota que o sistema não tem.
  finalizadas_no_sist INTEGER NOT NULL DEFAULT 0,
  origem              TEXT NOT NULL DEFAULT 'relatorios'
                      CHECK (origem IN ('relatorios', 'planilha')),
  transportadora      TEXT NOT NULL DEFAULT '',
  cte                 TEXT NOT NULL DEFAULT '',
  obs                 TEXT NOT NULL DEFAULT '',
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por      TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_pgfrete_cargas_consulta ON pgfrete_cargas (data_consulta DESC);
CREATE INDEX IF NOT EXISTS ix_pgfrete_cargas_transp   ON pgfrete_cargas (transportadora);

CREATE TABLE IF NOT EXISTS pgfrete_pendencias (
  numero_carga   TEXT NOT NULL REFERENCES pgfrete_cargas (numero_carga) ON DELETE CASCADE,
  nota           TEXT NOT NULL,
  categoria      TEXT NOT NULL
                 CHECK (categoria IN ('aguardando', 'nao_entregue', 'outro', 'nao_localizada', 'so_b2b')),
  status_b2b     TEXT NOT NULL DEFAULT '',    -- como o B2B escreveu ('Cancelado', 'A caminho'...)
  cliente        TEXT NOT NULL DEFAULT '',
  cidade         TEXT NOT NULL DEFAULT '',
  visto_em       DATE NOT NULL,               -- a primeira conferência em que apareceu pendente
  resolvida_em   DATE,                        -- a conferência em que virou Finalizado
  tratativa      TEXT NOT NULL DEFAULT ''
                 CHECK (tratativa IN ('', 'SEM TRATATIVA', 'DEV', 'DEV NO SISTEMA', 'OK B2B', 'OK', 'SUMIU DO B2B')),
  tratativa_em   DATE,
  tratativa_por  TEXT NOT NULL DEFAULT '',
  obs            TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (numero_carga, nota)
);
CREATE INDEX IF NOT EXISTS ix_pgfrete_pend_abertas ON pgfrete_pendencias (numero_carga) WHERE resolvida_em IS NULL;

CREATE TABLE IF NOT EXISTS pgfrete_pagamentos (
  id               BIGSERIAL PRIMARY KEY,
  numero_carga     TEXT NOT NULL REFERENCES pgfrete_cargas (numero_carga) ON DELETE CASCADE,
  pct              NUMERIC(5,2) NOT NULL CHECK (pct > 0 AND pct <= 100),
  data_pagamento   DATE,                      -- em branco = "ainda sem data"
  entregue_pct     NUMERIC(5,2),              -- o % entregue no momento do registro
  estimado         BOOLEAN NOT NULL DEFAULT FALSE, -- veio da planilha, que só dizia "PARCIAL"
  obs              TEXT NOT NULL DEFAULT '',
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por_id    TEXT NOT NULL DEFAULT '',
  criado_por_nome  TEXT NOT NULL DEFAULT '',
  anulado_em       TIMESTAMPTZ,
  anulado_por      TEXT,
  anulado_motivo   TEXT
);
CREATE INDEX IF NOT EXISTS ix_pgfrete_pag_carga ON pgfrete_pagamentos (numero_carga) WHERE anulado_em IS NULL;

-- A leitura dos PDFs, guardada até a pessoa confirmar. O servidor lê o
-- arquivo uma vez; quem decide o que entra é a confirmação, sobre o que ELE
-- leu — a tela não devolve dado nenhum para ser gravado. Passa de um dia,
-- some sozinha (a importação seguinte limpa).
CREATE TABLE IF NOT EXISTS pgfrete_leituras (
  lote          TEXT NOT NULL,
  tipo          TEXT NOT NULL CHECK (tipo IN ('B2B', 'SIST')),
  numero_carga  TEXT NOT NULL,
  arquivo       TEXT NOT NULL DEFAULT '',
  conteudo      JSONB NOT NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por    TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (lote, tipo, numero_carga)
);
CREATE INDEX IF NOT EXISTS ix_pgfrete_leituras_data ON pgfrete_leituras (criado_em);

CREATE TABLE IF NOT EXISTS pgfrete_eventos (
  id            BIGSERIAL PRIMARY KEY,
  numero_carga  TEXT,
  nota          TEXT,
  acao          TEXT NOT NULL,
  detalhe       JSONB NOT NULL DEFAULT '{}'::jsonb,
  por_id        TEXT NOT NULL DEFAULT '',
  por_nome      TEXT NOT NULL DEFAULT '',
  em            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_pgfrete_eventos_carga ON pgfrete_eventos (numero_carga, em DESC);
