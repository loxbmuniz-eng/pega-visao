#!/usr/bin/env python3
"""Nº DEV ≠ Nº da carga de devolução, e até três lacres na saída (20/08/2026).

Relato do gestor, com o print do SIS ATAK: o checklist traz o CÓDIGO DA DEV,
lançado pelas meninas. Depois o porteiro abre a "Montagem de Cargas" do SIS
ATAK, escolhe a rota, joga as DEVs daquela rota para dentro e salva — e o
"Número Documento" que sai dali é o NÚMERO DA CARGA DE DEVOLUÇÃO. São dois
números; num campo só, um apagava o outro.

No mesmo pedido: "pode haver mais de um (ou dois, no máximo três) lacres na
saída do caminhão".

    python3 testes/test_carga_dev_e_lacres.py
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
    """Postgres local descartável — não é a produção. Devolve a primeira
    linha em lista (ou None), para servir tanto de escrita quanto de
    consulta."""
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
    url = f'{API}/__cargadev_{rotulo}'
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

        print('\n=== 1. O CHECKLIST NASCE COM O Nº DEV, SEM Nº DE CARGA ===')
        ctxL, pgL = await abrir(nav, 'ana@teste.local', 'log')
        dev = await pgL.evaluate(
            """async () => {
                 const hoje = new Date().toISOString().slice(0, 10);
                 const d = await SuincoSharePoint.devolucoes.criar({
                   dataDev: hoje, rotas: ['500'], regiao: 'Patos de Minas',
                   operadorCodigo: '82205', itens: [],
                 });
                 const i = await SuincoSharePoint.devolucoes.criarItem(d.id, {
                   nota: '654789', cx: 1, numDev: '41836', motivo: '602',
                 });
                 return {id: d.id, itemId: i.itemId, numDev: i.numDev, cargaDev: i.cargaDev};
               }""")
        ck('checklist criado com o Nº DEV das meninas', dev['numDev'] == '41836', str(dev['numDev']))
        ck('o Nº da carga de devolução nasce vazio — ainda não passou pela Portaria',
           dev['cargaDev'] == '', repr(dev['cargaDev']))

        print('\n=== 2. A PORTARIA INFORMA O NÚMERO DO SIS ATAK ===')
        ctxP, pgP = await abrir(nav, 'bruno@teste.local', 'portaria')
        r = await pgP.evaluate(
            """async ({id, itemId}) => {
                 const cab = await SuincoSharePoint.devolucoes.editar(id, {cargaNumero: '118294'});
                 const item = await SuincoSharePoint.devolucoes.editarItem(id, itemId,
                   {cargaDev: '118294'});
                 return {cargaNumero: cab.cargaNumero, cargaDev: item.cargaDev, numDev: item.numDev};
               }""", {'id': dev['id'], 'itemId': dev['itemId']})
        ck('a Portaria grava o número da carga no cabeçalho', r['cargaNumero'] == '118294', str(r))
        ck('e o número da carga na linha da DEV', r['cargaDev'] == '118294', str(r))
        ck('o Nº DEV continua intacto — os dois convivem',
           r['numDev'] == '41836', str(r['numDev']))

        print('\n=== 3. OS TRÊS LACRES DA SAÍDA ESTÃO NA TELA DA PORTARIA ===')
        await pgP.click(".nav-tab[data-tab='portaria']")
        await pgP.wait_for_timeout(800)
        tela = await pgP.evaluate(
            """() => {
                 const ids = ['portaria-lacre', 'portaria-lacre-2', 'portaria-lacre-3'];
                 const campos = ids.map((i) => document.getElementById(i));
                 const placa = document.getElementById('portaria-placa');
                 const linha = document.querySelector('.quick-linha-lacres');
                 return {
                   existem: campos.every(Boolean),
                   abaixoDaPlaca: !!(linha && placa
                     && linha.getBoundingClientRect().top > placa.getBoundingClientRect().top),
                   linhaInteira: !!linha,
                 };
               }""")
        ck('os três campos de lacre existem', tela['existem'], str(tela))
        ck('ficam na linha de baixo, depois da placa', tela['abaixoDaPlaca'], str(tela))

        print('\n=== 4. A SAÍDA GRAVA OS TRÊS NA CARGA ===')
        # A placa vem do BANCO, não da tela (20/08/2026). Escolher "a
        # primeira que o painel não conhece" falhava de vez em quando: o
        # banco de teste é compartilhado entre as suítes, e uma placa sem
        # carga NA TELA podia ter carga de outra suíte no servidor — aí a
        # trava de reentrada recusava a promoção e o teste acusava um
        # defeito que não existia.
        livre = sql("SELECT v.placa FROM dim_veiculos v "
                    "LEFT JOIN fact_viagens f ON f.placa = v.placa AND f.excluida_em IS NULL "
                    "WHERE v.transportadora <> '' AND f.carga_id IS NULL "
                    "ORDER BY v.placa LIMIT 1")
        placa = livre[0] if livre else None
        ck('placa livre escolhida', bool(placa), str(placa))
        if not placa:
            await nav.close()
            return 1
        # A trava de reentrada recusa promover carga de placa com pendência —
        # o pátio do banco de teste guarda cargas de outras suítes.
        sql(f"DELETE FROM fact_statusfrota WHERE placa = '{placa}'")
        sql(f"DELETE FROM fact_viagens WHERE placa = '{placa}'")

        cargaId = await pgL.evaluate(
            """async (placa) => {
                 await SuincoSharePoint.sincronizarAgora();
                 const c = criarCargaProgramada({numeroCarga: 'LACRE-UI', placa, cliente: 'X',
                   destino: 'Y', peso: 1000, rota: '500', operador: 'Ana'});
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
                 for (const s of ['Aguardando Embarque', 'Embarque Iniciado',
                                  'Embarque Finalizado', 'Faturado']) {
                   await SuincoSharePoint.mudarStatus(c.id, s);
                 }
                 await SuincoSharePoint.sincronizarAgora();
                 return c.id;
               }""", placa)
        pronto = await pgL.evaluate(
            "(id) => { const c = getCarga(id); return c ? c.status : null; }", cargaId)
        ck('carga de teste chegou a Faturado, pronta para sair', pronto == 'Faturado', str(pronto))

        await pgP.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        await pgP.wait_for_timeout(1500)
        await pgP.fill('#portaria-placa', placa)
        await pgP.fill('#portaria-lacre', '133476')
        await pgP.fill('#portaria-lacre-2', '133477')
        await pgP.fill('#portaria-lacre-3', '133478')
        await pgP.click("button:has-text('Saiu')")
        await pgP.wait_for_timeout(3500)

        # Terminal NOVO de propósito: é o que um colega enxerga. A aba que
        # criou a carga tem cópia local e poderia mascarar um campo que não
        # subiu — foi assim que a observação sumiu em 14/08/2026.
        ctxV, pgV = await abrir(nav, 'ana@teste.local', 'confere')
        gravado = await pgV.evaluate(
            """async (id) => {
                 await SuincoSharePoint.sincronizarAgora();
                 const c = getCarga(id);
                 return c ? {status: c.status, l1: c.lacre, l2: c.lacre2, l3: c.lacre3} : null;
               }""", cargaId)
        ck('o caminhão seguiu viagem', gravado and gravado['status'] == 'Seguiu Viagem', str(gravado))
        ck('os três lacres ficaram gravados, cada um no seu campo',
           gravado and [gravado['l1'], gravado['l2'], gravado['l3']] == ['133476', '133477', '133478'],
           str(gravado))

        limpo = await pgP.evaluate(
            """() => ['portaria-lacre', 'portaria-lacre-2', 'portaria-lacre-3']
                 .every((i) => (document.getElementById(i) || {}).value === '')""")
        ck('os campos limpam depois da saída, para o próximo caminhão', limpo)

        await pgL.evaluate(
            """async (id) => { try { await SuincoSharePoint.devolucoes.excluir(id); }
                 catch (e) {} }""", dev['id'])
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
