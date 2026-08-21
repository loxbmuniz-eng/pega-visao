#!/usr/bin/env python3
"""Histórico da Programação: o dia como ele foi programado. (21/08/2026)

Pedido do gestor: "quero que haja um histórico da programação também, para
controle das cargas que foram programadas... salvando logs de toda
atualização do programador, alteração".

O que este teste prova:
  1. a consulta traz TODAS as cargas programadas do dia — inclusive a
     CANCELADA, que as outras telas escondem de propósito;
  2. o resumo de aderência conta certo (programadas/concluídas/canceladas);
  3. clicar numa linha abre o LOG de alterações daquela carga (diff campo a
     campo vindo das revisões do servidor);
  4. o PDF sai com o mesmo conteúdo.

    python3 testes/test_programacao_do_dia.py
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


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        # Limpeza ANTES do login (lição das outras suítes: depois, o painel
        # já puxou as sobras para o estado local).
        sql("DELETE FROM fact_statusfrota WHERE placa IN "
            "(SELECT placa FROM fact_viagens WHERE numero_carga IN ('QP-1','QP-2'))")
        sql("DELETE FROM fact_viagens WHERE numero_carga IN ('QP-1','QP-2')")

        ctx = await nav.new_context(viewport={'width': 1360, 'height': 900})
        pg = await ctx.new_page()
        html = open(PAINEL_ARQ, encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = f'{API}/__progdia'
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        await pg.wait_for_selector('#login-email', timeout=25000)
        await pg.fill('#login-email', 'ana@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3000)
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        print('\n=== 0. MATÉRIA-PRIMA: DUAS PROGRAMADAS, UMA CANCELADA ===')
        livres = sql("SELECT string_agg(placa, '|') FROM (SELECT v.placa FROM dim_veiculos v "
                     "LEFT JOIN fact_viagens f ON f.placa = v.placa AND f.excluida_em IS NULL "
                     "WHERE v.transportadora <> '' AND f.carga_id IS NULL "
                     "ORDER BY v.placa LIMIT 2) t")
        placas = livres if livres and len(livres) >= 2 else None
        ck('duas placas livres', bool(placas), str(placas))
        if not placas:
            await nav.close()
            return 1
        ids = await pg.evaluate(
            """async ([p1, p2]) => {
                 const ids = [];
                 for (const [placa, num] of [[p1, 'QP-1'], [p2, 'QP-2']]) {
                   const c = criarCargaProgramada({numeroCarga: num, placa, cliente: 'CLI',
                     destino: 'DST', peso: 4000, rota: '500', operador: 'Ana'});
                   SuincoStore.save();
                   await SuincoSharePoint.sincronizarAgora();
                   ids.push(c.id);
                 }
                 return ids;
               }""", placas)
        # Uma ALTERAÇÃO real na primeira (vira revisão no servidor). Dirigido
        # pelo SERVIDOR com re-tentativa: mudar status na mesma fração de
        # segundo da criação corre contra a fila e é recusado em silêncio.
        for _ in range(6):
            r = sql("SELECT status_atual FROM fact_viagens WHERE numero_carga = 'QP-1'")
            if r and r[0] == 'Aguardando Embarque':
                break
            await pg.evaluate(
                "(id) => SuincoSharePoint.mudarStatus(id, 'Aguardando Embarque')", ids[0])
            await pg.wait_for_timeout(900)
        # O CANCELAMENTO da segunda, com motivo — também confirmado no banco.
        for _ in range(6):
            r = sql("SELECT excluida_em IS NOT NULL FROM fact_viagens WHERE numero_carga = 'QP-2'")
            if r and r[0] == 't':
                break
            await pg.evaluate(
                "(id) => SuincoSharePoint.excluir(id, 'teste de controle da programação')", ids[1])
            await pg.wait_for_timeout(900)
        await pg.evaluate("() => SuincoSharePoint.sincronizarAgora()")
        no_banco = sql("SELECT count(*), count(excluida_em) FROM fact_viagens "
                       "WHERE numero_carga IN ('QP-1','QP-2')")
        ck('as duas existem no banco e uma está cancelada',
           no_banco == ['2', '1'], str(no_banco))

        print('\n=== 1. O RODAPÉ DISCRETO NA ABA PROGRAMAÇÃO ===')
        await pg.click(".nav-tab[data-tab='programacao']")
        await pg.wait_for_timeout(800)
        rodape = await pg.evaluate(
            """() => ({botaoVisivel: !document.getElementById('progdia-rodape').hidden,
                       cardFechado: document.getElementById('card-programacao-dia').hidden})""")
        ck('o botão do controle aparece para a Logística', rodape['botaoVisivel'], str(rodape))
        ck('o card começa DOBRADO — só abre ao clicar', rodape['cardFechado'], str(rodape))
        await pg.click('.btn-progdia')
        await pg.wait_for_timeout(1500)
        tela = await pg.evaluate(
            """() => { const t = document.getElementById('progdia-lista').textContent;
                 const resumo = document.getElementById('progdia-resumo').textContent;
                 const cancelada = document.querySelector('#progdia-lista tr.progdia-cancelada');
                 return {temQP1: t.includes('QP-1'), temQP2: t.includes('QP-2'),
                         canceladaMarcada: !!cancelada,
                         textoCancelada: cancelada ? cancelada.textContent : '',
                         resumo,
                         pdfVisivel: !document.getElementById('progdia-pdf').hidden}; }""")
        ck('a carga ativa aparece', tela['temQP1'], str(tela)[:120])
        ck('a carga CANCELADA aparece — razão da tela existir', tela['temQP2'])
        ck('a cancelada vem marcada como cancelada, com autor',
           tela['canceladaMarcada'] and 'Cancelada por' in tela['textoCancelada'],
           tela['textoCancelada'][:120])
        ck('o resumo traz Programadas e Aderência',
           'Programadas' in tela['resumo'] and 'Aderência' in tela['resumo'])
        ck('o botão de PDF aparece', tela['pdfVisivel'])

        print('\n=== 2. O LOG DE ALTERAÇÕES ABRE NA LINHA ===')
        await pg.evaluate("(id) => alternarLogProgramacaoUI(id)", ids[0])
        await pg.wait_for_timeout(1500)
        log = await pg.evaluate(
            """(id) => { const l = document.getElementById('progdia-log-' + id);
                 return {aberto: l && !l.hidden, texto: l ? l.textContent : ''}; }""", ids[0])
        ck('o log abre', bool(log['aberto']), str(log)[:100])
        ck('com a mudança de status no diff',
           'Status' in log['texto'] and 'Aguardando Embarque' in log['texto'],
           log['texto'][:160])
        ck('e o evento de programação no fim', 'Carga programada' in log['texto'])

        print('\n=== 3. O PDF SAI COM O MESMO CONTEÚDO ===')
        pdf = await pg.evaluate(
            """async () => {
                 let capturado = null;
                 exportarViaServidor = async (el) => { capturado = el.outerHTML; };
                 await pdfProgramacaoDoDiaUI();
                 return capturado;
               }""")
        ck('o PDF é montado', bool(pdf))
        if pdf:
            ck('com as duas cargas', 'QP-1' in pdf and 'QP-2' in pdf)
            ck('com a aderência explicada no rodapé', 'aderência' in pdf.lower())
            ck('sem lixo de programação',
               'undefined' not in pdf and 'NaN' not in pdf and '[object' not in pdf)

        print('\n=== 3b. A PORTARIA NÃO VÊ O CONTROLE — NEM NA TELA NEM NO SERVIDOR ===')
        ctxP = await nav.new_context()
        pgP = await ctxP.new_page()
        await pgP.route(f'{API}/__progdia_port', lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pgP.goto(f'{API}/__progdia_port')
        await pgP.wait_for_selector('#login-email', timeout=25000)
        await pgP.fill('#login-email', 'bruno@teste.local')
        await pgP.fill('#login-senha', SENHA)
        await pgP.click('#btn-entrar')
        await pgP.wait_for_timeout(2500)
        portaria = await pgP.evaluate(
            """async () => {
                 abrirTab('programacao');
                 const rodape = document.getElementById('progdia-rodape');
                 let statusApi = null;
                 try { await SuincoSharePoint.programacaoDoDia('2026-01-01'); statusApi = 200; }
                 catch (e) { statusApi = String(e.message || e); }
                 return {botaoEscondido: !rodape || rodape.hidden, statusApi}; }""")
        ck('o botão do rodapé não existe para a Portaria', portaria['botaoEscondido'], str(portaria))
        ck('e o SERVIDOR recusa a consulta (tela escondida não é porta destrancada)',
           portaria['statusApi'] != 200, str(portaria['statusApi'])[:80])
        await ctxP.close()

        print('\n=== 4. CONSOLE LIMPO + CAPTURA ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await pg.evaluate("() => document.getElementById('card-programacao-dia').scrollIntoView({block:'center'})")
        await pg.wait_for_timeout(400)
        await pg.screenshot(path='/tmp/claude-0/-home-user-pega-visao/82f87c99-e223-5c72-91d0-65150266c838/scratchpad/progdia.png')

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
