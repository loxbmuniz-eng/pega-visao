#!/usr/bin/env python3
"""O atualizar.sh não desfaz o que foi editado em Cadastros (30/09/2026).

O DEFEITO, achado ao conferir linha por linha o comando que ia para o dono
(regra do CLAUDE.md de 30/09): todo `atualizar.sh` chama o `instalar.sh`, que
roda `scripts/seed.js` — a carga inicial de rotas e frota. O seed gravava com
`ON CONFLICT … DO UPDATE`: a cada atualização, a transportadora, o tipo de
veículo e o "precisa revisão" de toda placa da planilha inicial, e o nome e o
detalhe (as cidades) de toda rota da lista inicial, VOLTAVAM ao valor de
agosto. O que a Logística e a Administração editaram em Cadastros era
desfeito em silêncio — e o tipo de veículo decide a tarifa do frete.

REPRODUZIDO no banco de teste: placa editada para outra transportadora e rota
com cidades editadas; `node scripts/seed.js`; as duas voltaram.

O QUE ESTE TESTE TRAVA, num banco descartável próprio:
  1. servidor novo: migrar → seed → as rotas e a frota da planilha entram;
  2. editar uma placa e uma rota (como a tela de Cadastros faz);
  3. rodar o seed de novo (como todo atualizar.sh faz) — as edições FICAM;
  4. placa e rota apagadas do banco voltam a existir (o seed continua
     completando o que falta).

    python3 testes/test_seed_nao_desfaz_cadastro.py
"""
import os
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.join(os.path.dirname(AQUI), 'backend')
BANCO = 'embarque_teste_seed_cadastro'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def postgres(cmd):
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
    dono = postgres('psql -tA -d postgres -c "SELECT pg_get_userbyid(datdba) FROM pg_database '
                    "WHERE datname = 'embarque_suinco'\"").stdout.strip() or 'suinco'
    postgres(f'dropdb --if-exists {BANCO}')
    r = postgres(f'createdb -O {dono} {BANCO}')
    ck('banco descartável criado', r.returncode == 0, r.stderr.strip()[:120])
    try:
        print('\n=== 1. SERVIDOR NOVO: O SEED CARREGA ROTAS E FROTA ===')
        for s in ('migrar.js', 'seed.js'):
            cod, saida = node(s)
            ck(f'{s} rodou', cod == 0, saida[-120:])
        placa = sql("SELECT placa FROM dim_veiculos WHERE origem='seed' ORDER BY placa LIMIT 1")
        rota = sql('SELECT codigo FROM dim_rotas ORDER BY codigo LIMIT 1')
        ck('a frota da planilha entrou', bool(placa), placa)
        ck('as rotas da lista entraram', bool(rota), rota)

        print('\n=== 2. EDITAR EM CADASTROS ===')
        sql(f"UPDATE dim_veiculos SET transportadora='TRANSP EDITADA TESTE', tipo_veiculo='TIPO EDITADO TESTE' "
            f"WHERE placa='{placa}'")
        sql(f"UPDATE dim_rotas SET nome='ROTA EDITADA TESTE', detalhe='CIDADES EDITADAS TESTE' WHERE codigo='{rota}'")

        print('\n=== 3. O ATUALIZAR.SH RODA O SEED DE NOVO — AS EDIÇÕES FICAM ===')
        cod, saida = node('seed.js')
        ck('seed.js rodou de novo', cod == 0, saida[-120:])
        v = sql(f"SELECT transportadora || '|' || tipo_veiculo FROM dim_veiculos WHERE placa='{placa}'")
        ck('a placa continua com a transportadora e o tipo editados',
           v == 'TRANSP EDITADA TESTE|TIPO EDITADO TESTE', v)
        r = sql(f"SELECT nome || '|' || coalesce(detalhe,'') FROM dim_rotas WHERE codigo='{rota}'")
        ck('a rota continua com o nome e as cidades editados', r == 'ROTA EDITADA TESTE|CIDADES EDITADAS TESTE', r)

        print('\n=== 4. O QUE FALTA, O SEED COMPLETA ===')
        outra = sql(f"SELECT placa FROM dim_veiculos WHERE origem='seed' AND placa <> '{placa}' ORDER BY placa LIMIT 1")
        sql(f"DELETE FROM dim_veiculos WHERE placa='{outra}'")
        node('seed.js')
        ck('placa da planilha que não estava no banco volta a existir',
           sql(f"SELECT count(*) FROM dim_veiculos WHERE placa='{outra}'") == '1', outra)
    finally:
        postgres(f'dropdb --if-exists {BANCO}')

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


main()
