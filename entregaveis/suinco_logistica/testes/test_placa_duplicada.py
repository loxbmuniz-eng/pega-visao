#!/usr/bin/env python3
"""Impede placa duplicada na mesma programação — sem impedir multi-carga.

Pedidos do usuário (11/08/2026), que só parecem se contradizer:
  - "criar uma carga com a mesma placa pra rotas diferentes"
  - "a ideia é nao duplicar placas na mesma programacao, podendo somente
     duplicar cargas na mesma placa, e poder ter rotas diferentes"
  - "IMPEDIR DUPLICIDADE DE PLACAS DENTRO DA MESMA PROGRAMACAO DE
     EMBARQUE SOMENTE APÓS O VEICULO SAIR E RETORNAR PARA NOVO INPUT"

A leitura que concilia os três: o que se barra é o ACIDENTE (lançar a
mesma placa de novo no formulário sem perceber que ela já está no pátio).
O caso real — um caminhão levando duas cargas, com rotas diferentes —
continua possível pelo botão "➕ Outra carga", que é decisão consciente.
E depois que o veículo sai (Seguiu Viagem), a placa fica livre sozinha.

    python3 testes/test_placa_duplicada.py
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


async def preencher_e_criar(pg, placa, numero, rota='500'):
    await pg.fill('#prog-placa', placa)
    await pg.evaluate("() => atualizarPreviewFrotaPrograma()")
    await pg.fill('#prog-numero-carga', numero)
    await pg.fill('#prog-peso', '9000')
    await pg.select_option('#prog-rota', rota)
    await pg.evaluate("() => criarCargaProgramadaUI()")
    await pg.wait_for_timeout(500)


async def contar(pg, placa):
    return await pg.evaluate("(p) => cargasAbertasPorPlaca(p).length", placa)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)
        await pg.evaluate("() => irParaTab('programacao')")
        await pg.wait_for_timeout(400)

        placa = await pg.evaluate("() => DB.frota[0].placa")

        print('\n=== 1. PRIMEIRA CARGA DA PLACA: PASSA ===')
        await preencher_e_criar(pg, placa, 'DUP-1')
        ck('primeira carga criada', await contar(pg, placa) == 1)

        print('\n=== 2. MESMA PLACA DE NOVO PELO FORMULÁRIO: BARRA ===')
        # Limpa a área de avisos: o painel limita quantos ficam visíveis ao
        # mesmo tempo e enfileira o resto, então sem isto o aviso novo pode
        # não estar na tela no instante da leitura.
        await pg.evaluate("() => { document.getElementById('notif').innerHTML = ''; }")
        await preencher_e_criar(pg, placa, 'DUP-2')
        ck('não criou a segunda por engano', await contar(pg, placa) == 1,
           str(await contar(pg, placa)))
        avisos = await pg.evaluate(
            "() => Array.from(document.querySelectorAll('.notif-item')).map(n=>n.textContent).join(' | ')")
        ck('explica como lançar outra carga de propósito',
           'Outra carga' in avisos, avisos[:200])

        print('\n=== 3. PELO BOTÃO "OUTRA CARGA": PERMITE, COM ROTA DIFERENTE ===')
        await pg.evaluate("""(p) => {
            const c = cargasAbertasPorPlaca(p)[0];
            adicionarOutraCargaNaPlacaUI(c.id);
        }""", placa)
        await pg.wait_for_timeout(400)
        await pg.fill('#prog-numero-carga', 'DUP-3')
        await pg.fill('#prog-peso', '8000')
        await pg.select_option('#prog-rota', '501')      # rota DIFERENTE
        await pg.evaluate("() => criarCargaProgramadaUI()")
        await pg.wait_for_timeout(600)
        ck('segunda carga deliberada foi criada', await contar(pg, placa) == 2,
           str(await contar(pg, placa)))
        rotas = await pg.evaluate("(p) => cargasAbertasPorPlaca(p).map(c=>c.rota)", placa)
        ck('as duas cargas têm rotas diferentes', len(set(rotas)) == 2, str(rotas))

        print('\n=== 4. A AUTORIZAÇÃO VALE UMA VEZ SÓ ===')
        await preencher_e_criar(pg, placa, 'DUP-4')
        ck('terceira por engano continua barrada', await contar(pg, placa) == 2,
           str(await contar(pg, placa)))

        print('\n=== 5. DEPOIS DE SEGUIR VIAGEM, A PLACA FICA LIVRE ===')
        await pg.evaluate("""(p) => {
            cargasAbertasPorPlaca(p).forEach(c => {
                ['Aguardando Embarque','Embarque Iniciado','Embarque Finalizado',
                 'Faturado','Seguiu Viagem'].forEach(st =>
                    avancarStatusCarga(c.id, st, 'Ana', 'Logística'));
            });
            renderAll();
        }""", placa)
        await pg.wait_for_timeout(700)
        ck('nenhuma carga em aberto na placa', await contar(pg, placa) == 0)

        await preencher_e_criar(pg, placa, 'DUP-5')
        ck('placa aceita novo lançamento depois de sair', await contar(pg, placa) == 1,
           str(await contar(pg, placa)))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
