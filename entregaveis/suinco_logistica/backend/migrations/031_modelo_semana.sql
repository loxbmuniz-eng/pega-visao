-- =====================================================================
-- 031 — MODELO DA SEMANA E MONTAGEM DO DIA (23/08/2026)
-- ---------------------------------------------------------------------
-- O que ainda prende a operação no Excel.
--
-- O dia nasce numa planilha do Teams: o Emerson abre o template do dia da
-- semana (segunda tem uma lista de rotas, terça outra, e assim por
-- diante), monta as cargas em cima daquelas rotas e só DEPOIS contrata as
-- placas. O painel não conseguia participar dessa etapa por um motivo
-- estrutural: `criarCargaProgramada` recusa placa vazia, e a Torre nasce da
-- placa. Ou seja — no painel a carga só existe quando o veículo já está
-- contratado, que é exatamente o último passo do processo real.
--
-- Estas duas tabelas cobrem os passos ANTERIORES a esse, sem encostar na
-- máquina de estados da carga.
--
-- POR QUE NÃO UM STATUS NOVO ("Aguardando Placa")
--
-- Seria a solução aparentemente mais simples e a mais cara: STATUS_FLOW é
-- lido pela Torre, pelos seis carimbos, pelos relatórios, pelos
-- indicadores, pelas badges e pelas regras de transição por setor. Um
-- sétimo status obrigaria a revisar todos esses lugares, e cada um deles é
-- uma chance de quebrar tela de operação em produção.
--
-- E seria conceitualmente errado: antes da placa não existe veículo, não
-- existe pátio, não existe nada para a Torre controlar. É PLANEJAMENTO,
-- não operação. Fica em tabela própria, e vira carga de verdade — pela
-- mesma rota de sempre — no instante em que a placa entra.
--
-- Resultado: a Torre de Controle não muda uma linha. Ela continua
-- recebendo cargas com placa, como sempre recebeu.
-- =====================================================================

-- ---------------------------------------------------------------------
-- O template do Teams, virando dado
-- ---------------------------------------------------------------------
-- Uma linha por rota que roda naquele dia da semana. `dia_semana` segue a
-- convenção do JavaScript (0=domingo … 6=sábado) porque é o painel que lê
-- isso a cada manhã — converter de um lado só evita o erro de fuso que
-- aparece quando os dois lados convertem.
--
-- Sábado e domingo cabem no modelo sem esforço: hoje a operação usa
-- segunda a sexta, mas nada aqui impede uma escala de fim de semana.
CREATE TABLE IF NOT EXISTS programacao_modelo (
    modelo_id      BIGSERIAL PRIMARY KEY,
    dia_semana     SMALLINT NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
    rota_codigo    TEXT NOT NULL REFERENCES dim_rotas(codigo),
    -- Ordem de exibição na tela da manhã. É a sequência com que a
    -- Logística está acostumada a ler o template, não uma prioridade
    -- operacional — a prioridade real é a `sequencia` da montagem.
    ordem          INTEGER NOT NULL DEFAULT 0,
    -- Valores que se repetem toda semana naquela rota. Entram
    -- pré-preenchidos no "Criar carga" para que a montagem do dia seja
    -- conferir e confirmar, não digitar tudo de novo. Vazio/NULL é
    -- legítimo: significa "não há padrão, quem monta decide".
    tipo_operacao  TEXT NOT NULL DEFAULT '',
    qtd_entregas   INTEGER,
    paletizada     TEXT NOT NULL DEFAULT '',
    observacoes    TEXT NOT NULL DEFAULT '',
    ativo          BOOLEAN NOT NULL DEFAULT TRUE,
    criado_por     TEXT NOT NULL DEFAULT '',
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A mesma rota pode repetir no mesmo dia (duas saídas para a mesma
    -- praça), então a unicidade é por (dia, rota, ordem) e não por
    -- (dia, rota).
    UNIQUE (dia_semana, rota_codigo, ordem)
);
COMMENT ON TABLE programacao_modelo IS
  'O template semanal que hoje vive numa planilha do Teams: quais rotas '
  'rodam em cada dia da semana. Editado pela Logística; muda as próximas '
  'semanas, nunca o dia já montado.';

