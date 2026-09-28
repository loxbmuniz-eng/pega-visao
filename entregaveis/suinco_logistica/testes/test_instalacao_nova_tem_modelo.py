#!/usr/bin/env python3
"""Servidor instalado do zero nasce com o modelo da semana (28/09/2026).

O DEFEITO, reproduzido num banco descartável na ordem do instalar.sh
(migrar.js → seed.js): programacao_modelo com 0 linhas. As migrações 041 e
042 gravam o modelo do dono só para rotas que já existem, e as rotas entram
no seed, depois. A Montagem do Dia de um servidor novo nasceria sem modelo.

O QUE ESTE TESTE TRAVA:
  1. o instalar.sh roda scripts/modelo_inicial.js DEPOIS do seed;
  2. num banco novo, migrar → seed → modelo_inicial dá as 80 linhas do dono;
  3. rodar de novo não mexe em nada (o atualizar.sh chama o instalador);
  4. com o modelo EDITADO, o passo não apaga a edição — a 041 começa com
     DELETE, e é por isso que o passo só age com a tabela vazia.

Usa um banco descartável próprio e o apaga no fim. Não toca no banco da
bateria.

    python3 testes/test_instalacao_nova_tem_modelo.py
"""
import os
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(os.path.dirname(AQUI), 'backend')
BANCO = 'embarque_teste_instalacao_nova'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def postgres(cmd):
    # SEM as variáveis PG* do ambiente. A bateria roda com as do banco da
    # aplicação carregadas (PGUSER=suinco), e o `su` as passa adiante: o
    # createdb rodava como `suinco`, que não cria banco — e o portão
    # reprovou por isso (28/09/2026), não por defeito do instalador.
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    return subprocess.run(['su', 'postgres', '-c', cmd], capture_output=True, text=True, env=env)


def sql(q):
    return postgres(f'psql -q -tA -d {BANCO} -c "{q}"').stdout.strip()


def ambiente():
    env = dict(os.environ)
    with open(os.path.join(BACKEND, '.env'), encoding='utf-8') as f:
        for linha in f:
            linha = linha.strip()
            if linha and not linha.startswith('#') and '=' in linha:
                k, v = linha.split('=', 1)
                env.setdefault(k, v)
    env['PGDATABASE'] = BANCO
    return env


def node(script):
    r = subprocess.run(['node', f'scripts/{script}'], cwd=BACKEND, env=ambiente(),
                       capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


def main():
    print('\n=== 1. O INSTALADOR RODA O PASSO, E DEPOIS DO SEED ===')
    inst = open(os.path.join(BACKEND, 'instalar.sh'), encoding='utf-8').read()
    i_mig, i_seed, i_mod = (inst.find('node scripts/migrar.js'), inst.find('node scripts/seed.js'),
                            inst.find('node scripts/modelo_inicial.js'))
    ck('migrar → seed → modelo_inicial, nessa ordem', 0 <= i_mig < i_seed < i_mod, f'{i_mig} {i_seed} {i_mod}')

    dono = postgres('psql -tA -d postgres -c "SELECT pg_get_userbyid(datdba) FROM pg_database '
                    "WHERE datname = 'embarque_suinco'\"").stdout.strip() or 'suinco'
    postgres(f'dropdb --if-exists {BANCO}')
    r = postgres(f'createdb -O {dono} {BANCO}')
    ck('banco descartável criado', r.returncode == 0, r.stderr.strip()[:120])
    try:
        print('\n=== 2. SERVIDOR NOVO NASCE COM O MODELO DO DONO ===')
        for s in ('migrar.js', 'seed.js'):
            cod, saida = node(s)
            ck(f'{s} rodou', cod == 0, saida[-120:])
        ck('antes do passo, o modelo está vazio (o defeito)', sql('SELECT count(*) FROM programacao_modelo') == '0')
        cod, saida = node('modelo_inicial.js')
        ck('modelo_inicial.js rodou', cod == 0, saida[-120:])
        ck('agora são as 80 linhas do dono', sql('SELECT count(*) FROM programacao_modelo') == '80',
           sql('SELECT count(*) FROM programacao_modelo'))
        ck('com a correção da 042 aplicada (a 7ª da quarta é "Belo Horizonte")',
           sql("SELECT apelido_rota FROM programacao_modelo WHERE dia_semana=3 AND ordem=7") == 'Belo Horizonte',
           sql("SELECT apelido_rota FROM programacao_modelo WHERE dia_semana=3 AND ordem=7"))

        print('\n=== 3. RODAR DE NOVO NÃO MEXE ===')
        cod, saida = node('modelo_inicial.js')
        ck('a segunda vez diz que não há nada a fazer', cod == 0 and 'nada a fazer' in saida, saida[-80:])

        print('\n=== 4. MODELO EDITADO NÃO É APAGADO ===')
        sql("UPDATE programacao_modelo SET apelido_rota = 'EDITADO PELA LOGISTICA' WHERE dia_semana=1 AND ordem=1")
        sql("DELETE FROM programacao_modelo WHERE dia_semana=2")
        antes = sql('SELECT count(*) FROM programacao_modelo')
        node('modelo_inicial.js')
        ck('as linhas continuam as mesmas', sql('SELECT count(*) FROM programacao_modelo') == antes, antes)
        ck('a edição continua lá',
           sql("SELECT apelido_rota FROM programacao_modelo WHERE dia_semana=1 AND ordem=1") == 'EDITADO PELA LOGISTICA')
    finally:
        postgres(f'dropdb --if-exists {BANCO}')

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


main()
