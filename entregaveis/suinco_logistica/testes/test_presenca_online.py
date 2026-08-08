#!/usr/bin/env python3
"""Aba Usuários mostra quem está online agora, num ícone ao lado do nome.

Pedido do usuário em 08/08/2026: "quero conseguir ver os usuários que
estão online logados na aba usuários, dentro de um ícone".

O que precisa ser verdade:
  1. Sem ninguém logado naquela conta, o ícone mostra offline (cinza).
  2. A pessoa loga em OUTRO terminal — o ícone na tela da Administração vira
     online (verde) SOZINHO, sem recarregar a página (via socket).
  3. A mesma pessoa com DUAS abas abertas continua online ao fechar só uma
     — contagem é por PESSOA, não por conexão (senão trocar de aba no
     próprio terminal já pareceria "saiu").
  4. Fechando a última conexão, volta a cinza — também sozinho, sem F5.

Exige o backend rodando e os operadores de teste criados
(chefe@teste.local / Administração, ana@teste.local / Logística).
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
    """Serve o painel na MESMA origem da API — precisa do socket real."""
    pagina = await ctx.new_page()
    html = open(PAINEL, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = API + '/__painel_presenca'
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


async def ir_para_usuarios(pagina):
    await pagina.evaluate("() => abrirTab('usuarios')")
    await pagina.wait_for_timeout(600)


async def status_presenca(pagina, email):
    return await pagina.evaluate("""(email) => {
        const linhas = [...document.querySelectorAll('#usr-tbody tr')];
        const linha = linhas.find(tr => tr.textContent.includes(email));
        if (!linha) return null;
        const dot = linha.querySelector('.presenca-dot');
        return dot ? dot.classList.contains('online') : null;
    }""", email)


async def esperar_status(pagina, email, esperado, tentativas=15):
    for _ in range(tentativas):
        if await status_presenca(pagina, email) == esperado:
            return True
        await pagina.wait_for_timeout(400)
    return False


async def main():
    async with async_playwright() as p:
        navegador = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []

        ctx_admin = await navegador.new_context()
        p_admin = await abrir_painel(ctx_admin)
        p_admin.on('pageerror', lambda e: erros.append('admin: ' + str(e)))

        print('\n=== 1. ADMINISTRAÇÃO VÊ A ABA USUÁRIOS ===')
        ck('chefe entrou como Administração', await entrar(p_admin, 'chefe@teste.local') == 'Administração')
        await ir_para_usuarios(p_admin)
        linha_existe = await p_admin.evaluate(
            "() => [...document.querySelectorAll('#usr-tbody tr')].some(tr => tr.textContent.includes('ana@teste.local'))")
        ck('a linha da Ana aparece na tabela', linha_existe)

        print('\n=== 2. SEM NINGUÉM LOGADO NA CONTA DA ANA, ÍCONE CINZA ===')
        ck('Ana aparece offline antes de logar', await status_presenca(p_admin, 'ana@teste.local') is False)

        print('\n=== 3. ANA LOGA NOUTRO TERMINAL — ÍCONE VIRA VERDE SOZINHO ===')
        ctx_ana = await navegador.new_context()
        p_ana = await abrir_painel(ctx_ana)
        p_ana.on('pageerror', lambda e: erros.append('ana: ' + str(e)))
        ck('Ana entrou como Logística', await entrar(p_ana, 'ana@teste.local') == 'Logística')

        ok = await esperar_status(p_admin, 'ana@teste.local', True)
        ck('ícone da Ana virou verde sem recarregar a tela da Administração', ok)

        print('\n=== 4. SEGUNDA ABA DA MESMA PESSOA — FECHAR UMA NÃO TIRA ELA DO AR ===')
        ctx_ana2 = await navegador.new_context()
        p_ana2 = await abrir_painel(ctx_ana2)
        ck('Ana entrou também na segunda aba', await entrar(p_ana2, 'ana@teste.local') == 'Logística')
        await p_admin.wait_for_timeout(800)
        ck('continua online com duas abas', await status_presenca(p_admin, 'ana@teste.local') is True)

        await ctx_ana2.close()
        await p_admin.wait_for_timeout(1000)
        ck('fechar SÓ uma aba não marca offline — a outra ainda está aberta',
           await status_presenca(p_admin, 'ana@teste.local') is True)

        print('\n=== 5. FECHANDO A ÚLTIMA CONEXÃO, VOLTA CINZA SOZINHO ===')
        await ctx_ana.close()
        ok = await esperar_status(p_admin, 'ana@teste.local', False)
        ck('ícone da Ana voltou cinza sem recarregar a tela da Administração', ok)

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))

        await ctx_admin.close()
        await navegador.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
