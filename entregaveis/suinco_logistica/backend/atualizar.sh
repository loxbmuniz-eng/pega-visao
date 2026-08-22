#!/usr/bin/env bash
# =====================================================================
# EMBARQUE SUINCO — atualizar o servidor com UM comando
# ---------------------------------------------------------------------
# Existe porque a atualização eram cinco comandos em sequência, e errar a
# ordem de um deles deixa o serviço no ar com o banco de outra versão.
# Aqui é um só, e ele confere o resultado sozinho.
#
# No servidor:
#     ssh root@2.25.95.253
#     cd /opt/suinco-src && git pull && sudo bash entregaveis/suinco_logistica/backend/atualizar.sh
#
# O QUE ELE FAZ, nesta ordem:
#   1. baixa o código novo
#   2. roda o instalador (que aplica as migrações e reinicia o serviço)
#   3. roda o diagnóstico
#   4. imprime um resumo curto, pronto para copiar e colar numa conversa
#
# É SEGURO RODAR DE NOVO. Todas as etapas são idempotentes — o instalador
# confere cada coisa antes de fazer. Rodar duas vezes não duplica banco nem
# derruba o serviço.
#
# NÃO IMPRIME SENHA, TOKEN NEM O CONTEÚDO DO .env. O resumo do fim foi feito
# para poder ser colado em qualquer lugar sem revisar linha por linha.
# =====================================================================

set -Eeuo pipefail

SRC="${SRC:-/opt/suinco-src}"
BASE="entregaveis/suinco_logistica/backend"
LOG="/tmp/suinco-atualizacao-$(date +%Y%m%d-%H%M%S).log"

azul()  { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }
ok()    { printf '   \033[0;32mok\033[0m   %s\n' "$*"; }
falha() { printf '   \033[0;31mX\033[0m    %s\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "rode com sudo: sudo bash $0"; exit 1; }

# Tudo que sai daqui vai para a tela E para o arquivo. Se algo quebrar no
# meio, o log inteiro fica salvo — sem depender de alguém ter rolado o
# terminal para trás antes de fechar a janela.
exec > >(tee -a "$LOG") 2>&1

echo "Log completo desta execução: $LOG"

azul "1. Código"
cd "$SRC" || { falha "não achei $SRC — o código está clonado em outro lugar?"; exit 1; }
ANTES="$(git rev-parse --short HEAD)"
# core.editor=true evita o pull abrir o editor de mensagem de merge e
# travar a sessão SSH esperando um :wq que ninguém vai digitar.
git -c core.editor=true pull --no-edit
DEPOIS="$(git rev-parse --short HEAD)"
if [[ "$ANTES" == "$DEPOIS" ]]; then
  ok "já estava na versão mais nova ($DEPOIS)"
else
  ok "atualizado: $ANTES -> $DEPOIS"
fi

azul "2. Instalador (aplica migrações e reinicia)"
bash "$BASE/instalar.sh"

azul "3. Diagnóstico"
bash "$BASE/diagnostico.sh" || true   # o diagnóstico sai != 0 quando acha
                                      # problema; queremos o resumo mesmo assim

azul "4. Resumo"
COMMIT="$(git rev-parse --short HEAD)"
ATIVO="$(systemctl is-active embarque-suinco 2>/dev/null || echo desconhecido)"
# Ver a nota em diagnostico.sh: curl imprime "000" E sai com erro quando
# não conecta; com `|| echo 000` o valor viraria "000 000".
SAUDE="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/health 2>/dev/null || true)"
SAUDE="${SAUDE:-000}"

# As migrações aplicadas são o que decide se a exclusão de carga funciona.
# Sem esta linha, "o serviço está no ar" esconde um banco de outra versão.
#
# Tabela `_migrations`, coluna `arquivo` — os mesmos nomes que o
# diagnostico.sh já usava. Lido pelo psql como postgres, e não por um script
# Node: é a consulta mais simples possível e não depende de o serviço estar
# de pé para responder.
MIG="$(sudo -u postgres psql -d embarque_suinco -tAc \
        'SELECT arquivo FROM _migrations ORDER BY arquivo' 2>/dev/null \
        | paste -sd', ' - || echo 'não consegui ler')"
[[ -n "$MIG" ]] || MIG='nenhuma'

echo
echo "--------- COPIE DAQUI ---------"
echo "commit no servidor : $COMMIT"
echo "serviço            : $ATIVO"
echo "/health local      : $SAUDE"
echo "migrações aplicadas: $MIG"
echo "-------- ATÉ AQUI -------------"
echo

if [[ "$ATIVO" == "active" && "$SAUDE" == "200" ]]; then
  ok "servidor atualizado e respondendo"
else
  falha "algo não subiu — o bloco acima e o log ($LOG) dizem o quê"
  echo "     últimas linhas do serviço:"
  journalctl -u embarque-suinco -n 20 --no-pager || true
fi
