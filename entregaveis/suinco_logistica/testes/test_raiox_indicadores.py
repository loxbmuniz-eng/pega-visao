#!/usr/bin/env python3
"""Raio-X da Operação: métricas por rota/transportadora/placa com drill-down.
(21/08/2026)

Pedido do gestor: "da mesma forma que no histórico eu consigo abrir um card
detalhado, quero poder enxergar as métricas de cada linha selecionável, cada
placa, cada rota... quero que os indicadores mostrem as rotas também".

    python3 testes/test_raiox_indicadores.py
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
        ctx = await nav.new_context(viewport={'width': 1360, 'height': 900})
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        html = open(PAINEL_ARQ, encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = f'{API}/__raiox'
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        # Limpa sobras de execuções anteriores ANTES do login — se a limpeza
        # vier depois, o painel já puxou as cargas RX velhas para o estado
        # local e elas assombram as contagens da tela.
        sql("DELETE FROM fact_statusfrota WHERE placa IN "
            "(SELECT placa FROM fact_viagens WHERE numero_carga IN ('RX-1','RX-2'))")
        sql("DELETE FROM fact_viagens WHERE numero_carga IN ('RX-1','RX-2')")
        await pg.goto(url)
        await pg.wait_for_selector('#login-email', timeout=25000)
        await pg.fill('#login-email', 'chefe@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3000)

        # Garante matéria-prima: duas cargas concluídas em rotas diferentes.
        livres = sql("SELECT string_agg(placa, '|') FROM (SELECT v.placa FROM dim_veiculos v "
                     "LEFT JOIN fact_viagens f ON f.placa = v.placa AND f.excluida_em IS NULL "
                     "WHERE v.transportadora <> '' AND f.carga_id IS NULL ORDER BY v.placa LIMIT 2) t")
        placas = livres if livres and len(livres) >= 2 else None
        ck('duas placas livres', bool(placas), str(placas))
        if not placas:
            await nav.close()
            return 1
        ids = await pg.evaluate(
            """async ([p1, p2]) => {
                 const ids = [];
                 for (const [placa, rota, num] of [[p1, '500', 'RX-1'], [p2, '517', 'RX-2']]) {
                   const c = criarCargaProgramada({numeroCarga: num, placa, cliente: 'C',
                     destino: 'D', peso: 2000, rota, operador: 'Chefe'});
                   SuincoStore.save();
                   await SuincoSharePoint.sincronizarAgora();
                   ids.push(c.id);
                 }
                 return ids;
               }""", placas)
        # A cadeia de status é dirigida pelo estado do SERVIDOR, lido por SQL
        # a cada volta. Duas lições de flakiness anteriores estão embutidas:
        #   1. O status local é otimista — o laço antigo declarava vitória
        #      olhando a tela, e uma recusa atrasada revertia depois.
        #   2. Sincronizar o painel INTEIRO a cada volta estourava o rate
        #      limit (300 req/min); o 429 vira "queda de rede", a mudança cai
        #      na fila offline e drena DEPOIS da checagem, fora de ordem.
        # Por isso cada volta faz UMA requisição HTTP (o próprio mudarStatus)
        # e a leitura de verdade é SQL, que não passa pela API.
        CADEIA = ['Aguardando Veículo', 'Aguardando Embarque', 'Embarque Iniciado',
                  'Embarque Finalizado', 'Faturado', 'Seguiu Viagem']
        for id_carga, num in zip(ids, ['RX-1', 'RX-2']):
            for volta in range(30):
                r = sql(f"SELECT status_atual FROM fact_viagens WHERE numero_carga = '{num}' "
                        "AND excluida_em IS NULL")
                atual = r[0] if r else None
                if atual == 'Seguiu Viagem':
                    break
                if atual is None or atual not in CADEIA[:-1]:
                    # A criação ainda não subiu (ou caiu na fila): dá um
                    # empurrão e espera, sem martelar a API.
                    await pg.evaluate("() => SuincoSharePoint.sincronizarAgora()")
                    await pg.wait_for_timeout(700)
                    continue
                prox = CADEIA[CADEIA.index(atual) + 1]
                rr = await pg.evaluate(
                    "([id, s]) => SuincoSharePoint.mudarStatus(id, s)", [id_carga, prox])
                if rr and rr.get('recusado'):
                    print(f'  [nota] {num}: {atual}->{prox} recusado: {rr.get("erro")}')
                    await pg.wait_for_timeout(700)
                else:
                    await pg.wait_for_timeout(250)
        srv = sql("SELECT string_agg(status_atual, '|') FROM (SELECT status_atual "
                  "FROM fact_viagens WHERE numero_carga IN ('RX-1','RX-2') "
                  "AND excluida_em IS NULL ORDER BY numero_carga) t")
        ck('as duas cargas de teste concluíram o ciclo NO SERVIDOR',
           srv == ['Seguiu Viagem', 'Seguiu Viagem'], str(srv))
        # Uma última sincronização para a tela refletir o servidor confirmado.
        await pg.evaluate("() => SuincoSharePoint.sincronizarAgora()")
        await pg.wait_for_timeout(1500)

        print('\n=== 1. O RAIO-X ABRE EM ROTAS ===')
        await pg.click(".nav-tab[data-tab='indicadores']")
        await pg.wait_for_timeout(1500)
        rotas = await pg.evaluate(
            """() => { const linhas = [...document.querySelectorAll('#raiox-tbody tr.raiox-linha')];
                 return {n: linhas.length,
                         tem500: linhas.some((l) => l.textContent.includes('500')),
                         tem517: linhas.some((l) => l.textContent.includes('517')),
                         segAtivo: document.querySelector('#raiox-seg .seg-ativo')?.dataset.visao,
                         temBarra: !!document.querySelector('.raiox-barra')}; }""")
        ck('a visão inicial é Rotas', rotas['segAtivo'] == 'rota', str(rotas))
        ck('as rotas das cargas aparecem', rotas['tem500'] and rotas['tem517'], str(rotas))
        ck('cada linha tem a barra de magnitude', rotas['temBarra'], str(rotas))

        print('\n=== 2. CLICAR NA LINHA ABRE O DETALHE ===')
        await pg.click("#raiox-tbody tr.raiox-linha")
        await pg.wait_for_timeout(600)
        det = await pg.evaluate(
            """() => { const d = document.querySelector('#raiox-tbody tr.raiox-det');
                 if (!d) return null;
                 const t = d.textContent;
                 return {svg: !!d.querySelector('svg.etapas-svg'),
                         etapas: /Aguardando embarque/.test(t) && /Carregamento/.test(t),
                         mediaGeral: /média geral/.test(t),
                         extremos: /Ciclo mais rápido|Sem ciclos/.test(t),
                         cargas: !!d.querySelector('.table-raiox-cargas'),
                         botoes: d.querySelectorAll('.raiox-acoes button').length >= 2}; }""")
        ck('o detalhe abre', det is not None, str(det))
        ck('com o gráfico SVG de etapas', det and det['svg'], str(det))
        ck('as 4 etapas nomeadas (cor nunca é o único canal)', det and det['etapas'], str(det))
        ck('o risco da média geral está explicado', det and det['mediaGeral'], str(det))
        ck('os extremos (mais rápido / mais lento)', det and det['extremos'], str(det))
        ck('a lista de cargas individuais', det and det['cargas'], str(det))
        ck('cada carga com linha do tempo e relatório próprios', det and det['botoes'], str(det))

        print('\n=== 2b. O 🕒 ABRE A LINHA DO TEMPO NO HISTÓRICO ===')
        # Relato do gestor: "quando clico em linha do tempo ele anda do
        # Indicadores pra Torre de Controle" — o botão apontava para a aba
        # errada, e a timeline era desenhada num container invisível.
        await pg.click('#raiox-tbody .raiox-acoes button[title*="Linha do tempo"]')
        await pg.wait_for_timeout(900)
        tl = await pg.evaluate(
            """() => ({
                 abaAtiva: document.querySelector('.nav-tab.active')?.dataset.tab,
                 temTimeline: !!document.querySelector('#hist-timeline-wrap .timeline-card'),
                 passos: document.querySelectorAll('#hist-timeline-wrap .timeline-step').length,
                 buscaPreenchida: !!document.getElementById('hist-busca-carga').value,
               })""")
        ck('o clique leva para o HISTÓRICO (não para a Torre)',
           tl['abaAtiva'] == 'historico', str(tl))
        ck('a linha do tempo "tipo iFood" está desenhada', tl['temTimeline'] and tl['passos'] >= 5, str(tl))
        ck('a busca fica preenchida, como se a pessoa tivesse buscado', tl['buscaPreenchida'], str(tl))
        await pg.click(".nav-tab[data-tab='indicadores']")
        await pg.wait_for_timeout(800)
        await pg.click("#raiox-tbody tr.raiox-linha")
        await pg.wait_for_timeout(400)

        print('\n=== 3. NAVEGAÇÃO ENTRE RECORTES ===')
        await pg.click("#raiox-seg [data-visao='placa']")
        await pg.wait_for_timeout(600)
        placasV = await pg.evaluate(
            """(ps) => { const t = document.getElementById('raiox-tbody').textContent;
                 return {p1: t.includes(ps[0]), p2: t.includes(ps[1]),
                         detalheFechou: !document.querySelector('#raiox-tbody tr.raiox-det')}; }""",
            placas)
        ck('a visão Placas lista as placas', placasV['p1'] and placasV['p2'], str(placasV))
        ck('trocar de recorte fecha o detalhe anterior', placasV['detalheFechou'], str(placasV))

        await pg.click("#raiox-seg [data-visao='transportadora']")
        await pg.wait_for_timeout(600)
        transp = await pg.evaluate(
            "() => document.querySelectorAll('#raiox-tbody tr.raiox-linha').length")
        ck('a visão Transportadoras tem linhas', transp > 0, str(transp))

        print('\n=== 4. ORDENAÇÃO PELO CABEÇALHO ===')
        await pg.click("#raiox-seg [data-visao='rota']")
        await pg.wait_for_timeout(400)
        # Ordena por nome (asc), depois clica de novo (desc): com 2+ nomes
        # diferentes, as duas ordens não podem ser iguais — comparar asc com
        # a ordenação padrão podia coincidir e acusar falha falsa.
        await pg.click("#raiox-thead .raiox-th")
        await pg.wait_for_timeout(400)
        asc = await pg.evaluate(
            "() => [...document.querySelectorAll('#raiox-tbody tr.raiox-linha td:first-child')].map((t) => t.textContent.trim())")
        setaAsc = await pg.evaluate(
            "() => document.querySelector('#raiox-thead .raiox-th').textContent.includes('▲')")
        await pg.click("#raiox-thead .raiox-th")
        await pg.wait_for_timeout(400)
        desc = await pg.evaluate(
            "() => [...document.querySelectorAll('#raiox-tbody tr.raiox-linha td:first-child')].map((t) => t.textContent.trim())")
        ck('a seta de ordenação aparece no cabeçalho', setaAsc)
        ck('clicar de novo inverte a ordem', asc == list(reversed(desc)) and len(asc) >= 2,
           f'{asc[:2]} vs {desc[:2]}')

        print('\n=== 4b. PULSO DO PÁTIO ===')
        pulso = await pg.evaluate(
            """() => { const heat = document.querySelector('#pulso-heatmap svg');
                 const evo = document.querySelector('#pulso-evolucao svg');
                 const leg = document.getElementById('pulso-heatmap-legenda');
                 return {heat: !!heat,
                         celulas: heat ? heat.querySelectorAll('rect').length : 0,
                         evo: !!evo,
                         barras: evo ? evo.querySelectorAll('rect').length : 0,
                         legenda: !!(leg && leg.textContent.includes('pico')),
                         doisPaineis: evo ? /ENTRADAS NO PÁTIO/.test(evo.textContent)
                           && /TEMPO MÉDIO DE PÁTIO/.test(evo.textContent) : False}; }"""
            .replace('False', 'false'))
        ck('o heatmap hora × dia está desenhado (168 células)',
           pulso['heat'] and pulso['celulas'] >= 168, str(pulso))
        ck('a evolução diária está desenhada', pulso['evo'] and pulso['barras'] >= 14, str(pulso))
        ck('os DOIS painéis existem (entradas e tempo médio — sem eixo duplo)',
           pulso['doisPaineis'], str(pulso))
        ck('a legenda do heatmap explica o pico', pulso['legenda'], str(pulso))

        print('\n=== 4c. TÍTULOS DE CARD SEM EMOJI ===')
        icones = await pg.evaluate(
            """() => ({svg: document.querySelectorAll('.card-title .ico-card').length,
                       emoji: document.querySelectorAll('.card-title .icon').length})""")
        ck('todos os títulos de card usam o ícone vetorial',
           icones['svg'] >= 40 and icones['emoji'] == 0, str(icones))

        print('\n=== 5. CONSOLE LIMPO + CAPTURA ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await pg.click("#raiox-tbody tr.raiox-linha")
        await pg.wait_for_timeout(600)
        alvo = await pg.query_selector('#raiox-seg')
        await pg.evaluate("() => document.querySelector('.table-raiox').scrollIntoView({block:'center'})")
        await pg.screenshot(path='/tmp/claude-0/-home-user-pega-visao/82f87c99-e223-5c72-91d0-65150266c838/scratchpad/raiox.png')
        await pg.evaluate("() => document.getElementById('pulso-heatmap').scrollIntoView({block:'center'})")
        await pg.wait_for_timeout(400)
        await pg.screenshot(path='/tmp/claude-0/-home-user-pega-visao/82f87c99-e223-5c72-91d0-65150266c838/scratchpad/pulso.png')

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
