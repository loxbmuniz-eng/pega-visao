#!/usr/bin/env python3
"""A parte de gerenciar usuários pede a senha da aba (08/10/2026, pedido do dono).

PEDIDO: "é pra você colocar a senha … na aba usuários e não mostrar nada
dela". Decisões do dono no PROMPT: tranca só o gerenciar (Minha segurança
segue livre); pede uma vez por login; quem erra segue a regra do login.
Quem confere é o SERVIDOR — a senha não mora no painel, que é público.

Este teste sobe uma API PRÓPRIA (porta 3019) com uma senha de teste gravada
como o servidor de verdade grava (scripts/hash_da_senha.mjs → base64 no
SENHA_USUARIOS_HASH) — a API da bateria (3010) segue sem senha, e as outras
suítes da aba Usuários não mudam. Tudo pela tela, como a pessoa faz:
  1. a Administração clica na aba: a pergunta abre, com campo escondido, e
     NADA do gerenciar está no DOM (nem a lista, nem o cadastro, nem os
     vigias); "Minha segurança" aparece;
  2. senha errada: o erro aparece DENTRO da janela, ela não fecha, o campo
     esvazia — e a pessoa continua logada (o 401 derrubaria a sessão);
  3. senha certa: a lista aparece; a senha não fica no DOM;
  4. sair da aba e voltar, e recarregar a página: não pede de novo (uma vez
     por login);
  5. login novo: pede de novo; quem desiste vê o cartão "Digitar a senha";
  6. a Portaria abre a aba e não vê pergunta nenhuma — só Minha segurança.

    bash testes/rodar_tudo.sh test_usuarios_com_senha
"""
import asyncio
import json
import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

RAIZ = Path(__file__).resolve().parent.parent
BACKEND = RAIZ / 'backend'
PAINEL_ARQ = RAIZ / 'index.html'
PORTA = '3019'
API = f'http://127.0.0.1:{PORTA}'
SENHA = 'senha-de-teste-123'            # login dos usuários de teste
SENHA_ABA = 'senha-da-aba-de-tela-7'    # a senha da aba, só deste teste
ADM = 'senhaaba-adm@teste.local'
PORT = 'senhaaba-port@teste.local'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def sql(comando):
    r = subprocess.run(['sudo', '-u', 'postgres', 'psql', '-qtA', '-d', 'embarque_suinco', '-c', comando],
                       capture_output=True, text=True)
    return r.stdout.strip()


def saude():
    try:
        with urllib.request.urlopen(API + '/health', timeout=3) as r:
            return json.loads(r.read().decode())
    except Exception:
        return None


