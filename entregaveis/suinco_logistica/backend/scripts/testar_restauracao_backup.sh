#!/usr/bin/env bash
# =====================================================================
# O BACKUP É DE VERDADE? — teste de restauração
# ---------------------------------------------------------------------
# O instalar.sh cria um backup diário do banco e o próprio script dele
# carrega esta frase: "Backup que nunca foi restaurado não é backup".
# Até hoje ninguém tinha restaurado. Este script restaura.
#
# O QUE ELE FAZ, na ordem:
#   1. escolhe o backup mais recente (ou o que você mandar em --arquivo);
#   2. confere se o .gz não está corrompido, ANTES de qualquer outra coisa;
#   3. cria um banco NOVO e DESCARTÁVEL, com nome carimbado pela hora;
#   4. restaura o backup dentro dele e conta os erros do PostgreSQL;
#   5. compara, tabela por tabela, o que veio do backup com o que está
#      hoje na produção;
#   6. confere o CONTEÚDO de algumas cargas antigas — não só a contagem —
#      porque banco cheio de linha errada também tem contagem bonita;
#   7. APAGA o banco descartável, aconteça o que acontecer.
#
# O QUE ELE NÃO FAZ, nunca: escrever, alterar ou apagar qualquer coisa no
# banco de produção. Da produção ele só LÊ contagens. O banco temporário
# tem nome com data e hora e é conferido contra o nome do banco real antes
# de existir — se por qualquer motivo os dois forem iguais, ele para.
#
# COMO RODAR, no servidor:
#     ssh root@2.25.95.253
#     bash /opt/suinco-src/entregaveis/suinco_logistica/backend/scripts/testar_restauracao_backup.sh
#
# Para testar um backup específico (por exemplo o de uma data anterior):
#     bash .../testar_restauracao_backup.sh --arquivo /var/backups/embarque-suinco/embarque_suinco_20260820.sql.gz
#
# O QUE ESPERAR. No fim ele imprime VEREDITO. Se der qualquer coisa
# diferente de "O BACKUP PRESTA", mande a saída inteira — a diferença é o
# diagnóstico.
# =====================================================================

set -uo pipefail

BANCO_REAL="embarque_suinco"
DESTINO="/var/backups/embarque-suinco"
ARQUIVO=""

vermelho() { printf '\033[0;31m%s\033[0m\n' "$*"; }
verde()    { printf '\033[0;32m%s\033[0m\n' "$*"; }
amarelo()  { printf '\033[0;33m%s\033[0m\n' "$*"; }
titulo()   { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

FALHAS=0
ALERTAS=0
falha()  { vermelho "  FALHA  $*"; FALHAS=$((FALHAS+1)); }
alerta() { amarelo  "  atenção $*"; ALERTAS=$((ALERTAS+1)); }
ok()     { verde    "  ok  $*"; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --arquivo) ARQUIVO="${2:-}"; shift 2 ;;
    *) vermelho "opção desconhecida: $1"; exit 2 ;;
  esac
done

if [[ "$(id -u)" != "0" ]]; then
  vermelho "Rode como root (é preciso virar o usuário postgres):  sudo bash $0"
  exit 2
fi

# Todo acesso ao PostgreSQL passa por aqui, sempre como o usuário postgres.
pg() { sudo -u postgres psql "$@"; }
if ! command -v sudo >/dev/null 2>&1; then
  vermelho "sudo não existe nesta máquina — este script precisa dele."
  exit 2
fi

# ---------------------------------------------------------------------
titulo "1. Escolhendo o backup"

if [[ -z "$ARQUIVO" ]]; then
  ARQUIVO="$(ls -1t "$DESTINO"/*.sql.gz 2>/dev/null | head -1 || true)"
fi

if [[ -z "$ARQUIVO" || ! -f "$ARQUIVO" ]]; then
  falha "não existe backup nenhum em $DESTINO."
  vermelho ""
  vermelho "VEREDITO: NÃO HÁ BACKUP. O cron diário não está rodando."
  exit 1
fi

TAMANHO="$(du -h "$ARQUIVO" | cut -f1)"
IDADE_S=$(( $(date +%s) - $(stat -c %Y "$ARQUIVO") ))
IDADE_H=$(( IDADE_S / 3600 ))
echo "      arquivo: $ARQUIVO"
echo "      tamanho: $TAMANHO   ·   gerado há ${IDADE_H}h"

# Um backup parado no tempo é o defeito mais silencioso que existe: o
# arquivo está lá, a pasta não está vazia, e faz semanas que ele não muda.
if (( IDADE_H > 48 )); then
  alerta "o backup mais novo tem mais de 48h — o cron diário pode ter parado."
