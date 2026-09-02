#!/usr/bin/env python3
"""Atualizar o cadastro de clientes não pode piorar o que já estava lá (02/09/2026).

O PEDIDO, do dono: "vou mandar o cadastro geral de clientes pro campo
clientes na aba devolucoes". Fonte:
CADASTRO_GERAL__20260902T142622.584.xlsx, aba "Export".

É A MESMA BASE, MAIS NOVA — comparada linha a linha contra o banco:
276 novos, 431 com alguma diferença, 5 no banco que a planilha não tem.

A ARMADILHA, e é o motivo deste arquivo existir. A planilha traz o
representante só como CÓDIGO ("810430"); o banco tem o nome completo
("810430 - Luciene Maria dos Santos (BH)"). Carregar a planilha por cima,
do jeito óbvio, apagaria o nome do RCA de 76 mil clientes — um dado pior
substituindo um melhor, em silêncio, sem erro nenhum na tela. É a família
do "campo vazio não é ordem de apagar", mas pior: aqui o campo não vem
vazio, vem MENOR.

O QUE ESTE TESTE EXIGE:

  1. o RCA de quem já existia continua com o nome completo;
  2. cliente novo cujo representante o banco já conhece herda a grafia
     completa, em vez de nascer com o número solto;
  3. os 5 que a planilha não tem CONTINUAM no banco — três deles já
     aparecem em devoluções gravadas, e apagá-los deixaria aquelas linhas
     com um código órfão que ninguém entenderia meses depois;
  4. o que a planilha traz de verdade novo chegou: nome e apelido
     atualizados, e os clientes que não existiam.

Exige o banco local com a migração 044 aplicada.

    python3 testes/test_cadastro_clientes_nao_piora_o_dado.py
"""
import subprocess
import sys

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
    print('\n=== 1. O RCA DE QUEM JÁ EXISTIA NÃO FOI DEGRADADO ===')
    # O erro que este teste existe para impedir: trocar
    # "810430 - Luciene Maria dos Santos (BH)" por "810430".
    # A PRIMEIRA VERSÃO DESTA CONTA ESTAVA ERRADA, e o erro foi meu.
    #
    # Ela exigia "no máximo 45 clientes com o RCA só em número", supondo
    # que só os 45 novos sem precedente ficariam assim. Reprovou com
    # 10.276 — e a checagem contra a cópia do banco tirada ANTES da
    # migração mostrou 10.231 já naquele estado. A base tinha dez mil
    # clientes com o RCA em número desde antes, de representantes que nem
    # a migração 019 conhecia pelo nome.
    #
    # Contagem absoluta não mede "eu piorei alguma coisa" — mede o tamanho
    # de um problema que já existia. O que este arquivo quer garantir é que
    # NENHUM cliente que TINHA o nome completo perdeu o nome. É isso que a
    # conta pergunta agora: quantos têm nome de representante hoje. Se uma
    # atualização futura degradar qualquer um, este número cai.
    com_nome = sql("SELECT count(*) FROM dim_clientes WHERE vendedor LIKE '% - %'")
    ck('a quantidade de clientes com o nome do RCA por extenso não caiu',
       com_nome and int(com_nome[0]) >= 66593,
       f"{com_nome} com nome por extenso (eram 66.593 antes desta atualização)")

    amostra = sql("SELECT vendedor FROM dim_clientes WHERE codigo = '10003'")
    ck('o cliente 10003 manteve o nome do representante',
       amostra and ' - ' in amostra[0], str(amostra))

    print('\n=== 2. CLIENTE NOVO HERDA A GRAFIA COMPLETA DO RCA ===')
    # 231 dos 276 novos têm um representante que o banco já conhecia.
    novo = sql("SELECT vendedor FROM dim_clientes WHERE codigo = '458458'")
    ck('o cliente novo 458458 nasceu com o RCA por extenso',
       novo and ' - ' in novo[0], str(novo))

    print('\n=== 3. NINGUÉM FOI APAGADO ===')
    # Os 5 que a planilha não tem são teste e nome de rota digitado no
    # campo errado — mas três já aparecem em devoluções gravadas.
    for cod in ('99913', 'CENTRO OESTE', 'AREAL', '00000-nao-existe', 'SENDAS'):
        tem = sql(f"SELECT count(*) FROM dim_clientes WHERE codigo = '{cod}'")
        ck(f'"{cod}" continua no cadastro', tem and tem[0] == '1', str(tem))

    print('\n=== 4. O QUE A PLANILHA TROUXE DE NOVO CHEGOU ===')
    total = sql("SELECT count(*) FROM dim_clientes")
    ck('a base cresceu para 77.100', total and int(total[0]) == 77100, str(total))

    apel = sql("SELECT apelido FROM dim_clientes WHERE codigo = '458458'")
    ck('e o apelido do novo veio junto',
       apel and apel[0] == 'Padaria e Confeitaria Victoria', str(apel))

    print('\n=== 5. TODO CLIENTE TEM CÓDIGO E NOME ===')
    # Cadastro pela metade é pior que cadastro faltando: quem digita o
    # código vê a linha aparecer vazia e acha que o sistema perdeu o dado.
    sem_nome = sql("SELECT count(*) FROM dim_clientes WHERE nome = '' AND apelido = ''")
    ck('quase ninguém está sem nome nem apelido',
       sem_nome and int(sem_nome[0]) <= 5,
       f"{sem_nome} sem nenhum dos dois (os 4 antigos de teste são aceitos)")

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


sys.exit(main())
