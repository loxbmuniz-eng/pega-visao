#!/usr/bin/env python3
"""O modelo da semana bate, linha por linha, com as planilhas do dono (02/09/2026).

O PEDIDO, com as palavras dele:

    "vou mandar um modelo de programacao e preciso que voce aplique ela aos
     modelos de programacao do dia, exatamente do jeito que eu vou mandar,
     substituindo o jeito e a sequencia que está la seguindo fielmente estes
     modelos enviados"

Fonte: cinco planilhas "Programação da semana", aba "Prog Carregamento". A
extração está em `docs/MODELO_SEMANA_02-09-2026.csv`, e é contra ELA que
este teste compara — não contra números escritos à mão aqui dentro. Assim,
mudar o modelo é um diff visível no CSV, e não uma edição escondida num
teste que ninguém relê.

O QUE ESTE TESTE EXIGE:

  1. as 80 linhas estão lá, distribuídas exatamente como nas planilhas
     (Segunda 13, Terça 21, Quarta 9, Quinta 12, Sexta 25);
  2. a SEQUÊNCIA de cada dia é a da folha, de cima para baixo. Antes desta
     entrega o campo `ordem` era quase todo zero, e por isso a ordem na tela
     parecia aleatória — era o defeito que o dono estava vendo;
  3. cada linha aponta para uma rota que EXISTE no cadastro. Nenhum código
     foi inventado: os 80 nomes casaram com praças já cadastradas, e a única
     sem precedente ("Supermercado BH - Contagem") só entrou depois de ele
     confirmar por escrito que é a 510;
  4. o apelido é o que aparece na tela, com a grafia do sistema. A planilha
     traz erros de digitação (Fioresta, Logísitca, Goias sem acento) e o
     dono decidiu corrigir: a mesma rota escrita de dois jeitos faz quem
     busca por uma não achar a outra.

Exige o banco local com a migração 041 aplicada.

    python3 testes/test_modelo_da_semana_bate_com_a_planilha.py
"""
import csv
import os
import subprocess
import sys

CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   '..', 'docs', 'MODELO_SEMANA_02-09-2026.csv')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def sql(q):
    r = subprocess.run(['sudo', '-u', 'postgres', 'psql', '-tAc', q, '-d', 'embarque_suinco'],
                       capture_output=True, text=True)
    return [l for l in r.stdout.strip().split('\n') if l]


def main():
    esperado = []
    with open(CSV, encoding='utf-8') as f:
        for r in csv.DictReader(f, delimiter=';'):
            esperado.append((int(r['dia_semana']), int(r['ordem']),
                             r['rota_codigo'], r['apelido_rota'], r['paletizada']))

    print(f'\n=== 1. O TOTAL E A DISTRIBUIÇÃO POR DIA ===')
    ck('a planilha extraída tem as 80 linhas', len(esperado) == 80, str(len(esperado)))
    NOMES = ['', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta']
    for d in range(1, 6):
        quer = sum(1 for e in esperado if e[0] == d)
        tem = sql(f"SELECT count(*) FROM programacao_modelo WHERE ativo AND dia_semana = {d}")
        ck(f'{NOMES[d]} tem {quer} linhas no modelo',
           tem and int(tem[0]) == quer, f"no banco: {tem}")

    print('\n=== 2. A SEQUÊNCIA É A DA FOLHA, LINHA POR LINHA ===')
    # Antes desta entrega `ordem` era quase todo zero: a ordem na tela saía
    # praticamente aleatória, e era isso que o dono estava vendo.
    no_banco = sql(
        "SELECT dia_semana || '|' || ordem || '|' || rota_codigo || '|' || apelido_rota "
        "|| '|' || paletizada FROM programacao_modelo WHERE ativo "
        "ORDER BY dia_semana, ordem")
    lidas = [tuple(l.split('|')) for l in no_banco]
    lidas = [(int(a), int(b), c, d, e) for a, b, c, d, e in lidas]
    ck('o modelo tem exatamente as linhas da planilha, na mesma ordem',
       lidas == sorted(esperado, key=lambda x: (x[0], x[1])),
       f'banco {len(lidas)} · planilha {len(esperado)}')

    if lidas != sorted(esperado, key=lambda x: (x[0], x[1])):
        for i, (a, b) in enumerate(zip(lidas, sorted(esperado, key=lambda x: (x[0], x[1])))):
            if a != b:
                print(f'      primeira diferença na posição {i}:')
                print(f'        banco:    {a}')
                print(f'        planilha: {b}')
                break

    print('\n=== 3. NENHUM CÓDIGO DE ROTA INVENTADO ===')
    orfas = sql("SELECT m.rota_codigo || ' (' || m.apelido_rota || ')' "
                "FROM programacao_modelo m WHERE m.ativo AND NOT EXISTS "
                "(SELECT 1 FROM dim_rotas r WHERE r.codigo = m.rota_codigo)")
    ck('toda linha aponta para uma rota que existe no cadastro',
       not orfas, '; '.join(orfas[:3]))

    print('\n=== 4. A MESMA ROTA NÃO APARECE COM DUAS GRAFIAS ===')
    # Foi por isso que o dono mandou corrigir os erros da planilha: a mesma
    # rota escrita de dois jeitos faz quem busca por uma não achar a outra.
    for errado in ('Fioresta', 'Logísitca', 'Goias ', 'Sao Gotardo'):
        achou = sql("SELECT count(*) FROM programacao_modelo WHERE ativo "
                    f"AND apelido_rota LIKE '%{errado}%'")
        ck(f'nenhum apelido ficou com "{errado}"',
           achou and achou[0] == '0', f"{achou} linha(s)")

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


sys.exit(main())
