#!/usr/bin/env python3
"""Segundo fator na tela: ativar, entrar com código, e o campo que só
aparece para quem ativou. (22/08/2026 — etapa 4 do protocolo de segurança)

O que este teste guarda, além do fluxo:

  · quem NÃO ativou não vê campo de código nenhum — publicar o segundo
    fator não pode mudar a tela de quem não pediu por ele;
  · o campo aparece SOZINHO quando o servidor pede, sem a pessoa precisar
    saber o que é segundo fator;
  · os códigos de recuperação aparecem uma vez, e a tela diz isso.

    python3 testes/test_segundo_fator.py
"""
import asyncio
import os
import subprocess
import sys
import hmac, hashlib, base64, struct, time
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def totp(segredo_b32, quando=None):
    """Gera o código como o aplicativo do celular geraria — implementação
    independente da do servidor, de propósito: se as duas concordam, a
    conta está certa; se eu reusasse a do servidor, o teste concordaria
    com o próprio erro."""
    chave = base64.b32decode(segredo_b32 + '=' * (-len(segredo_b32) % 8))
    contador = int((quando or time.time()) // 30)
    mac = hmac.new(chave, struct.pack('>Q', contador), hashlib.sha1).digest()
    o = mac[-1] & 0x0F
    num = struct.unpack('>I', mac[o:o + 4])[0] & 0x7FFFFFFF
    return str(num % 10 ** 6).zfill(6)


def marcarSuspeita():
    """Coloca a conta no estado que faz o servidor pedir o código.

    Desde 24/08/2026 o segundo fator só aparece depois de CINCO senhas
    erradas na janela de 30 min. Toda seção que queira ver o campo de
    código precisa passar por aqui primeiro — inclusive DEPOIS de uma
    entrada bem-sucedida, porque entrar zera o contador de propósito.

    Escrito direto no banco em vez de cinco tentativas pela tela: o que
    estas seções testam é a TELA reagindo ao pedido do servidor. O
    contador em si tem teste próprio no bloco 10 de api.test.js.
    """
    subprocess.run(
        ['sudo', '-u', 'postgres', 'psql', '-q', '-d', 'embarque_suinco', '-c',
         "UPDATE operadores SET falhas_senha = 5, falhas_desde = now(), "
         "bloqueado_ate = NULL WHERE email = 'mfaui@teste.local'"],
        capture_output=True)


async def esperarEntrada(pg, segundos=20):
    """Espera o painel confirmar que entrou, em vez de dormir um tanto fixo.

    O sleep fixo passava isolado e falhava na bateria: com quatro
    navegadores disputando CPU, a volta do servidor mais o render passam
    de três segundos. Vermelho de relógio custa mais caro que o defeito
    que ele finge denunciar — é a mesma lição de test_carga_dev_e_lacres.
    """
    for _ in range(segundos * 4):
        if await pg.evaluate("() => !!(DB.operador && DB.operador.email)"):
            return True
        await asyncio.sleep(0.25)
    return False


async def esperarPedidoDeCodigo(pg, segundos=20):
    """Espera o servidor TER PEDIDO o código antes de preencher o campo.

    O campo aparecer não basta. Preencher enquanto a resposta do primeiro
    clique ainda está voltando faz o painel limpar o valor ao renderizar o
    pedido — o formulário sobe com o código VAZIO e o servidor responde
    "Digite o código", que é exatamente o que se estava tentando fazer.

    A mensagem de erro na tela é a prova de que a ida ao servidor
    terminou. Esperar por ela é esperar a condição certa.
    """
    for _ in range(segundos * 4):
        txt = await pg.evaluate(
            "() => (document.getElementById('login-erro')||{}).textContent || ''")
        if 'autenticador' in txt:
            return True
        await asyncio.sleep(0.25)
    return False


async def abrir(nav, rotulo):
    ctx = await nav.new_context(viewport={'width': 1280, 'height': 900})
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__mfa_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email', timeout=25000)
    return ctx, pg


async def main():
    # Operador dedicado, criado direto no banco para não depender de tela.
    subprocess.run(['sudo', '-u', 'postgres', 'psql', '-q', '-d', 'embarque_suinco', '-c',
                    "DELETE FROM operadores WHERE email = 'mfaui@teste.local'"],
                   capture_output=True)
    # O hash sai do bcrypt (o servidor confere com bcrypt); a gravação vai
    # por psql, que é como o resto da bancada de teste fala com o banco.
    h = subprocess.run(
        ['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
        cwd='/home/user/pega-visao/entregaveis/suinco_logistica/backend',
        capture_output=True, text=True)
    if h.returncode != 0:
        print('não consegui gerar o hash:', h.stderr[:300])
        return 1
    cria = subprocess.run(
        ['sudo', '-u', 'postgres', 'psql', '-q', '-d', 'embarque_suinco', '-c',
         "INSERT INTO operadores (email,nome,setor,senha_hash) VALUES "
         f"('mfaui@teste.local','MFA Tela','Logística','{h.stdout.strip()}')"],
        capture_output=True, text=True)
    if cria.returncode != 0:
        print('não consegui criar o operador:', cria.stderr[:300])
        return 1

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctx, pg = await abrir(nav, 'a')
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        print('\n=== 1. QUEM NÃO ATIVOU NÃO VÊ CAMPO DE CÓDIGO ===')
        escondido = await pg.evaluate(
            "() => document.getElementById('login-mfa-bloco').hidden")
        ck('o campo de código nasce escondido', escondido is True, str(escondido))

        await pg.fill('#login-email', 'mfaui@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3000)
        entrou = await pg.evaluate("() => !!(DB.operador && DB.operador.email)")
        ck('entra normalmente só com a senha', entrou, str(entrou))

        print('\n=== 2. ATIVAÇÃO PELA ABA USUÁRIOS ===')
        await pg.click(".nav-tab[data-tab='usuarios']")
        await pg.wait_for_timeout(1500)
        temCard = await pg.evaluate(
            "() => (document.getElementById('mfa-painel')||{}).textContent || ''")
        ck('o card "Minha segurança" oferece a ativação', 'Ativar segundo fator' in temCard,
           temCard[:80])

        await pg.click("#mfa-painel button")
        await pg.wait_for_timeout(1200)
        segredo = await pg.evaluate(
            "() => (document.querySelector('.mfa-segredo')||{}).textContent || ''")
        segredo = segredo.replace(' ', '').strip()
        ck('a chave é mostrada para digitar no celular', len(segredo) >= 16, segredo[:12] + '…')
        if len(segredo) < 16:
            await nav.close()
            return 1

        await pg.fill('#mfa-confirmar-codigo', totp(segredo))
        await pg.click("button:has-text('Confirmar e ativar')")
        await pg.wait_for_timeout(1800)
        codigos = await pg.evaluate(
            "() => [...document.querySelectorAll('.mfa-codigos span')].map(s=>s.textContent)")
        ck('os 8 códigos de recuperação aparecem', len(codigos) == 8, str(len(codigos)))
        avisa = await pg.evaluate(
            "() => (document.querySelector('.mfa-recuperacao')||{}).textContent || ''")
        ck('a tela avisa que eles não aparecem de novo', 'não aparecem de novo' in avisa)

        print('\n=== 3. ENTRADA NORMAL CONTINUA SÓ COM A SENHA ===')
        # MUDANÇA DE REGRA (24/08/2026): "2FA não deve aparecer no login,
        # somente caso erre a senha mais de 5x". Ativar o segundo fator
        # deixou de cobrar código em toda entrada — se cobrasse, ninguém
        # ativaria, que foi exatamente o que aconteceu nos dois primeiros
        # dias. Ver o cabeçalho da migração 032.
        ctx0, pg0 = await abrir(nav, 'z')
        await pg0.fill('#login-email', 'mfaui@teste.local')
        await pg0.fill('#login-senha', SENHA)
        await pg0.click('#btn-entrar')
        await pg0.wait_for_timeout(2500)
        normal = await pg0.evaluate(
            "() => !document.getElementById('login-mfa-bloco').hidden")
        ck('sem suspeita, o campo de código NÃO aparece', not normal)
        await ctx0.close()

        print('\n=== 3b. DEPOIS DE CINCO SENHAS ERRADAS, O LOGIN PEDE O CÓDIGO ===')
        # Escrito direto no banco em vez de cinco tentativas pela tela: o
        # que se testa aqui é a TELA reagindo ao pedido do servidor; o
        # contador tem teste próprio no backend (bloco 10 de api.test.js).
        marcarSuspeita()
        ctx2, pg2 = await abrir(nav, 'b')
        await pg2.fill('#login-email', 'mfaui@teste.local')
        await pg2.fill('#login-senha', SENHA)
        await pg2.click('#btn-entrar')
        await pg2.wait_for_timeout(2500)
        apareceu = await pg2.evaluate(
            """() => ({visivel: !document.getElementById('login-mfa-bloco').hidden,
                       erro: (document.getElementById('login-erro')||{}).textContent || ''})""")
        ck('o campo de código aparece sozinho quando o servidor pede',
           apareceu['visivel'], str(apareceu))
        ck('e a mensagem diz o que fazer',
           'aplicativo autenticador' in apareceu['erro'], apareceu['erro'][:60])

        await esperarPedidoDeCodigo(pg2)
        await pg2.fill('#login-codigo', totp(segredo))
        await pg2.click('#btn-entrar')
        dentro = await esperarEntrada(pg2)
        ck('senha + código entra', dentro,
           '' if dentro else await pg2.evaluate(
               "() => (document.getElementById('login-erro')||{}).textContent || ''"))

        print('\n=== 4. CÓDIGO DE RECUPERAÇÃO (celular perdido) ===')
        # A entrada da seção 3b zerou o contador — é o comportamento certo
        # e documentado. Para ver o campo de código de novo, a conta
        # precisa voltar ao estado de suspeita.
        marcarSuspeita()
        ctx3, pg3 = await abrir(nav, 'c')
        await pg3.fill('#login-email', 'mfaui@teste.local')
        await pg3.fill('#login-senha', SENHA)
        await pg3.click('#btn-entrar')
        # Espera o servidor TER PEDIDO o código — o campo visível não
        # basta, ver esperarPedidoDeCodigo.
        await pg3.wait_for_selector('#login-codigo:visible', timeout=15000)
        await esperarPedidoDeCodigo(pg3)
        await pg3.fill('#login-codigo', codigos[0])
        await pg3.click('#btn-entrar')
        await esperarEntrada(pg3)
        rec = await pg3.evaluate(
            """() => ({dentro: !!(DB.operador && DB.operador.email),
                       erro: (document.getElementById('login-erro')||{}).textContent || ''})""")
        # Leva o MOTIVO junto. Sem isso, esta linha falhava na bateria e
        # passava isolada sem dizer por quê — e um vermelho que não se
        # explica custa mais tempo que o defeito que ele denuncia.
        ck('um código de recuperação entra sem o celular',
           rec['dentro'], rec['erro'][:90] or 'sem mensagem na tela')

        print('\n=== 5. CONSOLE LIMPO + CAPTURA ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await pg.screenshot(path='/tmp/claude-0/-home-user-pega-visao/'
                                 '82f87c99-e223-5c72-91d0-65150266c838/scratchpad/mfa.png')
        await nav.close()

    subprocess.run(['sudo', '-u', 'postgres', 'psql', '-q', '-d', 'embarque_suinco', '-c',
                    "DELETE FROM operadores WHERE email = 'mfaui@teste.local'"],
                   capture_output=True)
    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
