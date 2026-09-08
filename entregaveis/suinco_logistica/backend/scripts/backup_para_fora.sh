#!/usr/bin/env bash
# =====================================================================
# O BACKUP SAI DO SERVIDOR — cópia diária para fora da máquina
# ---------------------------------------------------------------------
# O PROBLEMA QUE ISTO RESOLVE, e ele é simples de enunciar: hoje o dump
# diário do banco mora em /var/backups/embarque-suinco, que fica DENTRO do
# mesmo VPS que ele existe para proteger. Os snapshots da Hostinger também.
# Se a máquina sumir inteira — apagada por engano, conta suspensa,
# incidente no provedor — some tudo junto, e a Suinco perde a operação.
#
# Backup na mesma máquina protege contra "eu apaguei a tabela errada".
# Não protege contra "o servidor não existe mais".
#
# ---------------------------------------------------------------------
# O QUE ESTE SCRIPT NÃO FAZ: gerar dump.
#
# Quem gera é o /etc/cron.daily/backup-embarque-suinco, criado pelo
# instalar.sh. Este aqui MANDA PARA FORA o dump mais recente que aquele
# já fez. Dois dumps por dia dobrariam a carga no banco e — pior —
# criariam duas verdades diferentes sobre o mesmo dia, com conteúdos
# ligeiramente distintos e nenhum jeito de saber qual é o bom.
#
# Por isso ele roda DEPOIS: em /etc/cron.daily o run-parts executa em
# ordem alfabética, e "backup-embarque-suinco-remoto" vem depois de
# "backup-embarque-suinco".
#
# ---------------------------------------------------------------------
# COMO INSTALAR, uma vez, no servidor:
#
#   1) Instalar o rclone (fala com Google Drive, OneDrive, S3, Backblaze
#      e mais uns quarenta destinos, com uma configuração só):
#
#        apt-get install -y rclone       # ou: curl https://rclone.org/install.sh | bash
#
#   2) Configurar o destino, uma vez, de forma interativa:
#
#        rclone config
#
#      Dê ao destino um nome — por exemplo `suinco` — e aponte para a
#      conta da EMPRESA, nunca para uma conta pessoal. É o mesmo motivo
#      de toda a migração corporativa: quem sai da empresa não pode levar
#      o backup junto.
#
#   3) Declarar o destino no .env do backend:
#
#        BACKUP_REMOTO=suinco:Backups/EmbarqueSuinco
#        BACKUP_REMOTO_DIAS=30
#
#   4) Rodar UMA VEZ à mão e conferir que o arquivo chegou lá:
#
#        bash /opt/suinco-src/entregaveis/suinco_logistica/backend/scripts/backup_para_fora.sh
#
#   5) Só então agendar:
#
#        ln -s /opt/suinco-src/entregaveis/suinco_logistica/backend/scripts/backup_para_fora.sh \
#              /etc/cron.daily/backup-embarque-suinco-remoto
#
# A ordem importa. Agendar antes de ver funcionar é criar a sensação de
# proteção sem a proteção — que é pior do que não ter, porque ninguém
# mais vai olhar.
# =====================================================================

set -uo pipefail

ORIGEM="${BACKUP_ORIGEM:-/var/backups/embarque-suinco}"
ENV_FILE="${ENV_FILE:-/opt/embarque-suinco/.env}"
ESTADO="/var/log/backup-remoto-suinco.estado"
# Um dump deste banco não tem como ser menor que isto. Arquivo minúsculo é
# dump interrompido, e dump interrompido abre, descompacta e engana.
MINIMO_BYTES="${BACKUP_MINIMO_BYTES:-51200}"

vermelho(){ printf '\033[0;31m%s\033[0m\n' "$*" >&2; }
verde(){    printf '\033[0;32m%s\033[0m\n' "$*"; }
amarelo(){  printf '\033[0;33m%s\033[0m\n' "$*"; }

# Registra o desfecho num arquivo que o diagnostico.sh pode ler depois.
# Controle que depende de alguém lembrar de olhar o log não é controle.
registrar(){
  printf '%s | %s | %s\n' "$(date -Is)" "$1" "${2:-}" > "$ESTADO" 2>/dev/null || true
}

falhou(){
  vermelho "  X  $*"
  registrar "FALHOU" "$*"
  exit 1
}

echo "== Backup do Embarque Suinco para fora do servidor =="

# --- 1. Destino declarado? -------------------------------------------
if [[ -f "$ENV_FILE" ]]; then
  # Só as duas variáveis deste script. `source` no .env inteiro traria
  # senha de banco e segredo de JWT para dentro do ambiente de um script
  # que não precisa de nenhum dos dois.
  BACKUP_REMOTO="$(grep -m1 '^BACKUP_REMOTO=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | xargs || true)"
  BACKUP_REMOTO_DIAS="$(grep -m1 '^BACKUP_REMOTO_DIAS=' "$ENV_FILE" | cut -d= -f2- | tr -d '"' | xargs || true)"
