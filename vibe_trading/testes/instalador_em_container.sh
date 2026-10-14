#!/usr/bin/env bash
# =====================================================================
# Teste do instalador do VPS num "servidor" falso: systemd, ss, ufw e apt
# simulados; usuario, permissoes, git, pip e a bateria sao reais.
#
# SO EM MAQUINA DESCARTAVEL (container de desenvolvimento). Ele cria e APAGA o
# usuario vibe e a pasta dele. No VPS isso apagaria o vigia e os dados — por
# isso ele se recusa a rodar se: faltar VIBE_TESTE_DESCARTAVEL=1, o systemd
# for o processo 1 (servidor de verdade), ou ja existir usuario vibe ou /opt/vibe.
#
#   VIBE_TESTE_DESCARTAVEL=1 bash testes/instalador_em_container.sh
#
# Testa: instalacao do zero com a Suinco intacta, reinstalacao, atualizacao sem
# versao nova, com versao boa, com versao sabotada (recusada), status e remocao.
# =====================================================================
set -uo pipefail
T=/tmp/vibe-teste
FONTE="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
recusa() { echo "RECUSADO: $*" >&2; exit 2; }
[[ "${VIBE_TESTE_DESCARTAVEL:-}" == "1" ]] || recusa "rode so em maquina descartavel, com VIBE_TESTE_DESCARTAVEL=1"
[[ "$(cat /proc/1/comm 2>/dev/null)" != "systemd" ]] || recusa "o systemd e o processo 1: isto parece um servidor de verdade"
[[ ! -e /opt/vibe ]] || recusa "/opt/vibe existe: isto parece o VPS com o vigia instalado"
! id vibe >/dev/null 2>&1 || recusa "o usuario vibe ja existe: este teste o apagaria"
[[ "$(id -u)" -eq 0 ]] || recusa "precisa de administrador para criar o usuario de teste"
rm -rf "$T"; mkdir -p "$T"/{bin,units,sbin,trab}; chmod 755 "$T"
FALHAS=0
checa() { if eval "$1"; then echo "  ok    $2"; else echo "  FALHA $2"; FALHAS=$((FALHAS+1)); fi; }

# --- comandos de sistema simulados ---------------------------------------
cat > "$T/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> /tmp/vibe-teste/systemctl.log
E=/tmp/vibe-teste/estado_vibe
case "$1" in
  is-active)
    case "$2" in
      embarque-suinco|nginx|postgresql) echo active ;;
      vibe-vigia|vibe-vigia.service) s=$(cat $E 2>/dev/null || echo inactive); echo $s; [[ $s == active ]] || exit 3 ;;
      *) echo active ;;
    esac ;;
  start|restart) [[ "$*" == *vibe-vigia* ]] && echo active > $E ;;
  stop) [[ "$*" == *vibe-vigia* ]] && echo inactive > $E ;;
  disable) [[ "$*" == *vibe-vigia* ]] && echo inactive > $E ;;
