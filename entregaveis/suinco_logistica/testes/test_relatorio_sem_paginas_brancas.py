#!/usr/bin/env python3
"""Relatório saía com páginas em branco sobrando no celular.

Relato do usuário (08/08/2026, depois do relatório já ter virado "one
pager" mais cedo nesta mesma sessão): "os relatorios pelo celular ainda
estao saindo com 3 paginas brancas sobrando... menos é mais só utillize
uma nova pagina se tiver informacao precisando de espaco".

RAIZ: `ajustarParaCaberEmUmaPagina()` (app.js) encolhe o relatório com
`transform:scale()` quando ele não cabe numa página — mas `transform`
SÓ afeta o DESENHO, nunca a altura de LAYOUT da caixa (é assim que a
especificação CSS define transform: ver comentário no código-fonte).
Uma `.print-page` com 500mm de altura original, escalada visualmente pra
caber em 287mm, continua "ocupando" 500mm no FLUXO do documento para fins
de paginação de impressão — o motor de impressão fatia esse excedente em
páginas extras.

Confirmado isolado (fora deste repositório, com HTML mínimo e
`page.pdf()` real do Chromium) ANTES de escrever o fix: uma caixa de teste
de 600mm de altura, escalada por 0,333 pra caber em 200mm, gerava 3
páginas — não 1. Envolvendo a caixa transformada num container com altura
TRAVADA na altura já escalada + `overflow:hidden`, virou exatamente 1
página. O mesmo princípio foi aplicado em `ajustarParaCaberEmUmaPagina()`.

Reproduzido também com o relatório de verdade (script fora deste
repositório): Executivo com 25 cargas foi de 6 páginas pra 3 depois do
fix (piso de 50% de encolhimento não é suficiente pra tudo caber numa
página — aceitável, ver comentário no código —, mas as 3 páginas restantes
têm conteúdo real, nenhuma em branco). Executivo com 3 cargas foi de 3
páginas pra 2.

Este teste cobre duas coisas:
1. O mecanismo em si (DOM): depois de `ajustarParaCaberEmUmaPagina()`
   rodar com escala < 1, o container pai (`.print-only`) precisa ter
   `height` travado na altura já escalada, com `overflow:hidden` — não a
   altura original da `.print-page` por baixo.
2. Um PDF de verdade (gerado via `page.pdf()` do Chromium real, não só
   inspeção de CSS): nenhuma página deve sair "em branco" quando existe
   conteúdo de sobra pra preenchê-la — usa extração de texto como prova.
   Depende de `pypdf` (`pip install pypdf`); se não estiver instalado,
   avisa e pula essa parte em vez de falhar com traceback confuso.

    python3 testes/test_relatorio_sem_paginas_brancas.py
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

        print('\n=== 1. MECANISMO: CONTAINER TRAVA NA ALTURA JÁ ESCALADA ===')
        # Mesma técnica de test_pdf_mobile_retrato.py: viewport estreito/alto +
        # emulate_media('print') faz orientation:portrait bater de verdade,
        # sem depender de page.pdf() (que sempre respeita @page{size:landscape}
        # deste painel, e por isso nunca simula o celular que a ignora).
        pg = await nav.new_page(viewport={'width': 700, 'height': 1100})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(400)
        await pg.evaluate("""() => {
            const placas = DB.frota.slice(0, 8).map(f=>f.placa);
            placas.forEach((p,i)=>{
                const c = criarCargaProgramada({placa:p, numeroCarga:'R'+i, peso:9000+i*100,
                  rota:'500', operador:'Ana'});
                avancarStatusCarga(c.id, 'Aguardando Embarque', 'Ana', 'Logística');
            });
            window.print = () => {};
            exportarPdfExecutivo();
        }""")
        await pg.wait_for_timeout(300)
        await pg.emulate_media(media='print')
        # `window.print` está mockado (não abre diálogo real, então o
        # evento 'beforeprint' de verdade nunca dispara sozinho) — dispara
        # manualmente, DEPOIS de emulate_media('print'), pra que
        # matchMedia('print and ...') dentro de ajustarParaCaberEmUmaPagina()
        # resolva no contexto certo. Sem isso o teste mediria só o valor
        # fixo da regra estática de CSS (scale(0.697)), não o cálculo
        # dinâmico da função — foi exatamente o engano que este teste
        # cometeu na primeira versão (viu 0.697 e achou que era a função
        # rodando; era só a CSS de sempre).
        await pg.evaluate("() => window.dispatchEvent(new Event('beforeprint'))")
        await pg.wait_for_timeout(100)
        info = await pg.evaluate("""() => {
            const el = document.getElementById('print-executivo');
            const pagina = el.querySelector('.print-page');
            return {
                elHeight: el.style.height,
                elOverflow: el.style.overflow,
                paginaTransform: getComputedStyle(pagina).transform,
                paginaScrollHeight: pagina.scrollHeight,
            };
        }""")
        escalou = info['paginaTransform'] not in ('none', 'matrix(1, 0, 0, 1, 0, 0)')
        ck('com conteúdo suficiente pra precisar encolher, a página realmente encolheu (pré-condição do teste)',
           escalou, info['paginaTransform'])
        if escalou:
            ck('container pai (.print-only) ganhou altura travada (não ficou "auto")',
               info['elHeight'].endswith('px') and info['elHeight'] != '0px', info['elHeight'])
            ck('container pai ganhou overflow:hidden', info['elOverflow'] == 'hidden', info['elOverflow'])
            altura_travada = float(info['elHeight'].replace('px', '') or 0)
            ck('altura travada é MENOR que a altura original da .print-page (não é a original vazando)',
               altura_travada < info['paginaScrollHeight'],
               f"travada={altura_travada}px, original={info['paginaScrollHeight']}px")

        print('\n=== 2. PDF DE VERDADE: NENHUMA PÁGINA SAI EM BRANCO ===')
        try:
            from pypdf import PdfReader
        except ImportError:
            print('  [AVISO] pypdf não instalado (pip install pypdf) — pulando checagem de PDF real.')
            PdfReader = None

        if PdfReader:
            # page.pdf() do Chromium real gera o PDF em PAISAGEM de qualquer
            # forma (@page{size:landscape} deste painel sempre vence os
            # parâmetros do Playwright neste ambiente — limitação conhecida,
            # documentada em test_pdf_mobile_retrato.py). Isso não impede o
            # teste: o MESMO bug (transform não encolhe a paginação) também
            # aparece em paisagem quando o conteúdo é denso o bastante pra
            # precisar de escala por ALTURA — é o caminho testado aqui.
            pg2 = await nav.new_page(viewport={'width': 900, 'height': 1200})
            pg2.on('pageerror', lambda e: erros.append('pdf: ' + str(e)))
            await pg2.goto(PAINEL)
            await pg2.wait_for_timeout(900)
            await pg2.evaluate("() => mostrarLoginLocal()")
            await pg2.fill('#login-nome', 'Ana')
            await pg2.select_option('#login-setor', 'Logística')
            await pg2.click('button:has-text("Entrar sem servidor")')
            await pg2.wait_for_timeout(400)
            await pg2.evaluate("""() => {
                const placas = DB.frota.slice(0, 20).map(f=>f.placa);
                placas.forEach((p,i)=>{
                    const c = criarCargaProgramada({placa:p, numeroCarga:'R'+i, peso:9000+i*100,
                      rota:'500', operador:'Ana'});
                    if(i % 2 === 0) avancarStatusCarga(c.id, 'Aguardando Embarque', 'Ana', 'Logística');
                });
                window.print = () => {};
                exportarPdfExecutivo();
            }""")
            await pg2.wait_for_timeout(400)
            caminho_pdf = '/tmp/_teste_relatorio_sem_paginas_brancas.pdf'
            await pg2.pdf(path=caminho_pdf, print_background=True)
            reader = PdfReader(caminho_pdf)
            n = len(reader.pages)
            print(f'  PDF gerado com {n} página(s)')
            vazias = []
            for i, page in enumerate(reader.pages):
                texto = (page.extract_text() or '').strip()
                print(f'    página {i+1}: {len(texto)} caractere(s) de texto')
                if len(texto) < 20:
                    vazias.append(i + 1)
            ck('nenhuma página do PDF real saiu em branco', not vazias, f'em branco: {vazias}')

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
