-- 030 — SEGUNDO FATOR DE AUTENTICAÇÃO (22/08/2026)
--
-- Etapa 4 do protocolo de segurança. Fecha a brecha B4: uma senha vazada de
-- administrador dá poder de restaurar carga, desfazer exclusão e criar
-- usuário. Senha sozinha protege contra quem não sabe a senha — e não
-- protege contra quem a descobriu.
--
-- REGRA DE IMPLANTAÇÃO, e é ela que torna esta migração segura de aplicar
-- num sistema com cinco setores ao vivo: o segundo fator nasce DESLIGADO
-- para todo mundo. Ninguém é obrigado a nada no dia da atualização; cada
-- pessoa ativa o seu quando tiver o aplicativo instalado. Migração que
-- derruba o login de quem está trabalhando é migração que volta atrás às
-- pressas, e sistema que volta atrás às pressas fica pior do que estava.

ALTER TABLE operadores ADD COLUMN IF NOT EXISTS mfa_segredo    TEXT NOT NULL DEFAULT '';
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS mfa_ativo      BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE operadores ADD COLUMN IF NOT EXISTS mfa_ativado_em TIMESTAMPTZ;

COMMENT ON COLUMN operadores.mfa_segredo IS
  'Segredo TOTP em base32. Preenchido no início da ativação e só passa a '
  'valer quando mfa_ativo vira TRUE — segredo gerado e não confirmado nunca '
  'tranca ninguém do lado de fora.';
COMMENT ON COLUMN operadores.mfa_ativo IS
  'FALSE por padrão, inclusive para quem já existe. A adesão é por pessoa.';

-- =====================================================================
-- CÓDIGOS DE RECUPERAÇÃO — o plano para o celular perdido
-- =====================================================================
-- É o caso que mais acontece na prática, e o que mais gera acesso de
-- emergência improvisado (que é pior que a brecha original). Cada pessoa
-- recebe oito códigos ao ativar; cada um vale UMA vez.
--
-- Guardados com HASH, nunca em claro: quem conseguir ler o banco não pode
-- usá-los para entrar. É a mesma razão de a senha ser guardada com bcrypt.
CREATE TABLE IF NOT EXISTS mfa_codigos_recuperacao (
    codigo_id   BIGSERIAL PRIMARY KEY,
    operador_id INTEGER NOT NULL REFERENCES operadores(id) ON DELETE CASCADE,
    codigo_hash TEXT NOT NULL,
    usado_em    TIMESTAMPTZ,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE mfa_codigos_recuperacao IS
  'Códigos de uso único para entrar sem o celular. Guardados com hash. '
  'Gerar um lote novo apaga o lote anterior — dois lotes válidos ao mesmo '
  'tempo dobrariam a superfície sem que ninguém percebesse.';

CREATE INDEX IF NOT EXISTS ix_mfa_codigos_operador
    ON mfa_codigos_recuperacao (operador_id) WHERE usado_em IS NULL;
