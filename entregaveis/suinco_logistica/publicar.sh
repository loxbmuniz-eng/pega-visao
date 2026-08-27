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
amarelo()  { printf '\033[0;33m%s\033[0m\n' "$*"; }
titulo()   { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

falhou() { vermelho "  X  $*"; echo; vermelho "PUBLICAÇÃO CANCELADA."; exit 1; }

cd "$RAIZ"

# ---------------------------------------------------------------------
# O NAVEGADOR QUE OS TESTES USAM.
#
# Duas partes do sistema abrem um navegador: a bateria de tela (Playwright)
# e o PDF gerado pelo SERVIDOR. Em produção o instalar.sh baixa o Chromium
# com `npx playwright install`; neste ambiente ele já vem em /opt.
#
# Sem apontar o caminho, o serviço de PDF procura um binário que não existe
# aqui e SEIS testes reprovam por motivo de ambiente — não de código. Foi o
# que cancelou a segunda execução deste portão. Deixar assim treinaria
# qualquer um a ignorar vermelho, que é o oposto do que ele existe para
# fazer.
#
# Se o navegador não estiver em lugar nenhum, o portão AVISA e segue: os
# testes vão reprovar de verdade e o cancelamento explica sozinho. O que
# não pode é reprovar em silêncio por falta de um caminho.
# ---------------------------------------------------------------------
if [[ -z "${PLAYWRIGHT_CHROMIUM_PATH:-}" && -x /opt/pw-browsers/chromium ]]; then
  export PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium
fi
if [[ -z "${PLAYWRIGHT_CHROMIUM_PATH:-}" ]]; then
  vermelho "  !  PLAYWRIGHT_CHROMIUM_PATH não definido e /opt/pw-browsers/chromium não existe."
  vermelho "     Os testes de PDF e a bateria de tela vão reprovar por falta de navegador."
fi

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
#
# A COMPARAÇÃO IGNORA O CARIMBO, e isso não é frouxidão: o carimbo é a HORA
# do build, então ele muda a cada execução por definição. A primeira versão
# deste passo comparava o arquivo inteiro e reprovava toda publicação —
# inclusive as corretas. Portão que acusa sempre é portão que alguém
# desliga na terceira vez.
#
# O que interessa é o resto do arquivo: se o código gerado for igual ao
# commitado, o build estava em dia. Se qualquer outra linha mudar, faltou
# rodar o build antes de commitar.
cd "$AQUI"
python3 build_arquivo_unico.py >/dev/null || falhou "o build falhou."
cd "$RAIZ"
DIFERENCA="$(git diff --unified=0 -- '*/index.html' '*/sw.js' \
             | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
             | grep -vE 'SUINCO_BUILD|SUINCO_BUILD_EM|const BUILD =' || true)"
if [[ -n "$DIFERENCA" ]]; then
  printf '%s\n' "$DIFERENCA" | head -12 | sed 's/^/      /'
  falhou "o index.html/sw.js mudou ao regerar — faltou rodar o build antes de commitar."
fi
# O carimbo novo não vai junto na publicação: ele muda a cada build e
# sujaria a árvore. O que vale é o conteúdo, já conferido acima.
git checkout -- '*/index.html' '*/sw.js' 2>/dev/null || true
verde "  ok  build em dia (carimbo à parte)"

titulo "4. Testes do servidor"
( cd "$AQUI/backend" && npm run teste >/tmp/suinco-teste-backend.txt 2>&1 ) \
  || { tail -25 /tmp/suinco-teste-backend.txt; falhou "testes do servidor reprovaram."; }
verde "  ok  $(grep -E '^# pass' /tmp/suinco-teste-backend.txt | head -1)"

