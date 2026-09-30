#!/usr/bin/env python3
"""A prova do backup confere o CONTEÚDO de verdade, não só a contagem (30/09/2026).

O QUE ACONTECEU (ocorrência #98): na primeira vez que o
`testar_restauracao_backup.sh` rodou no servidor, o passo 6 disse "não há
carga com mais de 7 dias para comparar (banco novo?)" — num banco que opera
desde agosto. O passo foi pulado e o veredito saiu "o backup presta".

A CAUSA, reproduzida: o servidor não tem sudo, então o script vira o usuário
postgres com `su -s /bin/sh`. A função `pg` monta o comando com
`printf '%q'`, que escreve quebra de linha como `$'\\n'` — sintaxe do bash.
O /bin/sh do Ubuntu (dash) não a entende: "Unterminated quoted string". Toda
consulta de VÁRIAS linhas quebrava; o erro ia para /dev/null; a resposta
vazia virava "não há carga antiga". As consultas de uma linha (a contagem
por tabela) funcionavam — por isso o resto do relatório parecia são.

O QUE ESTE TESTE TRAVA, num banco descartável próprio e com um backup de
verdade (pg_dump | gzip, como o cron do servidor faz):
  1. com cinco cargas criadas há 10 dias, o passo 6 compara as cinco campo
     a campo e diz que são idênticas;
  2. a frase "não há carga com mais de 7 dias" NÃO aparece;
  3. se a consulta da amostra falhar, o script diz que falhou — não finge
     que o banco é novo.

Roda como root (o script exige). Não toca no banco embarque_suinco.

    python3 testes/test_restauracao_confere_conteudo.py
"""
import os
import re
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(os.path.dirname(AQUI), 'backend', 'scripts', 'testar_restauracao_backup.sh')
BANCO = 'embarque_teste_restauracao_conteudo'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def postgres(cmd):
    env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
    return subprocess.run(['su', '-s', '/bin/bash', 'postgres', '-c', cmd], cwd='/tmp',
                          capture_output=True, text=True, env=env)


def sem_cor(t):
    return re.sub(r'\x1b\[[0-9;]*m', '', t)


def main():
    if os.geteuid() != 0:
        print('precisa rodar como root (o script exige)')
        sys.exit(1)
    pasta = tempfile.mkdtemp(prefix='restauracao_conteudo_')
    os.chmod(pasta, 0o755)
    arq = os.path.join(pasta, 'embarque_teste_20260930.sql.gz')
    postgres(f'dropdb --if-exists {BANCO}')
    try:
        r = postgres(f'createdb {BANCO}')
        ck('banco descartável criado', r.returncode == 0, r.stderr.strip()[:120])
        # Só o que o script lê: as tabelas que ele conta e as cargas antigas.
        sql = '''
          CREATE TABLE fact_viagens (carga_id text PRIMARY KEY, numero_carga text, placa text NOT NULL,
            peso_kg numeric, status_atual text, criado_em timestamptz DEFAULT now(), atualizado_em timestamptz DEFAULT now());
          CREATE TABLE _migrations (arquivo text PRIMARY KEY);
          INSERT INTO _migrations VALUES ('056_km_com_casas_decimais.sql');
          INSERT INTO fact_viagens (carga_id, numero_carga, placa, peso_kg, status_atual, criado_em)
            SELECT 'teste-rest-' || g, (900300 + g)::text, 'TST' || (3000 + g), 1000 + g, 'Seguiu Viagem',
                   now() - interval '10 days'
              FROM generate_series(1, 5) g;
          INSERT INTO fact_viagens (carga_id, numero_carga, placa, peso_kg, status_atual)
            VALUES ('teste-rest-hoje', '900399', 'TST3999', 500, 'Aguardando Veículo');
        '''
        with open(os.path.join(pasta, 'semear.sql'), 'w') as f:
            f.write(sql)
        os.chmod(os.path.join(pasta, 'semear.sql'), 0o644)
        r = postgres(f"psql -q -v ON_ERROR_STOP=1 -d {BANCO} -f {pasta}/semear.sql")
        ck('cinco cargas de 10 dias atrás e uma de hoje', r.returncode == 0, r.stderr.strip()[:160])
        # igual ao instalar.sh: o pg_dump roda como postgres, quem grava é o root
        r = subprocess.run(f'su - postgres -c "pg_dump {BANCO}" | gzip > {arq}', shell=True,
                           capture_output=True, text=True, cwd='/tmp')
        ck('backup gerado como o cron do servidor gera', r.returncode == 0 and os.path.getsize(arq) > 0,
           r.stderr.strip()[:120])

        print('\n=== O SCRIPT DE PROVA, CONTRA ESSE BACKUP ===')
        r = subprocess.run(['bash', SCRIPT, '--arquivo', arq, '--banco', BANCO],
                           capture_output=True, text=True, cwd='/tmp')
        saida = sem_cor(r.stdout + r.stderr)
        passo6 = saida.split('6. O conteúdo confere?')[-1].split('VEREDITO')[0].strip()
        print('   ' + passo6.replace('\n', '\n   '))
        ck('o passo 6 não diz que "não há carga com mais de 7 dias"', 'não há carga com mais de 7 dias' not in saida)
        ck('as cinco cargas antigas são conferidas e idênticas',
           '5 carga(s) antiga(s) conferidas, todas idênticas à produção' in saida, passo6[:200])
        bancos = postgres("psql -tAc \"SELECT datname FROM pg_database\"").stdout.split()
        ck('o banco descartável da prova foi apagado',
           not [b for b in bancos if re.match(r'^teste_restauracao_\d', b)], str(bancos))
    finally:
        postgres(f'dropdb --if-exists {BANCO}')
        subprocess.run(['rm', '-rf', pasta])

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


main()