else
  ok "backup recente"
fi

# Um dump que encolheu de repente é sinal de pg_dump interrompido.
ANTERIOR="$(ls -1t "$DESTINO"/*.sql.gz 2>/dev/null | sed -n 2p || true)"
if [[ -n "$ANTERIOR" ]]; then
  B_HOJE=$(stat -c %s "$ARQUIVO")
  B_ONTEM=$(stat -c %s "$ANTERIOR")
  if (( B_ONTEM > 0 )) && (( B_HOJE * 2 < B_ONTEM )); then
    alerta "este backup tem menos da metade do tamanho do anterior ($B_HOJE vs $B_ONTEM bytes)."
  fi
fi

# ---------------------------------------------------------------------
titulo "2. O arquivo está inteiro?"

if gzip -t "$ARQUIVO" 2>/dev/null; then
  ok "o .gz abre sem erro"
else
  falha "o arquivo está CORROMPIDO — o gzip não consegue abrir."
  vermelho ""
  vermelho "VEREDITO: BACKUP INSERVÍVEL. Não adianta tentar restaurar."
  exit 1
fi

BYTES_SQL=$(gunzip -c "$ARQUIVO" | wc -c)
echo "      SQL descompactado: $(numfmt --to=iec "$BYTES_SQL" 2>/dev/null || echo "$BYTES_SQL bytes")"

LIVRE_KB=$(df -Pk /var/lib/postgresql | awk 'NR==2{print $4}')
PRECISA_KB=$(( BYTES_SQL / 1024 * 2 ))
if (( LIVRE_KB < PRECISA_KB )); then
  falha "espaço em disco insuficiente para a cópia (livre ${LIVRE_KB}KB, preciso ~${PRECISA_KB}KB)."
  vermelho ""
  vermelho "VEREDITO: NÃO DEU PARA TESTAR. Libere espaço e rode de novo."
  exit 1
fi
ok "há espaço em disco para a cópia"

# ---------------------------------------------------------------------
titulo "3. Criando o banco descartável"

TEMP="teste_restauracao_$(date +%Y%m%d_%H%M%S)"

# Trava de segurança. O nome tem data e hora, então nunca deveria bater com
# o banco real — mas "nunca deveria" é exatamente o tipo de frase que
# antecede um acidente. Se bater, para aqui.
if [[ "$TEMP" == "$BANCO_REAL" ]]; then
  vermelho "ABORTANDO: o nome do banco temporário ficou igual ao de produção."
  exit 2
fi

limpar() {
  if pg -tAc "SELECT 1 FROM pg_database WHERE datname='$TEMP'" 2>/dev/null | grep -q 1; then
    titulo "Apagando o banco descartável"
    pg -d postgres -c "DROP DATABASE IF EXISTS \"$TEMP\"" >/dev/null 2>&1 \
      && ok "$TEMP apagado" \
      || vermelho "  FALHA  não consegui apagar $TEMP — apague à mão."
  fi
}
# O trap vale para saída normal, erro e Ctrl-C: o banco de teste não fica.
trap limpar EXIT INT TERM

if pg -d postgres -c "CREATE DATABASE \"$TEMP\"" >/dev/null 2>&1; then
  ok "$TEMP criado"
else
  falha "não consegui criar o banco temporário."
  exit 1
fi

# ---------------------------------------------------------------------
titulo "4. Restaurando"

ERROS_LOG="$(mktemp)"
gunzip -c "$ARQUIVO" | sudo -u postgres psql -q -d "$TEMP" >/dev/null 2>"$ERROS_LOG"

N_ERROS=$(grep -c '^ERRO:\|^ERROR:' "$ERROS_LOG" || true)
if (( N_ERROS == 0 )); then
  ok "restaurou sem nenhum erro"
else
  falha "o PostgreSQL reclamou $N_ERROS vez(es) durante a restauração:"
  grep '^ERRO:\|^ERROR:' "$ERROS_LOG" | head -15 | sed 's/^/        /'
  (( N_ERROS > 15 )) && echo "        ... (e mais $((N_ERROS-15)))"
fi
rm -f "$ERROS_LOG"

# ---------------------------------------------------------------------
titulo "5. O que veio dentro — tabela por tabela"

TABELAS="fact_viagens carga_revisoes log_eventos operadores programacao_montagem programacao_modelo programacoes devolucoes dim_veiculos dim_rotas dim_clientes fact_statusfrota _migrations"

conta() { pg -d "$1" -tAc "SELECT count(*) FROM $2" 2>/dev/null || echo "-"; }

printf '      %-24s %12s %12s\n' "TABELA" "NO BACKUP" "HOJE"
printf '      %-24s %12s %12s\n' "------" "---------" "----"

