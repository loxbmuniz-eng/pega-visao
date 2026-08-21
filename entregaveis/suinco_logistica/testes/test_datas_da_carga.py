#!/usr/bin/env python3
"""As TRÊS datas de uma carga não se confundem (21/08/2026).

Relato do gestor, olhando o Histórico: "que estranho essa data de entrada no
pátio dessa placa". A carga 118292 dizia "Entrada no pátio 20/08 19:57" e a
movimentação logo acima mostrava a Portaria registrando a chegada em 21/08
09:06 — quatorze horas depois.

O rótulo é que mentia: a tela mostrava `criadoEm`, que para uma carga
PROGRAMADA é quando a Logística a lançou, não quando o caminhão encostou.

  criadoEm     — quando o REGISTRO nasceu
  programadoEm — quando a CARGA foi lançada
  entrada      — quando o CAMINHÃO encostou (evento na trilha)

    python3 testes/test_datas_da_carga.py
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
    url = f'{API}/__datas_{rotulo}'
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
    livre = sql("SELECT v.placa FROM dim_veiculos v "
                "LEFT JOIN fact_viagens f ON f.placa = v.placa AND f.excluida_em IS NULL "
                "WHERE v.transportadora <> '' AND f.carga_id IS NULL ORDER BY v.placa LIMIT 1")
    placa = livre[0] if livre else None

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        ctxL, pgL = await abrir(nav, 'ana@teste.local', 'log')
        ck('placa livre', bool(placa), str(placa))
        if not placa:
            await nav.close()
            return 1

        print('\n=== 1. CARGA PROGRAMADA: AINDA NÃO TEM ENTRADA ===')
        cargaId = await pgL.evaluate(
            """async (placa) => {
                 await SuincoSharePoint.sincronizarAgora();
                 const c = criarCargaProgramada({numeroCarga: 'DATAS-1', placa, cliente: 'C',
                   destino: 'D', peso: 1000, rota: '500', operador: 'Ana'});
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
                 return c.id;
               }""", placa)
        semEntrada = await pgL.evaluate(
            """(id) => { const c = getCarga(id);
                 return {entrada: entradaNoPatioDe(c), criado: !!c.criadoEm,
                         programado: !!c.programadoEm}; }""", cargaId)
        ck('a carga tem data de criação', semEntrada['criado'], str(semEntrada))
        ck('e data de programação', semEntrada['programado'], str(semEntrada))
        ck('mas NÃO tem entrada no pátio — o caminhão não chegou',
           semEntrada['entrada'] is None, str(semEntrada))

        print('\n=== 2. A ENTRADA NASCE QUANDO A PORTARIA REGISTRA ===')
        # A carga foi lançada ONTEM; o caminhão só encosta hoje. É o caso
        # exato do relato — as duas datas ficam a horas de distância.
        sql("UPDATE fact_viagens SET criado_em = now() - interval '14 hours', "
            f"programado_em = now() - interval '14 hours' WHERE carga_id = '{cargaId}'")

        ctxP, pgP = await abrir(nav, 'bruno@teste.local', 'portaria')
        await pgP.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        await pgP.click(".nav-tab[data-tab='portaria']")
        await pgP.fill('#portaria-placa', placa)
        await pgP.click("button:has-text('Chegou')")
        for _ in range(40):
            await pgP.wait_for_timeout(500)
            r = sql(f"SELECT status_atual FROM fact_viagens WHERE carga_id = '{cargaId}'")
            if r and r[0] == 'Aguardando Embarque':
                break

        datas = await pgL.evaluate(
            """async (id) => { await SuincoSharePoint.sincronizarAgora();
                 const c = getCarga(id);
                 const e = entradaNoPatioDe(c);
                 return {entrada: e, criado: c.criadoEm,
                         horas: e ? Math.round((new Date(e) - new Date(c.criadoEm)) / 3600000) : null}; }""",
            cargaId)
        ck('agora existe entrada no pátio', bool(datas['entrada']), str(datas))
        ck('e ela NÃO é a data de criação — são fatos diferentes',
           datas['horas'] is not None and datas['horas'] >= 13, str(datas))

        print('\n=== 3. O HISTÓRICO MOSTRA AS DUAS, COM O NOME CERTO ===')
        await pgL.click(".nav-tab[data-tab='historico']")
        await pgL.wait_for_timeout(1500)
        detalhe = await pgL.evaluate(
            """(id) => { const c = getCarga(id);
                 const html = detalheHistoricoHtml({id: 'x', cargaId: id, timestamp: c.criadoEm,
                   operador: 'Teste', setor: 'Portaria', statusAnterior: null,
                   statusNovo: 'Aguardando Embarque'});
                 const div = document.createElement('div'); div.innerHTML = html;
                 const campos = {};
                 div.querySelectorAll('.hist-campo').forEach((f) => {
                   campos[f.querySelector('dt').textContent.trim()] =
                     f.querySelector('dd').textContent.trim(); });
                 return campos; }""", cargaId)
        ck('o detalhe traz "Entrada no pátio"', 'Entrada no pátio' in detalhe, str(list(detalhe))[:150])
        ck('e traz "Registro criado em" separado', 'Registro criado em' in detalhe,
           str(list(detalhe))[:150])
        ck('as duas datas são DIFERENTES na tela',
           detalhe.get('Entrada no pátio') != detalhe.get('Registro criado em'),
           f"entrada={detalhe.get('Entrada no pátio')} criado={detalhe.get('Registro criado em')}")

        print('\n=== 3b. RELATÓRIO DE UMA CARGA SÓ ===')
        # Pedido do gestor (21/08/2026): "quero conseguir gerar um relatório
        # de qualquer número de carga individual do histórico".
        temBotao = await pgL.evaluate(
            """(id) => { const c = getCarga(id);
                 const html = detalheHistoricoHtml({id: 'z', cargaId: id, timestamp: c.criadoEm,
                   operador: 'T', setor: 'Portaria', statusAnterior: null,
                   statusNovo: 'Aguardando Embarque'});
                 return html.includes('Relatório desta carga'); }""", cargaId)
        ck('o detalhe do Histórico oferece o relatório da carga', temBotao)

        async with pgL.expect_download(timeout=60000):
            await pgL.evaluate("(id) => relatorioDaCargaUI(id)", cargaId)
        doc = await pgL.evaluate(
            "() => document.getElementById('print-carga').innerText")
        ck('o documento traz a identificação da carga', 'DATAS-1' in doc, doc[:60])
        ck('traz a linha do tempo com as etapas', 'Linha do tempo' in doc and 'Aguardando Embarque' in doc)
        ck('traz as três datas com os nomes certos',
           'Programada em' in doc and 'Registro criado em' in doc and 'Entrada no pátio' in doc)
        ck('e explica no rodapé que são fatos diferentes',
           'três fatos distintos' in doc or 'fatos distintos' in doc)

        print('\n=== 4. CARGA SEM CHEGADA DIZ ISSO, EM VEZ DE UMA DATA QUALQUER ===')
        outra = await pgL.evaluate(
            """async (placa) => {
                 const c = criarCargaProgramada({numeroCarga: 'DATAS-2', placa, cliente: 'C',
                   destino: 'D', peso: 500, rota: '500', operador: 'Ana'});
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
                 return c.id;
               }""", placa)
        texto = await pgL.evaluate(
            """(id) => { const c = getCarga(id);
                 const html = detalheHistoricoHtml({id: 'y', cargaId: id, timestamp: c.criadoEm,
                   operador: 'Teste', setor: 'Logística', statusAnterior: null,
                   statusNovo: 'Aguardando Veículo'});
                 return html.includes('ainda não teve chegada registrada'); }""", outra)
        ck('a tela diz que a chegada ainda não aconteceu', texto)

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
