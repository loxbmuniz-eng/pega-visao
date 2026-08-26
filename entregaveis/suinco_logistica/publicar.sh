#!/usr/bin/env bash
# =====================================================================
# PORTÃO DE PUBLICAÇÃO — Embarque Suinco
# ---------------------------------------------------------------------
# Existe por causa de uma cobrança do Luis, em 26/08/2026:
#
#   "não adianta nada eu confiar em você aqui e você me falar que foi erro
#    seu e que você OMITIU algo de mim"
#
# Ele está certo. Pedido de desculpas não é controle. Nas duas semanas
# anteriores três problemas chegaram na operação pela MESMA porta: uma
# mudança subiu no painel dependendo de algo que o servidor ainda não
# tinha, e o aviso disso dependia de eu lembrar de dar.
#
#   · 25/08 — botão "Excluir usuário" publicado sem a rota no servidor;
#             o Luis clicou e leu "Rota não encontrada".
#   · 25/08 — de-duplicação da montagem casando por uma coluna que a
#             migração 035 cria; sem ela nada casava e o dia inteiro
#             duplicou (53 linhas).
#   · 26/08 — o mesmo, de novo, porque na lista de pendências que eu
#             escrevi a duplicação simplesmente não estava.
#
# Este script tira isso da memória e põe na máquina. Ele NÃO publica se
# alguma checagem falhar, e IMPRIME o texto das pendências que precisa ser
# repassado — não dá para publicar e esquecer de contar.
#
#     bash entregaveis/suinco_logistica/publicar.sh
#
# Nada aqui toca produção. O que ele faz é rodar as provas e, se tudo
# passar, fazer o merge na branch que o Vercel publica.
# =====================================================================

set -Eeuo pipefail

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
TRABALHO="claude/suinco-logistics-migration-z0k521"
ENTREGA="claude/pega-visao-up19-deliverables-6cqhjb"

