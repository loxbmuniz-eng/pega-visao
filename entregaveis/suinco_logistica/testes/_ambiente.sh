# shellcheck shell=bash
# =====================================================================
# O VIGIA DA BATERIA — banco local e API de teste de pé (08/10/2026)
# ---------------------------------------------------------------------
# Pedido do dono: "deixa um vigia pra não morrer a bateria de novo".
# Decisão dele: religa sozinho e anota.
#
# O que acontecia: este ambiente é um contêiner que reinicia sem avisar, e
# o reinício derruba o Postgres local e a API de teste — nenhum dos dois
# volta sozinho. O publicar.sh religava os dois, mas SÓ NO COMEÇO; o
# rodar_tudo.sh não religava nada: com a API caída ele parava, e com o
# banco caído no meio cada suíte seguinte reprovava por "conexão recusada"
# — vermelho que não diz nada sobre o código. Em 08/10/2026 uma rodada
# inteira de prova se perdeu assim.
#
# Uma função, dois chamadores: o publicar.sh (passos 3b e 5) e o
# rodar_tudo.sh (no começo, antes de cada suíte que fala com o servidor e
# depois de cada uma que reprova) chamam ESTAS. Tudo o que o vigia faz sai
# na tela com "[vigia]" e fica anotado em $LOGS/.vigia, quando há $LOGS.
#
# SÓ O LOCAL: o rodar_tudo.sh recusa PGHOST que não seja da máquina antes
# de chegar aqui, e a API é sempre 127.0.0.1. Nada disto toca a produção.
#
# Quem carrega precisa ter definido AQUI (a pasta suinco_logistica) e
# carregado o backend/.env (set -a; . backend/.env).
# =====================================================================

PORTA_TESTE="${PORTA_TESTE:-${PORT:-3000}}"
API_LOG="${API_LOG:-/tmp/suinco-api-teste.log}"

anotar_vigia() {
  printf '  [vigia] %s\n' "$*"
  [[ -n "${LOGS:-}" && -d "${LOGS:-}" ]] && printf '%s\n' "$*" >> "$LOGS/.vigia"
  return 0
}

# --- o banco ----------------------------------------------------------
banco_no_ar() { pg_isready -q -t 3 2>/dev/null; }

# Sobe o cluster local (o primeiro da lista — nesta máquina, 16/main) e
# aplica as migrações que faltarem: banco que volta sem a migração nova
# faz a suíte reprovar por coluna que não existe.
subir_banco() {
  local versao nome
  read -r versao nome _ < <(pg_lsclusters -h 2>/dev/null | head -1)
  pg_ctlcluster "${versao:-16}" "${nome:-main}" start >/dev/null 2>&1 || true
  local _i
  for _i in $(seq 1 20); do banco_no_ar && break; sleep 1; done
  banco_no_ar || return 1
  ( cd "$AQUI/backend" && node scripts/migrar.js >/dev/null 2>&1 ) || return 1
  return 0
}

# --- a API de teste ---------------------------------------------------
# "No ar" quer dizer responde E gera PDF (a lição de 26/08/2026: API subida
# sem o Chromium parece inteira e reprova toda suíte de relatório).
api_no_ar() {
  local corpo
  corpo="$(curl -sf --max-time 3 "http://127.0.0.1:$PORTA_TESTE/health" 2>/dev/null)" || return 1
  [[ "$corpo" == *'"pronto":true'* ]]
}

# E "inteira", para o portão, quer dizer também DO COMMIT CERTO (11/09/2026):
# o /health diz qual commit o servidor carregou.
api_inteira() {
  local corpo head_curto
  corpo="$(curl -sf --max-time 3 "http://127.0.0.1:$PORTA_TESTE/health" 2>/dev/null)" || return 1
  [[ "$corpo" == *'"pronto":true'* ]] || return 1
  head_curto="$(git -C "$AQUI" rev-parse --short HEAD 2>/dev/null)"
  [[ -z "$head_curto" || "$corpo" == *"$head_curto"* ]]
}

