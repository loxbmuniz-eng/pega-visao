#!/usr/bin/env python3
"""O relatório monta o CSS mesmo com outro <style> na frente do principal.

INCIDENTE (14/08/2026) — relatado pelo dono do projeto, no Safari:
"não estou conseguindo gerar relatorios, diz que ta faltando css". A tela
mostrava: "Não consegui gerar o relatório: Faltou o estilo do relatório
(css)."

Essa mensagem é do SERVIDOR (backend/src/rotas/relatorios.js): ele valida
`html` primeiro e `css` depois. Como o erro foi o de css, o `html` chegou
inteiro — ou seja, o painel montou o relatório e só o CSS saiu vazio.

E o painel na tela estava perfeitamente estilizado, então a folha de estilo
existia e tinha conteúdo. As duas coisas juntas apontam para um lugar só:

    const css = (document.querySelector('style') || {}).textContent || '';

`querySelector` devolve o PRIMEIRO <style> do documento. O build embute
toda a folha num <style> só, e o código assumiu que esse é sempre o
primeiro. Basta QUALQUER outro <style> aparecer antes — extensão de
navegador, bloqueador de conteúdo, modo escuro de terceiro, tradutor de
página — para o painel mandar o conteúdo do <style> do intruso (quase
sempre vazio) no lugar da folha inteira. Isso explica por que falha no
navegador de um e funciona no de outro, sem nada ter mudado no código.

Este teste injeta um <style> vazio antes do principal — exatamente o que
uma extensão faz — e cobra que o CSS enviado continue sendo o do painel.

Precisa do backend local no ar (SUINCO_API) e do operador de teste.

    python3 testes/test_css_do_relatorio.py
"""
import asyncio
import json
import os
import sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAIL = os.environ.get('SUINCO_EMAIL', 'chefe@teste.local')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        ctx = await nav.new_context(viewport={'width': 1400, 'height': 1000},
                                    accept_downloads=True)
        pg = await ctx.new_page()
        enviados = []

        html = open(PAINEL, encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = API + '/__painel_css'
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))

        async def espiar(rota):
            corpo = rota.request.post_data or ''
            try:
                d = json.loads(corpo)
                enviados.append({'css': d.get('css') or '', 'html': d.get('html') or ''})
            except Exception as e:
                enviados.append({'erro': str(e), 'css': '', 'html': ''})
            # Não deixa subir Chromium à toa: o que este teste mede é o ENVIO.
            await rota.fulfill(status=200, content_type='application/pdf', body=b'%PDF-1.4 teste')

        await pg.route('**/api/relatorios/pdf', espiar)

        await pg.goto(url)
        await pg.wait_for_timeout(1200)

        print('\n=== 0. LOGIN ===')
        await pg.fill('#login-email', EMAIL)
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(2500)
        setor = await pg.evaluate("() => DB.operador && DB.operador.setor")
        ck('logado no servidor', bool(setor), str(setor))
        if not setor:
            await nav.close()
            print('\n  (sem login não dá pra medir o envio)')
            return 1

        print('\n=== 1. UMA EXTENSÃO INJETA UM <style> VAZIO ANTES DO PRINCIPAL ===')
        antes = await pg.evaluate("""() => {
            const intruso = document.createElement('style');
            // É assim que extensão de tema/bloqueador costuma entrar: no
            // topo do <head>, e muitas vezes sem texto (usa CSSOM).
            document.head.insertBefore(intruso, document.head.firstChild);
            return {
                total: document.querySelectorAll('style').length,
                primeiroTam: (document.querySelector('style').textContent || '').length,
            };
        }""")
        ck('o primeiro <style> da página agora é o do intruso (vazio)',
           antes['primeiroTam'] == 0, str(antes))

        print('\n=== 2. O RELATÓRIO AINDA PRECISA SAIR COM O CSS DO PAINEL ===')
        await pg.evaluate("() => abrirTab('relatorios')")
        await pg.wait_for_timeout(500)
        await pg.click('button:has-text("Gerar PDF Executivo")')
        await pg.wait_for_timeout(4000)

        ck('o painel chegou a enviar o relatório', bool(enviados))
        if enviados:
            css = enviados[-1]['css']
            ck('o CSS enviado NÃO está vazio', len(css) > 0, f'{len(css)} caracteres')
            # A folha real do painel tem ~200 mil caracteres (CSS + fonte
            # embutida). Qualquer coisa perto de zero é o bug do incidente.
            ck('o CSS enviado é a folha inteira do painel', len(css) > 50000,
               f'{len(css)} caracteres')
            ck('o CSS traz as regras de impressão do relatório',
               '.print-page' in css)
            ck('o HTML do relatório também foi enviado',
               len(enviados[-1]['html']) > 0, f"{len(enviados[-1]['html'])} caracteres")

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
