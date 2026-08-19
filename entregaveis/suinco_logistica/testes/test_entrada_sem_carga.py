#!/usr/bin/env python3
"""Entrada sem carga fica na Programação, não na Torre (19/08/2026).

Pedido do gestor: "os caminhões que recebem entrada pela portaria não vão
direto para a torre de controle... quero que sejam direcionados para a aba
Programação, onde deverão aparecer como entrada aguardando carga. Não quero
que apareçam na torre, pois isso gera confusão. Só devem ser exibidos na
torre após a carga ser lançada."

    python3 testes/test_entrada_sem_carga.py
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
    url = f'{API}/__entrada_{rotulo}'
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
        ctxP, pgP = await abrir(nav, 'bruno@teste.local', 'portaria')

        # Placa da Frota sem nenhuma carga: é o caminhão que aparece no
        # portão sem programação.
        placa = await pgP.evaluate(
            "() => { const usadas = new Set(DB.cargas.map((c) => c.placa));"
            "  const f = DB.frota.find((x) => x.placa && x.transportadora && !usadas.has(x.placa));"
            "  return f ? f.placa : null; }")
        ck('placa livre escolhida na Frota', bool(placa), str(placa))
        if not placa:
            await nav.close()
            return 1

        await pgP.click(".nav-tab[data-tab='portaria']")
        await pgP.fill('#portaria-placa', placa)
        await pgP.click("button:has-text('Chegou')")
        await pgP.wait_for_timeout(4000)
        criada = await pgP.evaluate(
            "(placa) => DB.cargas.some((c) => c.placa === placa && c.aguardandoCarga)", placa)
        ck('a Portaria registrou a entrada sem programação', criada)

        print('\n=== A ENTRADA NÃO APARECE NA TORRE ===')
        ctxL, pgL = await abrir(nav, 'ana@teste.local', 'log')
        await pgL.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        await pgL.wait_for_timeout(1500)
        await pgL.click(".nav-tab[data-tab='torre']")
        await pgL.wait_for_timeout(1000)
        naTorre = await pgL.evaluate(
            "(placa) => (document.getElementById('torre-tbody') || {}).innerHTML?.includes(placa) || false",
            placa)
        ck('a placa NÃO está na tabela da Torre', not naTorre)

        caixa = await pgL.evaluate(
            "() => (document.getElementById('torre-stats') || {}).innerText || ''")
        ck('a Torre mostra a caixa "Entradas sem carga"', 'Entradas sem carga' in caixa,
           ' '.join(caixa.split())[:100])

        print('\n=== ELA APARECE NA PROGRAMAÇÃO ===')
        await pgL.click(".nav-tab[data-tab='programacao']")
        await pgL.wait_for_timeout(1000)
        naProg = await pgL.evaluate(
            "(placa) => (document.getElementById('prog-aguardando-tbody') || {}).innerHTML?.includes(placa) || false",
            placa)
        ck('a placa está na tabela "aguardando carga" da Programação', naProg)

        print('\n=== DEPOIS DA CARGA LANÇADA, ELA ENTRA NA TORRE ===')
        await pgL.evaluate(
            """async (placa) => {
                 const c = DB.cargas.find((x) => x.placa === placa && x.aguardandoCarga);
                 c.numeroCarga = 'ENTR-1'; c.cliente = 'CLIENTE'; c.destino = 'DESTINO';
                 c.peso = 1000; c.aguardandoCarga = false; c.atualizadoEm = new Date().toISOString();
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
               }""", placa)
        await pgL.wait_for_timeout(2500)
        await pgL.click(".nav-tab[data-tab='torre']")
        await pgL.wait_for_timeout(1200)
        agoraNaTorre = await pgL.evaluate(
            "(placa) => (document.getElementById('torre-tbody') || {}).innerHTML?.includes(placa) || false",
            placa)
        ck('com a carga lançada, a placa aparece na Torre', agoraNaTorre)

        # Limpeza.
        await pgL.evaluate(
            """async (placa) => { for (const c of DB.cargas.filter((x) => x.placa === placa)) {
                 try { await SuincoSharePoint.excluir(c.id, 'limpeza de teste'); } catch (e) {} } }""",
            placa)
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