# ---------------------------------------------------------------------
# A BATERIA PRECISA DA API NO AR — E ISSO NÃO É ÓBVIO PARA QUEM OLHA O ERRO.
#
# O rodar_tudo.sh não sobe o servidor: ele assume que já está de pé. Em
# 26/08/2026 o contêiner reiniciou no meio do dia e derrubou o processo. A
# bateria seguinte gastou 25 minutos para terminar com UMA suíte vermelha
# (test_torre_acao_e_encerramento, acaoEm/acaoPor/acaoSetor todos nulos) —
# que é exatamente como um dado que não sincroniza se parece.
#
# Vinte e cinco minutos para descobrir que faltava ligar o servidor, e uma
# suíte vermelha que parecia regressão de verdade. O portão precisa
# responder isso em dois segundos, antes de começar.
titulo "5. Servidor de teste no ar"
PORTA_TESTE="$(grep -E '^PORT=' "$AQUI/backend/.env" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')"
PORTA_TESTE="${PORTA_TESTE:-3000}"
# "ESTÁ NO AR" NÃO BASTA — TEM QUE ESTAR INTEIRA.
#
# Segunda lição do mesmo dia, e mais cara que a primeira. Depois de o portão
# passar a conferir se a API respondia, ele encontrou uma no ar e seguiu — só
# que aquela tinha sido subida À MÃO, sem PLAYWRIGHT_CHROMIUM_PATH. Um
# servidor assim responde /health com ok:true, aceita login, grava carga:
# parece inteiro. Só o PDF não sai. Três suítes de relatório reprovaram
# depois de 25 minutos, e por um momento pareceu regressão de verdade.
#
# Por isso a pergunta virou "responde E consegue gerar relatório?". O
# /health passou a dizer isso em `pdf.pronto`. Se estiver no ar mas capenga,
# o portão derruba e sobe do jeito certo — meia dúvida aqui custa a bateria
# inteira lá na frente.
api_inteira() {
  local corpo
  corpo="$(curl -sf --max-time 3 "http://127.0.0.1:$PORTA_TESTE/health" 2>/dev/null)" || return 1
  [[ "$corpo" == *'"pronto":true'* ]]
}

subir_api() {
  ( cd "$AQUI/backend" && PLAYWRIGHT_CHROMIUM_PATH="$PLAYWRIGHT_CHROMIUM_PATH" \
      nohup node src/servidor.js > /tmp/suinco-api-teste.log 2>&1 & )
  for _ in $(seq 1 25); do api_inteira && return 0; sleep 1; done
  return 1
}

if api_inteira; then
  verde "  ok  API no ar na porta $PORTA_TESTE, com Chromium para os PDFs"
else
  if curl -sf --max-time 3 "http://127.0.0.1:$PORTA_TESTE/health" >/dev/null 2>&1; then
    echo "      API no ar, mas SEM Chromium — os relatórios em PDF falhariam."
    echo "      Derrubando e subindo do jeito certo."
    # Padrão ANCORADO. Sem as âncoras, `pkill -f` casa com qualquer shell
    # que tenha esse texto na linha de comando — inclusive o próprio wrapper
    # que está rodando este script. Já aconteceu nesta bancada: o pkill matou
    # a sessão que o chamou e o erro saiu como "exit 144", sem explicação.
    pkill -f '^node src/servidor\.js$' 2>/dev/null || true
    sleep 2
  else
    echo "      API fora do ar — subindo (log em /tmp/suinco-api-teste.log)"
  fi
  subir_api || { tail -15 /tmp/suinco-api-teste.log 2>/dev/null | sed 's/^/      /'
                 falhou "não consegui subir a API de teste inteira na porta $PORTA_TESTE."; }
  verde "  ok  API no ar na porta $PORTA_TESTE, com Chromium para os PDFs"
fi

titulo "6. Bateria de tela"
( cd "$AQUI" && bash testes/rodar_tudo.sh >/tmp/suinco-bateria.txt 2>&1 ) \
  || { tail -25 /tmp/suinco-bateria.txt; falhou "a bateria reprovou."; }
