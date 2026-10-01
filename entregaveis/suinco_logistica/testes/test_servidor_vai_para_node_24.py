#!/usr/bin/env python3
"""O servidor vai para o Node 24 sem derrubar nada (01/10/2026).

PEDIDO DO DONO: "não vamos esperar abril, dá pra mexer no node sem
comprometer a operação". O Node 22 do servidor sai de suporte em abril/2027.

PROVADO ANTES DESTA MUDANÇA: os 509 testes do servidor e a bateria de tela
inteira com a API rodando no Node 24.21.0. Nenhum módulo nativo (bcryptjs,
pg, express… são JavaScript puro).

O QUE ESTE TESTE TRAVA — roda o trecho REAL do instalar.sh com `node`,
`curl` e `apt-get` de mentira, em quatro cenários:
  1. já está no 24: não tenta instalar nada;
  2. está no 22 e a instalação dá certo: troca e diz de qual para qual;
  3. está no 22 e o repositório do Node não responde: AVISA e segue no 22
     — o atualizar não para, nada cai;
  4. está abaixo do 22 e não consegue instalar: para com erro.
E, no texto do instalar.sh, que a troca acontece ANTES de o código novo
ser copiado e do reinício do serviço; e que o COPIE DAQUI diz a versão.

    python3 testes/test_servidor_vai_para_node_24.py
"""
import os
import re
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(os.path.dirname(AQUI), 'backend')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


instalar = open(os.path.join(BACKEND, 'instalar.sh'), encoding='utf-8').read()
m = re.search(r'^NODE_MAJOR=.*?^ok "node \$\(node -v\), npm \$\(npm -v\)"', instalar, re.S | re.M)
ck('o instalar.sh tem o trecho da versão do Node', m is not None)
if not m:
    sys.exit(1)
trecho = m.group(0)
ajudantes = '\n'.join(l for l in instalar.splitlines() if re.match(r'^(ok|aviso|erro)\(\)', l))


def rodar(versao_antes, instala_ok):
    d = tempfile.mkdtemp(prefix='node24_')
    estado = os.path.join(d, 'versao')
    open(estado, 'w').write(versao_antes)
    def dublê(nome, corpo):
        p = os.path.join(d, nome)
        open(p, 'w').write('#!/bin/bash\n' + corpo + '\n')
        os.chmod(p, 0o755)
    dublê('node', f'cat {estado}')
    dublê('npm', 'echo 10.0.0')
    dublê('curl', 'exit 0' if instala_ok else 'exit 7')
    dublê('apt-get', f'echo v24.21.0 > {estado}; echo apt >> {d}/chamadas')
    script = f'set -Eeuo pipefail\n{ajudantes}\n{trecho}\necho FIM-DO-TRECHO\n'
    r = subprocess.run(['bash', '-c', script], capture_output=True, text=True,
                       env={'PATH': d + ':/usr/bin:/bin'})
    chamou = os.path.exists(os.path.join(d, 'chamadas'))
    return r.returncode, r.stdout + r.stderr, chamou


print('\n=== 1. JÁ NO 24 ===')
cod, saida, chamou = rodar('v24.21.0', True)
ck('não tenta instalar', not chamou and cod == 0 and 'FIM-DO-TRECHO' in saida, saida.strip()[-120:])

print('\n=== 2. NO 22, A INSTALAÇÃO DÁ CERTO ===')
cod, saida, chamou = rodar('v22.22.2', True)
ck('troca e diz de qual para qual', cod == 0 and 'Node atualizado: v22 -> v24.21.0' in saida, saida.strip()[-160:])

print('\n=== 3. NO 22, O REPOSITÓRIO DO NODE NÃO RESPONDE ===')
cod, saida, chamou = rodar('v22.22.2', False)
ck('avisa e segue no 22 — o atualizar não para', cod == 0 and 'segue no v22.22.2' in saida and 'FIM-DO-TRECHO' in saida,
   saida.strip()[-200:])

print('\n=== 4. ABAIXO DO 22 E SEM CONSEGUIR INSTALAR ===')
cod, saida, chamou = rodar('v18.19.0', False)
ck('para com erro', cod != 0 and 'ERRO' in saida and 'FIM-DO-TRECHO' not in saida, saida.strip()[-160:])

print('\n=== 5. A ORDEM NO instalar.sh E O BLOCO COPIE DAQUI ===')
i_node = instalar.index('NODE_MAJOR=')
i_codigo = instalar.index('rsync -a --delete')
i_restart = instalar.index('systemctl restart embarque-suinco')
ck('a troca do Node vem antes de copiar o código novo e de reiniciar', i_node < i_codigo < i_restart)
tudo = open(os.path.join(BACKEND, 'atualizar_tudo.sh'), encoding='utf-8').read()
ck('o COPIE DAQUI do atualizar_tudo.sh diz a versão do Node', 'node no servidor' in tudo)

print('\n=== RESULTADO ===')
print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
sys.exit(1 if falhas else 0)
