-- =====================================================================
-- 032 — SEGUNDO FATOR SÓ DEPOIS DE ERRAR A SENHA (24/08/2026)
-- ---------------------------------------------------------------------
-- Decisão do dono do projeto: "2FA não deve aparecer no login, somente
-- caso erre a senha mais de 5x".
--
-- O QUE MUDA. Até aqui, quem ativava o segundo fator digitava o código
-- em TODA entrada. Era correto do ponto de vista de segurança e caro do
-- ponto de vista de adesão: ninguém ativou em dois dias, e proteção que
-- ninguém liga não protege nada.
--
-- Agora o código só é pedido quando o padrão de acesso fica estranho —
-- cinco senhas erradas na mesma conta dentro da janela. Quem digita a
-- senha certa entra como sempre, e é por isso que dá para exigir de
-- quem interessa sem parar o pátio.
--
-- O QUE ISSO PROTEGE, E O QUE NÃO PROTEGE — registrado porque a
-- diferença importa e não deve se perder:
--
--   PROTEGE contra FORÇA BRUTA. Quem tenta adivinhar erra muito por
--   definição, bate nas cinco e passa a precisar de algo que não tem.
--
--   NÃO PROTEGE contra SENHA VAZADA. Quem já sabe a senha acerta de
--   primeira, nunca erra cinco vezes e nunca vê o segundo fator. A
--   brecha B4 do protocolo ("uma senha vazada de administrador dá poder
--   de restaurar carga, desfazer exclusão e criar usuário") continua
--   aberta por este caminho. Fechá-la exige pedir o código no MOMENTO
--   da ação crítica, não na entrada — e isso fica para uma etapa
--   própria, com decisão própria.
--
-- JANELA DE 30 MINUTOS. Sem ela, cinco erros espalhados ao longo de um
-- ano trancariam alguém para sempre. Erro velho não é sinal de ataque.
-- =====================================================================

ALTER TABLE operadores ADD COLUMN IF NOT EXISTS falhas_senha  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS falhas_desde  TIMESTAMPTZ;
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS bloqueado_ate TIMESTAMPTZ;

COMMENT ON COLUMN operadores.falhas_senha IS
  'Senhas erradas seguidas. Zera na entrada bem-sucedida e quando a '
  'janela de 30 min expira.';
COMMENT ON COLUMN operadores.bloqueado_ate IS
  'Só para quem NÃO tem segundo fator: passadas as cinco tentativas não '
  'há código para pedir, então o que resta é uma espera curta. Quem tem '
  'segundo fator nunca é bloqueado — digita o código e entra.';
