#!/usr/bin/env python3
"""O checklist de devoluções não se apaga quando uma carga é atualizada.

O RELATO, do dono, 27/08/2026:

    "se uma carga é atualizada o checklist está sendo apagado"
    "qualquer coisa que aparece atualizado apaga o checklist de devoluções,
     precisamos bater forte nisso e resolver esse processo da esteira"

O CAMINHO, rastreado linha a linha (nada disso é suposição):

  1. qualquer carga criada/alterada/movimentada em QUALQUER setor emite
     `carga:atualizada` no socket;
  2. o painel chama `sincronizarAgora()`, funde o que veio e, se algo mudou,
     chama `renderAll()`  (app.js, dentro de `aoReceberDados`);
  3. `renderAll()` → `renderTabAtual()` → `renderDevolucoes()`;
  4. `renderDevolucoes()` chamava `carregarDevolucoes()` SEMPRE — busca a
     lista no servidor de novo e reescreve `#dev-lista` inteiro;
  5. o `innerHTML` novo nasce com os campos vazios. Tudo que a pessoa tinha
     digitado e ainda NÃO gravou — a linha nova da nota, o cabeçalho em
     meio-preenchimento — desaparece na frente dela.

E não depende de outro setor: a consulta periódica faz o mesmo caminho
sempre que qualquer coisa mudou no dia.

O QUE ESTE TESTE EXIGE, com a carga sendo atualizada DE VERDADE por outro
terminal, pelo socket, como acontece no pátio:

  · o que está digitado na linha nova continua lá;
  · o que está digitado no cabeçalho continua lá;
  · o checklist continua ABERTO;
  · o cursor continua no campo onde estava.

Exige o backend local no ar.

    python3 testes/test_checklist_nao_apaga.py
"""
import asyncio
import os
import sys

from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def abrir(nav, email, rotulo):
    ctx = await nav.new_context(viewport={'width': 1400, 'height': 950})
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__cheklist_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_timeout(1200)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    return ctx, pg


# O campo do cabeçalho é achado pelo RÓTULO, não por posição: rótulo é o que
# a pessoa lê, e é o que sobrevive a um campo entrar ou sair do bloco.
POR_ROTULO = """(rot) => {
  const cartao = document.querySelector('.dev-card.dev-aberta');
  if(!cartao) return null;
  const div = [...cartao.querySelectorAll('.dev-card-corpo div')]
    .find(d => d.querySelector(':scope > label')
            && d.querySelector(':scope > label').textContent.trim().startsWith(rot)
            && d.querySelector(':scope > input'));
  return div ? div.querySelector(':scope > input') : null;
}"""