vermelho() { printf '\033[0;31m%s\033[0m\n' "$*"; }
verde()    { printf '\033[0;32m%s\033[0m\n' "$*"; }
titulo()   { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

falhou() { vermelho "  X  $*"; echo; vermelho "PUBLICAÇÃO CANCELADA."; exit 1; }

cd "$RAIZ"

titulo "1. Branch de trabalho"
ATUAL="$(git rev-parse --abbrev-ref HEAD)"
[[ "$ATUAL" == "$TRABALHO" ]] || falhou "você está em '$ATUAL'; o trabalho é feito em '$TRABALHO'."
verde "  ok  $ATUAL"

titulo "2. Nada solto fora do commit"
# Publicar com arquivo por commitar publica o que está no GIT, não o que
# está no disco — e a diferença só aparece quando alguém procura o bug numa
# linha que não existe lá.
if [[ -n "$(git status --porcelain)" ]]; then
  git status --short | sed 's/^/      /'
  falhou "há mudanças não commitadas."
fi
verde "  ok  árvore limpa"

titulo "3. O index.html corresponde às fontes"
# O painel é um arquivo só, gerado. Publicar sem regerar sobe a versão
# ANTERIOR do código com a mensagem da nova — o pior tipo de mentira,
# porque o commit diz uma coisa e o navegador roda outra.
cd "$AQUI"
python3 build_arquivo_unico.py >/dev/null || falhou "o build falhou."
cd "$RAIZ"
if [[ -n "$(git status --porcelain -- '*/index.html' '*/sw.js')" ]]; then
  falhou "o index.html/sw.js mudou ao regerar — faltou rodar o build antes de commitar."
fi
verde "  ok  build em dia"

titulo "4. Testes do servidor"
( cd "$AQUI/backend" && npm run teste >/tmp/suinco-teste-backend.txt 2>&1 ) \
  || { tail -25 /tmp/suinco-teste-backend.txt; falhou "testes do servidor reprovaram."; }
verde "  ok  $(grep -E '^# pass' /tmp/suinco-teste-backend.txt | head -1)"

titulo "5. Bateria de tela"
( cd "$AQUI" && bash testes/rodar_tudo.sh >/tmp/suinco-bateria.txt 2>&1 ) \
  || { tail -25 /tmp/suinco-bateria.txt; falhou "a bateria reprovou."; }
grep -q "0 falha(s)" /tmp/suinco-bateria.txt \
  || { tail -25 /tmp/suinco-bateria.txt; falhou "a bateria tem falhas."; }
verde "  ok  $(grep -E 'verde\(s\)' /tmp/suinco-bateria.txt | tail -1 | sed 's/^ *//')"

# ---------------------------------------------------------------------
# 6. A TRAVA QUE ESTE SCRIPT EXISTE PARA APLICAR.
#
# Toda migração nova precisa declarar, no cabeçalho, o que acontece no
# painel ENQUANTO ela não sobe. A linha tem esta forma:
#
#     -- SEM ESTA MIGRAÇÃO: a montagem do dia continua duplicando linhas.
#
# Sem a declaração o script não publica. Com ela, o texto é impresso no
# fim, e é esse texto que precisa ser repassado ao Luis junto com o aviso
# de rodar o atualizar.sh. A omissão deixa de ser possível por esquecimento.
# ---------------------------------------------------------------------
titulo "6. Migrações pendentes declaram o que quebra sem elas"
# A pergunta certa NÃO é "esta publicação traz migração nova?" — é "o que o
# SERVIDOR ainda não tem?". Foi assim que a primeira versão deste passo
# errou: a 035 e a 036 subiram para o repositório em 25/08, seguiram sem
# rodar no servidor, e como já não eram "novas" o portão as daria por
# resolvidas — repetindo em forma de script o esquecimento que ele existe
# para impedir.
#
# A referência é o APLICADAS_EM_PRODUCAO.txt, que guarda até onde o
# servidor foi de fato atualizado. Tudo acima disso é pendente, venha da
# publicação de hoje ou da semana passada.
MARCA="$AQUI/backend/migrations/APLICADAS_EM_PRODUCAO.txt"
[[ -f "$MARCA" ]] || falhou "falta $MARCA — sem ele não dá para saber o que o servidor tem."
APLICADA="$(head -1 "$MARCA" | tr -d '[:space:]')"
[[ "$APLICADA" =~ ^[0-9]+$ ]] || falhou "a primeira linha de APLICADAS_EM_PRODUCAO.txt precisa ser o número da migração."
echo "      servidor está na migração $APLICADA"

PENDENTES=""
QUANTAS=0
for m in "$AQUI"/backend/migrations/*.sql; do
  NUM="$(basename "$m" | cut -d_ -f1)"
  [[ "$NUM" =~ ^[0-9]+$ ]] || continue
  # 10#$NUM força base decimal: "035" em base 8 seria outro número, e
  # "038" nem existiria em octal — o script morreria sozinho em setembro.
  (( 10#$NUM > 10#$APLICADA )) || continue
  QUANTAS=$(( QUANTAS + 1 ))
  if ! grep -qi '^-- SEM ESTA MIGRAÇÃO:' "$m"; then
    vermelho "      $(basename "$m") — falta a linha '-- SEM ESTA MIGRAÇÃO: <o que quebra>'"
    falhou "migração pendente sem declaração de consequência."
  fi
  LINHA="$(grep -i '^-- SEM ESTA MIGRAÇÃO:' "$m" | head -1 | sed 's/^-- SEM ESTA MIGRAÇÃO: *//I')"
  PENDENTES+="  · $(basename "$m"): $LINHA"$'\n'
done

if (( QUANTAS == 0 )); then
  verde "  ok  nenhuma migração pendente"
else
  verde "  ok  $QUANTAS pendente(s), todas com a consequência declarada"
fi

titulo "7. Publicando"
git checkout "$ENTREGA" >/dev/null 2>&1
git merge "$TRABALHO" --no-edit >/dev/null
git push -u origin "$ENTREGA" >/dev/null
git checkout "$TRABALHO" >/dev/null 2>&1
verde "  ok  $ENTREGA atualizada — o Vercel sobe em instantes"

echo
echo "====================================================================="
if [[ -n "$PENDENTES" ]]; then
  vermelho "ESTA PUBLICAÇÃO SÓ FUNCIONA POR COMPLETO DEPOIS DO atualizar.sh."
  echo
  echo "Enquanto o servidor não for atualizado:"
  echo
  printf '%s' "$PENDENTES"
  echo
  echo "  ssh root@2.25.95.253"
  echo "  cd /opt/suinco-src && git pull && sudo bash entregaveis/suinco_logistica/backend/atualizar.sh"
  echo
  vermelho "REPASSE ESTE BLOCO AO LUIS. Publicar sem contar isto foi o erro de 25 e 26/08."
else
  verde "Publicação completa — nada depende de atualização do servidor."
fi
echo "====================================================================="
