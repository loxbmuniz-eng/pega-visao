#!/usr/bin/env python3
"""Digitar não pode ser interrompido pelo redesenho automático (31/08/2026).

O RELATO, do Wemerson, pelo dono:

    "comeca a preencher o campo e o campo para de digitar, tem que clicar de
     novo no campo, na hora de fazer um cadastro completando informacoes tem
     que ficar voltando no campo que ta digitando"

A CAUSA. O painel se redesenha inteiro a cada sincronia (15 em 15 segundos)
e a cada dado que chega de outro setor. O redesenho troca o HTML da aba, e
com ele o campo que estava sob o dedo: o foco se perde, o cursor volta para
o começo, e o que já tinha sido digitado some.

A proteção para isso JÁ EXISTE no projeto — `_devCapturarDigitacao` e
`_devRestaurarDigitacao` guardam valor, foco e posição do cursor. Mas foram
escritas para `#dev-lista` e valem só nas Devoluções. É a mesma família de
"a proteção escrita para um posto só" (ocorrência #20): a regra certa
existe, com comentário e tudo, e não vale para os irmãos dela.

O QUE ESTE TESTE EXIGE, nas telas onde se digita cadastro:

  1. o que já foi digitado CONTINUA no campo depois de um redesenho;
  2. o campo continua com o FOCO — a pessoa não precisa clicar de novo;
  3. o cursor fica onde estava, e não pulando para o fim: quem corrige o
     meio de um número não pode ter o resto digitado no lugar errado;
  4. e nada disso atrapalha o redesenho de quem NÃO está digitando.

    python3 testes/test_digitacao_nao_perde_foco.py
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
        pg = await nav.new_page(viewport={'width': 1400, 'height': 950})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(1200)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Chefe')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(900)

        print('\n=== 1. LINHA DA TORRE: DIGITAR E O PAINEL REDESENHAR ===')
        # A tela onde o defeito acontece é a que RECONSTRÓI o campo a cada
        # redesenho. Os campos fixos do formulário de Frota sobrevivem porque
        # não são regerados; as linhas editáveis da Torre, da Fila e da
        # Montagem são reescritas inteiras — e é nelas que se "completa
        # informação" de uma carga, que foi o que o Wemerson descreveu.
        await pg.evaluate("""() => {
              const f = DB.frota.find(x => x.placa && x.transportadora);
              criarCargaProgramada({placa: f.placa, numeroCarga: 'FOCO-1',
                cliente: 'C', destino: 'D', peso: 1000, operador: 'Chefe'});
              SuincoStore.save();
              abrirTab('torre');
            }""")
        await pg.wait_for_timeout(900)

        alvo = '#torre-tbody .motorista-input'
        existe = await pg.locator(alvo).count()
        ck('a linha da Torre tem campo editável', existe > 0, f'{existe} campo(s)')
        if not existe:
            await nav.close()
            return 1

        await pg.click(alvo)
        await pg.type(alvo, 'JOAO DA SILVA')
        # O redesenho que a sincronia dispara, no meio da digitação.
        await pg.evaluate("() => renderAll()")
        await pg.wait_for_timeout(300)

        d = await pg.evaluate("""(sel) => {
            const el = document.querySelector(sel);
            const foco = document.activeElement;
            return { valor: el ? el.value : null,
                     temFoco: !!(el && foco === el),
                     focoEm: foco ? (foco.className || foco.tagName) : null };
        }""", alvo)
        ck('o que foi digitado CONTINUA no campo',
           d['valor'] == 'JOAO DA SILVA', str(d['valor']))
        ck('e o campo continua com o foco — sem precisar clicar de novo',
           d['temFoco'], f"foco em {d['focoEm']}")

        print('\n=== 2. O CURSOR NÃO PULA PARA O FIM ===')
        await pg.evaluate("""(sel) => {
            const el = document.querySelector(sel);
            el.focus(); el.setSelectionRange(6, 6);
        }""", alvo)
        await pg.evaluate("() => renderAll()")
        await pg.wait_for_timeout(300)
        cur = await pg.evaluate("""(sel) => {
            const el = document.querySelector(sel);
            return { ini: el.selectionStart, fim: el.selectionEnd };
        }""", alvo)
        ck('o cursor fica onde estava', cur['ini'] == 6 and cur['fim'] == 6, str(cur))

        print('\n=== 3. QUEM NÃO ESTÁ DIGITANDO CONTINUA VENDO A TELA ATUALIZAR ===')
        atualizou = await pg.evaluate("""() => {
            document.activeElement && document.activeElement.blur();
            renderAll();
            const t = document.getElementById('torre-tbody');
            return { redesenhou: !!(t && t.innerHTML.length > 0) };
        }""")
        ck('o redesenho continua acontecendo normalmente',
           atualizou['redesenhou'], str(atualizou))

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


sys.exit(asyncio.run(main()))
