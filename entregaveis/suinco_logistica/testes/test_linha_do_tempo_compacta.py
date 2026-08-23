#!/usr/bin/env python3
"""Visão do Pátio "sumindo" no celular — seis colunas de etapa viram uma.

Relato do usuário (08/08/2026): "os cards da torre de controle no celular
tao maiores do que cabe na tela, e a visao de patio nao aparece mais...
eu queria que ela aparecesse de forma mais compacta no mobile e no
desktop também... utilizando sequencia e organizacao".

Medido antes da correção: uma carga no cartão mobile da Visão do Pátio
ocupava ~425px — as seis colunas de etapa (Programada/Chegou/Iniciou/
Finalizou/Faturou/Saiu), sem `data-rotulo` na lista "curta" curada,
empilhavam cada uma em seu próprio bloco rótulo+valor.

Correção: `linhaDoTempoCompacta()` (app.js) junta as seis etapas — que
SÃO uma sequência por natureza — numa faixa horizontal só, um selo por
etapa (mesma marca ✓/●/· e o mesmo `title` com o nome completo de antes,
nunca só cor carregando a informação). Uma célula, não seis colunas.

    python3 testes/test_linha_do_tempo_compacta.py
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

        print('\n=== 1. CELULAR: UMA CARGA CABE EM ALTURA COMPACTA ===')
        ctx = await nav.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate("""() => {
            DB.operador = {nome:'Chefe', setor:'Logística'};
            document.getElementById('modal-operador')?.classList.remove('open');
            renderAll();  // tela de entrada própria (16/08): painel só aparece após render com operador
        }""")
        await pg.wait_for_timeout(300)
        await pg.evaluate("""() => {
            criarCargaProgramada({placa: DB.frota[0].placa, numeroCarga:'D0', peso:9000, rota:'500', operador:'Chefe'});
        }""")
        await pg.wait_for_timeout(300)
        await pg.evaluate("() => abrirTab('torre')")
        await pg.wait_for_timeout(500)
        info = await pg.evaluate("""() => {
            // :not(.vp-grupo) — a Torre agrupa em "🚛 Transportadoras" e
            // "🏠 Frota própria" desde 19/08/2026, e a PRIMEIRA linha e o
            // cabecalho do grupo: um <td colspan> sem linha do tempo nenhuma.
            const tr = document.querySelector('#torre-vp-tbody tr:not(.vp-grupo)');
            const linha = tr.querySelector('.et-linha');
            const chips = [...linha.querySelectorAll('.et-mini')];
            return {
                alturaCartao: tr.getBoundingClientRect().height,
                qtdSelos: chips.length,
                selosNaMesmaLinha: new Set(chips.map(c => Math.round(c.getBoundingClientRect().top / 10))).size <= 1,
                temTitulo: chips.every(c => (c.getAttribute('title')||'').length > 3),
            };
        }""")
        ck('um selo por etapa (6)', info['qtdSelos'] == 6, str(info['qtdSelos']))
        ck('os 6 selos ficam na mesma linha (não empilham)', info['selosNaMesmaLinha'], str(info))
        ck('cada selo mantém o title com o nome completo do status (acessibilidade)',
           info['temTitulo'], str(info))
        # Antes da correção, medido: ~425px por carga (seis etapas
        # empilhadas). Depois, medido: ~254px (Transportadora/Rota, que já
        # eram largura cheia por terem texto longo, continuam sendo — a
        # mudança foi só nas seis etapas). Teto de 300px prova que não
        # voltou a empilhar as seis etapas sem exigir um número exato,
        # frágil a qualquer ajuste fino de padding.
        ck('altura do cartão de UMA carga é compacta (< 300px, era ~425px)',
           info['alturaCartao'] < 300, f"{info['alturaCartao']}px")
        await ctx.close()

        print('\n=== 2. DESKTOP: A COLUNA CONTINUA FUNCIONANDO ===')
        ctx2 = await nav.new_context(viewport={'width': 1280, 'height': 900})
        pg2 = await ctx2.new_page()
        pg2.on('pageerror', lambda e: erros.append(str(e)))
        await pg2.goto(PAINEL)
        await pg2.wait_for_timeout(700)
        await pg2.evaluate("""() => {
            DB.operador = {nome:'Chefe', setor:'Logística'};
            document.getElementById('modal-operador')?.classList.remove('open');
            renderAll();  // tela de entrada própria (16/08): painel só aparece após render com operador
        }""")
        await pg2.wait_for_timeout(300)
        await pg2.evaluate("""() => {
            criarCargaProgramada({placa: DB.frota[0].placa, numeroCarga:'D0', peso:9000, rota:'500', operador:'Chefe'});
        }""")
        await pg2.wait_for_timeout(300)
        await pg2.evaluate("() => abrirTab('torre')")
        await pg2.wait_for_timeout(500)
        info2 = await pg2.evaluate("""() => {
            const linha = document.querySelector('#torre-vp-tbody .et-linha');
            return { existe: !!linha, selos: linha ? linha.querySelectorAll('.et-mini').length : 0 };
        }""")
        ck('desktop também mostra a linha do tempo compacta (uma célula, 6 selos)',
           info2['existe'] and info2['selos'] == 6, str(info2))
        await ctx2.close()

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
