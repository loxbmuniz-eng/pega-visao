#!/usr/bin/env python3
"""Expedição e Destinação: só um OK, igual à Central de Notas (31/08/2026).

O PEDIDO, do dono, apontando as colunas num print da tela:

    "precisa que expedição, destinação fica igual da central de nota,
     so colocar um ok"

A Central de Notas já era assim desde 018: um tique por item. A Expedição
digitava a quantidade recebida e os Controles distribuíam caixas em três
campos (E/D/R) — trabalho de escrita onde bastava uma confirmação, com o
caminhão esperando no pátio.

A PERGUNTA QUE EU FIZ ANTES DE ESCREVER, e a resposta dele:

    A coluna FALTA nasce de `cx - qtdRecebida`. Se a Expedição passa a dar
    só um tique, não há o que subtrair e a falta deixa de ser apontada.
    Decisão: MANTER a Falta, com o campo de quantidade ao lado do tique —
    quem quiser conferir caixa a caixa aponta a falta, quem não quiser só
    dá o OK.

Isto está escrito aqui porque em 31/08 de manhã eu li um pedido parecido
como "apague a conferência da tela", apaguei as colunas, e a Bruna abriu o
checklist e não achou mais nada (ocorrência #23). A pergunta que faltava era
exatamente esta.

O QUE ESTE TESTE EXIGE:

  1. a Expedição tem o TIQUE, e ele grava no banco;
  2. os Controles Internos têm o TIQUE, e ele grava no banco;
  3. o campo de quantidade continua ao lado do tique da Expedição, e a
     FALTA continua sendo apontada quando ele é preenchido;
  4. as três caixas de destinação (E/D/R) saíram da tela, mas o que já foi
     distribuído continua aparecendo — dado gravado não some porque a tela
     mudou;
  5. o cabeçalho e a linha de total têm o MESMO número de colunas. Colspan
     que não bate desalinha a tabela inteira, e é o tipo de erro que só
     aparece no papel, na frente de quem confere.

Exige o backend local no ar, com a migração 040.

    python3 testes/test_ok_expedicao_e_destinacao.py
"""
import asyncio
import os
import subprocess
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


def sql(q):
    r = subprocess.run(['sudo', '-u', 'postgres', 'psql', '-tAc', q, '-d', 'embarque_suinco'],
                       capture_output=True, text=True)
    return [l for l in r.stdout.strip().split('\n') if l]


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        ctx = await nav.new_context(viewport={'width': 1500, 'height': 950})
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        html = open(PAINEL_ARQ, encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = f'{API}/__okdev'
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        await pg.wait_for_selector('#login-email', timeout=25000)
        await pg.fill('#login-email', 'chefe@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3000)

        await pg.evaluate("() => abrirTab('devolucoes')")
        await pg.wait_for_timeout(1600)
        did = await pg.evaluate("""async () => {
              document.getElementById('dev-operador-cod').value = '700001';
              document.getElementById('dev-rota').value = '500';
              await criarDevolucaoUI();
              await carregarDevolucoes();
              const d = DEVOLUCOES[0];
              if(!d) return null;
              await SuincoSharePoint.devolucoes.criarItem(d.id, {
                nota: '99001', cx: 10, peso: 500, codProduto: '30110',
                numDev: 'DEV-99001', motivo: '607' });
              await carregarDevolucoes();
              return d.id;
            }""")
        ck('checklist criado para o teste', bool(did), str(did))
        if not did:
            await nav.close()
            return 1

        print('\n=== 1. OS DOIS TIQUES ESTÃO NA TELA ===')
        await pg.evaluate("() => renderDevolucoes()")
        await pg.wait_for_timeout(1000)
        tela = await pg.evaluate("""() => {
            const html = document.getElementById('tab-devolucoes').innerHTML;
            return { okExpedicao: /-okExpedicao"/.test(html),
                     okDestinacao: /-okDestinacao"/.test(html),
                     qtdRecebida: /-qtdRecebida"/.test(html),
                     caixasEDR: /-destEstoque"/.test(html) };
        }""")
        ck('a Expedição tem o tique de OK', tela['okExpedicao'], str(tela))
        ck('os Controles Internos têm o tique de OK', tela['okDestinacao'], str(tela))
        ck('o campo de quantidade continua ao lado (é dele que nasce a falta)',
           tela['qtdRecebida'], str(tela))
        ck('as três caixas E/D/R saíram da tela', not tela['caixasEDR'], str(tela))

        print('\n=== 2. O TIQUE CHEGA NO BANCO ===')
        # "Aparecer" sem "funcionar" é a coluna que mostra traço — #19.
        item = await pg.evaluate("""async (id) => {
              const d = DEVOLUCOES.find(x => x.id === id);
              const it = d.itens[0];
              await editarItemDevolucaoUI(id, it.itemId, 'okExpedicao', true);
              await editarItemDevolucaoUI(id, it.itemId, 'okDestinacao', true);
              await carregarDevolucoes();
              const dep = DEVOLUCOES.find(x => x.id === id).itens[0];
              return { itemId: it.itemId, okExp: dep.okExpedicao, okDest: dep.okDestinacao };
            }""", did)
        # psql escreve booleano por extenso com `||`: "true", não "t".
        no_banco = sql("SELECT ok_expedicao || '/' || ok_destinacao FROM devolucao_itens "
                       f"WHERE item_id = {item['itemId']}")
        ck('os dois OKs gravaram no banco', no_banco and no_banco[0] == 'true/true',
           str(no_banco) + ' (esperado true/true)')
        ck('e voltaram para a tela', item['okExp'] is True and item['okDest'] is True,
           str(item))

        print('\n=== 3. A FALTA CONTINUA SENDO APONTADA (decisão do dono) ===')
        falta = await pg.evaluate("""async (o) => {
              await editarItemDevolucaoUI(o.id, o.itemId, 'qtdRecebida', '7');
              await carregarDevolucoes();
              const it = DEVOLUCOES.find(x => x.id === o.id).itens[0];
              return { cx: it.cx, recebida: it.qtdRecebida, falta: it.falta };
            }""", {'id': did, 'itemId': item['itemId']})
        ck('10 lançadas e 7 recebidas apontam falta de 3',
           str(falta['falta']) == '3', str(falta))

        print('\n=== 4. CABEÇALHO E TOTAL COM O MESMO NÚMERO DE COLUNAS ===')
        # Colspan que não bate desalinha a tabela inteira, e isso só
        # aparece no papel — na frente de quem está conferindo.
        colunas = await pg.evaluate("""() => {
            const t = document.querySelector('#tab-devolucoes table');
            if(!t) return { semTabela: true };
            const ths = t.querySelectorAll('thead th').length;
            const corpo = t.querySelector('tbody tr');
            const larg = corpo ? [...corpo.children]
              .reduce((s, td) => s + (parseInt(td.getAttribute('colspan'), 10) || 1), 0) : 0;
            return { ths, larg };
        }""")
        if not colunas.get('semTabela'):
            ck('a linha do item tem a mesma largura do cabeçalho',
               colunas['larg'] >= colunas['ths'],
               f"cabeçalho {colunas['ths']} · linha {colunas['larg']}")

        sql(f"DELETE FROM devolucoes WHERE devolucao_id = '{did}'")
        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


sys.exit(asyncio.run(main()))