# Estas quatro são o coração do painel. Vazias, o backup não serve para
# nada — mesmo que o arquivo exista e a restauração não tenha dado erro.
ESSENCIAIS="fact_viagens operadores dim_veiculos _migrations"

for t in $TABELAS; do
  b="$(conta "$TEMP" "$t")"
  p="$(conta "$BANCO_REAL" "$t")"
  printf '      %-24s %12s %12s\n' "$t" "$b" "$p"

  if [[ "$b" == "-" ]]; then
    if [[ "$p" == "-" ]]; then
      : # a tabela não existe nos dois lados: migração que ainda não subiu
    else
      falha "a tabela $t existe na produção e NÃO veio no backup."
    fi
    continue
  fi

  # A produção anda o dia inteiro depois do backup da madrugada, então ter
  # MAIS linhas hoje é o normal. Ter MENOS é que é notícia.
  if [[ "$p" != "-" ]] && (( b > p )); then
    alerta "$t tem mais linhas no backup ($b) do que hoje ($p) — alguém apagou dados?"
  fi

  if [[ " $ESSENCIAIS " == *" $t "* ]] && (( b == 0 )); then
    falha "$t veio VAZIA no backup."
  fi
done

echo ""
ULTIMA="$(pg -d "$TEMP" -tAc "SELECT to_char(max(atualizado_em) AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI') FROM fact_viagens" 2>/dev/null || echo '')"
[[ -n "$ULTIMA" ]] && echo "      última carga mexida dentro do backup: $ULTIMA"

MIG="$(pg -d "$TEMP" -tAc "SELECT arquivo FROM _migrations ORDER BY arquivo DESC LIMIT 1" 2>/dev/null || echo '')"
[[ -n "$MIG" ]] && echo "      última migração aplicada no backup:   $MIG"

# ---------------------------------------------------------------------
titulo "6. O conteúdo confere? (não só a contagem)"

# Contagem igual não prova nada sobre o que está escrito nas linhas. Aqui
# comparam-se cargas ANTIGAS — criadas há mais de sete dias, portanto já
# encerradas — campo a campo entre o backup e a produção. Carga do dia
# ficaria de fora de propósito: ela muda o tempo todo, e uma diferença ali
# seria trabalho normal, não defeito de backup.
AMOSTRA="$(pg -d "$TEMP" -tAc "
  SELECT carga_id
    FROM fact_viagens
   WHERE criado_em < now() - interval '7 days'
   ORDER BY carga_id
   LIMIT 5" 2>/dev/null || echo '')"

if [[ -z "$AMOSTRA" ]]; then
  alerta "não há carga com mais de 7 dias para comparar (banco novo?). Conferência de conteúdo pulada."
else
  linha() {
    pg -d "$1" -tAc "
      SELECT numero_carga||' | '||placa||' | '||peso_kg||' | '||status_atual
        FROM fact_viagens WHERE carga_id = '$2'" 2>/dev/null
  }
  IGUAIS=0; DIFERENTES=0
  while read -r id; do
    [[ -z "$id" ]] && continue
    a="$(linha "$TEMP" "$id")"
    b="$(linha "$BANCO_REAL" "$id")"
    if [[ "$a" == "$b" ]]; then
      IGUAIS=$((IGUAIS+1))
    else
      DIFERENTES=$((DIFERENTES+1))
      echo "        difere: $id"
      echo "          backup:   $a"
      echo "          produção: $b"
    fi
  done <<< "$AMOSTRA"

  if (( DIFERENTES == 0 )); then
    ok "$IGUAIS carga(s) antiga(s) conferidas, todas idênticas à produção"
  else
    alerta "$DIFERENTES de $((IGUAIS+DIFERENTES)) cargas antigas diferem (pode ser correção feita depois do backup — olhe acima)."
  fi
fi

# ---------------------------------------------------------------------
titulo "VEREDITO"

if (( FALHAS > 0 )); then
  vermelho "O BACKUP NÃO PRESTA — $FALHAS problema(s) grave(s), $ALERTAS alerta(s)."
  vermelho "Mande esta saída inteira. Enquanto isso, o backup não pode ser"
  vermelho "considerado uma rede de proteção."
  exit 1
fi

if (( ALERTAS > 0 )); then
  amarelo "O BACKUP PRESTA, com $ALERTAS ponto(s) para olhar (marcados como 'atenção' acima)."
  exit 0
fi

verde "O BACKUP PRESTA. Restaurou inteiro, com os dados certos dentro."
verde "Rode este teste de vez em quando — de preferência todo mês."
exit 0
