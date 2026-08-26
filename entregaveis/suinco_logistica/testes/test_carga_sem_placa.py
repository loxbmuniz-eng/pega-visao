#!/usr/bin/env python3
"""Carga sem placa: a Torre espera a contratação (26/08/2026).

Pedido do dono: "na programação de carga quero poder liberar criar a carga
sem a placa, e só a partir da hora que colocarem a placa ela vai pra torre
de controle".

    python3 testes/test_carga_sem_placa.py
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
    ctx = await nav.new_context()
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__semplaca_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    return ctx, pg


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        ctxL, pgL = await abrir(nav, 'ana@teste.local', 'log')

        print('\n=== 1. CRIAR SEM PLACA, PELO FORMULÁRIO ===')
        await pgL.click(".nav-tab[data-tab='programacao']")
        await pgL.fill('#prog-numero-carga', 'SP-UI-1')
        await pgL.fill('#prog-peso', '12000')
        await pgL.evaluate("() => criarCargaProgramadaUI()")
        await pgL.wait_for_timeout(2500)

        carga = await pgL.evaluate(
            "() => { const c = DB.cargas.find(x => x.numeroCarga === 'SP-UI-1');"
            "  return c ? {placa: c.placa, status: c.status} : null; }")
        ck('a carga nasce sem placa, Aguardando Veículo',
           carga and carga['placa'] == '' and carga['status'] == 'Aguardando Veículo',
           str(carga))

        # E uma SEGUNDA sem placa não é bloqueada como "duplicidade".
        await pgL.fill('#prog-numero-carga', 'SP-UI-2')
        await pgL.fill('#prog-peso', '9000')
        await pgL.evaluate("() => criarCargaProgramadaUI()")
        await pgL.wait_for_timeout(2000)
        duas = await pgL.evaluate(
            "() => DB.cargas.filter(c => !c.placa && c.numeroCarga.startsWith('SP-UI')).length")
        ck('duas cargas sem placa convivem — vazio não é duplicata', duas == 2, f'{duas} de 2')

        print('\n=== 2. FORA DA TORRE, DENTRO DA FILA ===')
        await pgL.click(".nav-tab[data-tab='torre']")
        await pgL.wait_for_timeout(800)
        naTorre = await pgL.evaluate(
            "() => (document.getElementById('torre-tbody')||{}).innerHTML?.includes('SP-UI-1') || false")
        ck('a Torre NÃO mostra a carga sem placa', not naTorre)

        await pgL.click(".nav-tab[data-tab='programacao']")
        await pgL.wait_for_timeout(800)
        naFila = await pgL.evaluate(
            "() => (document.getElementById('prog-fila-tbody')||{}).innerHTML?.includes('SP-UI-1') || false")
        ck('a Fila de Programados mostra, com o campo de placa vazio', naFila)

        print('\n=== 3. PREENCHER A PLACA LEVA PARA A TORRE ===')
        placa = await pgL.evaluate(
            "() => { const usadas = new Set(DB.cargas.map(c => c.placa));"
            "  const f = DB.frota.find(x => x.placa && x.transportadora && !usadas.has(x.placa));"
            "  return f ? f.placa : null; }")
        ck('placa livre na Frota', bool(placa), str(placa))

        await pgL.evaluate(
            """(placa) => { const c = DB.cargas.find(x => x.numeroCarga === 'SP-UI-1');
                 atualizarPlacaUI(c.id, placa); }""", placa)
        await pgL.wait_for_timeout(2000)

        depois = await pgL.evaluate(
            "() => { const c = DB.cargas.find(x => x.numeroCarga === 'SP-UI-1');"
            "  return {placa: c.placa, transportadora: c.transportadora}; }")
        ck('a placa entrou e trouxe a transportadora do cadastro',
           depois['placa'] == placa and bool(depois['transportadora']), str(depois))

        await pgL.click(".nav-tab[data-tab='torre']")
        await pgL.wait_for_timeout(800)
        agoraNaTorre = await pgL.evaluate(
            "() => (document.getElementById('torre-tbody')||{}).innerHTML?.includes('SP-UI-1') || false")
        ck('com a placa, a carga aparece na Torre', agoraNaTorre)

        print('\n=== 4. O RELATÓRIO CONTA SEPARADO ===')
        html = await pgL.evaluate(
            "async () => (await montarRelatorioOperacional()).innerHTML")
        ck('a carga sem caminhão sai como "a contratar"', 'a contratar' in html)
        ck('a ficha conta as sem caminhão em linha própria',
           'Sem caminhão contratado' in html)

        print('\n=== LIMPEZA ===')
        await pgL.evaluate(
            """async () => { for (const c of DB.cargas.filter(x => x.numeroCarga && x.numeroCarga.startsWith('SP-UI'))) {
                 try { await SuincoSharePoint.excluir(c.id, 'limpeza de teste'); } catch (e) {} } }""")
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