fi
BACKUP_REMOTO="${BACKUP_REMOTO:-}"
DIAS="${BACKUP_REMOTO_DIAS:-30}"

if [[ -z "$BACKUP_REMOTO" ]]; then
  falhou "BACKUP_REMOTO não está no .env. Sem destino, não há para onde mandar — veja o cabeçalho deste arquivo."
fi
command -v rclone >/dev/null 2>&1 || falhou "rclone não está instalado. Instale com: apt-get install -y rclone"
verde "  ok  destino declarado: ${BACKUP_REMOTO%%:*}: (caminho omitido do log)"

# --- 2. Qual é o backup mais recente? ---------------------------------
[[ -d "$ORIGEM" ]] || falhou "a pasta de backup $ORIGEM não existe."
ARQ="$(ls -1t "$ORIGEM"/embarque_suinco_*.sql.gz 2>/dev/null | head -1 || true)"
[[ -n "$ARQ" ]] || falhou "nenhum backup encontrado em $ORIGEM. O cron diário rodou hoje?"

IDADE_H=$(( ( $(date +%s) - $(stat -c %Y "$ARQ") ) / 3600 ))
TAM=$(stat -c %s "$ARQ")
verde "  ok  mais recente: $(basename "$ARQ") · $(numfmt --to=iec "$TAM") · ${IDADE_H}h atrás"
if (( IDADE_H > 36 )); then
  # Não é motivo para parar: mandar um backup velho para fora é melhor do
  # que não mandar nada. Mas precisa aparecer, porque significa que o cron
  # que gera parou — e esse é um problema maior do que este script.
  amarelo "  !!  o backup mais novo tem ${IDADE_H}h. O cron que GERA o dump pode ter parado."
fi

# --- 3. O arquivo presta? ---------------------------------------------
# Três perguntas, na ordem em que elas descartam mais rápido. Backup que
# ninguém conferiu não é backup — e conferir DEPOIS de subir é conferir
# tarde.
(( TAM >= MINIMO_BYTES )) || falhou "o backup tem só $TAM bytes. Dump interrompido não vira backup."
gzip -t "$ARQ" 2>/dev/null || falhou "o arquivo está corrompido (gzip -t reprovou)."
# Um pg_dump inteiro termina com a marca de fim. Se o processo morreu no
# meio de um COPY, o .gz continua VÁLIDO e o conteúdo está pela metade —
# é o caso que engana, e por isso a conferência olha o fim do conteúdo, e
# não só o envelope.
if ! zcat "$ARQ" | tail -5 | grep -q "PostgreSQL database dump complete"; then
  falhou "o dump não termina com a marca de conclusão: foi interrompido no meio."
fi
verde "  ok  íntegro: tamanho, compactação e marca de fim conferidos"

# --- 4. Subir ---------------------------------------------------------
NOME="$(basename "$ARQ")"
if ! rclone copyto "$ARQ" "$BACKUP_REMOTO/$NOME" --no-traverse --retries 3 --low-level-retries 5 2>&1; then
  falhou "o rclone não conseguiu subir $NOME."
fi

# --- 5. Chegou inteiro? -----------------------------------------------
# "O rclone não deu erro" não é a mesma coisa que "o arquivo está lá com o
# tamanho certo". A pergunta é feita ao DESTINO, não ao programa que subiu.
TAM_LA="$(rclone size "$BACKUP_REMOTO/$NOME" --json 2>/dev/null | grep -o '"bytes":[0-9]*' | cut -d: -f2 || true)"
[[ -n "$TAM_LA" ]] || falhou "o arquivo não foi encontrado no destino depois de subir."
(( TAM_LA == TAM )) || falhou "o tamanho no destino ($TAM_LA) é diferente do de origem ($TAM)."
verde "  ok  $NOME chegou ao destino com $(numfmt --to=iec "$TAM_LA")"

# --- 6. Retenção lá fora ----------------------------------------------
# Sem isto a pasta cresce para sempre e um dia estoura a cota, em silêncio,
# e a partir daquele dia nada mais sobe.
if rclone delete "$BACKUP_REMOTO" --min-age "${DIAS}d" --include "embarque_suinco_*.sql.gz" 2>/dev/null; then
  verde "  ok  cópias com mais de ${DIAS} dias removidas do destino"
else
  amarelo "  !!  não consegui aplicar a retenção de ${DIAS} dias — confira a cota do destino"
fi

QUANTAS="$(rclone lsf "$BACKUP_REMOTO" --include "embarque_suinco_*.sql.gz" 2>/dev/null | wc -l || echo '?')"
verde "  ok  $QUANTAS cópia(s) guardada(s) fora do servidor"
registrar "OK" "$NOME ($(numfmt --to=iec "$TAM"), ${QUANTAS} cópias fora)"

echo
verde "Backup fora do servidor. Estado gravado em $ESTADO"
echo
echo "A prova final continua sendo restaurar. Uma vez por mês:"
echo "  bash $(dirname "$0")/testar_restauracao_backup.sh"
