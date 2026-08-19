#!/usr/bin/env python3
"""Caminhão que não saiu não "chega" de novo (19/08/2026).

Relato de produção: o caminhão foi embora, a Portaria não registrou a saída,
e no dia seguinte o porteiro digitou a placa e clicou "Chegou". O sistema
aceitou — nasceu uma segunda carga para a mesma placa e o processo anterior,
que estava em Faturado, ficou órfão. Nas palavras do gestor: "ele aceitou e
agora ele sumiu".

O que se prova aqui, no navegador de verdade contra o backend local:

  1. Com a carga anterior à vista, o "Chegou" é recusado e o painel MANDA
     registrar a saída — sem criar carga nenhuma.
  2. O caso real: mesmo com a lista do porteiro DESATUALIZADA (a carga
     anterior nem aparece na tela dele), o clique não passa — o painel puxa
     o servidor antes e, na pior das hipóteses, o servidor recusa e a carga
     fantasma some da tela com aviso.
  3. Depois da SAÍDA registrada, a mesma placa chega normalmente.

    python3 testes/test_reentrada_portaria.py
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
PLACA = os.environ.get('SUINCO_PLACA_TESTE', '')

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
    url = f'{API}/__reentrada_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    return ctx, pg


async def avisos(pg):
    return await pg.evaluate(
        "() => [...document.querySelectorAll('.notif-item')].map((e) => e.innerText)")


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        ctxL, pgL = await abrir(nav, 'ana@teste.local', 'log')

        # Uma placa da Frota SEM carga nenhuma no painel: o teste leva um
        # caminhão do zero até Faturado, e qualquer resíduo de execução
        # anterior mudaria o cenário no meio do caminho.
        placa = PLACA or await pgL.evaluate(
            "() => { const usadas = new Set(DB.cargas.map((c) => c.placa));"
            "  const f = DB.frota.find((x) => x.placa && x.transportadora"
            "    && !usadas.has(x.placa));"
            "  return f ? f.placa : null; }")
        ck('placa de teste escolhida da Frota', bool(placa), str(placa))
        if not placa:
            await nav.close()
            return 1

        # A Logística programa e leva a carga até Faturado — é o estado do
        # caminhão que já foi embora sem a Portaria dar baixa.
        carga = await pgL.evaluate(
            """async (placa) => {
                 const c = criarCargaProgramada({placa, numeroCarga: 'REENT-1',
                   cliente: 'CLIENTE TESTE', destino: 'DESTINO TESTE', peso: 1000,
                   operador: 'Ana'});
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
                 /* Status direto pela API, um por vez: a fila local sobe
                    em segundo plano e um pull no meio do caminho traz o
                    estado intermediário de volta — no teste isso vira
                    corrida. Aqui o que interessa é o estado FINAL no
                    servidor, que é o que o porteiro vai receber. */
                 for (const st of ['Aguardando Embarque', 'Embarque Iniciado',
                                   'Embarque Finalizado', 'Faturado']) {
                   await SuincoSharePoint.mudarStatus(c.id, st);
                 }
                 await SuincoSharePoint.sincronizarAgora();
                 return c.id;
               }""", placa)
        await pgL.wait_for_timeout(1500)
        status = await pgL.evaluate("(id) => (getCarga(id) || {}).status", carga)
        ck('carga anterior ficou em Faturado, sem saída registrada', status == 'Faturado', str(status))

        print('\n=== 1. COM A CARGA À VISTA, O "CHEGOU" É RECUSADO ===')
        ctxP, pgP = await abrir(nav, 'bruno@teste.local', 'portaria')
        await pgP.click(".nav-tab[data-tab='portaria']")
        await pgP.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        await pgP.wait_for_timeout(1200)
        visto = await pgP.evaluate("(id) => (getCarga(id) || {}).status", carga)
        ck('o porteiro enxerga a carga anterior em Faturado', visto == 'Faturado', str(visto))
        antes = await pgP.evaluate("() => DB.cargas.length")
        await pgP.fill('#portaria-placa', placa)
        await pgP.click("button:has-text('Chegou')")
        # O clique agora puxa o servidor antes de decidir — a espera precisa
        # caber esse pull, senão o teste lê a tela antes do aviso.
        await pgP.wait_for_timeout(5000)
        texto = ' '.join(await avisos(pgP))
        ck('o painel manda registrar a SAÍDA antes', 'SAÍDA' in texto.upper(), texto[:120])
        depois = await pgP.evaluate("() => DB.cargas.length")
        ck('nenhuma carga nova foi criada', depois == antes, f'{antes} → {depois}')

        print('\n=== 2. O CASO REAL: LISTA DO PORTEIRO DESATUALIZADA ===')
        # Some com a carga do terminal do porteiro, como se ele nunca a
        # tivesse recebido — é o estado em que o bug aconteceu.
        await pgP.evaluate(
            """(id) => { DB.cargas = DB.cargas.filter((c) => c.id !== id);
                 SuincoStore.save(); renderAll(); }""", carga)
        sumiu = await pgP.evaluate("(id) => !getCarga(id)", carga)
        ck('carga anterior fora da tela do porteiro', sumiu)

        await pgP.fill('#portaria-placa', placa)
        await pgP.click("button:has-text('Chegou')")
        await pgP.wait_for_timeout(4000)
        texto2 = ' '.join(await avisos(pgP))
        ck('mesmo com a lista velha, o clique não vira carga nova',
           'SAÍDA' in texto2.upper() or 'ABERTO' in texto2.upper(), texto2[:160])
        criadas = await pgP.evaluate(
            "(placa) => DB.cargas.filter((c) => c.placa === placa && c.aguardandoCarga).length",
            placa)
        ck('nenhuma entrada "Aguardando Carga" sobrou na tela', criadas == 0, str(criadas))

        # E o servidor continua com UMA carga só para a placa.
        no_servidor = await pgL.evaluate(
            """async (placa) => { await SuincoSharePoint.sincronizarAgora();
                 return DB.cargas.filter((c) => c.placa === placa
                   && c.status !== 'Seguiu Viagem').length; }""", placa)
        ck('no servidor a placa continua com UMA carga em aberto', no_servidor == 1, str(no_servidor))

        print('\n=== 3. DEPOIS DA SAÍDA, A CHEGADA VOLTA A FUNCIONAR ===')
        await pgP.fill('#portaria-placa', placa)
        await pgP.click("button:has-text('Saiu')")
        await pgP.wait_for_timeout(3000)
        await pgP.fill('#portaria-placa', placa)
        await pgP.click("button:has-text('Chegou')")
        await pgP.wait_for_timeout(3500)
        nova = await pgP.evaluate(
            "(placa) => DB.cargas.filter((c) => c.placa === placa && c.aguardandoCarga).length",
            placa)
        ck('a chegada nova foi aceita', nova >= 1, str(nova))

        # Limpeza: o cenário não fica pendurado no dia.
        await pgL.evaluate(
            """async (placa) => { await SuincoSharePoint.sincronizarAgora();
                 for (const c of DB.cargas.filter((x) => x.placa === placa)) {
                   try { await SuincoSharePoint.excluir(c.id, 'limpeza de teste'); }
                   catch (e) { /* ignora */ }
                 } }""", placa)
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
