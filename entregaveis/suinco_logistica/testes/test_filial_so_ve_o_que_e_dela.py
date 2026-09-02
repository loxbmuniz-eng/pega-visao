#!/usr/bin/env python3
"""Filial cria, acompanha o que é dela, e não vê a das outras (02/09/2026).

O PEDIDO, do dono, em quatro mensagens:

    "isso é um setor novo, so vai ter acesso a aba devolucoes e escopo de
     devolucoes, e vai poder so criar checklists e acompanhar historico de
     devolucoes somente que competem a eles, ou seja, quem for filial so
     acompanha dev filial (...) o processo de dev é feito aqui normalmente,
     porem as permissoes da filial sao restritas a isso"

    "crie 3 setores filial 105 BSB, 106 BAHIA, 107 ES"

    "cada setor so acompanha o historico de checklists da sua filial" ·
    "nós da logistica e administracao temos acesso a tudo normalmente"

    "mas na portaria e nos outros setores tudo que for da filial tem que
     contar normalmente como se fosse nosso" · "por ser filial tem que ter
     essa identificacao"

São DUAS regras que puxam para lados opostos, e é por isso que este teste
mede as duas juntas:

  · SEPARAÇÃO, do lado de quem é filial: a 105 não vê nada da 106 nem da
    matriz. Vale para a lista E para o pedido direto pelo ID — esconder
    linha na tela não é permissão, e quem abrisse o endereço da API veria
    tudo;

  · INTEGRAÇÃO, do lado da matriz: a devolução da filial aparece para
    Portaria, Balança, Expedição, Controles e Notas exatamente como
    qualquer outra, e roda as seis etapas igual. Com uma diferença só: fica
    IDENTIFICADA como da filial, na tela e no papel.

E a terceira, que é o limite da filial: ela CRIA e LANÇA os itens do
próprio checklist, mas NÃO avança etapa — o ciclo é rodado pela matriz.

Exige o backend local no ar, com as migrações 043 aplicadas.

    python3 testes/test_filial_so_ve_o_que_e_dela.py
"""
import asyncio
import os
import subprocess
import sys

import urllib.request
import json

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')

USUARIOS = [
    ('filial105@teste.local', 'Filial BSB', 'Filial 105 BSB'),
    ('filial106@teste.local', 'Filial Bahia', 'Filial 106 BAHIA'),
]

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def psql(q):
    return subprocess.run(['sudo', '-u', 'postgres', 'psql', '-q', '-d', 'embarque_suinco',
                           '-c', q], capture_output=True, text=True)


def so_lista(r):
    """A rota devolve lista direta; guardo o normalizador num lugar só para
    o teste não repetir a suposição em quatro pontos."""
    if isinstance(r, dict):
        return r.get('devolucoes', [])
    return r or []


def http(caminho, token=None, metodo='GET', corpo=None):
    req = urllib.request.Request(f'{API}{caminho}', method=metodo)
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    dados = None
    if corpo is not None:
        dados = json.dumps(corpo).encode()
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, dados, timeout=15) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or 'null')
        except Exception:
            return e.code, None


def entrar(email):
    st, r = http('/auth/login', metodo='POST', corpo={'email': email, 'senha': SENHA})
    return (r or {}).get('token') if st == 200 else None


