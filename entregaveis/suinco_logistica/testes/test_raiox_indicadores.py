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
        estados = await pg.evaluate(
            """async ([p1, p2]) => {
                 const ids = [];
                 for (const [placa, rota, num] of [[p1, '500', 'RX-1'], [p2, '517', 'RX-2']]) {
                   const c = criarCargaProgramada({numeroCarga: num, placa, cliente: 'C',
                     destino: 'D', peso: 2000, rota, operador: 'Chefe'});
                   SuincoStore.save();
                   await SuincoSharePoint.sincronizarAgora();
                   ids.push(c.id);
                 }
                 /* A cadeia de status roda DEPOIS de os dois upserts terem
                    subido, e com uma nova tentativa por etapa: mudarStatus
                    direto pode correr contra a fila de sincronização e ser
                    recusado com 404 — no pátio real a Portaria não clica
                    dentro da mesma fração de segundo da programação. */
                 /* Dirigido pelo ESTADO, não por uma lista cega: cada volta
                    olha onde a carga está e pede a PRÓXIMA etapa, até chegar
                    em Seguiu Viagem. Uma recusa pontual (corrida com a fila
                    de sincronização) vira só mais uma volta do laço. */
                 const CADEIA = ['Aguardando Veículo', 'Aguardando Embarque',
                   'Embarque Iniciado', 'Embarque Finalizado', 'Faturado', 'Seguiu Viagem'];
                 for (const id of ids) {
                   for (let volta = 0; volta < 25; volta++) {
                     const atual = (getCarga(id) || {}).status;
                     if (atual === 'Seguiu Viagem') break;
                     const prox = CADEIA[CADEIA.indexOf(atual) + 1];
                     if (!prox) break;
                     await SuincoSharePoint.mudarStatus(id, prox);
                     await new Promise((x) => setTimeout(x, 250));
                   }
                 }
                 await SuincoSharePoint.sincronizarAgora();
                 return ids.map((id) => (getCarga(id) || {}).status);
               }""", placas)
        ck('as duas cargas de teste concluíram o ciclo',
           estados == ['Seguiu Viagem', 'Seguiu Viagem'], str(estados))
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

        print('\n=== 5. CONSOLE LIMPO + CAPTURA ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await pg.click("#raiox-tbody tr.raiox-linha")
        await pg.wait_for_timeout(600)
        alvo = await pg.query_selector('#raiox-seg')
        await pg.evaluate("() => document.querySelector('.table-raiox').scrollIntoView({block:'center'})")
        await pg.screenshot(path='/tmp/claude-0/-home-user-pega-visao/82f87c99-e223-5c72-91d0-65150266c838/scratchpad/raiox.png')

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
