#!/usr/bin/env python3
"""Visão de Pátio da Torre separada: frota própria e transportadoras.

Pedido do gestor (19/08/2026): "um bloco só para a frota própria, liberando
o outro bloco da visão de pátio para as de transportadoras, facilitando a
visualização mais clara das informações".

São duas conversas diferentes: o caminhão da casa a Suinco remaneja; o de
transportadora ela cobra. Misturados, a pessoa filtra com o olho toda vez.

    python3 testes/test_patio_frota_propria.py
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


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        ctx = await nav.new_context()
        pg = await ctx.new_page()
        html = open(PAINEL_ARQ, encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = f'{API}/__patio'
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        await pg.wait_for_selector('#login-email', timeout=25000)
        await pg.fill('#login-email', 'ana@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3000)

        # Duas cargas: uma da frota própria (Suinco) e uma de transportadora.
        placas = await pg.evaluate(
            """() => {
                 const usadas = new Set(DB.cargas.map((c) => c.placa));
                 const propria = DB.frota.find((f) => /suinco/i.test(f.transportadora || '')
                   && !usadas.has(f.placa));
                 const terceiro = DB.frota.find((f) => f.transportadora
                   && !/suinco/i.test(f.transportadora) && !usadas.has(f.placa));
                 return propria && terceiro
                   ? {propria: propria.placa, terceiro: terceiro.placa,
                      transp: terceiro.transportadora} : null;
               }""")
        ck('achou uma placa própria e uma de transportadora', placas is not None, str(placas))
        if not placas:
            await nav.close()
            return 1

        criadas = await pg.evaluate(
            """async (p) => {
                 const ids = [];
                 for (const [placa, num] of [[p.propria, 'PAT-PROP'], [p.terceiro, 'PAT-TERC']]) {
                   const c = criarCargaProgramada({placa, numeroCarga: num, cliente: 'C',
                     destino: 'D', peso: 1000, operador: 'Ana'});
                   ids.push(c.id);
                 }
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
                 return ids;
               }""", placas)
        await pg.wait_for_timeout(1500)

        await pg.click(".nav-tab[data-tab='torre']")
        await pg.wait_for_timeout(1200)

        grupos = await pg.evaluate(
            "() => [...document.querySelectorAll('#torre-vp-tbody tr.vp-grupo')]"
            ".map((t) => t.innerText.trim())")
        ck('a Torre mostra os dois blocos', len(grupos) == 2, ' / '.join(grupos))
        # Transportadoras primeiro, frota própria depois (ordem pedida em
        # 19/08/2026).
        ck('o primeiro bloco é o das transportadoras',
           bool(grupos) and 'TRANSPORTADORA' in grupos[0].upper(), grupos[0] if grupos else '')
        ck('o segundo bloco é o da frota própria',
           len(grupos) > 1 and 'PRÓPRIA' in grupos[1].upper(), grupos[1] if len(grupos) > 1 else '')

        # A placa própria tem que estar DEPOIS do título de frota própria e
        # ANTES do título de transportadoras.
        ordem = await pg.evaluate(
            """(p) => {
                 const linhas = [...document.querySelectorAll('#torre-vp-tbody tr')];
                 const iProp = linhas.findIndex((t) => t.classList.contains('vp-grupo')
                   && /PR[ÓO]PRIA/i.test(t.innerText));
                 const iTerc = linhas.findIndex((t) => t.classList.contains('vp-grupo')
                   && /TRANSPORTADORA/i.test(t.innerText));
                 const idx = (placa) => linhas.findIndex((t) => t.innerText.includes(placa));
                 return {iProp, iTerc, prop: idx(p.propria), terc: idx(p.terceiro)};
               }""", placas)
        ck('a placa de transportadora caiu no bloco de transportadoras',
           ordem['iTerc'] < ordem['terc'] < ordem['iProp'], str(ordem))
        ck('a placa própria caiu no bloco da frota própria',
           ordem['prop'] > ordem['iProp'], str(ordem))

        resumo = await pg.evaluate("() => document.getElementById('torre-vp-resumo').innerText")
        # O CSS dos chips deixa o texto em caixa alta — a comparação segue o
        # que a pessoa lê na tela, sem depender da capitalização do código.
        alto = resumo.upper()
        ck('o resumo conta as duas frotas',
           'FROTA PRÓPRIA' in alto and 'TRANSPORTADORAS' in alto,
           ' '.join(resumo.split())[:110])

        print('\n=== NAS OUTRAS ABAS SEGUE LISTA ÚNICA ===')
        await pg.click(".nav-tab[data-tab='portaria']")
        await pg.wait_for_timeout(1000)
        naPortaria = await pg.evaluate(
            "() => document.querySelectorAll('#portaria-vp-tbody tr.vp-grupo').length")
        ck('a Portaria continua sem os blocos', naPortaria == 0, str(naPortaria))

        await pg.evaluate(
            """async (ids) => { for (const id of ids) {
                 try { await SuincoSharePoint.excluir(id, 'limpeza de teste'); } catch (e) {} } }""",
            criadas)
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
