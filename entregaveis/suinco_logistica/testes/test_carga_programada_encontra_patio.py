#!/usr/bin/env python3
"""A carga programada DEPOIS encontra o caminhão que já está no pátio (27/08/2026).

O RELATO, do dono, palavra por palavra:

    "se tem um caminhao que a portaria ja deu entrada, e ele for programado
     depois da entrada do caminhao, apos o input da programacao o caminhao
     que ja entrou passa a obter essa carga programada?"

Hoje NÃO passa. Ficam duas linhas abertas na mesma placa:

    · "Aguardando Carga"  →  Aguardando Embarque   (a entrada da Portaria)
    · "999001"            →  Aguardando Veículo    (a carga nova)

E a segunda nasce afirmando que o veículo não chegou, com o caminhão parado
no pátio desde antes. É o mesmo relato do programador de embarque em 20/08
("na segunda carga a placa está dando que o veículo não chegou, só que o
veículo está no pátio"), que na época foi corrigido só no visual.

POR QUE ISSO ACONTECE. A reconciliação existe e funciona —
`reconciliarPatioAoTrocarPlaca` acha a entrada órfã, absorve, herda o
horário real e sobe o status. Mas ela é chamada de UM lugar só: a troca de
placa de uma carga que já existe. O caminho de CRIAR carga nunca foi ligado
a ela.

O QUE ESTE TESTE EXIGE. Depois da programação:

  1. UMA carga aberta na placa, não duas;
  2. ela é a carga real (tem o número), não a linha "Aguardando Carga";
  3. o status é "Aguardando Embarque" — o caminhão ESTÁ aqui;
  4. o horário de entrada é o da Portaria, não o da programação. Fidelidade
     ao momento exato: o caminhão entrou quando entrou;
  5. a entrada órfã não é apagada — sai da operação e fica no Histórico,
     com o registro de que foi absorvida. Pátio não se apaga.

    python3 testes/test_carga_programada_encontra_patio.py
"""
import asyncio
import sys

from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def entrar(pg):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(1100)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(900)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)

        print('\n=== A PORTARIA DÁ ENTRADA ANTES DA PROGRAMAÇÃO ===')
        d = await pg.evaluate("""() => {
              const PLACA = (DB.frota && DB.frota[0] && DB.frota[0].placa) || '';
              if(!PLACA) return { erro: 'frota vazia — o teste precisa de uma placa cadastrada' };
              registrarChegadaPortaria(PLACA, {nome:'Porteiro', setor:'Portaria'});
              const orfa = cargasAbertas().find(c =>
                normalizarPlaca(c.placa) === normalizarPlaca(PLACA) && c.aguardandoCarga);
              // A ENTRADA, pela mesma definição que o código usa
              // (entradaNoPatioDe): o carimbo da movimentação, e criadoEm
              // só como reserva. Medir por criadoEm daria diferença de
              // milissegundos e o teste reprovaria por engano.
              const entrada = orfa
                ? (primeiroTimestamp(orfa.id, 'Aguardando Embarque') || orfa.criadoEm)
                : null;
              return { PLACA, entrada,
                       abertas: cargasAbertas().filter(c =>
                         normalizarPlaca(c.placa) === normalizarPlaca(PLACA)).length };
            }""")
        if d.get('erro'):
            print('  ' + d['erro'])
            sys.exit(1)
        ck('o caminhão entrou e ficou no pátio sem carga',
           d['abertas'] == 1 and bool(d['entrada']), str(d))

        print('\n=== A LOGÍSTICA PROGRAMA A CARGA DEPOIS ===')
        r = await pg.evaluate("""(ctx) => {
              criarCargaProgramada({
                placa: ctx.PLACA, numeroCarga: '999001',
                cliente: 'Cliente do Teste', destino: 'Patos de Minas',
                rota: '500', peso: 9000,
                operador: {nome:'Ana', setor:'Logística'}
              });
              const daPlaca = cargasAbertas().filter(c =>
                normalizarPlaca(c.placa) === normalizarPlaca(ctx.PLACA));
              const real = daPlaca.find(c => !c.aguardandoCarga) || null;
              const orfaViva = daPlaca.some(c => c.aguardandoCarga);
              const noHistorico = (DB.alteracoes || []).some(a =>
                a.campo === 'Entrada sem carga' &&
                String(a.para || '').includes('absorvida'));
              return {
                abertas: daPlaca.length,
                numeros: daPlaca.map(c => c.numeroCarga),
                status: real ? real.status : null,
                entradaHerdada: real
                  ? (primeiroTimestamp(real.id, 'Aguardando Embarque') || null)
                  : null,
                orfaViva, noHistorico,
                entradaOriginal: ctx.entrada
              };
            }""", {'PLACA': d['PLACA'], 'entrada': d['entrada']})

        ck('sobra UMA carga aberta na placa, não duas',
           r['abertas'] == 1, f"{r['abertas']} aberta(s): {r['numeros']}")
        ck('a que sobra é a carga real, com número',
           r['numeros'] == ['999001'], str(r['numeros']))
        ck('e ela já está em "Aguardando Embarque" — o caminhão ESTÁ aqui',
           r['status'] == 'Aguardando Embarque', str(r['status']))
        ck('a entrada órfã saiu da operação',
           not r['orfaViva'], f"ainda viva: {r['orfaViva']}")
        ck('o horário de entrada é o da Portaria, não o da programação',
           r['entradaHerdada'] == r['entradaOriginal'],
           f"herdado={r['entradaHerdada']} original={r['entradaOriginal']}")
        ck('e a absorção ficou registrada no Histórico',
           r['noHistorico'], 'pátio não se apaga')

        print('\n=== SEM ERRO DE JAVASCRIPT ===')
        ck('console limpo', not erros, str(erros))
        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print(f'    · {f}')
        sys.exit(1)
    print('  Tudo verde.')


asyncio.run(main())