def main():
    print('\n=== 0. OS TRÊS SETORES EXISTEM NO BANCO ===')
    # A CHECK de `operadores` lista os setores aceitos. Sem a 043, criar o
    # usuário da filial é recusado pelo BANCO, com erro de constraint que
    # não diz nada a quem está cadastrando.
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd='/home/user/pega-visao/entregaveis/suinco_logistica/backend',
                       capture_output=True, text=True)
    if h.returncode != 0:
        print('não consegui gerar o hash:', h.stderr[:200]); return 1
    hash_senha = h.stdout.strip()
    for email, nome, setor in USUARIOS:
        psql(f"DELETE FROM operadores WHERE email = '{email}'")
        r = psql("INSERT INTO operadores (email,nome,setor,senha_hash) VALUES "
                 f"('{email}','{nome}','{setor}','{hash_senha}')")
        ck(f'o banco aceita o setor "{setor}"', r.returncode == 0,
           (r.stderr or '')[:120])

    tok105 = entrar('filial105@teste.local')
    tok106 = entrar('filial106@teste.local')
    tokChefe = entrar('chefe@teste.local')
    ck('as duas filiais conseguem entrar', bool(tok105 and tok106))
    ck('e a matriz também', bool(tokChefe))
    if not (tok105 and tok106 and tokChefe):
        return 1

    print('\n=== 1. CADA FILIAL CRIA O PRÓPRIO CHECKLIST ===')
    st105, d105 = http('/api/devolucoes', tok105, 'POST',
                       {'dataDev': '2026-09-02', 'regiao': 'Brasília', 'rotas': ['519']})
    ck('a 105 cria checklist', st105 == 201, f'HTTP {st105} {str(d105)[:90]}')
    st106, d106 = http('/api/devolucoes', tok106, 'POST',
                       {'dataDev': '2026-09-02', 'regiao': 'Bahia', 'rotas': ['525']})
    ck('a 106 cria checklist', st106 == 201, f'HTTP {st106} {str(d106)[:90]}')
    if st105 != 201 or st106 != 201:
        return 1
    id105, id106 = d105['id'], d106['id']

    print('\n=== 2. A SEPARAÇÃO: UMA NÃO VÊ A OUTRA ===')
    st, lista105 = http('/api/devolucoes', tok105)
    ids105 = [x['id'] for x in so_lista(lista105)]
    ck('a 105 vê o próprio checklist', id105 in ids105, str(len(ids105)) + ' na lista')
    ck('a 105 NÃO vê o da 106', id106 not in ids105, 'a lista trouxe o da outra filial')
    ck('e não vê nenhum da matriz',
       all(x.get('criadaSetor') == 'Filial 105 BSB' for x in so_lista(lista105)),
       'apareceu checklist de outro setor')

    # Esconder na lista não basta: quem pede pelo ID tem que levar 404.
    st, _ = http(f'/api/devolucoes/{id106}', tok105)
    ck('pedir pelo ID o checklist da outra filial responde 404',
       st == 404, f'HTTP {st} — vazou pelo endereço direto')

    print('\n=== 3. A INTEGRAÇÃO: A MATRIZ VÊ TUDO ===')
    st, listaChefe = http('/api/devolucoes', tokChefe)
    idsChefe = [x['id'] for x in so_lista(listaChefe)]
    ck('a matriz vê o checklist da 105', id105 in idsChefe)
    ck('e o da 106 também', id106 in idsChefe)

    print('\n=== 4. A IDENTIFICAÇÃO: DÁ PARA SABER DE QUAL FILIAL VEIO ===')
    # "por ser filial tem que ter essa identificacao" — sem isto a matriz
    # processa às cegas, e o processo é o mesmo mas a origem não é.
    dev = next((x for x in so_lista(listaChefe) if x['id'] == id105), None)
    ck('a devolução carrega o setor que a criou',
       dev and dev.get('criadaSetor') == 'Filial 105 BSB',
       str(dev.get('criadaSetor') if dev else None))

    print('\n=== 5. O LIMITE: A FILIAL NÃO AVANÇA ETAPA ===')
    st, r = http(f'/api/devolucoes/{id105}/etapa', tok105, 'POST',
                 {'para': 'Recebida na Portaria', 'placa': 'AAK8958'})
    ck('a filial é recusada ao tentar avançar a própria devolução',
       st == 403, f'HTTP {st}')
    ck('e a recusa EXPLICA, em vez de só negar',
       r and 'matriz' in str(r.get('erro', '')).lower(), str(r)[:120])

    print('\n=== 6. MAS ELA LANÇA OS ITENS DO PRÓPRIO CHECKLIST ===')
    # Checklist sem item é capa vazia: o que a filial está dizendo é O QUE
    # está voltando.
    st, _ = http(f'/api/devolucoes/{id105}/itens', tok105, 'POST',
                 {'nota': '77001', 'cx': 5, 'peso': 100, 'codProduto': '30110',
                  'numDev': 'DEV-F105', 'motivo': '607'})
    ck('a 105 lança item no próprio checklist', st == 201, f'HTTP {st}')
    st, _ = http(f'/api/devolucoes/{id106}/itens', tok105, 'POST',
                 {'nota': '77002', 'cx': 1, 'peso': 10, 'codProduto': '30110'})
    ck('e é barrada ao lançar no checklist da outra filial',
       st == 404, f'HTTP {st} — conseguiu escrever no da 106')

    for d in (id105, id106):
        psql(f"DELETE FROM devolucoes WHERE devolucao_id = '{d}'")
    for email, _, _ in USUARIOS:
        psql(f"DELETE FROM operadores WHERE email = '{email}'")

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


sys.exit(main())
