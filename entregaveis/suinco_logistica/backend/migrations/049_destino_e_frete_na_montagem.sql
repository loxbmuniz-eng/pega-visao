-- =====================================================================
-- 049 — Destino e valor de frete na Montagem do Dia (10/09/2026)
-- ---------------------------------------------------------------------
-- RELATO DO DONO: "quando o wemerson coloca adicionar linha nao ta
-- aparecendo na hora de montar a programcao"; e, precisando o sintoma:
-- "quando adiciona a linha ela nao aparece o destino".
-- Depois, o pedido: "montagem do dia precisa seguir com destino valor de
-- frete" e "é pra aparecer e conectar com tudo".
--
-- O DEFEITO É DE COBERTURA, NÃO DE CÓDIGO QUEBRADO. A migração 047 criou
-- o destino de frete e os dois KM em fact_viagens — as cargas. A Montagem
-- do Dia é o SEGUNDO caminho de criar carga (efetivarMontagemUI monta o
-- payload a partir da linha montada), e não recebeu os campos. Resultado:
-- toda carga que nasce pela Montagem nasce sem destino, e sem destino o
-- servidor não tem de onde tirar o KM — então não calcula frete nenhum.
--
-- É a regra da casa quebrada por quem a escreveu: "uma função, dois
-- chamadores". O segundo chamador ficou para trás por três semanas.
--
-- POR QUE OS TRÊS CAMPOS, E NÃO SÓ O DESTINO. O cálculo do frete usa o KM
-- DE DESLOCAMENTO, não o do destino — é essa a razão de existirem dois
-- números (desvio, retorno e coleta no caminho são reais). Guardar só o
-- destino obrigaria a Montagem a recalcular o KM na efetivação e perderia
-- a correção que o operador fez na linha.
--
-- O QUE NÃO ENTRA AQUI, E É DECISÃO REGISTRADA: programacao_modelo, o
-- Modelo da Semana, NÃO ganha destino. Perguntado se a rota deveria levar
-- um destino fixo que o dia herda, o dono respondeu nomeando a montagem do
-- dia. Modelo com destino fixo herda destino errado quando a rota muda de
-- cliente, e o erro entra silencioso em 39 linhas de uma sexta-feira. Se
-- um dia isso for pedido, é outra migração, com essa decisão revista.
--
-- MESMOS TIPOS DE fact_viagens, de propósito: o valor viaja da linha para
-- a carga sem conversão, e conversão silenciosa entre INTEGER e NUMERIC é
-- de onde vem "o KM mudou sozinho".
-- =====================================================================

ALTER TABLE programacao_montagem
  ADD COLUMN IF NOT EXISTS frete_destino      TEXT,
  ADD COLUMN IF NOT EXISTS km_destino         INTEGER,
  ADD COLUMN IF NOT EXISTS km_deslocamento    INTEGER;

-- Índice por destino: a conferência de frete lê o dia inteiro por destino,
-- e a Montagem de uma sexta tem ~39 linhas. Barato agora, evita varredura
-- quando o histórico crescer.
CREATE INDEX IF NOT EXISTS idx_montagem_destino
  ON programacao_montagem (frete_destino)
  WHERE frete_destino IS NOT NULL;
