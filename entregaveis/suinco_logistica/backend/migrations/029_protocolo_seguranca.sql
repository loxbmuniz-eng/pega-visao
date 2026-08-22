-- 029 — PROTOCOLO DE SEGURANÇA, ETAPAS 1 A 3 (22/08/2026)
--
-- Pedido do gestor: "um protocolo de segurança que tenha controle e
-- autorização para quem consegue recuperar o dado, quem vê o relatório,
-- autenticar todos os usuários, e um relacionamento de dados que impeça
-- qualquer tipo de ataque ou má intenção".
--
-- O modelo de ameaça deste sistema aponta para DENTRO, não para fora: o
-- cenário realista não é invasão, é uso indevido de acesso legítimo — apagar
-- a carga que atrasou, restaurar uma versão para esconder um erro, levar a
-- base embora antes de sair da empresa. Por isso esta migração cria três
-- coisas, e nenhuma delas é firewall.

-- =====================================================================
-- 1. REGISTRO DE LEITURA — quem LEVOU o dado, não só quem mudou
-- =====================================================================
-- `log_eventos` responde "quem alterou". Nada respondia "quem exportou", e
-- exfiltração não altera nada: ela lê e vai embora. Sem esta tabela, levar a
-- operação inteira num PDF é invisível — e o que é invisível não se prova.
--
-- Não registra a leitura de estado incremental do painel (cada terminal
-- consulta a cada poucos segundos; seria ruído escondendo o que importa).
-- Registra o que PRODUZ DOCUMENTO: PDF, CSV, exportação de BI — e a leitura
-- COMPLETA de estado, que é o padrão de quem está copiando a base.
CREATE TABLE IF NOT EXISTS log_leitura (
    leitura_id    BIGSERIAL PRIMARY KEY,
    tipo          TEXT NOT NULL,          -- 'relatorio-operacional', 'bi:dim_carga', 'estado-completo'
    detalhe       TEXT NOT NULL DEFAULT '', -- recorte pedido: período, dia, carga
    linhas        INTEGER,                -- volume levado, quando aplicável
    operador_id   TEXT NOT NULL DEFAULT '',
    operador_nome TEXT NOT NULL DEFAULT '',
    operador_setor TEXT NOT NULL DEFAULT '',
    ip_origem     TEXT NOT NULL DEFAULT '',
    permitido     BOOLEAN NOT NULL DEFAULT TRUE, -- FALSE = tentou e foi barrado
    lida_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE log_leitura IS
  'Quem LEVOU dado para fora: PDF, CSV, exportação de BI e leitura completa '
  'de estado. Complementa log_eventos, que registra apenas alteração. '
  'Tentativa BARRADA também entra (permitido = FALSE) — negativa repetida é '
  'sinal, não silêncio.';

CREATE INDEX IF NOT EXISTS ix_log_leitura_quando ON log_leitura (lida_em DESC);
CREATE INDEX IF NOT EXISTS ix_log_leitura_operador ON log_leitura (operador_id, lida_em DESC);
-- Índice parcial: consultar as tentativas barradas é a consulta de segurança
-- mais frequente, e elas são minoria absoluta das linhas.
CREATE INDEX IF NOT EXISTS ix_log_leitura_barrada ON log_leitura (lida_em DESC) WHERE NOT permitido;

-- =====================================================================
-- 2. VERSÃO DE SESSÃO — desligar alguém derruba a sessão NA HORA
-- =====================================================================
-- O token é JWT: vale até expirar (12h), e o servidor não tinha como
-- desfazê-lo. Demitir um operador deixava a sessão dele viva por até meio
-- dia, em todos os aparelhos onde estivesse aberta.
--
-- A correção é um contador por operador, assinado dentro do token. Quando o
-- contador do banco não bate com o do token, a sessão morre. Incrementar o
-- contador é, portanto, "revogar tudo o que essa pessoa tem aberto".
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS sessao_versao INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN operadores.sessao_versao IS
  'Incrementar invalida imediatamente todos os tokens já emitidos para este '
  'operador, em todos os aparelhos. Sobe ao desativar, ao trocar senha e no '
  'botão de revogar sessões.';

-- =====================================================================
-- 3. AÇÕES CRÍTICAS — o que reescreve o passado precisa de duas pessoas
-- =====================================================================
-- Restaurar versão, desfazer exclusão e corrigir etapa não mudam o pátio:
-- mudam a HISTÓRIA do pátio. São exatamente as ferramentas de quem quer
-- esconder um erro — e estavam a um clique de um único administrador.
--
-- Agora são pedido + aprovação, por administradores DIFERENTES. Quem pede
-- não aprova: duas contas na mão da mesma pessoa derrotariam o controle, e
-- é justamente esse o cenário contra o qual ele existe.
CREATE TABLE IF NOT EXISTS acoes_criticas (
    acao_id       BIGSERIAL PRIMARY KEY,
    tipo          TEXT NOT NULL,          -- 'restaurar', 'desfazer-exclusao', 'corrigir-etapa'
    carga_id      TEXT NOT NULL,
    -- Tudo o que a execução vai precisar, no formato da rota que a executa.
    -- JSONB e não colunas: cada tipo de ação tem parâmetros próprios, e
    -- colunas espelhadas exigiriam migração a cada ação nova.
    parametros    JSONB NOT NULL DEFAULT '{}'::jsonb,
    motivo        TEXT NOT NULL,
    pedida_por    TEXT NOT NULL,
    pedida_por_id TEXT NOT NULL,
    pedida_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Preenchidos na aprovação. Nulos = pedido ainda aberto.
    aprovada_por    TEXT,
    aprovada_por_id TEXT,
    aprovada_em     TIMESTAMPTZ,
    executada_em    TIMESTAMPTZ,
    -- Pedido recusado morre com motivo: negativa também é decisão auditável.
    recusada_por  TEXT,
    recusada_em   TIMESTAMPTZ,
    recusa_motivo TEXT
);

COMMENT ON TABLE acoes_criticas IS
  'Pedidos de ação que reescreve o passado (restaurar, desfazer exclusão, '
  'corrigir etapa). Exige aprovação de administrador DIFERENTE de quem pediu. '
  'Pedido, aprovação, recusa e execução ficam registrados com os dois nomes.';

CREATE INDEX IF NOT EXISTS ix_acoes_criticas_abertas
    ON acoes_criticas (pedida_em DESC)
 WHERE aprovada_em IS NULL AND recusada_em IS NULL;
CREATE INDEX IF NOT EXISTS ix_acoes_criticas_carga ON acoes_criticas (carga_id, pedida_em DESC);

-- Pedido aberto expira: aprovação de ontem para um estado que já mudou hoje
-- executaria a ação errada. A janela é curta de propósito.
COMMENT ON COLUMN acoes_criticas.pedida_em IS
  'Pedido vale por 24 horas. Depois disso a aprovação é recusada e é preciso '
  'pedir de novo — o estado da carga pode ter mudado no intervalo.';
