#!/usr/bin/env python3
"""Lacres fiéis na Torre e nos relatórios; Histórico que abre. (20/08/2026)

Pedidos do gestor, no mesmo dia:

  · "as informações de lacre dos porteiros — lacres, tanto na saída quanto
     devoluções, e lacre retido também — saiam como informação para a gente
     na torre de controle, nos relatórios... grave fielmente no backend";
  · "quero que cada linha do histórico se expanda quando clicada nela com as
     informações de log, tudo que é necessário quando vou acessar um
     histórico".

    python3 testes/test_lacres_e_historico.py
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


def sql(consulta):
    saida = subprocess.run(
        ['sudo', '-u', 'postgres', 'psql', '-tAF', '|', '-P', 'pager=off',
         '-d', 'embarque_suinco', '-c', consulta],
        capture_output=True, text=True)
    linhas = [l for l in saida.stdout.strip().splitlines() if l]
    return linhas[0].split('|') if linhas else None


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
    url = f'{API}/__lacres_{rotulo}'
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

        placa = await pgL.evaluate(
            """() => { const u = new Set(DB.cargas.map((c) => c.placa));
                 const f = DB.frota.find((x) => x.placa && x.transportadora && !u.has(x.placa));
                 return f ? f.placa : null; }""")
        ck('placa livre', bool(placa), str(placa))
        if not placa:
            await nav.close()
            return 1
        sql(f"DELETE FROM fact_statusfrota WHERE placa = '{placa}'")
        sql(f"DELETE FROM fact_viagens WHERE placa = '{placa}'")

        print('\n=== 1. LACRE APARECE NA TORRE ===')
        cargaId = await pgL.evaluate(
            """async (placa) => {
                 await SuincoSharePoint.sincronizarAgora();
                 const c = criarCargaProgramada({numeroCarga: 'LACRE-UI2', placa, cliente: 'CLI',
                   destino: 'DEST', peso: 3000, rota: '500', operador: 'Ana'});
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
                 for (const s of ['Aguardando Embarque', 'Embarque Iniciado',
                                  'Embarque Finalizado', 'Faturado']) {
                   await SuincoSharePoint.mudarStatus(c.id, s);
                 }
                 await SuincoSharePoint.sincronizarAgora();
                 return c.id;
               }""", placa)

        ctxP, pgP = await abrir(nav, 'bruno@teste.local', 'portaria')
        await pgP.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        await pgP.click(".nav-tab[data-tab='portaria']")
        await pgP.fill('#portaria-placa', placa)
        await pgP.fill('#portaria-lacre', '133476')
        await pgP.fill('#portaria-lacre-2', '133477')
        await pgP.click("button:has-text('Saiu')")
        await pgP.wait_for_timeout(3500)

        print('\n=== 2. RETENÇÃO GRAVA MOTIVO, AUTOR E HORA ===')
        await pgP.fill('#lacre-ret-placa', placa)
        await pgP.fill('#lacre-ret-numero', '133476')
        await pgP.fill('#lacre-ret-novo', '900123')
        await pgP.fill('#lacre-ret-motivo', 'carga incorreta na conferencia')
        await pgP.click("button:has-text('Registrar retenção')")
        await pgP.wait_for_timeout(3500)

        noBanco = sql("SELECT lacre, lacre_2, lacre_retido, lacre_retido_motivo, lacre_retido_por, "
                      f"lacre_retido_em IS NOT NULL FROM fact_viagens WHERE carga_id = '{cargaId}'")
        ck('o banco guarda o número retido', noBanco and noBanco[2] == '133476', str(noBanco))
        ck('o banco guarda o MOTIVO em campo próprio',
           noBanco and noBanco[3] == 'carga incorreta na conferencia', str(noBanco))
        ck('o banco guarda QUEM reteve', noBanco and noBanco[4], str(noBanco))
        ck('o banco guarda QUANDO reteve', noBanco and noBanco[5] == 't', str(noBanco))
        ck('o novo lacre virou o vigente', noBanco and noBanco[0] == '900123', str(noBanco))

        print('\n=== 3. A TORRE MOSTRA OS CHIPS ===')
        ctxA, pgA = await abrir(nav, 'chefe@teste.local', 'adm')
        await pgA.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        await pgA.click(".nav-tab[data-tab='torre']")
        await pgA.wait_for_timeout(1200)
        chips = await pgA.evaluate(
            """(id) => { const c = getCarga(id);
                 return {temCarga: !!c, html: chipLacreHtml(c || {})}; }""", cargaId)
        ck('o chip de lacre retido é montado', 'retido' in (chips['html'] or ''), str(chips)[:160])

        print('\n=== 4. O RELATÓRIO TRAZ O BLOCO DE LACRES ===')
        rel = await pgA.evaluate(
            """(id) => { const c = getCarga(id);
                 const html = blocoLacresPdf([c]);
                 return {tem: !!html, temRetido: html.includes('133476'),
                         temMotivo: html.includes('carga incorreta'),
                         temTitulo: html.includes('Controle de lacres')}; }""", cargaId)
        ck('o bloco "Controle de lacres" é gerado', rel['temTitulo'], str(rel))
        ck('com o número retido', rel['temRetido'], str(rel))
        ck('e com o motivo da retenção', rel['temMotivo'], str(rel))

        print('\n=== 5. O HISTÓRICO ABRE A LINHA ===')
        await pgA.click(".nav-tab[data-tab='historico']")
        await pgA.wait_for_timeout(1500)
        antes = await pgA.evaluate(
            """() => { const l = document.querySelector('#hist-tbody tr.hist-linha');
                 const d = document.querySelector('#hist-tbody tr.hist-detalhe');
                 return {temLinha: !!l, detalheFechado: d ? d.hidden : null}; }""")
        ck('as linhas do histórico existem', antes['temLinha'], str(antes))
        ck('o detalhe começa fechado', antes['detalheFechado'] is True, str(antes))

        await pgA.click('#hist-tbody tr.hist-linha')
        await pgA.wait_for_timeout(600)
        depois = await pgA.evaluate(
            """() => { const d = document.querySelector('#hist-tbody tr.hist-detalhe');
                 const txt = d ? d.textContent : '';
                 return {aberto: d ? !d.hidden : null,
                         temSecoes: /Este registro/.test(txt) && /A carga/.test(txt),
                         temBotao: !!d.querySelector('button')}; }""")
        ck('clicar abre o detalhe', depois['aberto'] is True, str(depois))
        ck('o detalhe traz as seções do log', depois['temSecoes'], str(depois))
        ck('e o atalho para a linha do tempo', depois['temBotao'], str(depois))

        await pgA.click('#hist-tbody tr.hist-linha')
        await pgA.wait_for_timeout(400)
        fechou = await pgA.evaluate(
            "() => document.querySelector('#hist-tbody tr.hist-detalhe').hidden")
        ck('clicar de novo fecha', fechou is True, str(fechou))

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
