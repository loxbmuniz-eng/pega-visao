#!/usr/bin/env python3
"""Os gráficos leem nos dois temas e sem ruído (07/10/2026, auditoria dataviz).

A AUDITORIA (skill dataviz, aprovada pelo dono) achou, nos gráficos da aba
Indicadores e na aba Pagamento de Frete:
  1. o dourado #e9b954 desenhado direto no tema CLARO tem contraste 1,64 com
     o fundo — barra que quase some. Agora cada tema tem a sua cor de
     gráfico (--graf-1): dourado no escuro, dourado queimado no claro;
  2. as barras Entregue · Liberado · Pago tinham três cores — cada linha já
     tem o nome escrito; a cor só fazia o olho procurar significado que não
     existe. Uma cor só;
  3. as etapas do raio-X usavam as cores de STATUS (reservadas ao status da
     carga) para dizer "duração". Uma cor só;
  4. textos dentro dos gráficos com 9,5 e 10 px — abaixo do piso de 12 px;
  5. a "Evolução" punha número em TODA barra (28 números): rótulo seletivo —
     o maior e o de hoje em cada painel; o resto fica na dica;
  6. o gráfico de barras em canvas não dizia nada ao passar o mouse.

    bash testes/rodar_tudo.sh test_graficos_dataviz
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
VITRINE = 'file://' + os.path.join(os.path.dirname(AQUI), 'vitrine', 'vitrine.html')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


CONTRASTE = """(tema) => {
  document.documentElement.setAttribute('data-tema', tema);
  const cs = getComputedStyle(document.documentElement);
  const hex = (s) => { s = s.trim(); if (s.startsWith('#')) { const h = s.slice(1); const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
      return [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16)); }
    return (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number); };
  const lum = (c) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
    return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const g = cs.getPropertyValue('--graf-1').trim(), fundo = cs.getPropertyValue('--navy').trim();
  if (!g) return { g: null };
  const a = lum(hex(g)), b = lum(hex(fundo));
  return { g, fundo, contraste: Math.round(((Math.max(a, b) + .05) / (Math.min(a, b) + .05)) * 100) / 100 };
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1440, 'height': 1000})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(VITRINE)
        await pg.wait_for_timeout(2500)

        print('\n=== 1. UMA COR DE GRÁFICO POR TEMA, QUE APARECE NO FUNDO ===')
        for tema in ('escuro', 'claro'):
            r = await pg.evaluate(CONTRASTE, tema)
            ck(f'{tema}: existe a cor de gráfico --graf-1', bool(r.get('g')), str(r))
            if r.get('g'):
                ck(f'{tema}: contraste da cor do gráfico com o fundo >= 3:1', r['contraste'] >= 3, str(r))
        await pg.evaluate("() => document.documentElement.setAttribute('data-tema', 'escuro')")

        print('\n=== 2. AS BARRAS DO FRETE: UMA COR SÓ ===')
        await pg.evaluate("() => abrirTab('frete')")
        await pg.wait_for_timeout(1200)
        cores = await pg.evaluate("""() => [...new Set([...document.querySelectorAll('#tab-frete .frete-and-trilho > span')]
            .map(s => getComputedStyle(s).backgroundColor))]""")
        ck('Entregue, Liberado e Pago com a MESMA cor', len(cores) == 1, str(cores))

        print('\n=== 3, 4 e 5. INDICADORES ===')
        await pg.evaluate("() => abrirTab('indicadores')")
        await pg.wait_for_timeout(1500)
        t = await pg.evaluate("""() => {
            const svgs = [...document.querySelectorAll('.heatmap-svg, .evolucao-svg')];
            const pequenos = [];
            svgs.forEach(s => s.querySelectorAll('text').forEach(x => {
              const fs = parseFloat(x.getAttribute('font-size') || getComputedStyle(x).fontSize);
              if (fs < 12) pequenos.push(x.textContent.trim() + ' ' + fs);
            }));
            const evo = document.querySelector('.evolucao-svg');
            const numeros = evo ? [...evo.querySelectorAll('text.evo-rotulo')].length : null;
            const todos = evo ? [...evo.querySelectorAll('text')].length : null;
            return { svgs: svgs.length, pequenos: pequenos.slice(0, 6), nPequenos: pequenos.length, numeros, todos };
        }""")
        ck('os gráficos do Pulso estão na tela', t['svgs'] >= 2, str(t))
        ck('nenhum texto de gráfico abaixo de 12 px', t['nPequenos'] == 0, str(t['pequenos']))
        # 2 painéis × (o maior + o de hoje) = no máximo 4 números; 14 dias, 2 títulos
        ck('Evolução com rótulo seletivo: no máximo 4 números (o maior e o de hoje de cada painel)',
           t['numeros'] is not None and t['numeros'] <= 4 and t['todos'] <= 14 + 2 + 4, str(t))

        etapas = await pg.evaluate("""() => {
            const div = document.createElement('div');
            div.innerHTML = barrasEtapasSvg({tempoAguardandoEmbarque:30, tempoCarregamento:60, tempoFaturamento:20, tempoAguardandoSaida:15},
                                            {tempoAguardandoEmbarque:40, tempoCarregamento:50, tempoFaturamento:25, tempoAguardandoSaida:10});
            document.body.appendChild(div);
            const fills = [...div.querySelectorAll('rect[fill]')].map(r => r.getAttribute('fill'));
            div.remove();
            return [...new Set(fills)];
        }""")
        ck('etapas do raio-X com UMA cor (não as cores de status)', len(etapas) == 1, str(etapas))

        print('\n=== 6. O GRÁFICO DE BARRAS DIZ O VALOR AO PASSAR O MOUSE ===')
        dica = await pg.evaluate("""() => {
            const c = document.getElementById('grafico-barras') || document.querySelector('canvas');
            if (!c) return { canvas: false };
            c.scrollIntoView();
            const r = c.getBoundingClientRect();
            return { canvas: true, x: r.left + r.width / (2 * 4), y: r.top + r.height / 2, id: c.id };
        }""")
        if dica.get('canvas'):
            await pg.mouse.move(dica['x'], dica['y'])
            await pg.wait_for_timeout(200)
            titulo = await pg.evaluate("(id) => (document.getElementById(id) || {}).title || ''", dica['id'])
            ck('ao passar o mouse na barra, a dica diz a etapa e o tempo', bool(titulo.strip()), repr(titulo))
        else:
            ck('o gráfico de barras está na tela', False, str(dica))

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\nRESULTADO:', 'OK' if not falhas else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