CREATE INDEX IF NOT EXISTS ix_prog_modelo_dia
    ON programacao_modelo (dia_semana, ordem) WHERE ativo;

-- ---------------------------------------------------------------------
-- A montagem do dia — a carga antes de ter placa
-- ---------------------------------------------------------------------
-- Uma linha por carga que a Logística montou hoje. Nasce sem placa e
-- ganha uma quando o transporte é contratado. A placa pode entrar, sair e
-- trocar de linha o dia inteiro: é justamente o que a planilha permitia e
-- o painel não permitia.
CREATE TABLE IF NOT EXISTS programacao_montagem (
    montagem_id    TEXT PRIMARY KEY,
    data_prog      DATE NOT NULL,
    rota_codigo    TEXT NOT NULL REFERENCES dim_rotas(codigo),
    sequencia      INTEGER,
    numero_carga   TEXT NOT NULL DEFAULT '',
    peso           NUMERIC(12,3),
    qtd_entregas   INTEGER NOT NULL DEFAULT 1,
    qtd_ganchos    INTEGER NOT NULL DEFAULT 0,
    paletizada     TEXT NOT NULL DEFAULT 'Não',
    tipo_operacao  TEXT NOT NULL DEFAULT '',
    motorista      TEXT NOT NULL DEFAULT '',
    observacoes    TEXT NOT NULL DEFAULT '',
    -- Vazio até o transporte ser contratado. NÃO tem FK para dim_veiculos
    -- de propósito: a validação de frota é regra de negócio (mensagem que
    -- ensina onde cadastrar), não restrição de banco que devolveria erro
    -- ilegível ao operador.
    placa          TEXT NOT NULL DEFAULT '',
    -- Preenchido quando a montagem vira carga de verdade. A partir daí a
    -- linha é histórico: quem montou, quando, e em que virou.
    carga_id       TEXT,
    efetivada_em   TIMESTAMPTZ,
    -- Rota do modelo que hoje não sai. Fica marcada em vez de sumir: "não
    -- saiu" é informação de programação, e apagar esconderia isso do
    -- Controle da Programação.
    cancelada_em   TIMESTAMPTZ,
    motivo_cancelo TEXT NOT NULL DEFAULT '',
    criado_por     TEXT NOT NULL DEFAULT '',
    criado_setor   TEXT NOT NULL DEFAULT '',
    operador_nome  TEXT NOT NULL DEFAULT '',
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE programacao_montagem IS
  'Carga em montagem: existe antes de ter placa. Vira carga de verdade '
  '(fact_viagens) quando o transporte é contratado; a linha permanece '
  'como registro de como o dia foi planejado.';
COMMENT ON COLUMN programacao_montagem.carga_id IS
  'NULL enquanto a carga não foi efetivada. Preenchido com o id da carga '
  'criada — é o elo entre o que foi PLANEJADO e o que de fato rodou.';

CREATE INDEX IF NOT EXISTS ix_prog_montagem_dia
    ON programacao_montagem (data_prog)
    WHERE cancelada_em IS NULL;

-- Uma placa não pode estar em duas montagens abertas do mesmo dia. É a
-- mesma regra que a Programação já aplica às cargas (ocorrência de placa
-- duplicada), aplicada um passo antes — onde ela é barata de corrigir,
-- porque ninguém saiu do lugar ainda.
CREATE UNIQUE INDEX IF NOT EXISTS ux_prog_montagem_placa_dia
    ON programacao_montagem (data_prog, placa)
    WHERE placa <> '' AND cancelada_em IS NULL AND efetivada_em IS NULL;
