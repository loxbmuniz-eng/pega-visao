#!/usr/bin/env python3
"""A Torre mostra a última ação de GENTE, e a programação anterior encerra.
(20/08/2026)

Relato do gestor: "na torre de controle, todos os veículos da programação de
ontem já deram seguimento à sua viagem, porém ainda continuam aparecendo...
todos estão marcando o mesmo horário, no mesmo dia".

Duas coisas se provam aqui:

  1. O horário exibido é o da última vez que uma PESSOA mexeu, com o nome de
     quem foi — e um eco de sincronização (painel reconectando e reenviando
     o que tem em memória) não move esse horário nem rouba a autoria.
  2. A Logística encerra as pendências das programações ANTERIORES, a Torre
     fica só com o dia de hoje, e a carga de hoje não é tocada.

    python3 testes/test_torre_acao_e_encerramento.py
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
    """Postgres local descartável — não é a produção."""
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
    url = f'{API}/__torreacao_{rotulo}'
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

        placas = await pgL.evaluate(
            """() => { const usadas = new Set(DB.cargas.map((c) => c.placa));
                 const livres = DB.frota.filter((x) => x.placa && x.transportadora
                   && !usadas.has(x.placa)).slice(0, 2).map((x) => x.placa);
                 return livres.length === 2 ? livres : null; }""")
        ck('duas placas livres', bool(placas), str(placas))
        if not placas:
            await nav.close()
            return 1
        for pl in placas:
            sql(f"DELETE FROM fact_statusfrota WHERE placa = '{pl}'")
            sql(f"DELETE FROM fact_viagens WHERE placa = '{pl}'")

        print('\n=== 1. A TORRE MOSTRA QUEM MEXEU, E QUANDO ===')
        ids = await pgL.evaluate(
            """async ([pOntem, pHoje]) => {
                 await SuincoSharePoint.sincronizarAgora();
                 const a = criarCargaProgramada({numeroCarga: 'TORRE-ONTEM', placa: pOntem,
                   cliente: 'C', destino: 'D', peso: 1000, rota: '500', operador: 'Ana'});
                 const b = criarCargaProgramada({numeroCarga: 'TORRE-HOJE', placa: pHoje,
                   cliente: 'C', destino: 'D', peso: 2000, rota: '500', operador: 'Ana'});
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
                 return {ontem: a.id, hoje: b.id};
               }""", placas)

        # A da "programação de ontem" fica presa no meio do caminho, como no relato.
        ctxP, pgP = await abrir(nav, 'bruno@teste.local', 'portaria')
        await pgP.evaluate("""async (id) => {
             await SuincoSharePoint.sincronizarAgora();
             await SuincoSharePoint.mudarStatus(id, 'Aguardando Embarque');
             await SuincoSharePoint.sincronizarAgora();
           }""", ids['ontem'])
        await pgP.wait_for_timeout(1200)

        acao = await pgL.evaluate(
            """async (id) => { await SuincoSharePoint.sincronizarAgora();
                 const c = getCarga(id);
                 return c ? {em: c.acaoEm, por: c.acaoPor, setor: c.acaoSetor} : null; }""",
            ids['ontem'])
        ck('a carga sabe quem mexeu por último', acao and acao['setor'] == 'Portaria', str(acao))

        await pgL.click(".nav-tab[data-tab='torre']")
        await pgL.wait_for_timeout(1200)
        naTela = await pgL.evaluate(
            """(id) => { const t = document.getElementById('torre-tbody');
                 const mov = ultimaMovimentacaoDaCarga(id);
                 const linha = [...t.querySelectorAll('tr')]
                   .find((l) => l.innerHTML.includes('TORRE-ONTEM'));
                 const cel = linha ? linha.querySelector('.cel-datas .dt-atu') : null;
                 return {temQuem: !!t.querySelector('.dt-quem'),
                         cabecalho: [...document.querySelectorAll('#torre-thead th')]
                           .some((th) => /Última etapa/i.test(th.textContent)),
                         naTela: cel ? cel.textContent.trim() : null,
                         doHistorico: mov ? fmtDataHora(mov.timestamp) : null,
                         etapa: mov ? mov.statusNovo : null}; }""", ids['ontem'])
        ck('a coluna se chama "Programação · Última etapa"', naTela['cabecalho'], str(naTela))
        ck('o nome de quem mexeu aparece na célula', naTela['temQuem'], str(naTela))
        # O pedido em uma linha: o horário da Torre é o MESMO do Histórico.
        ck('o horário da Torre é o mesmo da última etapa no Histórico',
           naTela['doHistorico'] and naTela['naTela'].startswith(naTela['doHistorico']),
           f"torre={naTela['naTela']!r} historico={naTela['doHistorico']!r} etapa={naTela['etapa']}")

        print('\n=== 2. ECO DE SINCRONIZAÇÃO NÃO INVENTA HORÁRIO ===')
        antes = sql(f"SELECT acao_em, acao_por FROM fact_viagens WHERE carga_id = '{ids['ontem']}'")
        # Exatamente o que um painel faz ao reconectar: reenvia o que tem.
        await pgL.evaluate("""async (id) => {
             const c = getCarga(id);
             c.atualizadoEm = new Date().toISOString();
             SuincoStore.save();
             await SuincoSharePoint.sincronizarAgora();
           }""", ids['ontem'])
        await pgL.wait_for_timeout(2000)
        depois = sql(f"SELECT acao_em, acao_por FROM fact_viagens WHERE carga_id = '{ids['ontem']}'")
        ck('o horário da última ação NÃO se moveu com o eco',
           antes and depois and antes[0] == depois[0], f'{antes} → {depois}')
        ck('e a autoria continua sendo de quem mexeu de verdade',
           antes and depois and antes[1] == depois[1], f'{antes} → {depois}')

        print('\n=== 3. ENCERRAR A PROGRAMAÇÃO ANTERIOR LIMPA A TORRE ===')
        sql("UPDATE fact_viagens SET programado_em = now() - interval '1 day', "
            f"atualizado_em = now() WHERE carga_id = '{ids['ontem']}'")

        ctxA, pgA = await abrir(nav, 'ana@teste.local', 'limpa')
        await pgA.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        await pgA.click(".nav-tab[data-tab='torre']")
        await pgA.wait_for_timeout(1500)

        temBotao = await pgA.evaluate(
            """() => !!document.querySelector("#torre-tbody .torre-sep button")""")
        ck('o botão de encerrar nasce colado na faixa da programação anterior', temBotao)

        pgA.on('dialog', lambda d: asyncio.ensure_future(
            d.accept('caminhões já saíram; limpando para a programação nova')))
        await pgA.click("#torre-tbody .torre-sep button")
        await pgA.wait_for_timeout(4000)

        estado = sql("SELECT (SELECT status_atual FROM fact_viagens WHERE carga_id = '"
                     + ids['ontem'] + "'), (SELECT status_atual FROM fact_viagens WHERE carga_id = '"
                     + ids['hoje'] + "')")
        ck('a carga de ontem foi encerrada', estado and estado[0] == 'Seguiu Viagem', str(estado))
        ck('a carga de HOJE continua intacta', estado and estado[1] == 'Aguardando Veículo', str(estado))

        await pgA.wait_for_timeout(1500)
        torreLimpa = await pgA.evaluate(
            """(id) => { const t = document.getElementById('torre-tbody');
                 return {temAntiga: t.innerHTML.includes('TORRE-ONTEM'),
                         temFaixa: !!t.querySelector('tr.torre-sep')}; }""", ids['ontem'])
        ck('a carga encerrada saiu da Torre', not torreLimpa['temAntiga'], str(torreLimpa))
        ck('a faixa de programação anterior sumiu junto', not torreLimpa['temFaixa'], str(torreLimpa))

        trilha = sql("SELECT acao FROM log_eventos WHERE carga_id = '"
                     + ids['ontem'] + "' ORDER BY data_evento DESC LIMIT 1")
        ck('o encerramento ficou registrado com o motivo',
           trilha and 'encerrada' in trilha[0] and 'caminhões já saíram' in trilha[0],
           str(trilha)[:120])

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
