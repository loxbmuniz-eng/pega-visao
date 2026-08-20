#!/usr/bin/env python3
"""Rota cadastrada durante o dia aparece nos painéis já abertos (20/08/2026).

Relato do gestor, duas vezes no mesmo dia e em máquinas diferentes:

    "não entendo por que a rota 011 está aparecendo sem nada escrito, para
     mim só o número"

A rota existia — tinha sido CADASTRADA naquele dia. Quem cadastrou via o
nome; todo painel aberto desde antes só via o código, porque a lista de
rotas só era buscada na carga inicial da página. E painel de pátio fica
aberto o dia inteiro.

    python3 testes/test_rota_cadastrada_aparece.py
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
    url = f'{API}/__rota_{rotulo}'
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
    codigo = '0' + str(int(asyncio.get_event_loop().time() * 100) % 90 + 10)
    nome = 'Force Meat-RJ'

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)

        # O painel do pátio: aberto ANTES de a rota existir, e fica aberto.
        ctxP, pgP = await abrir(nav, 'bruno@teste.local', 'patio')
        antes = await pgP.evaluate("(c) => rotaCurta(c)", codigo)
        ck('antes de cadastrar, o painel só tem o número', antes == codigo, repr(antes))

        # Outra pessoa cadastra a rota, em outro terminal.
        ctxA, pgA = await abrir(nav, 'chefe@teste.local', 'adm')
        await pgA.evaluate(
            """async ({codigo, nome}) => {
                 upsertRota(codigo, nome, '', 'Operador Teste');
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
               }""", {'codigo': codigo, 'nome': nome})
        await pgA.wait_for_timeout(2000)
        noAdm = await pgA.evaluate("(c) => rotaCurta(c)", codigo)
        ck('quem cadastrou vê o nome na hora', nome in noAdm, repr(noAdm))

        # E programa uma carga NESSA rota — é assim que ela chega no painel
        # do pátio, que é o caso real do relato.
        placa = await pgA.evaluate(
            """async (codigo) => {
                 const u = new Set(DB.cargas.map((c) => c.placa));
                 const f = DB.frota.find((x) => x.placa && x.transportadora && !u.has(x.placa));
                 if (!f) return null;
                 criarCargaProgramada({numeroCarga: 'ROTA-NOVA', placa: f.placa, cliente: 'C',
                   destino: 'D', peso: 1000, rota: codigo, operador: 'Chefe'});
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
                 return f.placa;
               }""", codigo)
        ck('carga programada na rota nova', bool(placa), str(placa))

        # O painel que estava aberto: sem recarregar a página. A carga chega
        # com uma rota que ele não conhece — e é isso que dispara a rebusca.
        atualizou = await pgP.evaluate(
            """async (codigo) => {
                 await SuincoSharePoint.sincronizarAgora();
                 for (let i = 0; i < 20; i++) {
                   await new Promise((r) => setTimeout(r, 500));
                   if (rotaInfo(codigo)) break;
                 }
                 return rotaCurta(codigo);
               }""", codigo)
        ck('o painel JÁ ABERTO passa a mostrar o nome, sem recarregar a página',
           nome in atualizou, repr(atualizou))

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
