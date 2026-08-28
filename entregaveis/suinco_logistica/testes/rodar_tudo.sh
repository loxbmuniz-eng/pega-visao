#!/usr/bin/env bash
# Roda a bateria inteira de navegador, com o banco LIMPO antes de cada suíte
# que encosta nele — e as demais em paralelo.
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
# POR QUE DUAS FASES, E POR QUE PARALELO (23/08/2026 — ocorrência #17)
#
# A bateria sequencial passava de uma hora. O ambiente de desenvolvimento é
# um container descartável que pode ser reciclado a qualquer momento: numa
# execução ele morreu em 57 de 98, e o resultado inteiro se perdeu — não por
# teste vermelho, por tempo de parede. Bateria que não cabe na janela do
# ambiente é bateria que não termina, e bateria que não termina não protege
# ninguém.
#
# A conta que resolveu: só 34 das 99 suítes falam com o servidor. As outras
# 65 abrem o index.html direto por file:// e não tocam no banco — logo não
# disputam estado entre si e podem correr juntas. Fase 1 roda essas em
# paralelo; fase 2 roda as do servidor uma a uma, com a limpeza de sempre.
#
# A classificação é FEITA NA HORA, por grep no próprio arquivo do teste.
# Lista fixa aqui envelheceria: bastaria alguém escrever uma suíte nova que
# fala com a API para ela cair no balde errado e passar a poluir o banco de
# outra — exatamente o defeito que a limpeza existe para evitar.
#
# NÃO aponta para produção: usa backend/.env, que é o Postgres local
# descartável. Se algum dia .env apontar para a VPS, este script apaga o
# pátio inteiro — daí a checagem de PGHOST logo abaixo.
#
#   bash testes/rodar_tudo.sh              # tudo
#   bash testes/rodar_tudo.sh mobile       # só as que casam com "mobile"
#   PARALELO=1 bash testes/rodar_tudo.sh   # força tudo sequencial (depuração)
set -uo pipefail
cd "$(dirname "$0")/.."

[ -f backend/.env ] || { echo "backend/.env não encontrado."; exit 1; }
set -a; . ./backend/.env; set +a

case "${PGHOST:-}" in
  127.0.0.1|localhost|'') : ;;
  *) echo "RECUSADO: PGHOST=$PGHOST não é local. Este script APAGA dados."; exit 1 ;;
esac

export PLAYWRIGHT_CHROMIUM_PATH="${PLAYWRIGHT_CHROMIUM_PATH:-/opt/pw-browsers/chromium}"
# O SERVIDOR PRECISA ESTAR INTEIRO ANTES DE COMEÇAR (28/08/2026).
#
# Três suítes reprovaram numa bateria de 121 e as três passavam sozinhas.
# A causa não estava em nenhuma delas: a API tinha sido reiniciada sem
# PLAYWRIGHT_CHROMIUM_PATH, e o gerador de PDF ficou fora do ar. Quem
# exporta relatório recebia um download que nunca chegava, e o relatório
# do erro apontava para o teste.
#
# A checagem custa um curl. Não custa nada perto de meia hora
# investigando o teste errado — e, principalmente, não depende de alguém
# lembrar. O aviso é fatal de propósito: bateria que roda com o servidor
# pela metade produz um vermelho que não significa nada.
API="${SUINCO_API:-http://127.0.0.1:3010}"
saude=$(curl -s -m 5 "$API/health" 2>/dev/null || true)
case "$saude" in
  '') echo "  X  a API não respondeu em $API/health."
      echo "      Suba com: cd backend && PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium node src/servidor.js"
      exit 1 ;;
esac
case "$saude" in
  *'"pronto":false'*)
      echo "  X  a API está no ar, mas o gerador de PDF NÃO."
      echo "      Toda suíte que exporta relatório vai reprovar sem ter defeito."
      echo "      Reinicie a API com PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium."
      exit 1 ;;
esac

FILTRO="${1:-}"
# Um navegador por processo pesa ~300MB. Teto no número de núcleos para não
# transformar paralelismo em disputa de CPU — teste lento estoura o timeout
# e vira vermelho falso, que é pior que teste demorado.
PARALELO="${PARALELO:-$(nproc 2>/dev/null || echo 2)}"
LOGS=$(mktemp -d)
export LOGS

# A LIMPEZA PRECISA ACONTECER — E RECLAMAR SE NÃO ACONTECER (27/08/2026).
#
# Esta função rodava `psql` direto, sem usuário e sem banco, com o erro
# jogado no lixo. Como root não é papel do Postgres nesta máquina, ela
# FALHAVA TODAS AS VEZES, em silêncio: as suítes de servidor rodavam uma
# atrás da outra num banco que só acumulava. Seis suítes reprovavam no
# portão e passavam sozinhas — e "passa sozinha, falha no portão" é o tipo
# de vermelho que ensina a gente a desconfiar do portão em vez do código.
#
# O `sudo -u postgres` é o mesmo que cada suíte já usa para consultar o
# banco. E a falha agora derruba a bateria: limpeza que falha calada é pior
# que limpeza nenhuma, porque o verde seguinte não significa nada.
limpar_banco(){
  sudo -u postgres psql -q -d embarque_suinco -c \
    "DELETE FROM log_eventos; DELETE FROM fact_statusfrota;
     DELETE FROM fact_viagens; DELETE FROM acoes_criticas;
     DELETE FROM programacao_montagem;" >/dev/null || {
    echo "  X  não consegui limpar o banco de teste — as suítes de servidor"
    echo "      rodariam sujas e o resultado não valeria nada."
    exit 1
  }
}

