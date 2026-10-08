#!/usr/bin/env python3
"""O vigia da bateria religa o banco e a API de teste (08/10/2026, pedido do dono).

PEDIDO: "deixa um vigia pra não morrer a bateria de novo". Decisão do dono:
religa sozinho e anota.

O QUE ACONTECIA: o contêiner reinicia sem avisar e derruba o Postgres local
e a API de teste (127.0.0.1:3010). O rodar_tudo.sh parava com a API caída e,
com o banco caindo no meio, cada suíte seguinte reprovava por "conexão
recusada". Em 08/10 uma rodada de prova se perdeu inteira assim.

O QUE ESTE TESTE TRAVA (testes/_ambiente.sh, chamado pelo rodar_tudo.sh e
pelo publicar.sh):
  A. API fora do ar: o vigia sobe de novo, COM o gerador de PDF, e anota
     (numa porta reserva, 3029, para não mexer na da bateria);
  B. banco parado: o vigia religa o cluster, aplica as migrações e anota;
  C. a bateria de verdade, com o banco E a API derrubados antes: ela não
     morre — religa, anota no resumo e termina verde.

    bash testes/rodar_tudo.sh test_vigia_da_bateria
"""
import json
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
# A bateria fala com o servidor em 127.0.0.1:3010 — a marca que põe esta
# suíte na fase "com servidor", uma de cada vez.
API_BATERIA = 'http://127.0.0.1:3010'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def com_vigia(comando, porta, logs):
    """Roda `comando` num bash que carregou o .env e o vigia, como o
    rodar_tudo.sh faz."""
    script = (f'set -a; . ./backend/.env; set +a; AQUI="$PWD"; PORTA_TESTE={porta}; LOGS={logs}; '
              f'. testes/_ambiente.sh; {comando}')
    return subprocess.run(['bash', '-c', script], cwd=str(RAIZ), capture_output=True, text=True, timeout=120)


def saude(porta):
    try:
        with urllib.request.urlopen(f'http://127.0.0.1:{porta}/health', timeout=3) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def banco_no_ar():
    return subprocess.run(['pg_isready', '-q', '-t', '3']).returncode == 0


