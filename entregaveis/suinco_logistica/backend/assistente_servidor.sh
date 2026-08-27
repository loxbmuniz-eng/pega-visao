#!/usr/bin/env bash
#
# ASSISTENTE DO SERVIDOR — Embarque Suinco
#
# Existe porque quatro coisas só o Luis pode fazer, e todas as vezes elas
# viraram comando colado por mensagem: subir a metade de servidor de uma
# correção, limpar as duplicadas da Montagem, provar que o backup restaura
# e trocar a senha de root.
#
# Rode DENTRO do servidor, logado como root:
#
#     ssh root@2.25.95.253
#     bash /opt/suinco-src/entregaveis/suinco_logistica/backend/assistente_servidor.sh
#
# Ele pergunta antes de tudo que apaga, mostra o que vai acontecer, e no
# fim imprime um bloco COPIE DAQUI para colar de volta na conversa — é com
# esse bloco que o registro de migrações sobe.
#
# NÃO usa sudo em lugar nenhum: nesta máquina o acesso é root direto.
#
# A biblioteca abaixo vem da skill `wizard` e não se edita à mão — exceto as
# frases que o operador LÊ, que foram traduzidas: entregar tela em inglês
# para quem opera o pátio seria entregar torto. A estrutura é a original.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Wizard library: delightful, consistent UX, identical across every wizard.
# ──────────────────────────────────────────────────────────────────────────

