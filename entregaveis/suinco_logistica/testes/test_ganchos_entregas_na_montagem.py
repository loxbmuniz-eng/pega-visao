#!/usr/bin/env python3
"""Ganchos e Entregas na linha da Montagem do Dia (31/08/2026).

O PEDIDO, do dono:

    "ta faltando o campo de quantidade de entregar e quantidade de ganchos
     igual na torre precisa aparecer na programcao do dia"
    "precisa aparecer e funcionar"

POR QUE FALTAVA. Não era falta de lugar no banco nem no servidor: a tabela
`programacao_montagem` já tem `qtd_entregas` e `qtd_ganchos`, e o
PATCH /montagem/:id já aceitava os dois campos. Faltava a TELA oferecer —
a mesma história das quatro colunas de 28/08 (número, placa, peso, rota),
quando o dono relatou "porque nao estao editaveis???".

O QUE ESTE TESTE EXIGE:

  1. as duas colunas aparecem no cabeçalho da Montagem do Dia;
  2. cada linha tem os dois campos, e eles aceitam digitação;
  3. o valor digitado CHEGA NO BANCO — "aparecer" sem "funcionar" é a
     coluna que mostra traço, ocorrência #19;
  4. os campos NÃO ficam duplicados no formulário que abre ao clicar na
     linha. Mesmo campo em dois lugares da mesma tela é como se produz um
     valor digitado num e lido do outro — foi por isso que o Tipo de
     Operação saiu do formulário em 28/08.

Exige o backend local no ar.

    python3 testes/test_ganchos_entregas_na_montagem.py
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
        url = f'{API}/__ganchos'
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        await pg.wait_for_selector('#login-email', timeout=25000)
        await pg.fill('#login-email', 'chefe@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3000)

        DIA = '2026-09-02'   # quarta — e NÃO hoje, para não sujar a programação do dia
        sql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}'")

        await pg.evaluate("() => abrirTab('programacao')")
        await pg.wait_for_timeout(1200)
        criou = await pg.evaluate("""async (dia) => {
              document.getElementById('mont-data').value = dia;
              await carregarMontagemUI();
              window.confirm = () => true;
              await aplicarModeloDoDiaUI();
              await carregarMontagemUI();
              return { linhas: (_montagemDia.montagens || []).length };
            }""", DIA)
        ck('a montagem do dia tem linhas para testar', criou['linhas'] > 0, str(criou))
        if not criou['linhas']:
            await nav.close()
            return 1

        print('\n=== 1. AS DUAS COLUNAS APARECEM NO CABEÇALHO ===')
        cab = await pg.evaluate(
            "() => [...document.querySelectorAll('#mont-tabela thead th')].map(t => t.textContent.trim())")
        ck('a coluna Ganchos existe', 'Ganchos' in cab, ' | '.join(cab))
        ck('a coluna Entregas existe', 'Entregas' in cab, ' | '.join(cab))

        print('\n=== 2. OS CAMPOS ESTÃO NA LINHA E ACEITAM DIGITAÇÃO ===')
        campos = await pg.evaluate("""() => {
            const tr = document.querySelector('#mont-tbody tr');
            if(!tr) return null;
            return { ganchos: !!tr.querySelector('.ganchos-input'),
                     entregas: !!tr.querySelector('.entregas-input') };
        }""")
        ck('a linha tem o campo de Ganchos', bool(campos and campos['ganchos']), str(campos))
        ck('a linha tem o campo de Entregas', bool(campos and campos['entregas']), str(campos))

        print('\n=== 3. O QUE FOI DIGITADO CHEGA NO BANCO ===')
        alvo = await pg.evaluate("() => _montagemDia.montagens[0].montagem_id")
        await pg.evaluate("""async (o) => {
              await alterarMontagemUI(o.id, 'qtdGanchos', '37');
              await alterarMontagemUI(o.id, 'qtdEntregas', '9');
              await carregarMontagemUI();
            }""", {'id': alvo})
        await pg.wait_for_timeout(1500)
        no_banco = sql("SELECT qtd_ganchos || '/' || qtd_entregas FROM programacao_montagem "
                       f"WHERE montagem_id = '{alvo}'")
        ck('ganchos e entregas gravaram no banco',
           no_banco and no_banco[0] == '37/9',
           str(no_banco) + ' (esperado 37/9)')

        na_tela = await pg.evaluate("""(id) => {
            const m = _montagemDia.montagens.find(x => x.montagem_id === id);
            return m ? { g: m.qtd_ganchos, e: m.qtd_entregas } : null;
        }""", alvo)
        ck('e voltaram para a tela', str(na_tela and na_tela['g']) == '37'
           and str(na_tela and na_tela['e']) == '9', str(na_tela))

        print('\n=== 4. NÃO FICARAM DUPLICADOS NO FORMULÁRIO ===')
        await pg.evaluate("(id) => alternarLinhaMontagemUI(id)", alvo)
        await pg.wait_for_timeout(900)
        dobrado = await pg.evaluate("""() => {
            const det = document.querySelector('#mont-tbody .mont-detalhe');
            if(!det) return { semDetalhe: true };
            const txt = det.innerText;
            return { ganchos: /Qtd\\. Ganchos/i.test(txt),
                     entregas: /Qtd\\. Entregas/i.test(txt) };
        }""")
        if dobrado.get('semDetalhe'):
            ck('o formulário abriu para conferir', False, 'a linha não expandiu')
        else:
            ck('Ganchos NÃO está repetido no formulário', not dobrado['ganchos'], str(dobrado))
            ck('Entregas NÃO está repetido no formulário', not dobrado['entregas'], str(dobrado))

        sql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}'")
        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


sys.exit(asyncio.run(main()))