esac
exit 0
EOF
printf '#!/usr/bin/env bash\necho "LISTEN 0 511 0.0.0.0:80 0.0.0.0:*"\necho "LISTEN 0 511 0.0.0.0:443 0.0.0.0:*"\necho "LISTEN 0 511 127.0.0.1:3000 0.0.0.0:*"\necho "LISTEN 0 244 127.0.0.1:5432 0.0.0.0:*"\n' > "$T/bin/ss"
printf '#!/usr/bin/env bash\necho "Status: active"\necho "22/tcp ALLOW Anywhere"\n' > "$T/bin/ufw"
printf '#!/usr/bin/env bash\necho "apt-get $*" >> /tmp/vibe-teste/apt.log\n' > "$T/bin/apt-get"
chmod +x "$T"/bin/*

# --- repositorio "privado" falso: copia do vibe_trading atual ------------------
cp -a "$FONTE/." "$T/trab/" && rm -rf "$T/trab/.venv" "$T/trab/dados_vigia" "$T/trab/segredos.json" "$T/trab/vigia.json" "$T/trab/caderno.jsonl" && find "$T/trab" -name __pycache__ -prune -exec rm -rf {} +
git -C "$T/trab" init -q -b main && git -C "$T/trab" add -A && git -C "$T/trab" -c user.email=t@t -c user.name=t commit -qm "versao 1"
git clone -q --bare "$T/trab" "$T/repo.git"
git config --system --add safe.directory "$T/repo.git"
chmod -R a+rX "$T/repo.git"

export VIBE_DIR="$T/opt/vibe" REPO="$T/repo.git" UNIDADES="$T/units" BIN="$T/sbin" TRAVA="$T/trava" PRIMEIRA_CARGA=0
export PATH="$T/bin:$PATH"
# so deste container: o certificado do proxy fica em /root, que o usuario vibe nao le
if [[ -f /root/.ccr/ca-bundle.crt ]]; then
  install -m 644 /root/.ccr/ca-bundle.crt "$T/ca.crt"
  export PIP_CERT="$T/ca.crt" SSL_CERT_FILE="$T/ca.crt" REQUESTS_CA_BUNDLE="$T/ca.crt"
fi
mkdir -p "$T/opt"
userdel -r vibe >/dev/null 2>&1 || true

echo "[1] instalacao do zero"
printf 'SIM\n\nn\n' | bash "$FONTE/servidor/instalar_vps.sh" > "$T/saida1.txt" 2>&1; R=$?
checa '[[ $R -eq 0 ]]' "terminou sem erro (codigo $R)"
checa 'grep -q "igual a antes" $T/saida1.txt' "Embarque Suinco igual antes e depois"
checa 'grep -q "APROVADO" $VIBE_DIR/ultima_bateria.log' "bateria inteira rodou e aprovou no servidor"
checa 'grep -q "^User=vibe" $T/units/vibe-vigia.service && grep -q "CPUQuota=30%" $T/units/vibe-vigia.service && grep -q "MemoryMax=400M" $T/units/vibe-vigia.service && grep -q "ProtectSystem=strict" $T/units/vibe-vigia.service' "servico com usuario proprio, teto de CPU e memoria, sistema so leitura"
checa '! grep -q -i "listen\|ExecStart=.*nginx\|ufw\|postgres" $T/units/vibe-vigia.service' "servico nao abre porta nem chama nada da Suinco"
checa 'grep -q "^Environment=TZ=America/Sao_Paulo" $T/units/vibe-vigia.service' "vigia na hora de Brasilia (resumo das 21 h), sem mexer no relogio do servidor"
checa '[[ -x $T/sbin/vibe-instalar ]]' "vibe-instalar instalado"
checa 'grep -q "enable vibe-vigia.service vibe-atualizar.timer" $T/systemctl.log' "servico e atualizacao diaria habilitados"
checa '! grep -qE "(restart|stop|reload|disable).*(embarque-suinco|nginx|postgresql)" $T/systemctl.log' "nenhum comando contra embarque-suinco, nginx ou postgresql"
checa '[[ ! -f $T/apt.log ]]' "nenhum pacote instalado (o necessario ja existia)"
checa '[[ $(stat -c %U $VIBE_DIR/app) == vibe && $(stat -c %a $VIBE_DIR/app/segredos.json) == 600 ]]' "codigo do usuario vibe; segredos.json com 600"
checa '[[ $(stat -c %a $VIBE_DIR) == 750 ]]' "pasta $VIBE_DIR fechada para os outros usuarios (750)"
checa '! grep -q "ERRO" $T/saida1.txt' "nenhum ERRO na tela de uma instalacao que deu certo"

echo "[2] rodar de novo (com o vigia ligado)"
: > "$T/systemctl.log"
printf 'SIM\n\nn\n' | bash "$T/sbin/vibe-instalar" > "$T/saida2.txt" 2>&1; R=$?
checa '[[ $R -eq 0 ]] && grep -q "vigia parado durante a instal" $T/saida2.txt && grep -q "ja configurado\|já configurado\|sem Telegram" $T/saida2.txt' "refaz sem erro, parando o vigia antes (codigo $R)"
checa '[[ $(grep -n "stop vibe-vigia" $T/systemctl.log | cut -d: -f1) -lt $(grep -n "restart vibe-vigia" $T/systemctl.log | cut -d: -f1) ]]' "para o vigia e religa no fim"

echo "[3] atualizar sem versao nova"
bash "$T/sbin/vibe-instalar" --atualizar > "$T/saida3.txt" 2>&1
checa 'grep -q "sem versão nova" $T/saida3.txt' "sem versao nova: nao faz nada"

echo "[4] atualizar com versao boa (que tambem muda o instalador no repositorio)"
echo "" >> "$T/trab/README.md"
echo "# linha nova no instalador do repositorio" >> "$T/trab/servidor/instalar_vps.sh"
ANTES_ROOT=$(sha256sum "$T/sbin/vibe-instalar" | cut -c1-16)
git -C "$T/trab" -c user.email=t@t -c user.name=t commit -qam "versao 2 (boa)" && git -C "$T/trab" push -q "$T/repo.git" main
BOA=$(git -C "$T/trab" rev-parse HEAD)
: > "$T/systemctl.log"
bash "$T/sbin/vibe-instalar" --atualizar > "$T/saida4.txt" 2>&1
checa '[[ $(runuser -u vibe -- git -C $VIBE_DIR/app rev-parse HEAD) == $BOA ]] && grep -q "bateria verde" $T/saida4.txt' "versao boa aplicada so depois da bateria verde"
checa '! grep -q "ERRO\|parou na linha" $T/saida4.txt' "atualizacao sem parada no meio (a primeira, sem registro antigo, morria calada)"
checa '[[ $(sha256sum "$T/sbin/vibe-instalar" | cut -c1-16) == $ANTES_ROOT ]]' "a copia de administrador do instalador NAO muda com o que vem do repositorio"
checa 'grep -q "^User=vibe" $T/units/vibe-atualizar.service && grep -q "atualizar_vibe.sh" $T/units/vibe-atualizar.service && ! grep -q "vibe-instalar" $T/units/vibe-atualizar.service' "a atualizacao diaria roda como vibe, nunca como administrador"

echo "[5] atualizar com versao sabotada"
python3 - "$T/trab/estrategias.py" <<'EOF'
import sys
p = sys.argv[1]; s = open(p).read()
a = "    return gatilho and votos >= minimo"
assert a in s, "ponto de sabotagem nao achado"
open(p, "w").write(s.replace(a, "    return votos >= minimo", 1))
EOF
git -C "$T/trab" -c user.email=t@t -c user.name=t commit -qam "versao 3 (sabotada)" && git -C "$T/trab" push -q "$T/repo.git" main
: > "$T/systemctl.log"
bash "$T/sbin/vibe-instalar" --atualizar > "$T/saida5.txt" 2>&1
checa '[[ $(runuser -u vibe -- git -C $VIBE_DIR/app rev-parse HEAD) == $BOA ]] && grep -q "RECUSADA" $T/saida5.txt' "versao sabotada recusada: o vigia continua na versao boa"
checa '[[ ! -d $VIBE_DIR/prova ]]' "pasta de prova apagada"
SAB=$(git -C "$T/trab" rev-parse --short=7 HEAD)
checa 'grep -q "^REPROVADO" $VIBE_DIR/bateria_$SAB.log && grep -q "^APROVADO: todas" $VIBE_DIR/bateria_${BOA:0:7}.log' "cada versao guarda o proprio registro: o da recusada diz REPROVADO e o da boa continua la"

echo "[6] status"
bash "$T/sbin/vibe-instalar" --status > "$T/saida6.txt" 2>&1
checa 'grep -q "Embarque Suinco (só leitura)" $T/saida6.txt && grep -q "embarque-suinco *active" $T/saida6.txt' "status mostra o vigia e o retrato da Suinco"

echo "[7] desinstalar guardando os dados"
printf '\n' | bash "$T/sbin/vibe-instalar" --desinstalar > "$T/saida7.txt" 2>&1
checa '[[ ! -f $T/units/vibe-vigia.service && ! -f $T/sbin/vibe-instalar && -d $VIBE_DIR/app ]] && grep -q "igual a antes" $T/saida7.txt' "servicos removidos, dados guardados, Suinco igual"
checa '! grep -q "ERRO" $T/saida2.txt $T/saida7.txt' "nenhum ERRO na tela ao refazer e ao remover"
printf 'APAGAR\n' | bash "$FONTE/servidor/instalar_vps.sh" --desinstalar > "$T/saida8.txt" 2>&1
checa '[[ ! -d $VIBE_DIR ]] && ! id vibe >/dev/null 2>&1' "com APAGAR: pasta e usuario removidos"

git config --system --unset-all safe.directory >/dev/null 2>&1 || true
echo
[[ $FALHAS -eq 0 ]] && echo "INSTALADOR APROVADO" || { echo "INSTALADOR REPROVADO: $FALHAS"; for f in "$T"/saida*.txt; do echo "--- $f"; tail -15 "$f"; done; }