def subir_api(hash_b64):
    amb = dict(os.environ, PORT=PORTA, SENHA_USUARIOS_HASH=hash_b64, RATE_LIMIT='20000',
               PLAYWRIGHT_CHROMIUM_PATH='/opt/pw-browsers/chromium')
    p = subprocess.Popen(['node', 'src/servidor.js'], cwd=str(BACKEND), env=amb,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    for _ in range(30):
        s = saude()
        if s and s.get('ok'):
            return p, s
        time.sleep(1)
    p.terminate()
    raise SystemExit('a API própria do teste não subiu')


async def abrir(nav, email, largura=1440):
    ctx = await nav.new_context(viewport={'width': largura, 'height': 900})
    pg = await ctx.new_page()
    html = PAINEL_ARQ.read_text(encoding='utf-8')
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js', f'{API}/socket.io/socket.io.js')
    url = f'{API}/__usuarios_com_senha'
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


async def pergunta_aberta(pg):
    return await pg.evaluate("() => !!document.querySelector('#modal-pergunta.open')")


async def visivel(pg, sel):
    return await pg.evaluate("""s => { const e = document.querySelector(s);
        return !!e && !e.closest('[hidden]') && e.offsetParent !== null; }""", sel)


async def linhas(pg):
    return await pg.evaluate("() => document.querySelectorAll('#usr-tbody tr').length")


async def entrar_na_aba(pg, tab):
    await pg.click(f'.nav-tab[data-tab="{tab}"]')
    await pg.wait_for_timeout(700)


async def main():
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(BACKEND), capture_output=True, text=True)
    hb = subprocess.run(['node', 'scripts/hash_da_senha.mjs'], input=SENHA_ABA, cwd=str(BACKEND),
                        capture_output=True, text=True)
    if h.returncode or hb.returncode or not hb.stdout.strip():
        print('não consegui gerar os hashes:', h.stderr[:200], hb.stderr[:200])
        return 1
    sql(f"DELETE FROM operadores WHERE email IN ('{ADM}','{PORT}')")
    sql("INSERT INTO operadores (email,nome,setor,senha_hash) VALUES "
        f"('{ADM}','Adm Senha Aba','Administração','{h.stdout.strip()}'),"
        f"('{PORT}','Port Senha Aba','Portaria','{h.stdout.strip()}')")

    proc, s = subir_api(hb.stdout.strip())
    try:
        ck('a API própria do teste diz que a trava está ligada (o hash gravado como no servidor)',
           s.get('travaUsuarios') == 'ligada', str(s.get('travaUsuarios')))
        async with async_playwright() as p:
            nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
            ctx, pg = await abrir(nav, ADM)
            erros = []
            pg.on('pageerror', lambda e: erros.append(str(e)))

            # 1. clicar na aba abre a pergunta; nada do gerenciar à vista
            await entrar_na_aba(pg, 'usuarios')
            ck('1. clicar na aba Usuários abre a pergunta da senha', await pergunta_aberta(pg))
            titulo = await pg.evaluate("() => (document.getElementById('pergunta-titulo')||{}).textContent || ''")
            ck('1. o título diz o que é', 'Senha da aba Usuários' in titulo, titulo)
            tipo = await pg.evaluate("() => (document.getElementById('pergunta-campo')||{}).type")
            ck('1. o campo é de senha (não mostra o que se digita)', tipo == 'password', str(tipo))
            ck('1. nenhuma linha de usuário no DOM', await linhas(pg) == 0)
            ck('1. o cadastro de usuário não aparece', not await visivel(pg, '#usr-email'))
            ck('1. os vigias não aparecem', not await visivel(pg, '#card-vigias'))
            ck('1. "Minha segurança" aparece (é de todos)', await visivel(pg, '#card-minha-seguranca'))

            # 2. senha errada: erro dentro da janela, ela não fecha, continua logado
            await pg.fill('#pergunta-campo', 'senha-errada-qualquer')
            await pg.press('#pergunta-campo', 'Enter')
            await pg.wait_for_timeout(1200)
            ck('2. senha errada: a janela continua aberta', await pergunta_aberta(pg))
            erro = await pg.evaluate("""() => { const e = document.getElementById('pergunta-erro');
                return e && !e.hidden ? e.textContent : ''; }""")
            ck('2. o erro aparece DENTRO da janela, dizendo o que acontece', 'Senha incorreta' in erro and '15 minutos' in erro, erro)
            ck('2. o campo esvaziou (a senha errada não fica para o próximo)',
               await pg.evaluate("() => document.getElementById('pergunta-campo').value") == '')
            ck('2. a pessoa CONTINUA logada (sem "Sessão expirada")',
               await pg.evaluate("() => !!(DB.operador && DB.operador.email) && SuincoSharePoint.estado() !== 'local'"))
            ck('2. ainda nenhuma linha de usuário', await linhas(pg) == 0)

            # 3. senha certa
            await pg.fill('#pergunta-campo', SENHA_ABA)
            await pg.press('#pergunta-campo', 'Enter')
            for _ in range(40):
                if not await pergunta_aberta(pg) and await linhas(pg) > 0:
                    break
                await asyncio.sleep(0.25)
            ck('3. senha certa: a janela fecha', not await pergunta_aberta(pg))
            corpo = await pg.evaluate("() => document.getElementById('usr-tbody').innerText")
            ck('3. a lista de usuários aparece', ADM in corpo, corpo[:120])
            ck('3. o cadastro aparece', await visivel(pg, '#usr-email'))
            ck('3. o cartão "trancado" some', not await visivel(pg, '#card-usuarios-trancada'))
            ck('3. a senha da aba não fica no DOM', SENHA_ABA not in await pg.content())

            # 4. uma vez por login
            await entrar_na_aba(pg, 'torre')
            await entrar_na_aba(pg, 'usuarios')
            ck('4. sair da aba e voltar não pede de novo', not await pergunta_aberta(pg) and await linhas(pg) > 0)
            await pg.reload()
            await pg.wait_for_function("() => !!(DB.operador && DB.operador.email)", timeout=20000)
            await pg.wait_for_timeout(1500)
            await entrar_na_aba(pg, 'usuarios')
            await pg.wait_for_timeout(800)
            ck('4. recarregar a página (o mesmo login) não pede de novo',
               not await pergunta_aberta(pg) and await linhas(pg) > 0)
            ck('sem erro de JavaScript', not erros, ' | '.join(erros[:3]))
            await ctx.close()

            # 5. login novo pede de novo; quem desiste tem o caminho
            ctx, pg = await abrir(nav, ADM)
            await entrar_na_aba(pg, 'usuarios')
            ck('5. login novo: pede a senha de novo', await pergunta_aberta(pg))
            await pg.click('#pergunta-cancelar')
            await pg.wait_for_timeout(400)
            ck('5. quem desiste vê o cartão que explica e o botão "Digitar a senha"',
               await visivel(pg, '#card-usuarios-trancada') and await visivel(pg, '#btn-destrancar-usuarios'))
            ck('5. e continua sem a lista', await linhas(pg) == 0)
            await pg.click('#btn-destrancar-usuarios')
            await pg.wait_for_timeout(400)
            ck('5. o botão abre a pergunta', await pergunta_aberta(pg))
            await ctx.close()

            # 6. outro setor: só Minha segurança, sem pergunta
            ctx, pg = await abrir(nav, PORT)
            await entrar_na_aba(pg, 'usuarios')
            ck('6. a Portaria abre a aba sem pergunta nenhuma', not await pergunta_aberta(pg))
            ck('6. e vê "Minha segurança"', await visivel(pg, '#card-minha-seguranca'))
            ck('6. e não vê o cartão de gerenciar', not await visivel(pg, '#card-usuarios-trancada'))
            await ctx.close()
            await nav.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        sql(f"DELETE FROM operadores WHERE email IN ('{ADM}','{PORT}')")

    print(f"\n{len(falhas)} FALHA(S)" + (': ' + ', '.join(falhas) if falhas else ''))
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
