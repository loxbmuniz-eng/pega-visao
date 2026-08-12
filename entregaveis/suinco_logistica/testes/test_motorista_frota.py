#!/usr/bin/env python3
"""Motorista habitual da placa — cadastro na Frota + autopreenchimento.

Pedido do usuário (11/08/2026):
  "adicionar campo motorista ao cadastro de placas"
  "DA MESMA FORMA QUE QUANDO O INPUT DA PLACA É FEITO, E ALTERA
   AUTOMATICAMENTE A TRANSPORTADORA, ALTERAR O NOME DO MOTORISTA CASO JA
   TENHA NOME CADASTRADO NA PLACA"

Regra que este teste fixa: o autopreenchimento NUNCA sobrescreve o que o
operador já digitou. Motorista de folga/substituto/freteiro do dia é caso
real, e o nome daquela viagem importa mais que o habitual do cadastro.

    python3 testes/test_motorista_frota.py
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
        pg = await nav.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)

        print('\n=== 1. CADASTRO DA FROTA ACEITA MOTORISTA ===')
        await pg.evaluate("() => abrirTab('cadastros')")
        await pg.wait_for_timeout(300)
        ck('campo Motorista existe na tela de Cadastros → Frota',
           await pg.is_visible('#frota-motorista'))

        await pg.fill('#frota-placa', 'TST7A11')
        await pg.fill('#frota-transportadora', 'Transportes Teste')
        await pg.fill('#frota-tipoveiculo', 'Carreta')
        await pg.fill('#frota-motorista', 'Carlos Pereira')
        await pg.evaluate("() => addFrotaUI()")
        await pg.wait_for_timeout(400)

        gravado = await pg.evaluate("() => (DB.frota.find(f=>f.placa==='TST7A11')||{}).motorista")
        ck('motorista fica gravado na Frota', gravado == 'Carlos Pereira', str(gravado))

        print('\n=== 2. AUTOPREENCHIMENTO AO DIGITAR A PLACA ===')
        await pg.evaluate("() => abrirTab('programacao')")
        await pg.wait_for_timeout(300)
        await pg.fill('#prog-placa', 'TST7A11')
        await pg.evaluate("() => atualizarPreviewFrotaPrograma()")
        await pg.wait_for_timeout(300)

        ck('motorista preenchido sozinho',
           (await pg.input_value('#prog-motorista')) == 'Carlos Pereira')
        ck('transportadora continua preenchendo (não quebrou o que já funcionava)',
           (await pg.input_value('#prog-transportadora')) == 'Transportes Teste')
        ck('aviso menciona o motorista',
           'Motorista' in (await pg.inner_text('#prog-frota-hint')))

        print('\n=== 3. NÃO SOBRESCREVE O QUE O OPERADOR DIGITOU ===')
        await pg.fill('#prog-motorista', 'Substituto de Hoje')
        await pg.fill('#prog-placa', 'TST7A11')
        await pg.evaluate("() => atualizarPreviewFrotaPrograma()")
        await pg.wait_for_timeout(300)
        ck('motorista digitado à mão é preservado',
           (await pg.input_value('#prog-motorista')) == 'Substituto de Hoje',
           await pg.input_value('#prog-motorista'))

        print('\n=== 4. PLACA SEM MOTORISTA CADASTRADO NÃO QUEBRA ===')
        await pg.evaluate("""() => {
            upsertFrota('TST8B22', 'Outra Transp', 'Truck', {});
        }""")
        await pg.fill('#prog-motorista', '')
        await pg.fill('#prog-placa', 'TST8B22')
        await pg.evaluate("() => atualizarPreviewFrotaPrograma()")
        await pg.wait_for_timeout(300)
        ck('sem motorista cadastrado, campo fica vazio (sem "undefined")',
           (await pg.input_value('#prog-motorista')) == '',
           await pg.input_value('#prog-motorista'))
        ck('aviso não promete motorista que não existe',
           'Motorista' not in (await pg.inner_text('#prog-frota-hint')))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