# O `exec` e o redirecionamento do bloco INTEIRO não são detalhe (08/10/2026).
# Na forma antiga — `( cd … && nohup node … > log & )` — sobrava um bash
# intermediário esperando a API, com a saída de quem chamou ainda aberta. Quem
# lia essa saída por cano (`| tail`, o subprocess de um teste) esperava para
# sempre: a bateria "terminava" e o terminal não voltava. Com `exec`, o bloco
# vira a própria API, e nada fica preso a quem a chamou.
subir_api() {
  ( cd "$AQUI/backend" || exit 1
    export PLAYWRIGHT_CHROMIUM_PATH="${PLAYWRIGHT_CHROMIUM_PATH:-/opt/pw-browsers/chromium}" PORT="$PORTA_TESTE"
    exec nohup node src/servidor.js ) > "$API_LOG" 2>&1 < /dev/null &
  local _i
  for _i in $(seq 1 30); do api_no_ar && return 0; sleep 1; done
  return 1
}

# Derruba a API de teste DESTA porta — achada por quem escuta nela, e não
# por `pkill -f`: o padrão por texto já casou com o shell que o chamou e
# matou a própria sessão ("exit 144"), e derrubaria também a API de outra
# porta que uma suíte subiu para si (test_usuarios_com_senha, na 3019).
#
# QUEM ESCUTA, COM `ss` OU COM `lsof` (09/10/2026, ocorrência #132). Um
# contêiner novo veio sem o `ss` (pacote iproute2): o laço não achava
# ninguém, a API velha ficava de pé, a nova não subia (porta ocupada) e o
# portão cancelou no passo 5; o test_vigia_da_bateria reprovou pelo mesmo
# motivo. Sem nenhum dos dois, ANOTA (na saída de erro: a de cima é a lista
# de PIDs) — não achar ninguém em silêncio é que era o defeito.
quem_escuta_na_porta() {
  if command -v ss >/dev/null 2>&1; then
    ss -lptnH "sport = :$PORTA_TESTE" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u
  elif command -v lsof >/dev/null 2>&1; then
    lsof -t -iTCP:"$PORTA_TESTE" -sTCP:LISTEN 2>/dev/null | sort -u
  else
    anotar_vigia "sem ss nem lsof nesta máquina: não sei quem escuta na porta $PORTA_TESTE (apt-get install iproute2)" >&2
  fi
}

derrubar_api() {
  local pid
  for pid in $(quem_escuta_na_porta); do
    kill "$pid" 2>/dev/null || true
  done
  sleep 2
}

# --- o vigia ----------------------------------------------------------
# Religa o que estiver caído e anota. Devolve 0 se tudo está de pé no fim;
# 1 se não conseguiu. `$1` = onde estava (para a anotação dizer quando).
garantir_ambiente() {
  local onde="${1:-}"
  local quando=""
  [[ -n "$onde" ]] && quando=" ($onde)"
  if ! banco_no_ar; then
    if subir_banco; then anotar_vigia "o banco local estava fora do ar e foi religado$quando"
    else anotar_vigia "o banco local está fora do ar e NÃO voltou$quando"; return 1; fi
  fi
  if ! api_no_ar; then
    if curl -sf --max-time 3 "http://127.0.0.1:$PORTA_TESTE/health" >/dev/null 2>&1; then
      derrubar_api   # no ar mas sem o gerador de PDF: sobe do jeito certo
    fi
    if subir_api; then anotar_vigia "a API de teste (porta $PORTA_TESTE) estava fora do ar e foi religada$quando"
    else anotar_vigia "a API de teste (porta $PORTA_TESTE) está fora do ar e NÃO voltou$quando — log em $API_LOG"; return 1; fi
  fi
  return 0
}

# Banco e API respondendo, sem religar nada — a pergunta de depois de uma
# suíte reprovar: "foi o ambiente que caiu no meio dela?"
ambiente_de_pe() { banco_no_ar && api_no_ar; }
