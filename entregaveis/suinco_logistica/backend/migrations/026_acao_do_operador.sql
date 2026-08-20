-- 026 — "QUANDO UMA PESSOA MEXEU NISTO PELA ÚLTIMA VEZ?" (20/08/2026)
--
-- Relato do gestor, olhando a Torre de Controle: "todos estão marcando o
-- mesmo horário, no mesmo dia... quero que seja informada a última vez que
-- foi atualizada por um OPERADOR, não pelo sistema".
--
-- A CAUSA, que já estava documentada no código sem ter sido resolvida na
-- raiz (ver o comentário de `programado_em` em rotas/cargas.js, achado de
-- 14/08/2026: 109 cargas com `atualizado_em` nos MESMOS dois instantes):
--
--   `atualizado_em` sobe a CADA UPDATE, por causa do gatilho abaixo. E
--   UPDATE acontece muito além de edição humana: todo painel reenvia as
--   cargas que tem em memória a cada gravação e a cada reconexão. Quando o
--   serviço reinicia, ou quando alguém abre o painel com cache cheio, meia
--   programação é regravada IDÊNTICA a si mesma — e todas essas cargas
--   passam a exibir o mesmo horário, que é a hora do eco, não a hora em que
--   alguém fez alguma coisa.
--
--   Para a sincronização incremental isso está certo: ela precisa saber
--   quando a LINHA mudou. Para a pessoa que olha a tela, está errado: ela
--   quer saber quando o PROCESSO andou.
--
-- A CORREÇÃO: duas verdades, duas colunas.
--
--   atualizado_em → "quando esta linha foi gravada" (máquina; sincronia)
--   acao_em       → "quando uma pessoa mudou alguma coisa aqui" (operação)
--
-- O gatilho passa a comparar os campos de negócio antes e depois. Gravação
-- que não muda nada NÃO carimba ação nova, e nem sequer rouba a autoria de
-- quem mexeu de verdade: o eco deixa de reescrever operador_nome/setor.
-- Isso vale para todos os caminhos de escrita ao mesmo tempo — PATCH, rota
-- de status, correções da Administração e restauração de revisão — porque
-- mora no banco, e não em cada rota que alguém possa esquecer de ajustar.

ALTER TABLE fact_viagens ADD COLUMN IF NOT EXISTS acao_em    TIMESTAMPTZ;
ALTER TABLE fact_viagens ADD COLUMN IF NOT EXISTS acao_por   TEXT NOT NULL DEFAULT '';
ALTER TABLE fact_viagens ADD COLUMN IF NOT EXISTS acao_setor TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN fact_viagens.acao_em IS
  'Última vez que uma PESSOA mudou algo nesta carga. Diferente de '
  'atualizado_em, que sobe também com eco de sincronização.';
COMMENT ON COLUMN fact_viagens.acao_por IS 'Quem fez essa última mudança de verdade.';
COMMENT ON COLUMN fact_viagens.acao_setor IS 'Setor de quem fez a última mudança de verdade.';

-- Preenchimento do passado: o melhor que existe hoje é `atualizado_em` e o
-- último operador gravado. Para as cargas que passaram por eco em massa
-- isso repete o horário errado — não há como recuperar o instante real,
-- porque ele nunca foi guardado. Daqui para a frente o valor é exato; o
-- histórico anterior fica com a aproximação, que é honesta e é a única
-- disponível. Quem precisar do instante exato de uma etapa antiga tem a
-- trilha completa em fact_statusfrota e log_eventos.
UPDATE fact_viagens
   SET acao_em    = COALESCE(acao_em, atualizado_em),
       acao_por   = CASE WHEN acao_por   = '' THEN COALESCE(operador_nome, '')  ELSE acao_por   END,
       acao_setor = CASE WHEN acao_setor = '' THEN COALESCE(operador_setor, '') ELSE acao_setor END
 WHERE acao_em IS NULL;

CREATE INDEX IF NOT EXISTS ix_viagens_acao ON fact_viagens (acao_em DESC);

