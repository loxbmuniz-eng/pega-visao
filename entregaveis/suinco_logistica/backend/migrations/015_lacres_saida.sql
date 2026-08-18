-- =====================================================================
-- 015 — Lacres na saída dos caminhões
-- ---------------------------------------------------------------------
-- Pedido do gestor (18/08/2026): "cada caminhão, ao sair para inspeção,
-- recebe um lacre com um número; às vezes esse lacre deve ser retido
-- (carga incorreta ou outro motivo), sendo necessário registrar um
-- número".
--
-- Dois campos, não um: `lacre` é o VIGENTE (o que está no caminhão);
-- `lacre_retido` guarda o número do que foi recolhido. Na retenção, o
-- vigente vai para lacre_retido e o novo número entra em lacre — os dois
-- ficam visíveis, e o motivo vai para as observações da carga (que já
-- sobem, já aparecem e já são protegidas contra apagamento por eco).
--
-- São campos da CARGA de propósito: viajam pela mesma sincronização
-- blindada das cargas (fila offline, eco barrado, revisões por trigger)
-- em vez de criar um segundo caminho de gravação para o pátio manter.
-- =====================================================================

ALTER TABLE fact_viagens ADD COLUMN IF NOT EXISTS lacre TEXT NOT NULL DEFAULT '';
ALTER TABLE fact_viagens ADD COLUMN IF NOT EXISTS lacre_retido TEXT NOT NULL DEFAULT '';
