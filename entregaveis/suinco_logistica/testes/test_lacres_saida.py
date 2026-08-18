#!/usr/bin/env python3
"""Lacres na saída dos caminhões (pedido do gestor, 18/08/2026).

Cada caminhão, ao sair para inspeção, recebe um lacre numerado. Às vezes o
lacre é RETIDO (carga incorreta ou outro motivo) e um número precisa ficar
registrado. O que se prova aqui, no painel:

  1. O "Saiu" da Portaria grava o lacre em TODAS as cargas Faturadas da
     placa (o lacre é do caminhão, não de uma carga).
  2. A retenção guarda o número retido, promove o novo lacre a vigente e
     escreve o motivo nas observações — com quem registrou.
  3. A ficha da carga (linha do tempo) mostra o lacre e o retido.
  4. A Torre agora edita Entregas (o campo que faltava — mesmo pedido).

    python3 testes/test_lacres_saida.py
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
            criarCargaProgramada({placa: DB.frota[0].placa, numeroCarga:'70001',
                peso:12000, rota:'500', operador:'Ana'});
            criarCargaProgramada({placa: DB.frota[0].placa, numeroCarga:'70002',
                peso:8000, rota:'500', operador:'Ana'});
            DB.cargas.forEach(c => { c.status = 'Faturado'; });
            SuincoStore.save(); renderAll();
            return DB.frota[0].placa;
        }""")

        print('\n=== 1. SAÍDA COM LACRE GRAVA NAS DUAS CARGAS DA PLACA ===')
        await pg.evaluate("() => abrirTab('portaria')")
        await pg.wait_for_timeout(400)
        await pg.fill('#portaria-placa', placa)
        await pg.fill('#portaria-lacre', '133476')
        await pg.click('button:has-text("🏁 Saiu")')
        await pg.wait_for_timeout(500)
        d = await pg.evaluate("""() => DB.cargas.map(c => ({s: c.status, l: c.lacre}))""")
        ck('as duas cargas seguiram viagem', all(x['s'] == 'Seguiu Viagem' for x in d), str(d))
        ck('o lacre 133476 ficou nas DUAS cargas', all(x['l'] == '133476' for x in d), str(d))
        campo = await pg.evaluate("() => document.getElementById('portaria-lacre').value")
        ck('o campo do lacre limpa após a saída', campo == '', repr(campo))

        print('\n=== 2. RETENÇÃO: NÚMERO RETIDO + NOVO LACRE + MOTIVO ===')
        await pg.fill('#lacre-ret-placa', placa)
        await pg.fill('#lacre-ret-numero', '133476')
        await pg.fill('#lacre-ret-novo', '133480')
        await pg.fill('#lacre-ret-motivo', 'carga incorreta')
        await pg.click('button:has-text("Registrar retenção")')
        await pg.wait_for_timeout(500)
        r = await pg.evaluate("""() => DB.cargas.map(c => ({
            retido: c.lacreRetido, vigente: c.lacre, obs: c.observacoes }))""")
        ck('o número retido ficou guardado', all(x['retido'] == '133476' for x in r), str(r)[:120])
        ck('o novo lacre virou o vigente', all(x['vigente'] == '133480' for x in r))
        ck('o motivo foi para as observações, com autor',
           all('RETIDO' in x['obs'] and 'carga incorreta' in x['obs'] and 'Ana' in x['obs'] for x in r),
           r[0]['obs'][:90])

        print('\n=== 3. A FICHA DA CARGA MOSTRA OS LACRES ===')
        await pg.evaluate("() => abrirTab('historico')")
        await pg.fill('#hist-busca-carga', '70001')
        await pg.wait_for_timeout(600)
        ficha = await pg.evaluate("() => document.body.innerText")
        ck('lacre vigente na ficha', '133480' in ficha)
        ck('lacre retido na ficha', '133476' in ficha)

        print('\n=== 4. TORRE EDITA ENTREGAS (CAMPO QUE FALTAVA) ===')
        await pg.evaluate("""() => {
            criarCargaProgramada({placa: DB.frota[1].placa, numeroCarga:'70003',
                peso:5000, rota:'500', operador:'Ana'});
            abrirTab('torre');
        }""")
        await pg.wait_for_timeout(500)
        tem_input = await pg.evaluate(
            "() => document.querySelectorAll('#torre-tbody .entregas-input').length")
        ck('a Torre tem o campo de Entregas editável', tem_input >= 1, f'{tem_input} campo(s)')
        await pg.evaluate("""() => {
            const c = DB.cargas.find(x => x.numeroCarga === '70003');
            atualizarEntregasUI(c.id, '7');
        }""")
        valor = await pg.evaluate(
            "() => DB.cargas.find(x => x.numeroCarga === '70003').qtdEntregas")
        ck('a edição de Entregas pega e carimba', valor == 7, str(valor))

        print('\n=== 5. CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
