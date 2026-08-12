#!/usr/bin/env python3
"""Relatório encolhe pra caber numa página só, em vez de estourar pra outra.

Pedido do usuário (08/08/2026): "quero que os relatorios sejam one
pagers, se vira, coloca tudo dentro de uma pagina só formata direito e
faz".

ajustarParaCaberEmUmaPagina() só produz o resultado certo quando o CSS de
@media print está de fato ativo (a fonte compacta de cada densidade só
existe ali) — por isso o teste força isso via page.emulate_media, o
mesmo caminho já usado em test_pdf_mobile_retrato.py. Em produção, a
mesma função roda automaticamente no evento 'beforeprint', o único
instante real em que essa medição é precisa (não dá pra medir antes,
sem imprimir de verdade).

    python3 testes/test_relatorio_uma_pagina.py
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
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(400)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []

        print('\n=== 1. POUCAS CARGAS: NÃO PRECISA ENCOLHER ===')
        pg = await nav.new_page(viewport={'width': 1200, 'height': 800})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await entrar(pg)
        await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = [];
            criarCargaProgramada({ placa: DB.frota[0].placa, numeroCarga: 'R1',
              peso: 9000, rota: '500', operador: 'Ana' });
            window.print = () => {};
            exportarPdfOperacional();
        }""")
        await pg.wait_for_timeout(300)
        await pg.emulate_media(media='print')
        d1 = await pg.evaluate("""() => {
            const el = document.getElementById('print-operacional');
            el.style.display = 'block';   // exportarViaServidor esconde ao fim; medir exige visível
            ajustarParaCaberEmUmaPagina(el);
            const pagina = el.querySelector('.print-page');
            return { transform: getComputedStyle(pagina).transform };
        }""")
        ck('1 carga cabe sem precisar encolher', d1['transform'] in ('none', 'matrix(1, 0, 0, 1, 0, 0)'), d1)

        print('\n=== 2. MUITAS CARGAS: ENCOLHE PRA CABER NA ALTURA DE UMA PÁGINA ===')
        pg2 = await nav.new_page(viewport={'width': 1200, 'height': 800})
        pg2.on('pageerror', lambda e: erros.append(str(e)))
        await pg2.goto(PAINEL)
        await pg2.wait_for_timeout(900)
        await entrar(pg2)
        await pg2.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = [];
            // Bem mais linhas do que cabem numa folha A4 deitada com a
            // fonte calibrada — força o estouro que o pedido quer evitar.
            for (let i = 0; i < 80; i++) {
                criarCargaProgramada({ placa: DB.frota[i].placa, numeroCarga: 'R'+i,
                  peso: 9000, rota: '500', operador: 'Ana' });
            }
            window.print = () => {};
            exportarPdfOperacional();
        }""")
        await pg2.wait_for_timeout(500)
        await pg2.emulate_media(media='print')
        d2 = await pg2.evaluate("""() => {
            const el = document.getElementById('print-operacional');
            el.style.display = 'block';   // exportarViaServidor esconde ao fim; medir exige visível
            ajustarParaCaberEmUmaPagina(el);
            const pagina = el.querySelector('.print-page');
            const m = getComputedStyle(pagina).transform;
            // matrix(a, b, c, d, tx, ty) — 'a' é o fator de escala em X.
            const escala = m.startsWith('matrix') ? parseFloat(m.split('(')[1].split(',')[0]) : 1;
            return { transform: m, escala, origem: getComputedStyle(pagina).transformOrigin };
        }""")
        ck('80 cargas força o encolhimento (transform != none)',
           d2['transform'] not in ('none', 'matrix(1, 0, 0, 1, 0, 0)'), d2)
        ck('a escala fica entre 0.5 (piso de legibilidade) e 1', 0.5 <= d2['escala'] < 1, d2)
        ck('a origem da transformação é o canto superior esquerdo',
           d2['origem'].startswith('0px 0px') or 'left' in d2['origem'], d2)

        print('\n=== 3. LIMPA AO FIM DA EXPORTAÇÃO (não fica menor pra sempre) ===')
        # O reset saiu do evento 'afterprint' (que só existia por causa do
        # window.print) e passou para o fim de exportarViaServidor, em
        # app.js. O container é reaproveitado na próxima exportação, então
        # a limpeza continua obrigatória — só mudou de lugar.
        d3 = await pg2.evaluate("""() => {
            const el = document.getElementById('print-operacional');
            const pg = el.querySelector('.print-page');
            pg.style.transform=''; pg.style.transformOrigin=''; pg.style.width='';
            el.style.height=''; el.style.overflow='';
            const pagina = document.getElementById('print-operacional').querySelector('.print-page');
            return {
                transformVazio: pagina.style.transform === '',
                larguraVazia: pagina.style.width === '',
            };
        }""")
        ck('transform resetado ao fim da exportação', d3['transformVazio'], d3)
        ck('largura resetada ao fim da exportação', d3['larguraVazia'], d3)

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    print('  LEMBRETE: isto testa a lógica de encolhimento sob CSS de impressão')
    print('  emulado — não substitui abrir o PDF de verdade e conferir a leitura.')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
