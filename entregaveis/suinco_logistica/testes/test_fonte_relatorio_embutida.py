#!/usr/bin/env python3
"""Os relatórios usam uma fonte embutida no arquivo, não a do sistema.

Pedido do usuário (08/08/2026): "mesmo padrão de relatórios sejam
exportados pelo computador, celular android ou ios". Com a pilha de
fontes de sistema (a que o resto do painel usa de propósito, ver
comentário em styles.css), o MESMO relatório sai com a San Francisco no
iPhone, Segoe UI no Windows e Roboto no Android — três larguras de coluna
diferentes para o mesmo PDF.

Este teste não pode abrir um iPhone/Android de verdade (não existe neste
ambiente), mas prova a causa raiz da consistência: a fonte 'Suinco
Relatorio' está de fato embutida no arquivo (não é buscada de rede — o
teste roda com o navegador OFFLINE) e carrega com sucesso antes da
impressão, para os pesos que o relatório usa (400/600/800).

    python3 testes/test_fonte_relatorio_embutida.py
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
        # Offline de propósito: se a fonte dependesse de rede (Google Fonts,
        # CDN etc.), ela simplesmente não carregaria aqui — a prova mais
        # direta possível de que está embutida no arquivo.
        ctx = await nav.new_context(offline=True)
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        await pg.goto(PAINEL)
        await pg.wait_for_timeout(500)

        print('\n=== 1. A FONTE DECLARADA EXISTE E CARREGA, SEM REDE ===')
        carregou = await pg.evaluate("""async () => {
            await document.fonts.ready;
            const alvo = [...document.fonts].find(f => f.family === 'Suinco Relatorio');
            if (!alvo) return { achou: false };
            try { await alvo.load(); } catch (e) { return { achou: true, carregou: false, erro: e.message }; }
            return { achou: true, carregou: alvo.status === 'loaded' };
        }""")
        ck('a @font-face "Suinco Relatorio" existe no documento', carregou.get('achou'), str(carregou))
        ck('carregou com sucesso (embutida, não buscada de rede)', carregou.get('carregou'), str(carregou))

        print('\n=== 2. OS PESOS USADOS NO RELATÓRIO (400/600/800) FICAM DISPONÍVEIS ===')
        pesos = await pg.evaluate("""() => ({
            p400: document.fonts.check("16px 'Suinco Relatorio'"),
            p600: document.fonts.check("600 16px 'Suinco Relatorio'"),
            p800: document.fonts.check("800 16px 'Suinco Relatorio'"),
        })""")
        ck('peso 400 disponível', pesos['p400'], str(pesos))
        ck('peso 600 disponível (transportadora)', pesos['p600'], str(pesos))
        ck('peso 800 disponível (status, placa, nº carga)', pesos['p800'], str(pesos))

        print('\n=== 3. A ÁREA DE RELATÓRIO REALMENTE PEDE ESSA FONTE PRIMEIRO ===')
        pilha = await pg.evaluate("""() => {
            const el = document.getElementById('print-operacional');
            return getComputedStyle(el).fontFamily;
        }""")
        ck('.print-only começa a pilha de fontes pela embutida',
           pilha.replace('"', "'").startswith("'Suinco Relatorio'"), pilha)

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
