# shellcheck shell=bash
# =====================================================================
# CÓDIGO NOVO PRIMEIRO — carregado (source) pelo atualizar.sh e pelo
# atualizar_tudo.sh, logo depois da checagem de root.
# ---------------------------------------------------------------------
# OCORRÊNCIA #97 (30/09/2026). O bash lê o script do arquivo que abriu no
# começo. O `git pull` troca o arquivo no disco, mas o bash continua lendo
# o ANTIGO — então a primeira rodada depois de qualquer mudança nestes
# scripts executava a versão velha. Foi assim que o passo aposentado "apagar
# linha da Montagem? digite SIM" apareceu para o dono numa rodada em que ele
# já não existia.
#
# O QUE ESTA FUNÇÃO FAZ: puxa o código ANTES de qualquer passo e troca o
# processo pela versão recém-baixada do próprio script (`exec`). A versão
# nova chega aqui com SUINCO_CODIGO_PUXADO=1 e segue direto; o commit de
# antes do pull vai junto em SUINCO_ANTES_DO_PULL, para o "atualizado:
# ANTES -> DEPOIS" continuar dizendo de onde para onde o servidor foi.
#
# Uma função, dois chamadores: a mesma decisão nos dois scripts.
# Travado por testes/test_atualizar_roda_a_versao_nova.py.
# =====================================================================

codigo_novo_primeiro() {
  local script_rel="$1"; shift
  [[ -n "${SUINCO_CODIGO_PUXADO:-}" ]] && return 0
  cd "$SRC" || { echo "não achei $SRC — o código está clonado em outro lugar?"; exit 1; }
  local antes
  antes="$(git rev-parse --short HEAD)"
  if ! git -c core.editor=true pull --no-edit; then
    echo "   X    o git pull falhou — nada foi feito. Leia a mensagem acima."
    exit 1
  fi
  export SUINCO_CODIGO_PUXADO=1 SUINCO_ANTES_DO_PULL="$antes"
  exec bash "$SRC/$script_rel" "$@"
}
