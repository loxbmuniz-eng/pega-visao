#!/usr/bin/env python3
"""Sem sessão, o painel não mostra a tela de trabalho — mostra o login (31/08/2026).

A CAUSA RAIZ DO DIA INTEIRO, em uma linha (app.js, o revelar do painel):

    if(DB.operador && document.body.classList.contains('pre-login')){
      revelarPainel();
    }

Dois fatos diferentes, com PRAZOS diferentes, tratados como um só:

    DB.operador (nome, setor, e-mail)  →  localStorage   →  para sempre
    o token (a sessão de verdade)      →  sessionStorage →  morre com a aba

Quem entrou uma vez ficava "logado" para sempre aos olhos da tela.

O QUE ISSO PRODUZIU, em cascata, em 31/08/2026:

  · o painel revelava a tela de trabalho INTEIRA sem sessão nenhuma;
  · sem sessão ele não lê o servidor: a Torre e a programação mostravam a
    cópia local — ZERO num navegador limpo. O dono, no meio da operação:
    "acabei de abrir aqui o painel e zerou tudo (...) zerou a programação
    que estava em andamento, a torre de controle". No celular, que tinha
    sessão, estava tudo certo — foi isso que provou que o dado não se
    perdeu, só não estava sendo lido;
  · nada do que se digitasse subia (ocorrência #24);
  · e não havia login na tela para sair do estado, porque aos olhos do
    painel a pessoa já estava logada.

Cada consequência foi corrigida no dia. Nenhuma bastava: enquanto a decisão
de revelar o painel olhasse um dado que sobrevive à sessão, o problema
voltaria de outra forma.

O QUE ESTE TESTE EXIGE:

  1. com operador salvo e SEM token, o painel NÃO revela a tela de trabalho
     e a tela de login está aberta;
  2. a tela de trabalho não fica visível por trás — `pre-login` esconde;
  3. quem escolheu "Entrar sem servidor" (sem e-mail) continua entrando: é
     decisão de quem usa, não sessão perdida;
  4. com sessão de verdade, o painel aparece normalmente — a trava não pode
     barrar quem está certo.

Roda sem servidor.

    python3 testes/test_sem_sessao_nao_mostra_painel.py
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
        erros = []

        print('\n=== 1. OPERADOR SALVO, SEM TOKEN: NÃO REVELA O PAINEL ===')
        ctx = await nav.new_context(viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(1000)
        # O estado de todo mundo que já usou o painel e fechou a aba.
        await pg.evaluate("""() => {
            DB.operador = { id:'u1', nome:'Rene', setor:'Expedição',
                            email:'rene@suinco.com.br' };
            SuincoStore.save();
            localStorage.setItem('suinco_entrou_pelo_servidor', '1');
            sessionStorage.removeItem('suinco_token');
        }""")
        await pg.reload()
        await pg.wait_for_timeout(1600)
        r = await pg.evaluate("""() => {
            renderAll();
            return { preLogin: document.body.classList.contains('pre-login'),
                     loginAberto: document.getElementById('modal-operador')
                                    .classList.contains('open'),
                     temSessao: typeof temSessaoParaOPainel === 'function'
                                  ? temSessaoParaOPainel() : null };
        }""")
        ck('o painel reconhece que NÃO tem sessão', r['temSessao'] is False, str(r))
        ck('a tela de trabalho fica escondida (pre-login)', r['preLogin'], str(r))
        ck('e a tela de login está aberta', r['loginAberto'], str(r))

        print('\n=== 2. E O PAINEL NÃO MOSTRA NÚMERO NENHUM POR TRÁS ===')
        # O que assustou o dono foi ver a Torre ZERADA — número errado é pior
        # que número nenhum, porque parece dado.
        vis = await pg.evaluate("""() => {
            const t = document.getElementById('tab-torre');
            if(!t) return { semTorre: true };
            const q = t.getBoundingClientRect();
            return { visivel: q.width > 0 && q.height > 0
                              && getComputedStyle(t).visibility !== 'hidden' };
        }""")
        ck('a Torre de Controle não fica visível sem sessão',
           vis.get('semTorre') or not vis['visivel'], str(vis))
        await ctx.close()

        print('\n=== 3. MODO LOCAL DE PROPÓSITO CONTINUA ENTRANDO ===')
        ctx2 = await nav.new_context(viewport={'width': 1440, 'height': 900})
        pg2 = await ctx2.new_page()
        pg2.on('pageerror', lambda e: erros.append(str(e)))
        await pg2.goto(PAINEL)
        await pg2.wait_for_timeout(1000)
        await pg2.evaluate("() => mostrarLoginLocal()")
        await pg2.fill('#login-nome', 'Ana')
        await pg2.select_option('#login-setor', 'Logística')
        await pg2.click('button:has-text("Entrar sem servidor")')
        await pg2.wait_for_timeout(900)
        local = await pg2.evaluate("""() => ({
            preLogin: document.body.classList.contains('pre-login'),
            temSessao: temSessaoParaOPainel(),
            operadorSemEmail: !(DB.operador && DB.operador.email)
        })""")
        ck('modo local não tem e-mail (é escolha, não acidente)',
           local['operadorSemEmail'], str(local))
        ck('e continua entrando no painel', local['temSessao'] and not local['preLogin'],
           str(local))
        await ctx2.close()

        print('\n=== 4. COM SESSÃO DE VERDADE, O PAINEL APARECE ===')
        # A trava não pode barrar quem está certo — seria trocar um defeito
        # por outro, e desta vez impedindo a operação inteira de trabalhar.
        ctx3 = await nav.new_context(viewport={'width': 1440, 'height': 900})
        pg3 = await ctx3.new_page()
        pg3.on('pageerror', lambda e: erros.append(str(e)))
        await pg3.goto(PAINEL)
        await pg3.wait_for_timeout(1000)
        com = await pg3.evaluate("""() => {
            DB.operador = { id:'u1', nome:'Rene', setor:'Expedição',
                            email:'rene@suinco.com.br' };
            localStorage.setItem('suinco_entrou_pelo_servidor', '1');
            sessionStorage.setItem('suinco_token', 'token-vivo');
            document.body.classList.add('pre-login');
            renderAll();
            return { temSessao: temSessaoParaOPainel(),
                     preLogin: document.body.classList.contains('pre-login') };
        }""")
        ck('com token, o painel entende que há sessão', com['temSessao'], str(com))
        ck('e revela a tela de trabalho', not com['preLogin'], str(com))
        await ctx3.close()

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


sys.exit(asyncio.run(main()))