if [[ -t 1 ]] && command -v tput >/dev/null 2>&1 && [[ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  BLUE=$(tput setaf 4); GREEN=$(tput setaf 2); YELLOW=$(tput setaf 3); RED=$(tput setaf 1)
else
  BOLD=""; DIM=""; RESET=""; BLUE=""; GREEN=""; YELLOW=""; RED=""
fi

# Author sets this at the top of the stages section.
TOTAL_STAGES=0

_STAGE_INDEX=0
ENV_FILE="${ENV_FILE:-.env}"
WRITTEN_ENV=()    # KEYs written to ENV_FILE this run
WRITTEN_SECRET=() # secret NAMEs set this run
SKIPPED=()        # things we couldn't do (e.g. gh missing)

# _clear wipes the terminal so only the current step is on screen. No-op when
# output isn't a terminal, so piped logs stay readable.
_clear() {
  [[ -t 1 ]] || return 0
  if command -v tput >/dev/null 2>&1; then tput clear; else printf '\033[2J\033[3J\033[H'; fi
}

# banner "Title" shows the opening frame: what this wizard does.
banner() {
  _clear
  printf '\n%s%s  %s%s\n' "$BOLD" "$BLUE" "$1" "$RESET"
  printf '%s  %s passos%s\n\n' "$DIM" "$TOTAL_STAGES" "$RESET"
  printf '%s  Quem decide é você: cada passo explica o que vai acontecer e pergunta\n' "$DIM"
  printf '  antes de fazer. Pode parar a qualquer momento com Ctrl-C e rodar de novo\n'
  printf '  depois — nada aqui precisa ser feito de uma vez só.%s\n' "$RESET"
  pause "Enter para começar"
}

# stage "Name" clears the screen, then announces a stage and shows progress.
# Clearing keeps only the current step on screen.
stage() {
  _clear
  _STAGE_INDEX=$((_STAGE_INDEX + 1))
  printf '\n%s%s▸ Stage %s/%s · %s%s\n' \
    "$BOLD" "$BLUE" "$_STAGE_INDEX" "$TOTAL_STAGES" "$1" "$RESET"
}

# say "..." prints a plain instruction line.
say()  { printf '  %s\n' "$1"; }
# step "..." is a numbered-feeling action the human takes in the browser.
step() { printf '  %s•%s %s\n' "$BLUE" "$RESET" "$1"; }
note() { printf '  %s%s%s\n' "$DIM" "$1" "$RESET"; }
warn() { printf '  %s⚠ %s%s\n' "$YELLOW" "$1" "$RESET"; }

# open_url URL opens it in the human's browser, cross-platform incl. WSL.
open_url() {
  local url="$1"
  printf '  %s↗ opening%s %s\n' "$GREEN" "$RESET" "$url"
  { if   command -v wslview     >/dev/null 2>&1; then wslview "$url"
    elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url"
    elif command -v xdg-open    >/dev/null 2>&1; then xdg-open "$url"
    elif command -v open        >/dev/null 2>&1; then open "$url"
    else warn "couldn't open a browser; visit it manually: $url"; fi
  } >/dev/null 2>&1 || warn "couldn't open a browser, so visit it manually: $url"
}

# pause "msg" waits for the human to confirm they've done the manual part.
pause() {
  printf '  %s%s%s ' "$DIM" "${1:-Press Enter to continue}" "$RESET"
  read -r _ || true
}

# confirm "question" is a y/N gate; returns success on yes.
confirm() {
  local reply=""
  printf '  %s? %s [y/N] ' "$YELLOW" "$1"
  read -r reply || true
  [[ "$reply" =~ ^[Yy] ]]
}

# _existing KEY: current value of KEY in ENV_FILE, if any.
_existing() {
  [[ -f "$ENV_FILE" ]] || return 1
  local line; line=$(grep -E "^${1}=" "$ENV_FILE" | tail -n1) || return 1
  printf '%s' "${line#*=}"
}

# ask KEY "Prompt" reads a value into $KEY. Offers the existing .env value as
# a default on re-runs (Enter keeps it). Visible input (non-secret).
ask() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -r input || true
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# ask_secret KEY "Prompt" is like ask, but input is hidden.
ask_secret() {
  local key="$1" prompt="$2" current input
  current=$(_existing "$key" || true)
  if [[ -n "$current" ]]; then
    printf '  %s%s%s %s[Enter keeps current]%s ' "$BOLD" "$prompt" "$RESET" "$DIM" "$RESET"
  else
    printf '  %s%s%s ' "$BOLD" "$prompt" "$RESET"
  fi
  read -rs input || true
  printf '\n'
  [[ -z "$input" && -n "$current" ]] && input="$current"
  printf -v "$key" '%s' "$input"
}

# write_env KEY VALUE upserts KEY=VALUE into ENV_FILE (creates it; replaces
# any existing line). Idempotent.
write_env() {
  local key="$1" value="$2" tmp
  touch "$ENV_FILE"
  tmp=$(mktemp)
  grep -vE "^${key}=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$ENV_FILE"
  WRITTEN_ENV+=("$key")
  printf '  %s✓ wrote%s %s → %s\n' "$GREEN" "$RESET" "$key" "$ENV_FILE"
}

# set_secret NAME VALUE sets a GitHub Actions repo secret via gh. Falls back
# to a warning (and records it) if gh is unavailable or unauthenticated.
set_secret() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if printf '%s' "$value" | gh secret set "$name" >/dev/null 2>&1; then
      WRITTEN_SECRET+=("$name")
      printf '  %s✓ set%s GitHub secret %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub secret $name (set it manually: gh secret set $name)")
  warn "skipped GitHub secret $name: gh not ready; set it later"
}

# set_var NAME VALUE sets a GitHub Actions repo variable (non-secret).
set_var() {
  local name="$1" value="$2"
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if gh variable set "$name" --body "$value" >/dev/null 2>&1; then
      printf '  %s✓ set%s GitHub variable %s\n' "$GREEN" "$RESET" "$name"
      return
    fi
  fi
  SKIPPED+=("GitHub variable $name")
  warn "skipped GitHub variable $name, gh not ready; set it later"
}

# finish clears, then shows a closing summary of everything configured.
finish() {
  _clear
  printf '\n%s%s  ✓ Assistente concluído%s\n' "$BOLD" "$GREEN" "$RESET"
  (( ${#WRITTEN_ENV[@]} ))    && note "gravou ${#WRITTEN_ENV[@]} valor(es) em $ENV_FILE: ${WRITTEN_ENV[*]}"
  (( ${#WRITTEN_SECRET[@]} )) && note "definiu ${#WRITTEN_SECRET[@]} segredo(s) no GitHub: ${WRITTEN_SECRET[*]}"
  if (( ${#SKIPPED[@]} )); then
    printf '\n'; warn "ainda falta fazer à mão:"
    for s in "${SKIPPED[@]}"; do note "  - $s"; done
  fi
  printf '\n'
}

# ──────────────────────────────────────────────────────────────────────────
# ──────────────────────────────────────────────────────────────────────────
# OS PASSOS
# ──────────────────────────────────────────────────────────────────────────

TOTAL_STAGES=6

SRC="/opt/suinco-src"
BASE="$SRC/entregaveis/suinco_logistica/backend"
FEITO_ATUALIZAR="não"
FEITO_LIMPEZA="não"
FEITO_BACKUP="não"
FEITO_SENHA="não"
FEITO_MONITOR="não"

banner "Assistente do Servidor — Embarque Suinco"

# ── 1. Onde estamos ───────────────────────────────────────────────────────
stage "Onde o servidor está agora"
say "Antes de mexer, o retrato do que está rodando. Nada aqui altera nada."
if [[ ! -d "$SRC" ]]; then
  warn "Não achei $SRC. Você está no servidor certo? Se não estiver, saia (Ctrl+C)."
  pause "Enter para continuar assim mesmo"
fi
printf '\n'
step "Commit no servidor:"
say "  $(cd "$SRC" 2>/dev/null && git log -1 --format='%h  %s' 2>/dev/null || echo '(não consegui ler)')"
step "Serviço:"
say "  $(systemctl is-active embarque-suinco 2>/dev/null || echo '(não consegui ler)')"
step "Saúde local:"
say "  HTTP $(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3010/health 2>/dev/null || echo '000')"
step "Última migração registrada no repositório:"
say "  $(head -1 "$BASE/migrations/APLICADAS_EM_PRODUCAO.txt" 2>/dev/null || echo '(não consegui ler)')"
printf '\n'
pause

# ── 2. Subir o código e as migrações ──────────────────────────────────────
stage "Subir o código e as migrações (atualizar.sh)"
say "Puxa o código novo, aplica as migrações que faltam, reinstala o que"
say "mudou, reinicia o serviço e roda o diagnóstico."
printf '\n'
warn "O serviço reinicia. São alguns segundos com o painel sem servidor."
say "Quem estiver com a tela aberta continua vendo; gravação nesse instante"
say "entra na fila e sobe sozinha depois."
printf '\n'
if confirm "Rodar o atualizar.sh agora?"; then
  printf '\n'
  if (cd "$SRC" && git pull && bash "$BASE/atualizar.sh"); then
    FEITO_ATUALIZAR="sim"
  else
    warn "O atualizar.sh reclamou. LEIA a saída acima antes de seguir."
    pause "Enter quando tiver lido"
  fi
else
  say "Pulado. O painel pode mostrar coisa que o servidor ainda não sabe fazer."
fi
printf '\n'
pause

# ── 3. As linhas duplicadas da Montagem ───────────────────────────────────
stage "Limpar as linhas duplicadas da Montagem"
say "São as linhas repetidas que entraram na Montagem do dia antes da"
say "correção. A correção impede duplicata NOVA; não apaga o que já está lá."
printf '\n'
step "Só sai linha VAZIA: sem placa, sem número, sem peso, sem motorista,"
step "não efetivada, não cancelada, e com irmã mais antiga do mesmo dia,"
step "mesma rota e mesmo destino."
step "O script MOSTRA a lista e pergunta antes de apagar qualquer coisa."
printf '\n'
warn "Este passo APAGA linha de programação. Nenhum dado de carga é tocado."
printf '\n'
if confirm "Abrir a limpeza (ela ainda vai te mostrar antes de apagar)?"; then
  printf '\n'
  if bash "$BASE/atualizar_tudo.sh"; then
    FEITO_LIMPEZA="sim"
    FEITO_BACKUP="sim"
  else
    warn "O passo a passo parou. Leia a saída acima."
    pause "Enter quando tiver lido"
  fi
  say "O atualizar_tudo.sh faz a limpeza E a prova do backup, em sequência."
else
  say "Pulado. As duplicadas continuam na Montagem."
fi
printf '\n'
pause

# ── 4. Trocar a senha de root ─────────────────────────────────────────────
stage "Trocar a senha de root"
say "A senha atual foi digitada numa conversa e precisa deixar de valer."
say "Quem tem o texto daquela conversa tem o servidor."
printf '\n'
step "O comando abaixo pede a senha nova duas vezes e não mostra na tela."
step "Escolha uma que você NÃO tenha usado em outro lugar."
step "Guarde num gerenciador de senhas, não num papel nem em mensagem."
printf '\n'
warn "Se você errar e esquecer a senha nova, entra pelo painel da Hostinger."
printf '\n'
if confirm "Trocar a senha de root agora?"; then
  printf '\n'
  if passwd root; then
    FEITO_SENHA="sim"
    printf '\n'
    say "Trocada. A senha antiga não vale mais."
  else
    warn "A troca não completou. Rode 'passwd root' de novo quando puder."
  fi
else
  say "Pulado. A senha exposta continua valendo."
fi
printf '\n'
pause

# ── 5. O monitor externo ──────────────────────────────────────────────────
stage "Avisar você se o servidor cair (UptimeRobot)"
say "Hoje, se o servidor cair de madrugada, ninguém fica sabendo até alguém"
say "reclamar. Isto resolve, e é de graça."
printf '\n'
warn "Este passo é no CELULAR ou no computador — não aqui no servidor."
say "Por isso o assistente não abre o navegador: você está dentro do VPS."
printf '\n'
step "1. Em uptimerobot.com, criar conta no plano gratuito."
step "2. Instalar o aplicativo UptimeRobot no celular e entrar na mesma conta."
step "   É ele que faz o aviso chegar; sem ele, só vai e-mail."
step "3. Add New Monitor, com:"
say "      Tipo      HTTP(s)"
say "      Nome      API Embarque Suinco"
say "      URL       https://api.embarquesuinco.com.br/health"
say "      Intervalo 5 minutos"
step "4. Nos alertas do monitor, marcar o aplicativo (Mobile Push) E o e-mail."
step "5. Se aparecer 'Keyword monitoring', trocar o tipo para Keyword:"
say "      palavra          \"ok\":true"
say "      alertar quando   a palavra NÃO existir"
say "   Sem isso o monitor só vê que o endereço respondeu — com isso ele vê"
say "   também quando o servidor responde DIZENDO que está com problema."
printf '\n'
if confirm "Monitor criado e testado?"; then
  FEITO_MONITOR="sim"
else
  say "Fica pendente. Está escrito em docs/ALERTA_DE_QUEDA.md."
fi
printf '\n'
pause

# ── Fecho: o bloco para colar de volta ────────────────────────────────────
stage "O bloco para mandar de volta"
say "Copie tudo entre as linhas e cole na conversa. É com ele que o registro"
say "de migrações sobe — sem ele, nada é dado como feito."
printf '\n'
printf -- '--------- COPIE DAQUI ---------\n'
printf 'assistente rodado em : %s\n' "$(date '+%d/%m/%Y %H:%M')"
printf 'commit no servidor   : %s\n' "$(cd "$SRC" 2>/dev/null && git log -1 --format=%h 2>/dev/null || echo '?')"
printf 'serviço              : %s\n' "$(systemctl is-active embarque-suinco 2>/dev/null || echo '?')"
printf '/health local        : %s\n' "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3010/health 2>/dev/null || echo '000')"
printf 'migrações aplicadas  : %s\n' "$(cd "$BASE" 2>/dev/null && ls migrations/*.sql 2>/dev/null | tail -1 | xargs -r basename || echo '?')"
printf 'atualizar.sh         : %s\n' "$FEITO_ATUALIZAR"
printf 'limpeza duplicadas   : %s\n' "$FEITO_LIMPEZA"
printf 'prova do backup      : %s\n' "$FEITO_BACKUP"
printf 'senha de root trocada: %s\n' "$FEITO_SENHA"
printf 'monitor externo      : %s\n' "$FEITO_MONITOR"
printf -- '-------- ATÉ AQUI -------------\n'
printf '\n'

finish
