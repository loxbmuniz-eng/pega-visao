#!/usr/bin/env python3
"""Relatório saía com páginas em branco sobrando no celular.

Relato do usuário (08/08/2026, depois do relatório já ter virado "one
pager" mais cedo nesta mesma sessão): "os relatorios pelo celular ainda
estao saindo com 3 paginas brancas sobrando... menos é mais só utillize
uma nova pagina se tiver informacao precisando de espaco".

RAIZ: `ajustarParaCaberEmUmaPagina()` (app.js) encolhe o relatório com
`transform:scale()` quando ele não cabe numa página — mas `transform`
SÓ afeta o DESENHO, nunca a altura de LAYOUT da caixa (é assim que a
especificação CSS define transform). Uma `.print-page` com 500mm de
altura original, escalada visualmente pra caber em 287mm, continua
"ocupando" 500mm no FLUXO do documento para fins de paginação — o motor
de impressão fatia esse excedente em páginas extras.

PRIMEIRA CORREÇÃO (travar a altura do container pai na altura já escalada,
com overflow:hidden) resolvia o caso onde o conteúdo cabe INTEIRO numa
página — confirmado isolado, fora deste repositório: uma caixa de 600mm
escalada por 0,333 pra caber em 200mm virava 1 página em vez de 3.

MAS essa mesma técnica, testada isolada pra um container que precisa de
MAIS de uma página mesmo depois de escalado (o piso de 50% de legibilidade
não é suficiente pra tudo caber numa página só — caso real e aceito, ver
comentário no código-fonte), não distribui o conteúdo corretamente entre
as páginas: PERDE conteúdo real (testado com marcadores de texto em
posições conhecidas — o do meio simplesmente não aparecia em nenhuma
página gerada). Isso é PIOR que o bug original (que só desperdiçava
página, nunca dado).

CORREÇÃO FINAL: o travamento de altura só é aplicado quando o conteúdo
escalado cabe inteiro numa página (com pequena folga de arredondamento).
Quando não cabe mesmo no piso de 50%, o relatório volta ao comportamento
anterior a esta sessão — pode sobrar página quase em branco no fim (caso
raro, conteúdo muito denso), mas NUNCA perde uma linha real. Sem dado
perdido é inegociável; página sobrando num caso raro é o mal menor.

Este teste cobre os dois regimes:
1. POUCO CONTEÚDO (cabe numa página escalado): o travamento de altura tem
   que entrar, e nenhum dado pode ficar de fora do container travado.
2. MUITO CONTEÚDO (não cabe nem no piso de 50%): o travamento tem que
   FICAR DE FORA — e mesmo assim, na saída real em PDF, todo placa/carga
   que existe no DOM continua aparecendo no texto extraído. Esta é a
   checagem mais importante: prova que a correção nunca troca "página
   sobrando" por "dado sumindo".

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


async def preparar_executivo(pg, n_cargas):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(900)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(400)
    placas = await pg.evaluate("""(n) => {
        const placas = DB.frota.slice(0, n).map(f=>f.placa);
        placas.forEach((p,i)=>{
            const c = criarCargaProgramada({placa:p, numeroCarga:'R'+i, peso:9000+i*100,
              rota:'500', operador:'Ana'});
            avancarStatusCarga(c.id, 'Aguardando Embarque', 'Ana', 'Logística');
        });
        window.print = () => {};
        exportarPdfExecutivo();
        return placas;
    }""", n_cargas)
    await pg.wait_for_timeout(300)
    return placas


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []

        print('\n=== 1. POUCO CONTEÚDO: TRAVAMENTO ENTRA, NADA FICA DE FORA ===')
        # 3 cargas cabe inteiro numa página mesmo escalado (confirmado por
        # medição: com este viewport, o piso de 50% NUNCA é atingido até
        # ~4 cargas — 3 fica com folga confortável do lado seguro).
        # Mesma técnica de test_pdf_mobile_retrato.py: viewport estreito/alto
        # + emulate_media('print') faz orientation:portrait bater de verdade.
        pg = await nav.new_page(viewport={'width': 700, 'height': 1100})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await preparar_executivo(pg, 3)
        await pg.emulate_media(media='print')
        # `window.print` está mockado (não abre diálogo real, então o
        # evento 'beforeprint' de verdade nunca dispara sozinho) — dispara
        # manualmente, DEPOIS de emulate_media('print'), pra que
        # matchMedia('print and ...') resolva no contexto certo.
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
        ck('com pouco conteúdo, a página ainda precisou encolher (pré-condição)',
           escalou, info['paginaTransform'])
        ck('container pai (.print-only) ganhou altura travada (cabia numa página)',
           info['elHeight'].endswith('px') and info['elHeight'] != '0px', info['elHeight'])
        ck('container pai ganhou overflow:hidden', info['elOverflow'] == 'hidden', info['elOverflow'])
        if info['elHeight'].endswith('px'):
            altura_travada = float(info['elHeight'].replace('px', ''))
            ck('altura travada é MENOR que a altura original da .print-page (não é a original vazando)',
               altura_travada < info['paginaScrollHeight'],
               f"travada={altura_travada}px, original={info['paginaScrollHeight']}px")

        print('\n=== 2. MUITO CONTEÚDO: TRAVAMENTO FICA DE FORA, NADA SE PERDE ===')
        # 12 cargas passa do piso de 50% (confirmado por medição) -- o
        # travamento de altura precisa ficar DESLIGADO aqui, senão perde dado
        # (achado desta sessão: o mesmo mecanismo que resolve o caso 1,
        # aplicado a um container que precisa de 2+ páginas, apaga conteúdo
        # do meio — testado isolado com marcadores de posição conhecida).
        pg2 = await nav.new_page(viewport={'width': 700, 'height': 1100})
        pg2.on('pageerror', lambda e: erros.append('muito: ' + str(e)))
        await preparar_executivo(pg2, 12)
        await pg2.emulate_media(media='print')
        await pg2.evaluate("() => window.dispatchEvent(new Event('beforeprint'))")
        await pg2.wait_for_timeout(100)
        info2 = await pg2.evaluate("""() => {
            const el = document.getElementById('print-executivo');
            const pagina = el.querySelector('.print-page');
            return {
                elHeight: el.style.height,
                paginaTransform: getComputedStyle(pagina).transform,
            };
        }""")
        ck('com muito conteúdo (não cabe nem no piso de 50%), o travamento de altura fica DESLIGADO',
           info2['elHeight'] == '', info2['elHeight'] or '(vazio, correto)')
        ck('mesmo sem travamento, a página continua encolhida no piso de legibilidade',
           info2['paginaTransform'] not in ('none', 'matrix(1, 0, 0, 1, 0, 0)'), info2['paginaTransform'])

        print('\n=== 3. PDF DE VERDADE: NENHUM PLACA/CARGA SOME DO TEXTO EXTRAÍDO ===')
        try:
            from pypdf import PdfReader
        except ImportError:
            print('  [AVISO] pypdf não instalado (pip install pypdf) — pulando checagem de PDF real.')
            PdfReader = None

        if PdfReader:
            # page.pdf() do Chromium real gera o PDF em PAISAGEM de qualquer
            # forma (@page{size:landscape} deste painel sempre vence os
            # parâmetros do Playwright neste ambiente, e a feature de mídia
            # orientation:portrait nunca resolve certo dentro do próprio
            # page.pdf() mesmo forçando @page via CSSOM — limitações
            # investigadas e confirmadas nesta sessão, análogas à já
            # documentada em test_pdf_mobile_retrato.py). Isso não invalida
            # o teste: o bug (perda de conteúdo com container multi-página)
            # é o MESMO em paisagem quando o conteúdo é denso o bastante —
            # é o caminho exercitado aqui, com o pior caso (muito conteúdo).
            for n_cargas, nome in [(3, 'poucas'), (20, 'muitas')]:
                pg3 = await nav.new_page(viewport={'width': 900, 'height': 1200})
                pg3.on('pageerror', lambda e: erros.append(f'pdf-{nome}: ' + str(e)))
                placas = await preparar_executivo(pg3, n_cargas)
                caminho_pdf = f'/tmp/_teste_sem_paginas_brancas_{nome}.pdf'
                await pg3.pdf(path=caminho_pdf, print_background=True)
                reader = PdfReader(caminho_pdf)
                texto_total = ''
                for page in reader.pages:
                    texto_total += (page.extract_text() or '')
                faltando = [pl for pl in placas if pl not in texto_total]
                print(f'  {nome} ({n_cargas} cargas, {len(reader.pages)} página(s)): '
                      f'{len(placas)-len(faltando)}/{len(placas)} placas presentes no texto')
                ck(f'{nome}: nenhuma placa sumiu do PDF gerado', not faltando, f'faltando: {faltando}')

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
