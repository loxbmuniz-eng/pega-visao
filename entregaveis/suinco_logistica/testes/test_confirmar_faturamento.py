#!/usr/bin/env python3
"""FATURAR pede confirmação, e a confirmação mostra QUAL carga. (25/08/2026)

Pedido do gestor: "quando o faturista clicar em FATURAR, aparecer um alerta
na tela para confirmar aquela etapa; ele clicando em FATURAR, aí sim a carga
faturada".

Faturar é a última etapa do pátio e a única que sai do painel para o
dinheiro. "Iniciar Embarque" a pessoa corrige em dois cliques; uma carga
faturada por engano vira nota emitida.

O que se prova aqui:

  1. clicar em FATURAR na fila NÃO fatura — abre a janela e a carga fica
     exatamente onde estava;
  2. a janela diz QUAL carga (número, placa, transportadora, destino, peso)
     — o erro que ela existe para pegar é linha trocada numa tabela de dez,
     não dedo torto;
  3. Cancelar fecha e não fatura;
  4. FATURAR na janela fatura de verdade — o status muda;
  5. a OUTRA porta para "Faturado" (o campo de placa da ação rápida) também
     passa pela confirmação: guardar só o botão deixaria essa destrancada;
  6. as etapas anteriores (Iniciar/Finalizar Embarque) continuam DIRETAS —
     confirmação em tudo vira clique automático e não protege nada;
  7. o foco começa em Cancelar, para quem apertar Enter por reflexo não
     faturar sem ler;
  8. no celular a janela cabe na tela e os botões têm alvo de toque de 44px.

    python3 testes/test_confirmar_faturamento.py
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


ATE_FINALIZADO = ['Aguardando Embarque', 'Embarque Iniciado', 'Embarque Finalizado']

# Uma carga pronta para faturar, sempre igual, para as checagens de conteúdo
# poderem comparar com valores conhecidos em vez de "algo não vazio".
MONTAR = """([ate]) => {
    DB.cargas = []; DB.movimentacoes = [];
    const f = DB.frota[0];
    criarCargaProgramada({ placa: f.placa, numeroCarga: '77123', peso: 12500,
      rota: '500', destino: 'UBERLANDIA', transportadora: 'TRANSP TESTE',
      operador: 'Ana' });
    const c = DB.cargas[0];
    c.transportadora = 'TRANSP TESTE'; c.destino = 'UBERLANDIA';
    for(const s of ate){ avancarStatusCarga(c.id, s, 'Op', 'Logística'); }
    abrirTab('faturamento'); renderAll();
    return { id: c.id, placa: c.placa, status: c.status };
  }"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Faturamento')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)

        print('\n=== 1. O CLIQUE ABRE A JANELA E NÃO FATURA ===')
        carga = await pg.evaluate(MONTAR, [ATE_FINALIZADO])
        ck('a carga chegou em Embarque Finalizado',
           carga['status'] == 'Embarque Finalizado', str(carga))
        await pg.click('#fat-tbody button')
        await pg.wait_for_timeout(400)
        d = await pg.evaluate("""(id) => ({
              janelaAberta: document.getElementById('modal-faturar').classList.contains('open'),
              status: getCarga(id).status,
            })""", carga['id'])
        ck('a janela de confirmação abriu', d['janelaAberta'], str(d))
        ck('e a carga NÃO foi faturada ainda',
           d['status'] == 'Embarque Finalizado', f"status {d['status']}")

        print('\n=== 2. A JANELA DIZ QUAL CARGA ===')
        txt = await pg.evaluate(
            "() => document.getElementById('faturar-resumo').textContent")
        for rot, val in (('número', '77123'), ('placa', carga['placa']),
                         ('transportadora', 'TRANSP TESTE'),
                         ('destino', 'UBERLANDIA'), ('peso', '12.500')):
            ck(f'mostra {rot}', val in txt, f'"{val}" em {txt[:90]!r}')

        print('\n=== 3. CANCELAR NÃO FATURA ===')
        await pg.click('#faturar-cancelar')
        await pg.wait_for_timeout(300)
        d = await pg.evaluate("""(id) => ({
              fechada: !document.getElementById('modal-faturar').classList.contains('open'),
              status: getCarga(id).status,
            })""", carga['id'])
        ck('a janela fechou', d['fechada'], str(d))
        ck('a carga continua em Embarque Finalizado',
           d['status'] == 'Embarque Finalizado', f"status {d['status']}")

        print('\n=== 4. FATURAR NA JANELA FATURA DE VERDADE ===')
        await pg.click('#fat-tbody button')
        await pg.wait_for_timeout(300)
        await pg.click('#faturar-confirmar')
        await pg.wait_for_timeout(500)
        d = await pg.evaluate("""(id) => ({
              fechada: !document.getElementById('modal-faturar').classList.contains('open'),
              status: getCarga(id).status,
            })""", carga['id'])
        ck('a janela fechou sozinha', d['fechada'], str(d))
        ck('agora sim a carga está Faturado',
           d['status'] == 'Faturado', f"status {d['status']}")

        print('\n=== 5. A AÇÃO RÁPIDA POR PLACA TAMBÉM CONFIRMA ===')
        # A porta que costuma ficar destrancada: a trava mora no
        # executarAvanco, não no botão, justamente por causa desta.
        carga = await pg.evaluate(MONTAR, [ATE_FINALIZADO])
        await pg.fill('#fat-placa', carga['placa'])
        await pg.click("#tab-faturamento button:has-text('FATURADO')")
        await pg.wait_for_timeout(400)
        d = await pg.evaluate("""(id) => ({
              janelaAberta: document.getElementById('modal-faturar').classList.contains('open'),
              status: getCarga(id).status,
            })""", carga['id'])
        ck('digitar a placa e clicar em FATURADO abre a mesma janela',
           d['janelaAberta'], str(d))
        ck('e também não fatura antes de confirmar',
           d['status'] == 'Embarque Finalizado', f"status {d['status']}")
        await pg.click('#faturar-confirmar')
        await pg.wait_for_timeout(400)
        st = await pg.evaluate("(id) => getCarga(id).status", carga['id'])
        ck('confirmando, fatura', st == 'Faturado', f'status {st}')

        print('\n=== 6. AS ETAPAS ANTERIORES CONTINUAM DIRETAS ===')
        # Confirmação em tudo vira clique automático e deixa de proteger.
        for ate, esperado in ((['Aguardando Embarque'], 'Embarque Iniciado'),
                              (['Aguardando Embarque', 'Embarque Iniciado'],
                               'Embarque Finalizado')):
            c = await pg.evaluate(MONTAR, [ate])
            await pg.evaluate("() => { abrirTab('expedicao'); renderAll(); }")
            await pg.wait_for_timeout(300)
            await pg.click('#exp-tbody button')
            await pg.wait_for_timeout(400)
            d = await pg.evaluate("""(id) => ({
                  janelaAberta: document.getElementById('modal-faturar').classList.contains('open'),
                  status: getCarga(id).status,
                })""", c['id'])
            ck(f'{esperado} avança sem janela',
               d['status'] == esperado and not d['janelaAberta'], str(d))
        await pg.evaluate("() => { abrirTab('faturamento'); renderAll(); }")

        print('\n=== 7. ENTER POR REFLEXO NÃO FATURA ===')
        carga = await pg.evaluate(MONTAR, [ATE_FINALIZADO])
        await pg.click('#fat-tbody button')
        await pg.wait_for_timeout(400)
        foco = await pg.evaluate("() => document.activeElement.id")
        ck('o foco começa em Cancelar', foco == 'faturar-cancelar', f'foco em {foco!r}')
        await pg.keyboard.press('Enter')
        await pg.wait_for_timeout(400)
        st = await pg.evaluate("(id) => getCarga(id).status", carga['id'])
        ck('Enter fecha sem faturar', st == 'Embarque Finalizado', f'status {st}')

        print('\n=== 8. NO CELULAR CABE E DÁ PARA TOCAR ===')
        # is_mobile/has_touch de verdade: a regra de 44px do painel é
        # @media (pointer:coarse), e uma janela estreita SEM emulação de
        # toque reporta ponteiro fino — mediria 40px e acusaria um defeito
        # que o celular do faturista não tem.
        ctxm = await nav.new_context(viewport={'width': 360, 'height': 740},
                                     is_mobile=True, has_touch=True)
        pgm = await ctxm.new_page()
        await pgm.goto(PAINEL)
        await pgm.wait_for_timeout(900)
        await pgm.evaluate("() => mostrarLoginLocal()")
        await pgm.fill('#login-nome', 'Ana')
        await pgm.select_option('#login-setor', 'Faturamento')
        await pgm.click('button:has-text("Entrar sem servidor")')
        await pgm.wait_for_timeout(500)
        await pgm.evaluate(MONTAR, [ATE_FINALIZADO])
        await pgm.evaluate("() => document.querySelector('#fat-tbody button').click()")
        await pgm.wait_for_timeout(500)
        m = await pgm.evaluate("""() => {
              const cx = document.getElementById('modal-faturar');
              const box = cx.querySelector('.modal-box');
              const alt = (id) => document.getElementById(id).getBoundingClientRect().height;
              return { aberta: cx.classList.contains('open'),
                       largura: box.getBoundingClientRect().width,
                       vazaLado: document.documentElement.scrollWidth > 360,
                       btnConfirmar: alt('faturar-confirmar'),
                       btnCancelar: alt('faturar-cancelar'),
                       texto: document.getElementById('faturar-resumo').textContent };
            }""")
        ck('a janela abre no celular', m['aberta'], str(m)[:80])
        ck('não vaza para os lados', not m['vazaLado'],
           f"scrollWidth {m['largura']:.0f}px de caixa")
        ck('o resumo da carga aparece igual', '77123' in m['texto'])
        for nome, alt in (('FATURAR', m['btnConfirmar']), ('Cancelar', m['btnCancelar'])):
            ck(f'o botão {nome} tem alvo de toque de 44px', alt >= 44, f'{alt:.1f}px')
        await pgm.close()
        await ctxm.close()

        print('\n=== 9. SEM ERRO DE JAVASCRIPT ===')
        ck('console limpo', not erros, '; '.join(erros[:3]))

        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('  Tudo verde.')
    return 0


sys.exit(asyncio.run(main()))