VALOR_POR_ROTULO = POR_ROTULO.replace(
    "return div ? div.querySelector(':scope > input') : null;",
    "return div ? div.querySelector(':scope > input').value : null;")


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        erros = []

        print('\n=== 0. UM CHECKLIST ABERTO, COM GENTE DIGITANDO NELE ===')
        ctxA, pgA = await abrir(nav, 'chefe@teste.local', 'admin')
        pgA.on('pageerror', lambda e: erros.append(str(e)))
        await pgA.evaluate("() => abrirTab('devolucoes')")
        await pgA.wait_for_timeout(1800)
        await pgA.fill('#dev-operador-cod', '900123')
        await pgA.select_option('#dev-rota', '500')
        await pgA.click('button:has-text("➕ Criar checklist")')
        await pgA.wait_for_timeout(2500)
        dev = await pgA.evaluate(
            "() => DEVOLUCOES.length ? { id: DEVOLUCOES[0].id, numero: DEVOLUCOES[0].numero } : null")
        ck('checklist criado', bool(dev), str(dev))
        if not dev:
            await nav.close()
            return 1
        did = dev['id']

        # Abre o cartão e digita SEM gravar — é exatamente o estado da pessoa
        # no meio do lançamento de uma nota.
        await pgA.evaluate("(id) => { _devExpandida = id; renderListaDevolucoes(); }", did)
        await pgA.wait_for_timeout(600)
        await pgA.fill(f'#dev-ni-{did}-nota', '778899')
        await pgA.fill(f'#dev-ni-{did}-cx', '5')
        await pgA.fill(f'#dev-ni-{did}-numdev', 'DEV-4242')
        cab = await pgA.evaluate_handle(POR_ROTULO, 'Cód. operador')
        temCab = await pgA.evaluate("(el) => !!el", cab)
        if temCab:
            await cab.as_element().fill('900999')
        # O cursor fica no último campo — é onde a pessoa está.
        await pgA.focus(f'#dev-ni-{did}-numdev')
        antes = await pgA.evaluate("""(id) => ({
              nota: (document.getElementById('dev-ni-'+id+'-nota')||{}).value,
              cx: (document.getElementById('dev-ni-'+id+'-cx')||{}).value,
              numdev: (document.getElementById('dev-ni-'+id+'-numdev')||{}).value,
              aberta: !!document.querySelector('.dev-card.dev-aberta'),
              foco: (document.activeElement||{}).id || null,
            })""", did)
        ck('o que foi digitado está na tela antes de qualquer atualização',
           antes['nota'] == '778899' and antes['numdev'] == 'DEV-4242' and antes['aberta'],
           str(antes))

        print('\n=== 1. OUTRO SETOR ATUALIZA UMA CARGA — PELO SOCKET, DE VERDADE ===')
        ctxB, pgB = await abrir(nav, 'logistica@teste.local', 'log')
        pgB.on('pageerror', lambda e: erros.append(str(e)))
        r = await pgB.evaluate("""async () => {
              const placa = (DB.frota && DB.frota[0] && DB.frota[0].placa) || '';
              const c = criarCargaProgramada({
                placa, numeroCarga: 'CHK-' + Date.now().toString().slice(-6),
                cliente: 'C', destino: 'D', rota: '500', peso: 7000,
                operador: { nome: 'Logistica', setor: 'Logística' } });
              await SuincoStore.save();
              await SuincoSharePoint.sincronizarAgora();
              return { placa, id: c.id };
            }""")
        ck('a outra tela criou/atualizou uma carga', bool(r and r['id']), str(r))
        # Tempo para o socket chegar e o painel A redesenhar.
        await pgA.wait_for_timeout(4000)

        print('\n=== 2. O QUE ESTAVA SENDO DIGITADO CONTINUA LÁ ===')
        depois = await pgA.evaluate("""(id) => ({
              nota: (document.getElementById('dev-ni-'+id+'-nota')||{}).value,
              cx: (document.getElementById('dev-ni-'+id+'-cx')||{}).value,
              numdev: (document.getElementById('dev-ni-'+id+'-numdev')||{}).value,
              aberta: !!document.querySelector('.dev-card.dev-aberta'),
              foco: (document.activeElement||{}).id || null,
            })""", did)
        ck('a nota digitada não foi apagada', depois['nota'] == '778899', str(depois['nota']))
        ck('as caixas digitadas não foram apagadas', depois['cx'] == '5', str(depois['cx']))
        ck('o Nº DEV digitado não foi apagado', depois['numdev'] == 'DEV-4242', str(depois['numdev']))
        ck('o checklist continua aberto', depois['aberta'] is True, str(depois['aberta']))
        ck('e o cursor continua no campo onde a pessoa estava',
           depois['foco'] == f'dev-ni-{did}-numdev', str(depois['foco']))
        if temCab:
            cabDepois = await pgA.evaluate(VALOR_POR_ROTULO, 'Cód. operador')
            ck('o campo do cabeçalho em meio-preenchimento também sobreviveu',
               cabDepois == '900999', str(cabDepois))

        print('\n=== 3. E A LISTA CONTINUA VIVA (o dado do servidor não sumiu) ===')
        vivo = await pgA.evaluate(
            "(id) => (DEVOLUCOES || []).some(d => d.id === id)", did)
        ck('o checklist continua na lista', vivo is True, str(vivo))

        print('\n=== 4. SEM ERRO DE JAVASCRIPT ===')
        ck('console limpo', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print(f'    · {f}')
        return 1
    print('  Tudo verde.')
    return 0


sys.exit(asyncio.run(main()))
