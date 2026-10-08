#!/usr/bin/env python3
"""A senha não aparece enquanto é digitada (08/10/2026, /impeccable Lote 2, ocorrência #122).

ACHADO DA AUDITORIA: a nova senha de um usuário (aba Usuários) era pedida
pela caixa do navegador — prompt() —, que mostra o que se digita, letra por
letra, a quem estiver olhando a tela. O mesmo com a senha de fechamento da
programação (provado em test_fechar_com_senha) e a do segundo fator (em
test_segundo_fator).

O QUE ESTE TESTE TRAVA, com o servidor de teste, pela tela da Administração:
  1. "Senha" abre a pergunta do painel com campo de SENHA (escondido), e
     nenhuma caixa do navegador; "Mostrar" deixa conferir antes de gravar;
  2. senha curta: o erro aparece na janela, dizendo o mínimo, e ela não
     fecha; a senha válida grava — e a pessoa ENTRA com ela;
  3. a senha não fica no DOM depois que a janela fecha;
  4. Excluir conta pede a palavra digitada: errada, a janela explica e não
     apaga; certa, a conta sai do banco.

    bash testes/rodar_tudo.sh test_senha_nao_aparece
"""
import asyncio
import json
import os
import subprocess
import sys
import urllib.request
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
ALVO = 'trocasenha@teste.local'
NOVA = 'nova-senha-do-teste-77'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def sql(comando):
    r = subprocess.run(['sudo', '-u', 'postgres', 'psql', '-qtA', '-d', 'embarque_suinco', '-c', comando],
                       capture_output=True, text=True)
    return r.stdout.strip()


def entra(email, senha):
    """Entra pela API, como o login do painel faz. Devolve o status HTTP."""
    req = urllib.request.Request(API + '/auth/login', data=json.dumps({'email': email, 'senha': senha}).encode(),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


async def abrir(nav, email):
    ctx = await nav.new_context(viewport={'width': 1440, 'height': 900})
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js', f'{API}/socket.io/socket.io.js')
    url = f'{API}/__senha_nao_aparece'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    for _ in range(80):
        if await pg.evaluate("() => !!(DB.operador && DB.operador.email)"):
            break
        await asyncio.sleep(0.25)
    return ctx, pg


async def main():
    sql(f"DELETE FROM operadores WHERE email = '{ALVO}'")
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd='/home/user/pega-visao/entregaveis/suinco_logistica/backend', capture_output=True, text=True)
    if h.returncode != 0:
        print('não consegui gerar o hash:', h.stderr[:300])
        return 1
    sql("INSERT INTO operadores (email,nome,setor,senha_hash) VALUES "
        f"('{ALVO}','Troca Senha','Portaria','{h.stdout.strip()}')")

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctx, pg = await abrir(nav, 'admin1@teste.local')
        erros, nativas = [], []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        pg.on('dialog', lambda d: (nativas.append(d.message), asyncio.ensure_future(d.dismiss())))
        await pg.click(".nav-tab[data-tab='usuarios']")
        linha = f"#tab-usuarios tr:has-text('{ALVO}')"
        try:
            await pg.wait_for_selector(linha, timeout=10000)
        except Exception:
            pass
        ck('a conta de teste aparece na aba Usuários', await pg.locator(linha).count() > 0)

        print('\n=== 1. NOVA SENHA: CAMPO ESCONDIDO, NENHUMA CAIXA DO NAVEGADOR ===')
        await pg.locator(linha).locator("button:has-text('Senha')").click()
        await pg.wait_for_timeout(500)
        tipo = await pg.evaluate("() => { const c = document.getElementById('pergunta-campo'); return c ? c.type : null; }")
        ck('abre a pergunta do painel com campo de senha (escondido)', tipo == 'password', str(tipo))
        ck('nenhuma caixa do navegador pediu a senha', not nativas, ' | '.join(m[:60] for m in nativas))
        if tipo == 'password':
            await pg.fill('#pergunta-campo', 'curta')
            await pg.click('#pergunta-ok')
            await pg.wait_for_timeout(300)
            erro = await pg.evaluate("() => { const e = document.getElementById('pergunta-erro'); return e && !e.hidden ? e.textContent : ''; }")
            ck('senha curta: a janela diz o mínimo', '8' in erro, erro)
            ck('e não fecha', await pg.is_visible('#modal-pergunta.open'))
            await pg.fill('#pergunta-campo', NOVA)
            await pg.click('#pergunta-mostrar')
            mostra = await pg.evaluate("() => [document.getElementById('pergunta-campo').type, document.getElementById('pergunta-mostrar').getAttribute('aria-pressed')]")
            ck('"Mostrar" deixa conferir o que foi digitado', mostra == ['text', 'true'], str(mostra))
            await pg.click('#pergunta-ok')
            await pg.wait_for_timeout(1500)
            ck('a janela fecha depois de gravar', not await pg.is_visible('#modal-pergunta.open'))
            sobrou = await pg.evaluate("(s) => document.documentElement.outerHTML.includes(s) || [...document.querySelectorAll('input')].some(i => i.value === s)", NOVA)
            ck('a senha NÃO fica na página depois', not sobrou)
            ck('a pessoa entra com a senha nova', entra(ALVO, NOVA) == 200, str(entra(ALVO, NOVA)))
            ck('e não entra mais com a antiga', entra(ALVO, SENHA) != 200)

        print('\n=== 2. EXCLUIR CONTA: A PALAVRA DIGITADA ===')
        await pg.click(".nav-tab[data-tab='usuarios']")
        await pg.wait_for_selector(linha, timeout=10000)
        await pg.locator(linha).locator("button:has-text('Excluir')").click()
        await pg.wait_for_timeout(500)
        ck('abre a pergunta do painel', await pg.is_visible('#modal-pergunta.open'))
        await pg.fill('#pergunta-campo', 'EXCLUI')
        await pg.click('#pergunta-ok')
        await pg.wait_for_timeout(300)
        erro = await pg.evaluate("() => { const e = document.getElementById('pergunta-erro'); return e && !e.hidden ? e.textContent : ''; }")
        ck('palavra errada: a janela diz o que digitar', 'EXCLUIR' in erro, erro)
        ck('e a conta continua no banco', sql(f"SELECT count(*) FROM operadores WHERE email = '{ALVO}'") == '1')
        await pg.fill('#pergunta-campo', 'EXCLUIR')
        await pg.click('#pergunta-ok')
        await pg.wait_for_timeout(1500)
        ck('palavra certa: a conta sai do banco', sql(f"SELECT count(*) FROM operadores WHERE email = '{ALVO}'") == '0')
        ck('nenhuma caixa do navegador em todo o caminho', not nativas, ' | '.join(m[:60] for m in nativas))
        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()

    sql(f"DELETE FROM operadores WHERE email = '{ALVO}'")
    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