grep -q "0 falha(s)" /tmp/suinco-bateria.txt \
  || { tail -25 /tmp/suinco-bateria.txt; falhou "a bateria tem falhas."; }
verde "  ok  $(grep -E 'verde\(s\)' /tmp/suinco-bateria.txt | tail -1 | sed 's/^ *//')"

# ---------------------------------------------------------------------
# 7. A TRAVA QUE ESTE SCRIPT EXISTE PARA APLICAR.
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
titulo "7. Migrações pendentes declaram o que quebra sem elas"
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

titulo "8. Publicando"
# A BATERIA REGENERA O index.html — e um build regerado tem carimbo novo,
# então a árvore fica suja no fim dos testes mesmo sem ninguém mexer em
# nada. Trocar de branch nesse estado falha, e na primeira execução isso
# aconteceu SEM DIZER NADA: o `git checkout` estava com a saída silenciada,
# o script parou no meio e o resumo final nunca apareceu.
#
# Um portão que falha em silêncio é o defeito que ele existe para impedir,
# escrito dentro dele. Por isso aqui: restaura o que é build, confere que
# não sobrou mais nada solto, e deixa o git falar.
git checkout -- '*/index.html' '*/sw.js' 2>/dev/null || true
if [[ -n "$(git status --porcelain)" ]]; then
  git status --short | sed 's/^/      /'
  falhou "os testes deixaram arquivos alterados que não são build."
fi

git checkout "$ENTREGA" || falhou "não consegui trocar para $ENTREGA."
git merge "$TRABALHO" --no-edit || {
  git merge --abort 2>/dev/null || true
  git checkout "$TRABALHO" 2>/dev/null || true
  falhou "o merge em $ENTREGA deu conflito."
}
git push -u origin "$ENTREGA" || {
  git checkout "$TRABALHO" 2>/dev/null || true
  falhou "o push falhou — a entrega NÃO subiu."
}
git checkout "$TRABALHO" || falhou "publiquei, mas não consegui voltar para $TRABALHO."
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
  echo "  cd /opt/suinco-src && git pull && bash entregaveis/suinco_logistica/backend/atualizar.sh"
  echo
  vermelho "REPASSE ESTE BLOCO AO LUIS. Publicar sem contar isto foi o erro de 25 e 26/08."
else
  verde "Publicação completa — nada depende de atualização do servidor."
fi
echo "====================================================================="

# ---------------------------------------------------------------------
# O QUE CONTINUA ABERTO — e não é migração.
#
# O passo 6 só enxerga migração. Mas em 26/08 o que ficou de fora da
# lista não foi migração nenhuma: foram as 53 linhas duplicadas já
# gravadas, que precisavam de um script à parte. Eu escrevi a lista de
# pendências à mão, esqueci essa, e o Luis descobriu na operação.
#
# Por isso o portão passou a ler o arquivo em vez de confiar em mim: toda
# publicação imprime tudo que está aberto no O_QUE_FALTA_BLINDAR.md, seja
# migração, script, decisão ou informação que falta. Fechar item é editar
# aquele arquivo — não é lembrar.
BLINDAR="$RAIZ/entregaveis/suinco_logistica/docs/O_QUE_FALTA_BLINDAR.md"
if [[ -f "$BLINDAR" ]]; then
  ABERTOS="$(awk '/^## PENDENTE/{p=1;next} /^## ABERTO/{p=1;next} /^## (FEITO|DÍVIDA|Histórico)/{p=0} p && /^### /{sub(/^### /,"");print "  · " $0}' "$BLINDAR")"
  if [[ -n "$ABERTOS" ]]; then
    echo
    amarelo "AINDA EM ABERTO (docs/O_QUE_FALTA_BLINDAR.md):"
    printf '%s\n' "$ABERTOS"
    echo
    echo "  Item só sai dessa lista depois de alguém rodar e ver funcionar."
    echo "====================================================================="
  fi
fi
