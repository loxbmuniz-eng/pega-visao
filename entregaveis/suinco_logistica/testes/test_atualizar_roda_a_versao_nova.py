#!/usr/bin/env python3
"""O atualizar roda a versão que ACABOU de baixar, não a que estava no disco (30/09/2026).

O QUE ACONTECEU (ocorrência #97): o dono rodou o `atualizar_tudo.sh` com o
servidor em e87ed1c e a entrega em 9fab33c. O passo que oferecia apagar
linha da Montagem tinha saído do script em 9fab33c — e mesmo assim apareceu
e perguntou "digite SIM". O bash lê o script do arquivo que abriu no começo;
o `git pull` troca o arquivo no disco, mas o bash continua lendo o antigo.
Ou seja: a primeira rodada depois de qualquer mudança nesses scripts
executa a versão VELHA. Nada foi apagado porque o .sql chamado já era o
novo e parava na primeira linha — sorte de desenho, não controle.

O QUE ESTE TESTE TRAVA, com um repositório de mentira e os passos pesados
trocados por dublês (instalar, diagnóstico, prova do backup):
  1. o `atualizar_tudo.sh` que está no disco puxa o código e passa a
     executar a versão NOVA dele mesmo antes de qualquer passo;
  2. o `atualizar.sh`, chamado sozinho, faz o mesmo;
  3. o "atualizado: ANTES -> DEPOIS" continua dizendo de onde para onde o
     servidor foi (não vira "já estava na versão mais nova");
  4. sem nada novo para baixar, roda uma vez só (não entra em laço).

Roda como root (os scripts exigem). Não toca no banco nem no serviço.

    python3 testes/test_atualizar_roda_a_versao_nova.py
"""
import os
import shutil
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(os.path.dirname(AQUI), 'backend')
BASE = 'entregaveis/suinco_logistica/backend'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def sh(cmd, cwd, env=None):
    return subprocess.run(cmd, cwd=cwd, env=env, shell=True, capture_output=True, text=True)


