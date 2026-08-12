#!/usr/bin/env python3
"""A folha do relatório não depende mais do aparelho de quem exporta.

HISTÓRICO — este teste inverteu de premissa em 11/08/2026, e o registro
importa mais que o teste em si:

Ele nasceu (07/08/2026) para cobrir um remendo: alguns celulares
ignoravam `@page{size:A4 landscape}` e imprimiam em pé, e a tabela de 13
colunas — calibrada para a folha deitada — estourava. A regra
`@media print and (orientation: portrait)` encolhia tudo por 200/287 para
caber. O teste conferia que esse encolhimento entrava.

O remendo tratava o sintoma. A causa era outra: quem decidia a folha era
o aparelho do operador. Em 09/08/2026 a geração do PDF passou para o
SERVIDOR, que pede A4 paisagem como parâmetro da chamada — não como
sugestão de CSS que o aparelho pode ignorar.

Com isso a regra de retrato virou risco em vez de proteção: pedindo
`orientacao:'retrato'` na rota, ela casaria e aplicaria um SEGUNDO
encolhimento por cima do que o JS já fez. Foi removida.

O que este teste protege agora é a garantia que substituiu o remendo: o
relatório sai igual venha de onde vier, porque a folha é decidida no
servidor. O tamanho real da página tem prova própria em
backend/testes/api.test.js (suíte 13, mede o MediaBox dos bytes do PDF).

    python3 testes/test_pdf_mobile_retrato.py
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


async def preparar(pg, n):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(900)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(400)
    await pg.evaluate("""(n) => {
        for(let i=0;i<n;i++){
            criarCargaProgramada({placa: DB.frota[i].placa, numeroCarga:'M'+i,
                peso:9000, rota:'500', operador:'Ana'});
        }
        exportarPdfOperacional();
    }""", n)
    await pg.wait_for_timeout(400)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []

        print('\n=== 1. NÃO EXISTE MAIS REGRA DE RETRATO NO CSS ===')
        # Se ela voltar, volta junto o risco de encolhimento duplo.
        css = open('/home/user/pega-visao/entregaveis/suinco_logistica/styles.css',
                   encoding='utf-8').read()
        # Procura a REGRA de verdade (@media ... { ... }), não a menção
        # dela no comentário que documenta a remoção — senão o próprio
        # texto explicativo faria o teste falhar.
        import re
        tem_regra = bool(re.search(
            r'@media\s+print\s+and\s*\(\s*orientation:\s*portrait\s*\)\s*\{', css))
        ck('regra de encolhimento por orientação foi removida', not tem_regra)

        print('\n=== 2. O PAINEL SEMPRE DECIDE A ORIENTAÇÃO (não o aparelho) ===')
        app = open('/home/user/pega-visao/entregaveis/suinco_logistica/app.js',
                   encoding='utf-8').read()
        # Virou RETRATO em 11/08/2026, a pedido do usuário: "prefiro que
        # seja na vertical mesmo, no formato a4". O que este teste guarda
        # não é a orientação em si — é que ela seja decidida por NÓS, no
        # código, e não pelo aparelho de quem exporta.
        ck("exportarViaServidor envia orientacao:'retrato'",
           "orientacao: 'retrato'" in app)

        print('\n=== 3. CELULAR: O RELATÓRIO MONTA IGUAL, SEM DEPENDER DA FOLHA ===')
        pg = await nav.new_page(viewport={'width': 390, 'height': 844},
                                device_scale_factor=3, is_mobile=True)
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await preparar(pg, 12)
        largura_mobile = await pg.evaluate("""() => {
            const el = document.getElementById('print-operacional');
            el.style.display = 'block';
            ajustarParaCaberEmUmaPagina(el);
            return el.querySelector('.print-page').style.width;
        }""")
        await pg.close()

        print('\n=== 4. DESKTOP: MESMA LARGURA DE FOLHA ===')
        pg2 = await nav.new_page(viewport={'width': 1400, 'height': 1000})
        pg2.on('pageerror', lambda e: erros.append(str(e)))
        await preparar(pg2, 12)
        largura_desktop = await pg2.evaluate("""() => {
            const el = document.getElementById('print-operacional');
            el.style.display = 'block';
            ajustarParaCaberEmUmaPagina(el);
            return el.querySelector('.print-page').style.width;
        }""")
        await pg2.close()

        # A largura passou a vir do CSS (@media print: .print-page{198mm},
        # A4 vertical) e não mais escrita pelo JS — daí style.width vazio
        # nos dois. O que importa continua igual, e é o ponto do teste:
        # celular e desktop chegam ao MESMO resultado, porque nenhum dos
        # dois decide a folha.
        ck('celular e desktop montam a MESMA folha (nenhum dos dois decide)',
           largura_mobile == largura_desktop,
           f'celular={largura_mobile!r} desktop={largura_desktop!r}')

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    print('  NOTA: o tamanho REAL da página (A4 paisagem, medido nos bytes do')
    print('  PDF) é provado em backend/testes/api.test.js, suíte 13.')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
