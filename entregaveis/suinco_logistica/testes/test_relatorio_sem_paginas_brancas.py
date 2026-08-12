#!/usr/bin/env python3
"""Encolher o relatório para caber na folha NUNCA pode esconder conteúdo.

HISTÓRICO — este teste mudou de premissa em 09/08/2026, e vale registrar:

Ele nasceu de um bug real de `window.print()`: o relatório saía com 2-3
páginas em branco sobrando no celular, porque `transform:scale()` encolhe
só o DESENHO — a altura de LAYOUT (que o motor de impressão usa para
paginar) não muda. A correção da época travava a altura do container, e
essa correção teve a própria regressão: aplicada quando o conteúdo
precisava de 2+ páginas, o motor de impressão PERDIA conteúdo (9 de 20
placas sumiam do PDF).

Depois disso a geração do PDF saiu do navegador do operador e passou para
o servidor (backend/src/rotas/relatorios.js), que pede A4 paisagem como
parâmetro — a paginação deixou de depender do aparelho de quem clica. O
tamanho da folha agora tem cobertura própria em api.test.js (mede o
MediaBox dos bytes do PDF, suíte 13).

O que continua valendo, e é o que este teste protege: o encolhimento
aplicado ao HTML antes de mandar para o servidor não pode cortar nem
esconder nenhuma carga. Página sobrando é desperdício; carga sumida do
relatório é decisão operacional tomada com dado errado.

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


async def preparar(pg, n_cargas, qual='exportarPdfExecutivo'):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(900)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(400)
    placas = await pg.evaluate("""([n, qual]) => {
        const placas = DB.frota.slice(0, n).map(f=>f.placa);
        placas.forEach((p,i)=>{
            const c = criarCargaProgramada({placa:p, numeroCarga:'R'+i, peso:9000+i*100,
              rota:'500', operador:'Ana'});
            avancarStatusCarga(c.id, 'Aguardando Embarque', 'Ana', 'Logística');
        });
        window[qual]();
        return placas;
    }""", [n_cargas, qual])
    await pg.wait_for_timeout(400)
    return placas


async def medir(pg, container):
    """Aplica o encolhimento real e devolve o que foi para o HTML final.

    `ajustarParaCaberEmUmaPagina` é chamada por `exportarViaServidor` logo
    antes de montar o HTML que sobe. Aqui ela é chamada do mesmo jeito —
    não existe mais o evento 'beforeprint', que era exigência do
    `window.print()` e sumiu junto com ele.
    """
    return await pg.evaluate("""(sel) => {
        const el = document.getElementById(sel);
        el.style.display = 'block';
        ajustarParaCaberEmUmaPagina(el);
        const pagina = el.querySelector('.print-page');
        return {
            transform: pagina.style.transform,
            alturaTravada: el.style.height,
            overflow: el.style.overflow,
            // O que de fato sobe para o servidor:
            html: el.outerHTML,
        };
    }""", container)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []

        print('\n=== 1. POUCO CONTEÚDO ===')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 1000})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        placas = await preparar(pg, 3)
        info = await medir(pg, 'print-executivo')
        faltando = [x for x in placas if x not in info['html']]
        ck('nenhuma placa fica de fora do HTML enviado', not faltando, str(faltando))
        ck('o container nunca esconde conteúdo por overflow sem altura definida',
           not (info['overflow'] == 'hidden' and not info['alturaTravada']),
           f"overflow={info['overflow']} altura={info['alturaTravada']}")
        await pg.close()

        print('\n=== 2. MUITO CONTEÚDO (o caso que já perdeu dado no passado) ===')
        pg2 = await nav.new_page(viewport={'width': 1400, 'height': 1000})
        pg2.on('pageerror', lambda e: erros.append(str(e)))
        placas2 = await preparar(pg2, 20)
        info2 = await medir(pg2, 'print-executivo')
        faltando2 = [x for x in placas2 if x not in info2['html']]
        ck('com 20 cargas, nenhuma placa some do HTML enviado',
           not faltando2, str(faltando2))
        print(f"    (escala aplicada: {info2['transform'] or 'nenhuma'})")

        print('\n=== 3. OPERACIONAL COM MUITA CARGA ===')
        await pg2.evaluate("() => exportarPdfOperacional()")
        await pg2.wait_for_timeout(400)
        info3 = await medir(pg2, 'print-operacional')
        faltando3 = [x for x in placas2 if x not in info3['html']]
        ck('operacional: nenhuma placa some do HTML enviado', not faltando3, str(faltando3))
        await pg2.close()

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
