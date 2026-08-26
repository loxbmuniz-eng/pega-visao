#!/usr/bin/env bash
# =====================================================================
# O PASSO A PASSO COMPLETO — num comando só
# ---------------------------------------------------------------------
# Pedido do Luis em 26/08/2026: "faca o passo a passo até completar tudo
# que é necessário no nosso sistema".
#
#     ssh root@2.25.95.253
#     bash /opt/suinco-src/entregaveis/suinco_logistica/backend/atualizar_tudo.sh
#
# O QUE ELE FAZ, na ordem:
#   1. atualizar.sh — puxa o código, aplica as migrações pendentes, gera as
#      chaves do aviso no celular se ainda não existirem, reinstala o que
#      mudou, reinicia o serviço e roda o diagnóstico;
#   2. limpa as linhas duplicadas da Montagem do dia — MOSTRA primeiro e só
#      apaga se você confirmar;
#   3. prova que o backup restaura de verdade, num banco descartável;
#   4. imprime um bloco pronto para mandar de volta.
#
# POR QUE OS TRÊS JUNTOS E NÃO NO atualizar.sh. O passo 1 é rotina de
# toda publicação. O passo 2 APAGA linha, e apagar sem olhar antes é o que
# este painel existe para acabar — por isso pergunta. O passo 3 é conferência
# de vez em quando, não de toda vez. Juntar tudo no atualizar.sh faria a
# rotina pedir confirmação todo dia, e confirmação que se repete todo dia é
# confirmação que ninguém lê.
#
# NADA AQUI APAGA DADO DE CARGA. O passo 2 só remove linha de programação
# VAZIA e repetida; o passo 3 só lê a produção.
# =====================================================================

set -uo pipefail

SRC="${SRC:-/opt/suinco-src}"
BASE="entregaveis/suinco_logistica/backend"
LOG="/tmp/suinco-passo-a-passo-$(date +%Y%m%d-%H%M%S).log"

