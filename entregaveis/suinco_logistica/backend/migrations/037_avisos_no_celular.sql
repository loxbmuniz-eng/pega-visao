-- =====================================================================
-- 037 — AVISOS NO CELULAR (26/08/2026)
-- SEM ESTA MIGRAÇÃO: os avisos no celular nao ligam. O painel mostra "avisos indisponiveis" e ninguem recebe nada; o resto do sistema segue igual.
-- ---------------------------------------------------------------------
-- Pedido do dono: "eu quero que todos que estiverem com o embarquesuinco
-- ligado no celular com atalho direto nos icones do celular como se fosse
-- um aplicativo recebam notificacoes push a cada vez que um caminhao
-- entrar na portaria ou sair, a cada vez que a programacao for finalizada
-- por inteiro".
--
-- Quem recebe o quê, decidido por ele no mesmo dia:
--   · entrada na portaria  → Logística, Administração e Expedição
--   · seguiu viagem        → Logística e Administração
--   · fim da programação   → quando o ÚLTIMO caminhão do dia sai
--
-- POR QUE ISTO NÃO É O SOCKET. O Socket.IO já avisa a TELA de quem está
-- com o painel aberto. Aviso com o celular no bolso e o aplicativo fechado
-- é outra coisa: o navegador guarda uma "inscrição" (um endereço secreto
-- na Google/Apple), e o servidor entrega a mensagem lá. É essa inscrição
-- que esta tabela guarda.
--
-- POR APARELHO, NÃO POR PESSOA. A mesma pessoa pode ter celular e
-- computador, e cada um gera uma inscrição diferente. Por isso a chave
-- única é o `endpoint`, e não o operador: quem entra no painel de dois
-- aparelhos recebe nos dois, e quem troca de celular não perde o antigo
-- por engano — ele morre sozinho (ver `falhas`).
-- =====================================================================

CREATE TABLE IF NOT EXISTS push_inscricoes (
    inscricao_id  BIGSERIAL PRIMARY KEY,
    operador_id   INTEGER NOT NULL REFERENCES operadores(id) ON DELETE CASCADE,
    -- O endereço que o navegador deu. É segredo: quem o tem consegue
    -- mandar notificação para aquele aparelho.
    endpoint      TEXT NOT NULL UNIQUE,
    -- As duas chaves que cifram a mensagem. Sem elas o conteúdo não pode
    -- ser lido pelo aparelho.
    p256dh        TEXT NOT NULL,
    auth          TEXT NOT NULL,
    -- Só para a pessoa se reconhecer na lista ("iPhone da Portaria").
    aparelho      TEXT NOT NULL DEFAULT '',
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Última vez que uma mensagem saiu com sucesso para cá.
    usado_em      TIMESTAMPTZ,
    -- Inscrição morre calada: o aparelho é trocado, o app é desinstalado,
    -- a permissão é revogada, e o servidor só descobre quando tenta
    -- enviar. Duas falhas seguidas e ela sai (ver servicos/avisos.js).
    falhas        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS ix_push_operador ON push_inscricoes(operador_id);

COMMENT ON TABLE push_inscricoes IS
  'Aparelhos inscritos para receber aviso no celular. Uma linha por '
  'aparelho, não por pessoa. Apagar a linha desliga o aviso naquele '
  'aparelho e nada mais.';

-- ---------------------------------------------------------------------
-- avisos_enviados — a trava contra aviso repetido
-- ---------------------------------------------------------------------
-- O aviso de "programação do dia terminou" dispara quando o último
-- caminhão sai, ou seja, quando a contagem de cargas em aberto chega a
-- zero. Só que essa contagem pode chegar a zero mais de uma vez no mesmo
-- dia: sai o último, chega um caminhão de última hora, ele sai também.
-- Sem trava, todo mundo recebe o mesmo "acabou" duas vezes.
--
-- A chave é o assunto + o dia ('fim-do-dia:2026-08-26'). Quem consegue
-- INSERIR manda o aviso; quem esbarrar no ON CONFLICT já sabe que outro
-- mandou. É atômico, então nem dois caminhões saindo no mesmo segundo
-- geram aviso dobrado.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS avisos_enviados (
    chave      TEXT PRIMARY KEY,
    criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE avisos_enviados IS
  'Trava de aviso único. Uma linha por assunto+dia; quem insere primeiro '
  'é quem envia.';