# Marcadores de que a suíte fala com o servidor. Mantidos aqui e não no
# arquivo de teste porque nenhuma suíte deve precisar se declarar: o que ela
# usa já está escrito nela.
MARCAS='3010|127\.0\.0\.1|localhost'

isoladas=(); comServidor=()
for f in testes/test_*.py testes/auditoria_*.py; do
  [ -f "$f" ] || continue
  [ -n "$FILTRO" ] && [[ "$f" != *"$FILTRO"* ]] && continue
  if grep -qE "$MARCAS" "$f"; then comServidor+=("$f"); else isoladas+=("$f"); fi
done

total=$(( ${#isoladas[@]} + ${#comServidor[@]} ))
[ "$total" -eq 0 ] && { echo "Nenhuma suíte casou com o filtro."; exit 1; }
echo "  $total suíte(s): ${#isoladas[@]} isolada(s) em até $PARALELO em paralelo,"
echo "  ${#comServidor[@]} com servidor, uma a uma."
echo

# Roda uma suíte e imprime o resultado numa linha. Usada nas duas fases.
rodar_uma(){
  f="$1"; nome=$(basename "$f" .py)
  if timeout 300 python3 "$f" > "$LOGS/$nome.txt" 2>&1; then
    printf '%-48s ok\n' "$nome"
  else
    printf '%-48s FALHA\n' "$nome"
    grep -m3 'FALHA' "$LOGS/$nome.txt" | sed 's/^/      /'
    echo "$nome" >> "$LOGS/.falhas"
  fi
}
export -f rodar_uma

# ---- Fase 1: as que não tocam no banco, em paralelo ----
if [ ${#isoladas[@]} -gt 0 ]; then
  printf '%s\n' "${isoladas[@]}" | xargs -P "$PARALELO" -I{} bash -c 'rodar_uma "$@"' _ {}
fi

# ---- Fase 2: as que tocam no banco, uma a uma e com limpeza ----
for f in "${comServidor[@]}"; do
  limpar_banco
  rodar_uma "$f"
done

# ---- Fase 3: SEGUNDA CHANCE, sozinha e com banco limpo (28/08/2026) ----
#
# Regra do dono, depois de esperar uma bateria inteira por um vermelho que
# passava sozinho: "toda bateria precisa ser cumprida e qualquer issue você
# vai focar e resolver antes da bateria finalizar".
#
# "Passa sozinha, falha no portão" não pode ser conclusão de ninguém — é
# trabalho do script. Toda suíte que reprovou volta a rodar UMA vez, sem
# ninguém junto e com o banco limpo. Se passar aqui, o vermelho era
# contaminação ou corrida entre suítes, e isso fica DITO na tela em vez de
# virar meia hora de investigação manual. Se reprovar de novo, é vermelho
# de verdade e a bateria cai — como tem que cair.
if [ -f "$LOGS/.falhas" ]; then
  mapfile -t primeiraLeva < "$LOGS/.falhas"
  if [ ${#primeiraLeva[@]} -gt 0 ]; then
    echo
    echo "  ${#primeiraLeva[@]} suíte(s) reprovaram. Segunda chance, uma a uma, com banco limpo:"
    rm -f "$LOGS/.falhas"
    for nome in "${primeiraLeva[@]}"; do
      arquivo=""
      for f in "${isoladas[@]}" "${comServidor[@]}"; do
        [ "$(basename "$f" .py)" = "$nome" ] && arquivo="$f" && break
      done
      [ -n "$arquivo" ] || { echo "$nome" >> "$LOGS/.falhas"; continue; }
      limpar_banco
      if timeout 300 python3 "$arquivo" > "$LOGS/$nome.txt" 2>&1; then
        printf '  %-46s ok (sozinha) — era contaminação, não regressão\n' "$nome"
      else
        printf '  %-46s FALHA de novo — é vermelho de verdade\n' "$nome"
        grep -m3 'FALHA' "$LOGS/$nome.txt" | sed 's/^/      /'
        echo "$nome" >> "$LOGS/.falhas"
      fi
    done
  fi
fi

falhas=()
[ -f "$LOGS/.falhas" ] && mapfile -t falhas < "$LOGS/.falhas"
ok=$(( total - ${#falhas[@]} ))

echo
echo "==================================================="
echo "  $ok verde(s), ${#falhas[@]} falha(s)"
if [ ${#falhas[@]} -gt 0 ]; then
  printf '  %s\n' "${falhas[@]}"
  echo
  echo "  Saída completa em: $LOGS"
  echo
  echo "  Vermelho tem QUATRO causas. Descubra qual antes de mexer no código:"
  echo "    1. a regra mudou de propósito  -> o teste é que está velho"
  echo "    2. o teste mede um atalho que mudou de forma, não a regra"
  echo "    3. contaminação de outra suíte -> rode ela sozinha e confirme"
  echo "    4. regressão de verdade        -> só aqui se as três acima caírem"
  exit 1
fi
echo "  Bateria completa verde."
