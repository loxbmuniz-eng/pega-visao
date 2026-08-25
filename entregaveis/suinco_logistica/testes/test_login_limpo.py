#!/usr/bin/env python3
"""A tela de login mostra login e senha. Só. (25/08/2026)

Relato do dono: "eu quero que na tela de login só apareça o login e senha,
nada sobre autenticação de 2 fatores; a autenticação de 2 fatores deve
aparecer somente se necessária".

Ele estava certo, e a causa era uma ARMADILHA DE CASCATA, não um
esquecimento: o campo do segundo fator nascia com o atributo `hidden` e
aparecia mesmo assim, 114px de altura, para gente que nem tinha 2FA.

`[hidden]` é seletor de ATRIBUTO e tem a mesma especificidade de uma
CLASSE. Como `[hidden]{display:none}` mora na folha do NAVEGADOR e
`.form-group{display:flex}` mora na nossa, a nossa vence — folha de autor
sempre ganha no empate. Ou seja: todo `display` escrito numa classe apaga
em silêncio o `hidden` de quem usar aquela classe.

O projeto já tinha sido mordido duas vezes e remendado caso a caso
(`.nav-tab[hidden]`, `.sync-overlay[hidden]`). Remendo por elemento não
escala — o terceiro caso apareceu em `.pulso-grid`, que mostrava a grade
vazia JUNTO com a mensagem "ainda não há chegadas".

Este teste guarda as duas coisas:

  1. a tela de login não fala em segundo fator para quem só quer entrar;
  2. `hidden` significa escondido em QUALQUER elemento do painel — a
     varredura passa por todas as abas e reprova se um só aparecer.

    python3 testes/test_login_limpo.py
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
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        pg = await nav.new_page(viewport={'width': 1360, 'height': 950})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(1200)

        print('\n=== 1. A TELA DE LOGIN NÃO FALA EM SEGUNDO FATOR ===')
        d = await pg.evaluate("""() => {
              const caixa = document.querySelector('#modal-operador .modal-box');
              const bloco = document.getElementById('login-mfa-bloco');
              const r = bloco.getBoundingClientRect();
              return {
                // innerText, não textContent: o primeiro respeita o que
                // está de fato RENDERIZADO. textContent devolve também o
                // texto de quem está com display:none — e mediria o campo
                // escondido como se ele estivesse na tela.
                texto: caixa.innerText,
                blocoAltura: +r.height.toFixed(0),
                blocoDisplay: getComputedStyle(bloco).display,
                temEmail: !!document.querySelector('#login-email'),
                temSenha: !!document.querySelector('#login-senha'),
              };
            }""")
        ck('o campo de e-mail está lá', d['temEmail'])
        ck('o campo de senha está lá', d['temSenha'])
        ck('o bloco do segundo fator não ocupa espaço nenhum',
           d['blocoAltura'] == 0, f"{d['blocoAltura']}px, display {d['blocoDisplay']}")
        for palavra in ('autenticador', 'código de recuperação', 'dois fatores',
                        'segundo fator'):
            ck(f'a tela não menciona "{palavra}"',
               palavra.lower() not in d['texto'].lower(),
               d['texto'][:80].replace('\n', ' '))

        print('\n=== 2. E APARECE QUANDO O SERVIDOR PEDE ===')
        # Escondido de saída não pode virar escondido para sempre: quem tem
        # 2FA precisa conseguir entrar.
        d = await pg.evaluate("""() => {
              const bloco = document.getElementById('login-mfa-bloco');
              bloco.hidden = false;
              const r = bloco.getBoundingClientRect();
              const alt = +r.height.toFixed(0);
              bloco.hidden = true;
              return { altura: alt,
                       temCampo: !!document.getElementById('login-codigo') };
            }""")
        ck('revelado, o campo aparece de verdade', d['altura'] > 40, f"{d['altura']}px")
        ck('e é o campo do código de 6 dígitos', d['temCampo'])

        print('\n=== 3. `hidden` SIGNIFICA ESCONDIDO EM TODO O PAINEL ===')
        # A varredura que teria pego este defeito antes de o dono ver.
        sobrando = await pg.evaluate("""() => [...document.querySelectorAll('[hidden]')]
              .filter(e => e.getBoundingClientRect().height > 0)
              .map(e => e.id || e.className || e.tagName)""")
        ck('nada escondido aparece na tela de login', not sobrando, str(sobrando))

        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(900)

        abas = await pg.evaluate(
            "() => [...document.querySelectorAll('.nav-tab:not([hidden])')].map(t => t.dataset.tab)")
        ck('há abas para varrer', len(abas) > 3, str(abas))
        for aba in abas:
            await pg.evaluate("(a) => abrirTab(a)", aba)
            await pg.wait_for_timeout(350)
            sobrando = await pg.evaluate(
                """() => [...document.querySelectorAll('.tab-page.active [hidden]')]
                     .filter(e => e.getBoundingClientRect().height > 0)
                     .map(e => e.id || e.className || e.tagName)""")
            ck(f'aba {aba}: nada escondido aparecendo', not sobrando, str(sobrando))

        print('\n=== 4. SEM ERRO DE JAVASCRIPT ===')
        ck('console limpo', not erros, '; '.join(erros[:3]))

        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('  Tudo verde.')
    return 0


sys.exit(asyncio.run(main()))
