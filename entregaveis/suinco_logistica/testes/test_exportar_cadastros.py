#!/usr/bin/env python3
"""Exportar qualquer cadastro completo em CSV (pedido de 18/08/2026).

"Quero poder na aba Cadastros exportar qualquer relação de cadastros
completa... por exemplo todo o registro de cadastro de Frota, atualizado."

O que se prova aqui:
  1. O botão da Frota baixa um CSV com TODAS as placas (749 do seed), com
     BOM (acentos certos no Excel) e ponto-e-vírgula (colunas certas no
     Excel pt-BR).
  2. O CSV traz as colunas completas da Frota, inclusive Motorista.
  3. Rotas exporta todas as rotas cadastradas.
  4. Os botões dos cadastros de Devoluções existem na aba.

    python3 testes/test_exportar_cadastros.py
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
        ctx = await nav.new_context(accept_downloads=True)
        pg = await ctx.new_page()
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)
        await pg.evaluate("() => abrirTab('cadastros')")
        await pg.wait_for_timeout(500)

        print('\n=== 1. FROTA COMPLETA EM CSV ===')
        total = await pg.evaluate("() => DB.frota.length")
        async with pg.expect_download() as dl:
            await pg.click('button:has-text("⬇ Exportar CSV")')
        arq = await dl.value
        caminho = await arq.path()
        dados = open(caminho, 'rb').read()
        texto = dados.decode('utf-8-sig')
        linhas = [l for l in texto.split('\r\n') if l.strip()]
        ck('nome do arquivo identifica o cadastro',
           'Suinco_Cadastro_Frota' in arq.suggested_filename, arq.suggested_filename)
        ck('BOM presente (Excel abre acentos certos)', dados[:3] == b'\xef\xbb\xbf')
        ck('separador ponto-e-vírgula', linhas[0].count(';') >= 6, linhas[0])
        ck('TODAS as placas exportadas', len(linhas) == total + 1,
           f'{len(linhas)-1} linhas para {total} placas')
        ck('colunas completas, com Motorista',
           'Placa' in linhas[0] and 'Motorista' in linhas[0] and 'Precisa Revisão' in linhas[0],
           linhas[0])
        placa0 = await pg.evaluate("() => DB.frota[0].placa")
        ck('placa real presente no arquivo', any(l.startswith(placa0 + ';') for l in linhas),
           placa0)

        print('\n=== 2. ROTAS EM CSV ===')
        n_rotas = await pg.evaluate("() => ROTAS.length")
        # O card Cadastrar Rota é só-Administração (oculto para Logística);
        # a função é a mesma que o botão chama.
        async with pg.expect_download() as dl2:
            await pg.evaluate("() => exportarRotasCsv()")
        arq2 = await dl2.value
        texto2 = open(await arq2.path(), 'rb').read().decode('utf-8-sig')
        linhas2 = [l for l in texto2.split('\r\n') if l.strip()]
        ck('todas as rotas exportadas', len(linhas2) == n_rotas + 1,
           f'{len(linhas2)-1} para {n_rotas}')

        print('\n=== 3. BOTÕES DOS CADASTROS DE DEVOLUÇÕES ===')
        botoes = await pg.evaluate("""() => ['produtos','supervisores','representantes','motivos']
            .map(q => !!document.querySelector(`button[onclick*="exportarCadastroDevCsv('${q}')"]`))""")
        ck('Produtos, Supervisores, Representantes e Motivos têm botão',
           all(botoes), str(botoes))

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
