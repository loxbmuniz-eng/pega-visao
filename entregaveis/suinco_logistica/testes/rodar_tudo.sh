#!/usr/bin/env bash
# Roda a bateria inteira de navegador, com o banco LIMPO antes de cada suíte.
#
# POR QUE LIMPAR ENTRE UMA E OUTRA (23/08/2026)
#
# As suítes compartilham um Postgres só. Rodando em sequência sem limpar,
# sobra de um teste vira falha do seguinte: carga que ficou aberta, pedido de
# aprovação pendente, placa já usada. Numa bateria de 98 isso produziu
# vermelhos que NÃO reproduziam sozinhos — test_admin_historico falhava na
# fila e passava verde no primeiro try isolado.
#
# O custo de limpar é um DELETE em quatro tabelas. O custo de não limpar foi
# uma lista de 19 vermelhos onde só 1 era regressão de verdade, e o tempo
# gasto para descobrir isso. Ver ocorrência #15 em
# docs/REGISTRO_DE_OCORRENCIAS.md.
#
# NÃO aponta para produção: usa backend/.env, que é o Postgres local
# descartável. Se algum dia .env apontar para a VPS, este script apaga o
# pátio inteiro — daí a checagem de PGHOST logo abaixo.
#
#   bash testes/rodar_tudo.sh              # tudo
#   bash testes/rodar_tudo.sh mobile       # só as que casam com "mobile"
set -uo pipefail
cd "$(dirname "$0")/.."

[ -f backend/.env ] || { echo "backend/.env não encontrado."; exit 1; }
set -a; . ./backend/.env; set +a

case "${PGHOST:-}" in
  127.0.0.1|localhost|'') : ;;
  *) echo "RECUSADO: PGHOST=$PGHOST não é local. Este script APAGA dados."; exit 1 ;;
esac

export PLAYWRIGHT_CHROMIUM_PATH="${PLAYWRIGHT_CHROMIUM_PATH:-/opt/pw-browsers/chromium}"
FILTRO="${1:-}"
LOGS=$(mktemp -d)
falhas=(); ok=0

for f in testes/test_*.py testes/auditoria_*.py; do
  [ -f "$f" ] || continue
  [ -n "$FILTRO" ] && [[ "$f" != *"$FILTRO"* ]] && continue
  nome=$(basename "$f" .py)
  psql -q -c "DELETE FROM log_eventos; DELETE FROM fact_statusfrota;
              DELETE FROM fact_viagens; DELETE FROM acoes_criticas;" 2>/dev/null
  printf '%-48s ' "$nome"
  if timeout 300 python3 "$f" > "$LOGS/$nome.txt" 2>&1; then
    echo "ok"; ok=$((ok+1))
  else
    echo "FALHA"; falhas+=("$nome")
    grep -m3 'FALHA' "$LOGS/$nome.txt" | sed 's/^/      /'
  fi
done

echo
echo "==================================================="
echo "  $ok verde(s), ${#falhas[@]} falha(s)"
if [ ${#falhas[@]} -gt 0 ]; then
  printf '  %s\n' "${falhas[@]}"
  echo
  echo "  Saída completa em: $LOGS"
  echo
  echo "  Antes de assumir que a culpa é da sua mudança, checar as três"
  echo "  outras causas (ocorrência #15): a regra mudou de propósito e o"
  echo "  teste ficou para trás; o teste mede um proxy que mudou de forma"
  echo "  (contar <tr> numa tabela que ganhou linha de grupo ou de detalhe);"
  echo "  ou o teste sempre foi vermelho e ninguém rodou a bateria inteira."
  echo "  Rodar a mesma suíte contra o build anterior responde isso em"
  echo "  minutos: git stash && python3 build_arquivo_unico.py"
  exit 1
fi
echo "  Bateria inteira verde."
echo "==================================================="
rm -rf "$LOGS"