def git(cwd, *args):
    r = subprocess.run(['git', '-c', 'user.name=teste', '-c', 'user.email=teste@teste.local', *args],
                       cwd=cwd, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


DUBLE = '#!/usr/bin/env bash\necho "DUBLE {nome}"\nexit 0\n'


def montar(raiz):
    """Origem com os dois scripts DE VERDADE e dublês no lugar do resto;
    o servidor de mentira é um clone dela, uma versão atrás."""
    origem = os.path.join(raiz, 'origem')
    b = os.path.join(origem, BASE)
    os.makedirs(os.path.join(b, 'scripts'))
    for s in ('atualizar_tudo.sh', 'atualizar.sh', 'scripts/codigo_novo_primeiro.sh'):
        if os.path.exists(os.path.join(BACKEND, s)):
            shutil.copy(os.path.join(BACKEND, s), os.path.join(b, s))
    for nome, caminho in (('instalar', 'instalar.sh'), ('diagnostico', 'diagnostico.sh'),
                          ('backup', 'scripts/testar_restauracao_backup.sh')):
        with open(os.path.join(b, caminho), 'w') as f:
            f.write(DUBLE.format(nome=nome))
    git(origem, 'init', '-q', '-b', 'entrega')
    git(origem, 'add', '-A')
    git(origem, 'commit', '-q', '-m', 'versao velha')
    servidor = os.path.join(raiz, 'servidor')
    git(raiz, 'clone', '-q', origem, servidor)
    return origem, servidor


def publicar_versao_nova(origem):
    """A entrega ganha uma versão nova dos dois scripts, que se denuncia."""
    b = os.path.join(origem, BASE)
    for s, marca in (('atualizar_tudo.sh', 'VERSAO-NOVA-DO-ATUALIZAR-TUDO'),
                     ('atualizar.sh', 'VERSAO-NOVA-DO-ATUALIZAR')):
        p = os.path.join(b, s)
        texto = open(p, encoding='utf-8').read()
        # a marca entra antes de qualquer passo: depois da troca pela versão
        # nova, se o script já a faz; senão, logo depois da checagem de root
        alvo = 'codigo_novo_primeiro "$BASE/' if 'codigo_novo_primeiro "$BASE/' in texto else '[[ $EUID -eq 0 ]]'
        i = texto.index(alvo)
        fim = texto.index('\n', i) + 1
        texto = texto[:fim] + f'echo "{marca}"\n' + texto[fim:]
        open(p, 'w', encoding='utf-8').write(texto)
    git(origem, 'commit', '-q', '-am', 'versao nova')
    return git(origem, 'rev-parse', '--short', 'HEAD')


def main():
    if os.geteuid() != 0:
        print('precisa rodar como root (os scripts exigem)')
        sys.exit(1)
    raiz = tempfile.mkdtemp(prefix='atualizar_versao_nova_')
    env = dict(os.environ)
    try:
        print('\n=== 1. ATUALIZAR_TUDO: A PRIMEIRA RODADA JÁ É A VERSÃO NOVA ===')
        origem, servidor = montar(raiz)
        antes = git(servidor, 'rev-parse', '--short', 'HEAD')
        depois = publicar_versao_nova(origem)
        env['SRC'] = servidor
        r = sh(f'bash {BASE}/atualizar_tudo.sh', servidor, env)
        saida = r.stdout + r.stderr
        ck('o servidor foi para o commit novo', git(servidor, 'rev-parse', '--short', 'HEAD') == depois)
        ck('o atualizar_tudo.sh que rodou foi o NOVO', 'VERSAO-NOVA-DO-ATUALIZAR-TUDO' in saida,
           saida[-300:].replace('\n', ' | '))
        ck('o atualizar.sh que ele chamou também foi o novo', 'VERSAO-NOVA-DO-ATUALIZAR\n' in saida)
        ck(f'e ele conta de onde para onde foi ({antes} -> {depois})', f'{antes} -> {depois}' in saida,
           next((l for l in saida.splitlines() if 'atualizado' in l or 'mais nova' in l), ''))
        ck('rodou uma vez só (sem laço)', saida.count('VERSAO-NOVA-DO-ATUALIZAR-TUDO') == 1,
           str(saida.count('VERSAO-NOVA-DO-ATUALIZAR-TUDO')))
        ck('os passos pesados rodaram (dublês)', 'DUBLE instalar' in saida and 'DUBLE backup' in saida)

        print('\n=== 2. ATUALIZAR SOZINHO: A MESMA COISA ===')
        shutil.rmtree(raiz)
        os.makedirs(raiz)
        origem, servidor = montar(raiz)
        antes = git(servidor, 'rev-parse', '--short', 'HEAD')
        depois = publicar_versao_nova(origem)
        env['SRC'] = servidor
        r = sh(f'bash {BASE}/atualizar.sh', servidor, env)
        saida = r.stdout + r.stderr
        ck('o atualizar.sh que rodou foi o NOVO', 'VERSAO-NOVA-DO-ATUALIZAR\n' in saida,
           saida[-300:].replace('\n', ' | '))
        ck(f'e ele conta de onde para onde foi ({antes} -> {depois})', f'{antes} -> {depois}' in saida)
        ck('rodou uma vez só (sem laço)', saida.count('VERSAO-NOVA-DO-ATUALIZAR\n') == 1)

        print('\n=== 3. NADA NOVO PARA BAIXAR: RODA UMA VEZ E DIZ ===')
        r = sh(f'bash {BASE}/atualizar.sh', servidor, env)
        saida = r.stdout + r.stderr
        ck('diz que já estava na versão mais nova', 'já estava na versão mais nova' in saida)
        ck('rodou uma vez só', saida.count('VERSAO-NOVA-DO-ATUALIZAR\n') == 1)
    finally:
        shutil.rmtree(raiz, ignore_errors=True)

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


main()