-- ---------------------------------------------------------------------
-- O gatilho, agora com memória do que é mudança de verdade
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_viagem_antes_update() RETURNS TRIGGER AS $$
DECLARE
    mudou BOOLEAN;
BEGIN
    -- Continua valendo para a sincronia: a linha foi gravada agora.
    NEW.atualizado_em := now();
    NEW.versao := OLD.versao + 1;

    /* Os campos que representam o PROCESSO. Ficam de fora, de propósito, os
       de controle (versao, atualizado_em, os próprios acao_*) — se eles
       entrassem na conta, toda gravação seria "mudança" e a coluna nova
       nasceria com o mesmo defeito da antiga. */
    mudou := (
         OLD.status_atual     IS DISTINCT FROM NEW.status_atual
      OR OLD.numero_carga     IS DISTINCT FROM NEW.numero_carga
      OR OLD.placa            IS DISTINCT FROM NEW.placa
      OR OLD.transportadora   IS DISTINCT FROM NEW.transportadora
      OR OLD.tipo_veiculo     IS DISTINCT FROM NEW.tipo_veiculo
      OR OLD.motorista        IS DISTINCT FROM NEW.motorista
      OR OLD.cliente          IS DISTINCT FROM NEW.cliente
      OR OLD.destino          IS DISTINCT FROM NEW.destino
      OR OLD.peso_kg          IS DISTINCT FROM NEW.peso_kg
      OR OLD.doca             IS DISTINCT FROM NEW.doca
      OR OLD.rota_codigo      IS DISTINCT FROM NEW.rota_codigo
      OR OLD.sequencia        IS DISTINCT FROM NEW.sequencia
      OR OLD.pra_onde         IS DISTINCT FROM NEW.pra_onde
      OR OLD.paletizada       IS DISTINCT FROM NEW.paletizada
      OR OLD.qtd_ganchos      IS DISTINCT FROM NEW.qtd_ganchos
      OR OLD.qtd_entregas     IS DISTINCT FROM NEW.qtd_entregas
      OR OLD.observacoes      IS DISTINCT FROM NEW.observacoes
      OR OLD.lacre            IS DISTINCT FROM NEW.lacre
      OR OLD.lacre_2          IS DISTINCT FROM NEW.lacre_2
      OR OLD.lacre_3          IS DISTINCT FROM NEW.lacre_3
      OR OLD.lacre_retido     IS DISTINCT FROM NEW.lacre_retido
      OR OLD.aguardando_carga IS DISTINCT FROM NEW.aguardando_carga
      OR OLD.programado_em    IS DISTINCT FROM NEW.programado_em
      OR OLD.excluida_em      IS DISTINCT FROM NEW.excluida_em
    );

    IF mudou THEN
        NEW.acao_em    := now();
        NEW.acao_por   := COALESCE(NULLIF(NEW.operador_nome, ''), OLD.acao_por);
        NEW.acao_setor := COALESCE(NULLIF(NEW.operador_setor, ''), OLD.acao_setor);
    ELSE
        /* Eco: nada mudou. Preserva o carimbo E A AUTORIA — sem esta parte,
           o último terminal a reconectar apareceria como autor da carga de
           todo mundo, que é uma informação pior que nenhuma. */
        NEW.acao_em       := OLD.acao_em;
        NEW.acao_por      := OLD.acao_por;
        NEW.acao_setor    := OLD.acao_setor;
        NEW.operador_id   := OLD.operador_id;
        NEW.operador_nome := OLD.operador_nome;
        NEW.operador_setor := OLD.operador_setor;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_viagem_update ON fact_viagens;
CREATE TRIGGER tg_viagem_update BEFORE UPDATE ON fact_viagens
    FOR EACH ROW EXECUTE FUNCTION fn_viagem_antes_update();

-- Carga nova nasce com a ação carimbada: criar é uma ação de gente.
ALTER TABLE fact_viagens ALTER COLUMN acao_em SET DEFAULT now();
