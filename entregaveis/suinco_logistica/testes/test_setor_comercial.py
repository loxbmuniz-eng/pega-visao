#!/usr/bin/env python3
"""Setor Comercial: vê Torre/Histórico/Relatórios, não altera nada.

Pedido do usuário (08/08/2026): "acesso a visualizacao de tudo que a
logistica e administração ve mas sem alterar nada, tipo relatorios,
historico, busca de cargas no historico, visao de patio... torre de
controle... para minimizar comunicacoes desnecessarias atras de
informacoes".

O servidor já recusa qualquer escrita (backend/testes/api.test.js,
bloco 11 — allowlist nega por padrão). Este teste prova o lado da TELA:
só as três abas certas aparecem, e nenhum controle de edição/exclusão é
mostrado nelas — inclusive o bug real encontrado no caminho (Histórico
mostrava o botão Cancelar/Excluir pra qualquer setor, corrigido junto).

Exige o backend no ar e comercial@teste.local cadastrado
(node -e cria o operador — ver histórico do commit).
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def abrir_painel(ctx):
    pagina = await ctx.new_page()
    html = open(PAINEL, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = API + '/__painel_comercial'
    await pagina.route(url, lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pagina.goto(url)
    await pagina.wait_for_timeout(1000)
    return pagina


async def entrar(pagina, email):
    await pagina.fill('#login-email', email)
    await pagina.fill('#login-senha', SENHA)
    await pagina.click('#btn-entrar')
    await pagina.wait_for_timeout(2000)
    return await pagina.evaluate("() => DB.operador && DB.operador.setor")


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctx = await nav.new_context()
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        pg2 = await abrir_painel(ctx)
        pg2.on('pageerror', lambda e: erros.append(str(e)))
        await pg.close()

        print('\n=== 1. LOGIN COMO COMERCIAL ===')
        ck('entrou como Comercial', await entrar(pg2, 'comercial@teste.local') == 'Comercial')

        print('\n=== 2. SÓ AS TRÊS ABAS CERTAS ESTÃO VISÍVEIS ===')
        abas = await pg2.evaluate("""() => {
            const els = [...document.querySelectorAll('.nav-tab')];
            return Object.fromEntries(els.map(el => [el.dataset.tab, !el.hidden]));
        }""")
        # REDUZIDO em 11/08/2026, a pedido do usuário: "a visão do
        # comercial, só visão de pátio e histórico". Relatórios saiu — o
        # Comercial consulta onde a carga está, não emite documento.
        esperado_visivel = {'torre', 'historico'}
        visiveis = {k for k, v in abas.items() if v}
        ck('exatamente torre + historico visíveis',
           visiveis == esperado_visivel, str(abas))

        print('\n=== 3. TORRE: SEM COLUNA DE AÇÃO, SEM CAMPO EDITÁVEL ===')
        await pg2.evaluate("() => abrirTab('torre')")
        await pg2.wait_for_timeout(400)
        thead = await pg2.inner_text('#torre-thead')
        ck('cabeçalho da Torre não tem coluna "Ação"', 'Ação' not in thead, thead)
        tem_input = await pg2.evaluate(
            "() => document.querySelectorAll('#torre-tbody input').length")
        ck('nenhum campo editável na Torre', tem_input == 0, str(tem_input))
        tem_botao_excluir = await pg2.evaluate(
            "() => document.querySelectorAll('#torre-tbody button').length")
        ck('nenhum botão de ação na Torre', tem_botao_excluir == 0, str(tem_botao_excluir))

        print('\n=== 4. HISTÓRICO: BUSCA DE CARGA SEM BOTÃO DE CANCELAR/EXCLUIR ===')
        await pg2.evaluate("() => abrirTab('historico')")
        await pg2.wait_for_timeout(400)
        alguma_carga = await pg2.evaluate("() => (DB.cargas[0]||{}).id || null")
        if alguma_carga:
            await pg2.evaluate("(id) => selecionarCargaTimeline(id)", alguma_carga)
            await pg2.wait_for_timeout(300)
            tem_cancelar = await pg2.evaluate(
                "() => !!document.querySelector('#hist-timeline-wrap button.btn-danger')")
            ck('sem botão Cancelar/Excluir na timeline da carga', not tem_cancelar)
        else:
            ck('(sem carga no DB pra testar a timeline — pulado)', True)

        print('\n=== 5. RELATÓRIOS SAÍRAM DA VISÃO DO COMERCIAL ===')
        # Mudou em 11/08/2026: antes o Comercial tinha a aba Relatórios
        # (exportar não altera dado, então fazia sentido). O usuário
        # reduziu o escopo para "só visão de pátio e histórico".
        aba_relatorios_visivel = await pg2.evaluate(
            "() => { const e = document.querySelector('.nav-tab[data-tab=\"relatorios\"]');"
            "        return !!e && !e.hidden; }")
        ck('aba Relatórios não aparece para o Comercial', not aba_relatorios_visivel)

        print('\n=== 6. ADMINISTRAÇÃO: "COMERCIAL" APARECE AO CRIAR UM NOVO USUÁRIO ===')
        # Achado real (08/08/2026): existem DOIS seletores de setor na tela de
        # Usuários — um pra criar (usr-setor, opções escritas direto no HTML)
        # e outro pra trocar o setor de alguém já cadastrado (gerado a partir
        # de SETORES, em app.js). Só o segundo foi atualizado da primeira vez;
        # o formulário de criação continuou sem Comercial na lista, e não
        # dava pra cadastrar ninguém no setor novo pela tela.
        # Contexto PRÓPRIO — não o mesmo `ctx` do Comercial. DB.operador vive
        # em localStorage (data.js), compartilhado entre páginas do mesmo
        # contexto; reusar `ctx` faria esta página herdar a sessão do
        # Comercial já logado e o modal de login nunca abriria.
        ctx3 = await nav.new_context()
        pg3 = await abrir_painel(ctx3)
        pg3.on('pageerror', lambda e: erros.append('admin: ' + str(e)))
        ck('chefe entrou como Administração', await entrar(pg3, 'chefe@teste.local') == 'Administração')
        await pg3.evaluate("() => abrirTab('usuarios')")
        await pg3.wait_for_timeout(300)
        opcoes_criar = await pg3.evaluate(
            "() => [...document.querySelectorAll('#usr-setor option')].map(o => o.textContent.trim())")
        ck('"Comercial" está nas opções do formulário de Novo Usuário',
           'Comercial' in opcoes_criar, str(opcoes_criar))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
