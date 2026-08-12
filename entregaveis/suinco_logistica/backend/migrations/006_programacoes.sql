-- =====================================================================
-- 006 — Histórico de programações (ciclos de embarque)
-- ---------------------------------------------------------------------
-- Pedido do usuário (11/08/2026): "COLOCAR UMA SENHA AO INVES DE
-- BLOQUEAR A O ENCERRAMENTO/CRIACAO DE NOVA PROGRAMACAO, SO APOS COLOCAR
-- A SENHA A PROGRAMACAO SERA ARQUIVADA NO HISTORICO E SERA CRIADA UMA
-- NOVA PROGRAMACAO DO ZERO" + esclarecimento: "da pra fechar programacao
-- mesmo com carga em aberto mas essa carga fica em aberto na torre de
-- controle e vai pro historico de programacoes, conseguindo acessar,
-- alterar ou excluir... precisamos ter esse controle e tomada de decisao
-- em nossas maos e nao depender de qualquer limitacao".
--
-- MUDANÇA DE POSTURA, REGISTRADA DE PROPÓSITO: até 08/08/2026 o
-- fechamento era BLOQUEADO quando havia carga em andamento (decisão
-- confirmada na época, para nunca esconder um caminhão real das telas
-- operacionais). O usuário reverteu conscientemente: prefere poder fechar
-- e assumir a decisão a ficar preso a uma trava. A proteção contra
-- "esconder caminhão" continua existindo por outro caminho — a carga em
-- aberto NÃO sai da Torre de Controle; ela só passa a pertencer à
-- programação arquivada. Fechar não apaga nem esconde nada.
--
-- Por isso `programacao_id` fica em fact_viagens em vez de a carga ser
-- movida/copiada: a carga é UMA só, vista por dois recortes diferentes
-- (status, para a operação de hoje; programação, para o histórico).
-- =====================================================================

CREATE TABLE IF NOT EXISTS programacoes (
    programacao_id   TEXT PRIMARY KEY,
    aberta_em        TIMESTAMPTZ NOT NULL DEFAULT now(),
    fechada_em       TIMESTAMPTZ,
    fechada_por      TEXT,
    fechada_setor    TEXT,
    -- TRUE quando o fechamento foi feito com senha, havendo carga ainda
    -- em aberto. É o que permite auditar depois "quem decidiu fechar com
    -- caminhão no pátio", que é justamente o controle que o usuário pediu.
    forcado          BOOLEAN NOT NULL DEFAULT FALSE,
    cargas_em_aberto INTEGER NOT NULL DEFAULT 0
);
COMMENT ON TABLE programacoes IS
  'Ciclos de programação de embarque. Fechar um ciclo não apaga carga '
  'nenhuma: as cargas continuam em fact_viagens, ligadas ao ciclo em que '
  'foram criadas.';

ALTER TABLE fact_viagens
  ADD COLUMN IF NOT EXISTS programacao_id TEXT;

CREATE INDEX IF NOT EXISTS ix_viagens_programacao ON fact_viagens (programacao_id);

-- Ciclo inicial: tudo que já existe pertence a ele. Sem isto, o histórico
-- nasceria com todas as cargas anteriores órfãs de programação.
INSERT INTO programacoes (programacao_id, aberta_em)
VALUES ('prog_inicial', now())
ON CONFLICT (programacao_id) DO NOTHING;

UPDATE fact_viagens SET programacao_id = 'prog_inicial' WHERE programacao_id IS NULL;
