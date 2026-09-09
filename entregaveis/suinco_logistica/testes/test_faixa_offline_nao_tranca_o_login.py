#!/usr/bin/env python3
"""A faixa de offline não pode trancar a porta de entrada (31/08/2026).

O RELATO, do dono, vindo do celular do Rene da Expedição:

    "a faixa vermelha aparece e esconde o botao de login e a pessoa nao
     consegue clicar no botao de login porque o alerta sobrepoem o lugar
     onde ficaria esse botao"

O QUE SE MEDIU antes de mexer, em celular DEITADO (740x360, que é como ele
estava segurando o aparelho):

    caixa do login começa em 31px · faixa vai de 0 a 61px
    o toque no topo do formulário cai em `faixa-offline-sub`

Em pé não acontece: sobra altura e a caixa desce. Por isso parecia
aleatório — dependia de como a pessoa segurava o telefone.

DUAS COISAS ERRARAM JUNTAS, e cada uma sozinha já bastava:

  1. a guarda "antes do login não existe offline" olhava `DB.operador`, que
     SOBREVIVE no localStorage — `SuincoStore.save()` grava o DB inteiro.
     Quem já entrou uma vez tem operador salvo para sempre, então a guarda
     nunca protegeu a tela de login de ninguém que já tivesse usado o painel;
  2. a faixa tinha z-index 9999 contra 3600 do `.modal-overlay`: pintava por
     cima de QUALQUER caixa de diálogo e engolia o toque.

E tinha uma terceira, mais silenciosa: `body.esta-offline .btn-primary`
deixava o botão "Entrar" com 45% de opacidade. Apagar o botão que TIRA a
pessoa do offline, embaixo de um aviso escrito "SISTEMA INDISPONÍVEL", faz
qualquer um concluir que não adianta tentar. É a regra da casa: botão
desabilitado não ensina o caminho, só nega.

O QUE ESTE TESTE EXIGE:

  1. com a tela de login aberta, NÃO existe faixa — mesmo com operador
     salvo de uma sessão anterior, que é o caso de todo mundo que já usou;
  2. o toque no formulário de login chega no formulário, em toda tela de
     celular, deitado inclusive;
  3. o botão "Entrar" não fica apagado por causa do offline;
  4. depois de entrar, a faixa VOLTA a aparecer — a trava de offline
     continua valendo, que é o pedido original do dono;
  5. a faixa nunca fica acima de uma caixa de diálogo (z-index).

Roda sem servidor.

    python3 testes/test_faixa_offline_nao_tranca_o_login.py
"""
import asyncio
import sys

from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'

# Deitado primeiro: é a tela em que o defeito aparece.
TELAS = [(740, 360, 'celular deitado'), (800, 360, 'deitado largo'),
         (360, 640, 'celular em pé'), (390, 844, 'iPhone em pé'),
         (360, 320, 'em pé com o teclado virtual aberto'),
         (412, 915, 'Android grande')]

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)

        print('\n=== 1. TELA DE LOGIN ABERTA: NENHUMA FAIXA, E O TOQUE CHEGA ===')
        for larg, alt, nome in TELAS:
            ctx = await nav.new_context(viewport={'width': larg, 'height': alt})
            pg = await ctx.new_page()
            await pg.goto(PAINEL)
            await pg.wait_for_timeout(700)
            # Quem JÁ entrou alguma vez tem o operador salvo no aparelho.
            # É o estado de todo mundo na operação — e era o que furava a
            # guarda antiga.
            await pg.evaluate("""() => {
                DB.operador = { id:'u1', nome:'Rene', setor:'Expedição',
                                email:'rene@suinco.com.br' };
                SuincoStore.save();
            }""")
            await pg.reload()
            await pg.wait_for_timeout(1000)
            r = await pg.evaluate("""() => {
                const m = document.getElementById('modal-operador');
                m.classList.add('open');
                atualizarFaixaOffline('offline');
                const box = document.querySelector('#modal-operador .modal-box');
                const b = document.getElementById('btn-entrar');
                const bq = box.getBoundingClientRect();
                const qb = b.getBoundingClientRect();
                const noTopo = document.elementFromPoint(
                    Math.round(bq.left + bq.width / 2), Math.round(bq.top + 8));
                const noBotao = document.elementFromPoint(
                    Math.round(qb.left + qb.width / 2), Math.round(qb.top + qb.height / 2));
                const dentro = (el) => !!(el && m.contains(el));
                return {
                  operadorSalvo: !!(DB.operador && DB.operador.nome),
                  temFaixa: !!document.getElementById('faixa-offline'),
                  topoRecebe: noTopo ? (noTopo.id || noTopo.className || noTopo.tagName) : null,
                  topoEhDoLogin: dentro(noTopo),
                  botaoRecebeOToque: noBotao === b || (noBotao && b.contains(noBotao)),
                  botaoNaTela: qb.top >= 0 && qb.bottom <= window.innerHeight,
                  opacidadeDoBotao: getComputedStyle(b).opacity
                };
            }""")
            ck(f'{nome} ({larg}x{alt}): o operador salvo NÃO faz a faixa aparecer no login',
               not r['temFaixa'], str(r))
            ck(f'{nome}: o toque no topo do formulário chega no formulário',
               r['topoEhDoLogin'], f"quem recebeu: {r['topoRecebe']}")
            ck(f'{nome}: o toque no botão Entrar chega no botão',
               r['botaoRecebeOToque'] and r['botaoNaTela'], str(r))
            ck(f'{nome}: o botão Entrar não fica apagado pelo offline',
               float(r['opacidadeDoBotao']) > 0.9, f"opacidade {r['opacidadeDoBotao']}")
            await ctx.close()

        print('\n=== 2. DEPOIS DE ENTRAR, A FAIXA VOLTA (a trava continua valendo) ===')
        ctx = await nav.new_context(viewport={'width': 740, 'height': 360})
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Rene')
        await pg.select_option('#login-setor', 'Expedição')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(600)
        depois = await pg.evaluate("""() => {
            atualizarFaixaOffline('offline');
            const f = document.getElementById('faixa-offline');
            return { temFaixa: !!f,
                     loginAberto: document.getElementById('modal-operador')
                                    .classList.contains('open'),
                     texto: f ? f.innerText.toUpperCase().replace(/\\s+/g,' ') : null };
        }""")
        ck('a tela de login fechou', not depois['loginAberto'], str(depois['loginAberto']))
        ck('com a operação em andamento, a faixa aparece', depois['temFaixa'], str(depois))
        if depois['texto']:
            for pedaco in ('ALERTA', 'VOCÊ ESTÁ OFFLINE', 'SISTEMA INDISPONÍVEL'):
                ck(f'e continua dizendo "{pedaco}"', pedaco in depois['texto'],
                   depois['texto'][:110])

        print('\n=== 3. A FAIXA NUNCA FICA ACIMA DE UMA CAIXA DE DIÁLOGO ===')
        # Vale para QUALQUER modal, não só o do login: foi o z-index que
        # transformou um aviso num bloqueio.
        z = await pg.evaluate("""() => {
            const f = document.getElementById('faixa-offline');
            const m = document.querySelector('.modal-overlay');
            return { faixa: parseInt(getComputedStyle(f).zIndex, 10),
                     modal: parseInt(getComputedStyle(m).zIndex, 10) };
        }""")
        ck('a faixa fica ABAIXO das caixas de diálogo',
           z['faixa'] < z['modal'], f"faixa={z['faixa']} modal={z['modal']}")

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


sys.exit(asyncio.run(main()))
