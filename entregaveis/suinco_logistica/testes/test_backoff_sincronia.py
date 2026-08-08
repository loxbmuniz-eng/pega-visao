#!/usr/bin/env python3
"""Sincronia em tempo real não martela o servidor quando ele recusa (429).

Achado em produção (08/08/2026): toda troca em tempo real (carga:criada,
carga:atualizada, movimentacao:nova, reconexão do socket) chama
sincronizarAgora() de novo, sem esperar a anterior terminar e sem nenhum
recuo se o servidor responder 429 ("muitas requisições"). Numa oscilação
de rede — o socket reconectando repetidamente — isso vira o próprio
painel martelando o limite que está recusando, numa espiral que só
piorava com o tempo (era essa a causa real de "fica online e offline",
não o valor do limite em si).

A correção (suinco-api.js): uma trava contra chamadas simultâneas
(a que chega durante outra em andamento só marca "roda mais uma vez",
não empilha) e um recuo que DOBRA a cada 429 (começa em 5 s), voltando
ao mínimo assim que uma sincronia der certo.

    python3 testes/test_backoff_sincronia.py
"""
import asyncio
import sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
API_FALSA = 'https://api-fake-teste.invalido'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        chamadas = []

        async def responder_429(rota):
            chamadas.append(rota.request.url)
            await rota.fulfill(status=429, content_type='application/json',
                                body='{"erro":"Muitas requisicoes. Espere um minuto.","codigo":"LIMITE_EXCEDIDO"}')

        await pg.route(f'{API_FALSA}/api/estado*', responder_429)

        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)

        await pg.evaluate("""(api) => {
            SuincoSharePoint.SP_CONFIG.ativo = true;
            SuincoSharePoint.SP_CONFIG.api = api;
            sessionStorage.setItem('suinco_token', 'token-fake-de-teste');
        }""", API_FALSA)

        print('\n=== 1. VÁRIOS GATILHOS QUASE JUNTOS = SÓ 1 REQUISIÇÃO REAL (coalescimento) ===')
        await pg.evaluate("""() => {
            // Simula 5 eventos de socket chegando quase juntos (carga:criada,
            // carga:atualizada, movimentacao:nova, connect, connect de novo).
            for (let i = 0; i < 5; i++) SuincoSharePoint.sincronizarAgora();
        }""")
        await pg.wait_for_timeout(600)
        ck('só 1 requisição real saiu, mesmo com 5 gatilhos quase juntos',
           len(chamadas) == 1, f'{len(chamadas)} chamadas')

        print('\n=== 2. DEPOIS DO 429, NOVOS GATILHOS NÃO GERAM NOVA REQUISIÇÃO (recuo ativo) ===')
        antes = len(chamadas)
        await pg.evaluate("""() => {
            for (let i = 0; i < 5; i++) SuincoSharePoint.sincronizarAgora();
        }""")
        await pg.wait_for_timeout(600)
        ck('nenhuma requisição nova durante a janela de recuo',
           len(chamadas) == antes, f'{antes} -> {len(chamadas)}')

        print('\n=== 3. APÓS A JANELA DE RECUO PASSAR, TENTA DE NOVO ===')
        await pg.wait_for_timeout(5000)  # recuo inicial é 5 s (BACKOFF_INICIAL_MS)
        await pg.evaluate("() => SuincoSharePoint.sincronizarAgora()")
        await pg.wait_for_timeout(600)
        ck('uma nova requisição saiu depois do recuo passar',
           len(chamadas) == antes + 1, f'{antes} -> {len(chamadas)}')

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
