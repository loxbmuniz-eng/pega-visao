#!/usr/bin/env python3
"""Gráfico da aba Indicadores virava uma coluna gigante em iPhone real.

Achado pelo usuário com print de tela real (08/08/2026, "3:45", iPhone,
4G): as barras do gráfico saíam da tela, cada vez mais altas — a mesma
barra foi de ~29min visível até "1h42min" ocupando quase a tela inteira em
minutos, sem o painel ter recarregado.

RAIZ: `prepararCanvas()` (app.js) lia a altura pretendida do canvas em
`canvas.height` — mas também ESCREVE `canvas.height` embaixo, com o
tamanho do buffer em pixels de DISPOSITIVO (`cssH * devicePixelRatio`). Na
segunda chamada (redimensionar, mudar filtro, qualquer atualização ao vivo
— todas chamam renderGraficosIndicadores() de novo), a função lia de volta
o valor JÁ multiplicado e multiplicava de novo. Num desktop com dpr=1 isso
nunca aparece (1×1×1... continua 1) — por isso nenhum teste desta sessão,
todos rodados em Chromium headless com dpr=1, pegou o bug. Num iPhone com
dpr≈3, duas chamadas já bastam para 160px virar 1440px.

Este teste reproduz o dpr alto (device_scale_factor) e chama o
redesenho várias vezes seguidas, como um filtro trocado repetidas vezes ou
uma atualização ao vivo chegando — a altura do canvas tem que ficar igual
em todas as chamadas.

    python3 testes/test_grafico_altura_dpr.py
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
        erros = []
        # device_scale_factor=3 reproduz um iPhone real (o Chromium headless
        # padrão dos outros testes desta sessão usa 1, onde o bug não aparece).
        ctx = await nav.new_context(
            viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True,
            device_scale_factor=3)
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate("""() => {
            DB.operador = {nome:'Chefe', setor:'Administração'};
            document.getElementById('modal-operador')?.classList.remove('open');
            abrirTab('indicadores');
        }""")
        await pg.wait_for_timeout(400)

        print('\n=== ALTURA DO CANVAS FICA ESTÁVEL EM VÁRIAS CHAMADAS (dpr=3) ===')
        alturas = []
        for i in range(6):
            # Simula o que dispara renderGraficosIndicadores() de novo na
            # vida real: mudar um filtro, ou uma atualização remota chegando.
            await pg.evaluate("() => renderGraficosIndicadores()")
            await pg.wait_for_timeout(50)
            h = await pg.evaluate("""() => {
                const c = document.getElementById('grafico-barras');
                return { cssHeight: parseFloat(getComputedStyle(c).height), bufferHeight: c.height };
            }""")
            alturas.append(h)
            print(f"  chamada {i+1}: CSS={h['cssHeight']}px, buffer={h['bufferHeight']}px")

        css_heights = [a['cssHeight'] for a in alturas]
        ck('altura CSS do canvas é a MESMA em todas as 6 chamadas (não cresce)',
           len(set(css_heights)) == 1, str(css_heights))
        ck('altura CSS fica perto do valor pretendido (160px), não explode',
           abs(css_heights[-1] - 160) < 2, f"{css_heights[-1]}px")

        print('\n=== A BARRA NÃO ESTOURA A ALTURA DO GRÁFICO ===')
        # Cria uma carga com um tempo de etapa razoável e confere que a barra
        # desenhada cabe dentro da altura do canvas — não vaza pra fora dele.
        await pg.evaluate("""() => {
            const id = criarCargaProgramada({placa: DB.frota[0].placa, numeroCarga:'R1',
              peso:9000, rota:'500', operador:'Chefe'}).id;
            avancarStatusCarga(id, 'Aguardando Embarque', 'Chefe', 'Logística');
        }""")
        for i in range(3):
            await pg.evaluate("() => renderGraficosIndicadores()")
            await pg.wait_for_timeout(50)
        canvas_info = await pg.evaluate("""() => {
            const c = document.getElementById('grafico-barras');
            const r = c.getBoundingClientRect();
            return { height: r.height };
        }""")
        ck('canvas continua com altura razoável depois de dados reais + re-render',
           canvas_info['height'] < 200, f"{canvas_info['height']}px")

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
