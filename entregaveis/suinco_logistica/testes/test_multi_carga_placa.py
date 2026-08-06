#!/usr/bin/env python3
"""Duas cargas no mesmo caminhão.

Acontece pouco — e é justamente por ser raro que dá errado. Quando aparece,
ninguém lembra se o sistema aceita, e duas linhas com a mesma placa na fila
são indistinguíveis de um erro de digitação. Alguém "corrige" a duplicidade
que não existe e apaga uma carga de verdade.

O que se prova aqui:

1. O modelo ACEITA duas cargas em aberto para a mesma placa (sempre aceitou —
   a Portaria já aplica o "Chegou" a todas as cargas da placa de uma vez).
2. O formulário AVISA quando a placa digitada já tem carga em aberto, sem
   bloquear: bloquear quebraria o caso legítimo.
3. O botão "➕ Outra carga" repete o VEÍCULO e zera a CARGA — herdar o número
   da carga anterior é o erro que o botão existe para evitar.
4. A fila marca "1 de 2" / "2 de 2", em Programação, Portaria e visão do pátio.
5. A chegada da Portaria move as DUAS cargas de uma vez.

    python3 testes/test_multi_carga_placa.py
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


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)

        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)

        placa = await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = []; SuincoStore.save();
            return DB.frota[0].placa;
        }""")
        print(f'\n=== PLACA DE TESTE: {placa} ===')

        print('\n=== 1. PRIMEIRA CARGA ===')
        await pg.evaluate("()=>abrirTab('programacao')")
        await pg.fill('#prog-placa', placa)
        await pg.evaluate("()=>atualizarPreviewFrotaPrograma()")
        await pg.fill('#prog-numero-carga', '90001')
        await pg.fill('#prog-motorista', 'José da Silva')
        await pg.fill('#prog-peso', '12000')
        await pg.select_option('#prog-rota', '500')
        await pg.click('button:has-text("Criar Carga")')
        await pg.wait_for_timeout(400)

        d = await pg.evaluate("""() => ({
            total: DB.cargas.length,
            aviso: !!document.querySelector('.aviso-placa-repetida'),
            marcas: [...document.querySelectorAll('#prog-fila-tbody .marca-multi')].length
        })""")
        ck('a carga foi criada', d['total'] == 1, f"{d['total']} carga(s)")
        ck('sem marca "de" com uma carga só', d['marcas'] == 0,
           'marca com uma carga só seria ruído')

        print('\n=== 2. O BOTÃO "OUTRA CARGA" PREPARA O FORMULÁRIO ===')
        botao = pg.locator('#prog-fila-tbody button:has-text("Outra carga")')
        ck('o botão existe na linha da fila', await botao.count() == 1,
           f'{await botao.count()} botão(ões)')
        await botao.first.click()
        await pg.wait_for_timeout(400)

        f = await pg.evaluate("""() => ({
            placa: document.getElementById('prog-placa').value,
            transportadora: document.getElementById('prog-transportadora').value,
            motorista: document.getElementById('prog-motorista').value,
            rota: document.getElementById('prog-rota').value,
            numero: document.getElementById('prog-numero-carga').value,
            peso: document.getElementById('prog-peso').value,
            obs: document.getElementById('prog-obs').value,
            entregas: document.getElementById('prog-entregas').value,
            aviso: (document.querySelector('.aviso-placa-repetida')||{}).innerText || ''
        })""")
        ck('repete a PLACA', f['placa'] == placa, f['placa'])
        ck('repete a transportadora', bool(f['transportadora']), f['transportadora'])
        ck('repete o motorista', f['motorista'] == 'José da Silva', f['motorista'])
        ck('repete a rota', f['rota'] == '500', f['rota'])
        ck('ZERA o número da carga', f['numero'] == '',
           'herdar o número gravaria duas cargas com o mesmo número')
        ck('ZERA o peso', f['peso'] == '', f['peso'])
        ck('ZERA as observações', f['obs'] == '', f['obs'])
        ck('volta entregas ao padrão', f['entregas'] == '1', f['entregas'])
        ck('avisa que a placa já tem carga em aberto', '90001' in f['aviso'],
           repr(f['aviso'][:90]))

        print('\n=== 3. SEGUNDA CARGA NA MESMA PLACA ===')
        await pg.fill('#prog-numero-carga', '90002')
        await pg.fill('#prog-peso', '9000')
        await pg.click('button:has-text("Criar Carga")')
        await pg.wait_for_timeout(400)

        d = await pg.evaluate("""() => {
            const marcas = [...document.querySelectorAll('#prog-fila-tbody .marca-multi')]
                             .map(e=>e.innerText.trim());
            return {
                total: DB.cargas.length,
                numeros: DB.cargas.map(c=>c.numeroCarga).sort(),
                placasIguais: new Set(DB.cargas.map(c=>c.placa)).size,
                marcas
            };
        }""")
        ck('as duas cargas existem', d['total'] == 2, str(d['numeros']))
        ck('números diferentes', d['numeros'] == ['90001', '90002'], str(d['numeros']))
        ck('mesma placa nas duas', d['placasIguais'] == 1)
        ck('a fila marca "1 de 2" e "2 de 2"',
           d['marcas'] == ['1 de 2', '2 de 2'], str(d['marcas']))

        print('\n=== 4. A MARCA APARECE NOS OUTROS SETORES ===')
        await pg.evaluate("()=>{ abrirTab('portaria'); renderAll(); }")
        await pg.wait_for_timeout(400)
        m = await pg.evaluate("""() => ({
            portaria: [...document.querySelectorAll('#portaria-prog-tbody .marca-multi')]
                        .map(e=>e.innerText.trim()),
            patio: [...document.querySelectorAll('#portaria-vp-tbody .marca-multi')]
                        .map(e=>e.innerText.trim())
        })""")
        ck('Portaria — cargas programadas marca as duas',
           m['portaria'] == ['1 de 2', '2 de 2'], str(m['portaria']))
        ck('Portaria — visão do pátio marca as duas',
           m['patio'] == ['1 de 2', '2 de 2'], str(m['patio']))

        print('\n=== 5. "CHEGOU" MOVE AS DUAS DE UMA VEZ ===')
        # O caminhão chega fisicamente uma vez só. Se a chegada movesse uma
        # carga e deixasse a outra em "Aguardando Veículo", a Expedição veria
        # meio caminhão no pátio.
        r = await pg.evaluate("""(placa) => {
            registrarChegadaPortaria(placa, 'Porteiro');
            return DB.cargas.map(c => c.status);
        }""", placa)
        ck('as duas cargas avançaram juntas',
           r == ['Aguardando Embarque', 'Aguardando Embarque'], str(r))

        print('\n=== 6. CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