def main():
    if not (RAIZ / 'testes' / '_ambiente.sh').exists():
        ck('o vigia existe (testes/_ambiente.sh)', False, 'arquivo não encontrado')
        print(f"\n{len(falhas)} FALHA(S)")
        return 1

    logs = tempfile.mkdtemp(prefix='vigia-')

    # A. API fora do ar, numa porta reserva
    com_vigia('derrubar_api', 3029, logs)
    ck('A. a porta reserva começa sem API', saude(3029) is None)
    r = com_vigia('garantir_ambiente "teste A"', 3029, logs)
    ck('A. o vigia termina dizendo que deu certo', r.returncode == 0, r.stdout[-300:] + r.stderr[-300:])
    s = saude(3029) or {}
    ck('A. a API voltou, COM o gerador de PDF', s.get('ok') is True and (s.get('pdf') or {}).get('pronto') is True, str(s)[:160])
    ck('A. e a volta ficou anotada na tela', 'a API de teste (porta 3029) estava fora do ar e foi religada (teste A)' in r.stdout, r.stdout[-200:])
    anot = Path(logs, '.vigia').read_text() if Path(logs, '.vigia').exists() else ''
    ck('A. e no arquivo de anotações da bateria', 'porta 3029' in anot)
    com_vigia('derrubar_api', 3029, logs)
    ck('A. derrubar_api desliga SÓ a da porta pedida', saude(3029) is None and (saude(3010) or {}).get('ok') is True)

    # B. banco parado
    subprocess.run(['bash', '-c', 'read -r v n _ < <(pg_lsclusters -h | head -1); pg_ctlcluster "$v" "$n" stop'],
                   capture_output=True, timeout=60)
    ck('B. o banco começa parado', not banco_no_ar())
    r = com_vigia('garantir_ambiente "teste B"', 3010, logs)
    ck('B. o vigia termina dizendo que deu certo', r.returncode == 0, r.stdout[-300:] + r.stderr[-300:])
    ck('B. o banco voltou', banco_no_ar())
    ck('B. e a volta ficou anotada', 'o banco local estava fora do ar e foi religado (teste B)' in r.stdout, r.stdout[-200:])

    # C. a bateria de verdade, com tudo derrubado antes
    subprocess.run(['bash', '-c', 'read -r v n _ < <(pg_lsclusters -h | head -1); pg_ctlcluster "$v" "$n" stop'],
                   capture_output=True, timeout=60)
    com_vigia('derrubar_api', 3010, logs)
    ck('C. antes: banco parado e API da bateria fora do ar', not banco_no_ar() and saude(3010) is None)
    r = subprocess.run(['bash', 'testes/rodar_tudo.sh', 'test_login_limpo'], cwd=str(RAIZ),
                       capture_output=True, text=True, timeout=600)
    saida = r.stdout + r.stderr
    ck('C. a bateria NÃO morre: termina verde', r.returncode == 0 and '1 verde(s), 0 falha(s)' in saida, saida[-400:])
    ck('C. o resumo diz o que o vigia fez', 'O vigia anotou' in saida and 'banco local estava fora do ar' in saida
       and 'API de teste (porta 3010) estava fora do ar' in saida, saida[-400:])
    s = saude(3010) or {}
    ck('C. depois: banco e API da bateria de pé', banco_no_ar() and s.get('ok') is True
       and (s.get('pdf') or {}).get('pronto') is True)

    # D. o ambiente cai NO MEIO de uma suíte: uma suíte de mentira derruba a
    #    API e reprova na primeira vez; o vigia tem que perceber, religar e
    #    rodá-la de novo — e na segunda ela passa.
    marca = Path(tempfile.mkdtemp(prefix='vigia-d-')) / 'ja_rodou'
    falsa = RAIZ / 'testes' / 'test_zz_vigia_simulado_tmp.py'
    falsa.write_text(
        '# suíte de mentira do test_vigia_da_bateria (fala com 127.0.0.1)\n'
        'import subprocess, sys\nfrom pathlib import Path\n'
        f'm = Path({str(marca)!r})\n'
        'if m.exists():\n    print("  [OK ] segunda vez, ambiente de pé"); sys.exit(0)\n'
        'm.write_text("1")\n'
        'p = subprocess.run(["bash", "-c", "ss -lptnH \\"sport = :3010\\" | grep -o pid=[0-9]* | cut -d= -f2"],'
        ' capture_output=True, text=True).stdout.split()\n'
        'for pid in p: subprocess.run(["kill", pid])\n'
        'print("  [FALHA] a API caiu no meio da suíte"); sys.exit(1)\n', encoding='utf-8')
    try:
        r = subprocess.run(['bash', 'testes/rodar_tudo.sh', 'test_zz_vigia_simulado_tmp'], cwd=str(RAIZ),
                           capture_output=True, text=True, timeout=600)
    finally:
        falsa.unlink(missing_ok=True)
    saida = r.stdout + r.stderr
    ck('D. a suíte que perdeu o ambiente no meio roda de novo e a bateria termina verde',
       r.returncode == 0 and '1 verde(s), 0 falha(s)' in saida, saida[-400:])
    ck('D. o resumo diz que a API caiu DURANTE a suíte e que ela rodou de novo',
       'estava fora do ar e foi religada (durante test_zz_vigia_simulado_tmp)' in saida
       and 'test_zz_vigia_simulado_tmp rodou de novo, com o ambiente de pé' in saida, saida[-500:])
    ck('D. depois: API da bateria de pé', (saude(3010) or {}).get('ok') is True)

    print(f"\n{len(falhas)} FALHA(S)" + (': ' + ', '.join(falhas) if falhas else ''))
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(main())
