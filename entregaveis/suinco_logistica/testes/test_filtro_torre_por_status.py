#!/usr/bin/env python3
"""Clicar numa caixa da Torre filtra a tabela pra aquele status na hora.

Pedido do usuário (08/08/2026): "quero que a pessoa da logistica clique
nos quadrados referentes a por exemplo seguiu viagem, aguardando
embarque, aguardando veiculo... e faça um filtro instantâneo apontando
praquelas cargas de cada status".

Os NÚMEROS das caixas nunca mudam com o clique (continuam o total real);
só a lista de baixo aponta pras cargas daquele status. Clicar de novo na
mesma caixa (ou em "Cargas em aberto") limpa o filtro.

    python3 testes/test_filtro_torre_por_status.py
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
        await pg.wait_for_timeout(400)

        await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = [];
            const f = DB.frota;
            // 2 em Aguardando Veículo, 1 em Aguardando Embarque, 1 Seguiu Viagem hoje.
            criarCargaProgramada({ placa: f[0].placa, numeroCarga: 'AV1', peso: 9000, rota: '500', operador: 'Ana' });
            criarCargaProgramada({ placa: f[1].placa, numeroCarga: 'AV2', peso: 9000, rota: '500', operador: 'Ana' });
            const c3 = criarCargaProgramada({ placa: f[2].placa, numeroCarga: 'AE1', peso: 9000, rota: '500', operador: 'Ana' });
            avancarStatusCarga(c3.id, 'Aguardando Embarque', 'Ana', 'Logística');
            const c4 = criarCargaProgramada({ placa: f[3].placa, numeroCarga: 'SV1', peso: 9000, rota: '500', operador: 'Ana' });
            ['Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado','Seguiu Viagem']
                .forEach(st => avancarStatusCarga(c4.id, st, 'Ana', 'Logística'));
            abrirTab('torre'); renderAll();
        }""")
        await pg.wait_for_timeout(300)

        print('\n=== 1. SEM FILTRO: TABELA MOSTRA AS 3 EM ABERTO (não a que já saiu) ===')
        linhas0 = await pg.evaluate(
            "() => document.getElementById('torre-tbody').querySelectorAll('tr').length")
        ck('3 cargas em aberto na tabela (Seguiu Viagem fica de fora por padrão)', linhas0 == 3, linhas0)

        print('\n=== 2. CLICAR EM "AGUARDANDO VEÍCULO" FILTRA PRA 2 ===')
        await pg.evaluate("() => filtrarTorrePorStatus('Aguardando Veículo')")
        await pg.wait_for_timeout(150)
        d1 = await pg.evaluate("""() => ({
            linhas: document.getElementById('torre-tbody').querySelectorAll('tr').length,
            numerosNaTela: [...document.querySelectorAll('#torre-tbody .col-identificacao')]
                .map(td => { const inp = td.querySelector('input'); return inp ? inp.value.trim() : td.textContent.trim(); })
                .filter(t => t.startsWith('AV')),
            caixaAtiva: document.querySelector('.stat-ativo .stat-label')?.textContent.trim(),
        })""")
        ck('só as 2 de Aguardando Veículo aparecem', d1['linhas'] == 2, str(d1))
        ck('são exatamente AV1 e AV2', sorted(d1['numerosNaTela']) == ['AV1', 'AV2'], str(d1))
        ck('a caixa clicada fica marcada como ativa', d1['caixaAtiva'] == 'Aguardando Veículo', str(d1))

        print('\n=== 3. OS NÚMEROS DAS CAIXAS NÃO MUDAM COM O FILTRO ===')
        numAberto = await pg.evaluate(
            "() => document.querySelector('[data-contador=\"Cargas em aberto\"]').textContent.trim()")
        ck('"Cargas em aberto" continua mostrando o TOTAL (3), não o filtrado (2)',
           numAberto == '3', numAberto)

        print('\n=== 4. CLICAR DE NOVO NA MESMA CAIXA LIMPA O FILTRO ===')
        await pg.evaluate("() => filtrarTorrePorStatus('Aguardando Veículo')")
        await pg.wait_for_timeout(150)
        linhas2 = await pg.evaluate(
            "() => document.getElementById('torre-tbody').querySelectorAll('tr').length")
        ck('volta a mostrar as 3 em aberto', linhas2 == 3, linhas2)

        print('\n=== 5. "SEGUIU VIAGEM HOJE" MOSTRA A QUE JÁ SAIU (fora do padrão) ===')
        await pg.evaluate("() => filtrarTorrePorStatus('__SEGUIU_HOJE__')")
        await pg.wait_for_timeout(150)
        d2 = await pg.evaluate("""() => {
            const tds = [...document.querySelectorAll('#torre-tbody .col-identificacao')]
                .map(td => { const inp = td.querySelector('input'); return inp ? inp.value.trim() : td.textContent.trim(); });
            return { linhas: document.getElementById('torre-tbody').querySelectorAll('tr').length, tds };
        }""")
        ck('a carga que já seguiu viagem aparece (normalmente ficaria escondida)',
           d2['linhas'] == 1 and 'SV1' in d2['tds'], str(d2))

        print('\n=== 6. CLICAR EM "CARGAS EM ABERTO" SEMPRE LIMPA (nunca fica preso) ===')
        await pg.evaluate("() => filtrarTorrePorStatus('__TODAS__')")
        await pg.wait_for_timeout(150)
        linhas3 = await pg.evaluate(
            "() => document.getElementById('torre-tbody').querySelectorAll('tr').length")
        ck('volta pras 3 em aberto', linhas3 == 3, linhas3)

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