azul()  { printf '\n\033[1;36m%s\033[0m\n' "== $*"; }
ok()    { printf '   \033[0;32mok\033[0m   %s\n' "$*"; }
falha() { printf '   \033[0;31mX\033[0m    %s\n' "$*"; }
aviso() { printf '   \033[0;33m!\033[0m    %s\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "precisa ser root. Entre como root e rode: bash $0"; exit 1; }

# COMO VIRAR O USUÁRIO postgres, nesta máquina.
#
# O VPS da Suinco NÃO tem sudo instalado — descoberto em 26/08/2026, com o
# dono parado no terminal lendo "command 'sudo' from deb sudo... Try: apt
# install". Escrever `sudo -u postgres` num script que só roda como root é
# depender de um pacote que ninguém prometeu que existe.
#
# `su` vem no sistema base e sempre esteve lá — o instalar.sh já usava só
# ele. Aqui a função tenta o su e cai no sudo se algum dia rodar numa
# máquina onde o postgres não aceite su. Uma função, um lugar para consertar.
como_postgres() {
  if su -s /bin/sh postgres -c 'true' 2>/dev/null; then
    su -s /bin/sh postgres -c "$1"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u postgres sh -c "$1"
  else
    echo "não consegui virar o usuário postgres (nem su nem sudo)" >&2
    return 1
  fi
}

# Consulta de uma linha só, com o SQL vindo pela entrada padrão.
#
# Escrever a consulta INLINE dentro de `su -c "psql -c \"SELECT...\""` é
# empilhar três níveis de aspas, e foi exatamente onde este script quebrou na
# primeira escrita. Com arquivo temporário não há aspa nenhuma para escapar.
consulta() {
  local arq; arq="$(mktemp)"
  cat > "$arq"
  chmod 644 "$arq"          # o usuário postgres precisa conseguir ler
  como_postgres "psql -d embarque_suinco -tA -f '$arq'" 2>/dev/null
  rm -f "$arq"
}


exec > >(tee -a "$LOG") 2>&1
echo "Log completo desta execução: $LOG"

PROBLEMAS=()

# ---------------------------------------------------------------------
azul "PASSO 1 de 3 — código, migrações e reinício"
if bash "$SRC/$BASE/atualizar.sh"; then
  ok "servidor atualizado"
else
  falha "o atualizar.sh reclamou — leia o bloco acima antes de seguir"
  PROBLEMAS+=("atualizacao")
fi

# ---------------------------------------------------------------------
azul "PASSO 2 de 3 — linhas duplicadas da Montagem do dia"
LIMPEZA="$SRC/$BASE/scripts/limpar_montagem_duplicada.sql"
if [[ ! -f "$LIMPEZA" ]]; then
  aviso "não achei $LIMPEZA — pulei"
else
  echo "   Primeiro, o que SAIRIA (nada foi apagado ainda):"
  como_postgres "psql -d embarque_suinco -f '$LIMPEZA'" 2>&1 | sed 's/^/   /'

  # Sem terminal (rodando por cron, por exemplo) não se apaga nada. Uma
  # exclusão que acontece sem ninguém olhando é exatamente o que o script
  # de limpeza foi escrito para evitar.
  if [[ ! -t 0 ]]; then
    aviso "sem terminal interativo — não apaguei nada."
    aviso "para apagar, rode este script à mão, ou:"
    echo  "        su -s /bin/sh postgres -c \"psql -d embarque_suinco -v apagar=1 -f $LIMPEZA\""
  else
    echo
    read -r -p "   Apagar as linhas listadas acima? (digite SIM para apagar) " RESPOSTA
    if [[ "$RESPOSTA" == "SIM" ]]; then
      if como_postgres "psql -d embarque_suinco -v apagar=1 -f '$LIMPEZA'" 2>&1 | sed 's/^/   /'; then
        ok "duplicadas removidas"
      else
        falha "a limpeza deu erro"
        PROBLEMAS+=("limpeza")
      fi
    else
      aviso "nada apagado (você não digitou SIM). Pode rodar de novo quando quiser."
    fi
  fi
fi

# ---------------------------------------------------------------------
azul "PASSO 3 de 3 — o backup restaura mesmo?"
TESTE="$SRC/$BASE/scripts/testar_restauracao_backup.sh"
if [[ ! -f "$TESTE" ]]; then
  aviso "não achei $TESTE — pulei"
else
  if bash "$TESTE"; then
    ok "backup conferido"
  else
    falha "o teste de backup encontrou problema — leia o bloco acima"
    PROBLEMAS+=("backup")
  fi
fi

# ---------------------------------------------------------------------
azul "RESUMO"
COMMIT="$(cd "$SRC" && git rev-parse --short HEAD 2>/dev/null || echo '?')"
ATIVO="$(systemctl is-active embarque-suinco 2>/dev/null || echo desconhecido)"
SAUDE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/health 2>/dev/null || true)"
MIG="$(consulta <<'SQL' || true
SELECT arquivo FROM _migrations ORDER BY arquivo DESC LIMIT 1
SQL
)"
[[ -n "$MIG" ]] || MIG='não consegui ler'

AVISOS="$(grep -qE '^VAPID_PRIVADA=.+' /opt/embarque-suinco/.env 2>/dev/null \
          && echo 'ligado' || echo 'DESLIGADO')"

DUPES="$(consulta <<'SQL' || true
SELECT count(*) FROM programacao_montagem m
 WHERE m.efetivada_em IS NULL AND m.cancelada_em IS NULL
   AND coalesce(m.placa,'') = '' AND coalesce(m.numero_carga,'') = ''
   AND coalesce(m.motorista,'') = '' AND coalesce(m.peso,0) = 0
SQL
)"
[[ -n "$DUPES" ]] || DUPES='?'

echo
echo "--------- COPIE DAQUI ---------"
echo "commit no servidor  : $COMMIT"
echo "serviço             : $ATIVO"
echo "/health local       : ${SAUDE:-000}"
echo "última migração     : $MIG"
echo "aviso no celular    : $AVISOS"
echo "linhas de montagem vazias que sobraram : $DUPES"
echo "problemas nesta rodada : ${PROBLEMAS[*]:-nenhum}"
echo "-------- ATÉ AQUI -------------"
echo

if [[ ${#PROBLEMAS[@]} -eq 0 ]]; then
  ok "tudo feito. Mande o bloco acima."
  exit 0
fi
falha "terminou com ${#PROBLEMAS[@]} ponto(s) para olhar: ${PROBLEMAS[*]}"
echo "     O log inteiro está em $LOG"
exit 1
