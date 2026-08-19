#!/usr/bin/env python3
"""A data de programação é a do LANÇAMENTO, nunca a da entrada (19/08/2026).

Relato: a programação do dia saiu com 11 cargas e o relatório trouxe 9. As
duas que faltaram eram caminhões que deram entrada ONTEM e tiveram a carga
lançada hoje — elas carregavam a data da entrada.

O que se prova aqui, no navegador de verdade:

  1. A Portaria registra a entrada de um caminhão e essa entrada NÃO ganha
     data de programação.
  2. A carga dela lançada hoje fica com data de HOJE, mesmo com a entrada
     sendo de outro dia — e o `criadoEm` (quando o caminhão chegou de fato)
     é preservado, porque são dois fatos diferentes.
  3. A carga entra na Fila de Programados de hoje e no filtro do relatório
     do dia.

    python3 testes/test_data_programacao.py
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
    """Consulta o Postgres local descartável (não é a produção)."""
    saida = subprocess.run(
        ['sudo', '-u', 'postgres', 'psql', '-tAF', '|', '-P', 'pager=off',
         '-d', 'embarque_suinco', '-c', consulta],
        capture_output=True, text=True)
    linhas = [l for l in saida.stdout.strip().splitlines() if l]
    return linhas[0].split('|') if linhas else None


def envelhecer(carga_id):
    """Faz a ENTRADA ter acontecido ontem, como no relato do gestor."""
    sql("UPDATE fact_viagens SET criado_em = now() - interval '1 day', "
        f"atualizado_em = now() WHERE carga_id = '{carga_id}'")



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
    url = f'{API}/__dataprog_{rotulo}'
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
        ctxP, pgP = await abrir(nav, 'bruno@teste.local', 'portaria')

        placa = await pgP.evaluate(
            "() => { const usadas = new Set(DB.cargas.map((c) => c.placa));"
            "  const f = DB.frota.find((x) => x.placa && x.transportadora && !usadas.has(x.placa));"
            "  return f ? f.placa : null; }")
        ck('placa livre escolhida', bool(placa), str(placa))
        if not placa:
            await nav.close()
            return 1

        print('\n=== 1. A ENTRADA NÃO É PROGRAMAÇÃO ===')
        await pgP.click(".nav-tab[data-tab='portaria']")
        await pgP.fill('#portaria-placa', placa)
        await pgP.click("button:has-text('Chegou')")
        await pgP.wait_for_timeout(4000)

        ctxL, pgL = await abrir(nav, 'ana@teste.local', 'log')
        await pgL.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        await pgL.wait_for_timeout(1500)
        entrada = await pgL.evaluate(
            "(placa) => { const c = DB.cargas.find((x) => x.placa === placa && x.aguardandoCarga);"
            "  return c ? {id: c.id, programadoEm: c.programadoEm || null} : null; }", placa)
        ck('entrada registrada', entrada is not None, str(entrada))
        if not entrada:
            await nav.close()
            return 1
        ck('entrada SEM data de programação',
           not entrada['programadoEm'], str(entrada['programadoEm']))

        print('\n=== 2. O LANÇAMENTO DEFINE A DATA ===')
        # O caso real: o caminhão entrou ONTEM e dormiu no pátio. A entrada
        # é envelhecida NO BANCO (o servidor nunca aceita `criado_em` do
        # cliente, e é justamente essa a diferença que se quer provar).
        envelhecer(entrada['id'])

        ctxL2, pgL2 = await abrir(nav, 'ana@teste.local', 'log2')
        await pgL2.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        await pgL2.wait_for_timeout(1500)

        await pgL2.evaluate(
            """async (id) => {
                 completarCargaAguardando(id, {numeroCarga: 'DATA-1', cliente: 'CLIENTE',
                   destino: 'DESTINO', peso: 1000, rota: '500', operador: 'Ana'});
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
               }""", entrada['id'])
        await pgL2.wait_for_timeout(2500)

        datas = await pgL2.evaluate(
            """(id) => { const c = getCarga(id) || {};
                 const dia = (v) => String(v || '').slice(0, 10);
                 return {prog: dia(c.programadoEm), criado: dia(c.criadoEm),
                         hoje: new Date().toISOString().slice(0, 10)}; }""", entrada['id'])
        ck('a data de programação é HOJE', datas['prog'] == datas['hoje'], str(datas))
        ck('a data de entrada continua sendo a de ontem (é outro fato)',
           datas['criado'] != datas['hoje'], str(datas))

        # E o banco tem que contar a mesma história para todo mundo.
        noBanco = sql(
            "SELECT to_char(criado_em,'YYYY-MM-DD'), to_char(programado_em,'YYYY-MM-DD') "
            f"FROM fact_viagens WHERE carga_id = '{entrada['id']}'")
        ck('no banco: entrada ontem, programação hoje',
           noBanco and noBanco[0] != noBanco[1] and noBanco[1] == datas['hoje'], str(noBanco))

        print('\n=== 3. A CARGA APARECE NO DIA DE HOJE ===')
        # Esta carga NÃO vai para a Fila de Programados — o caminhão já está
        # no pátio ("Aguardando Embarque"), então o lugar dela é a Torre.
        naTorre = await pgL2.evaluate(
            """(id) => { const c = getCarga(id) || {};
                 return c.status === 'Aguardando Embarque' && !c.aguardandoCarga; }""",
            entrada['id'])
        ck('caminhão que já estava no pátio segue na Torre', naTorre)

        noRelatorio = await pgL2.evaluate(
            """(id) => { const hoje = new Date().toISOString().slice(0, 10);
                 return filtrarPorDataProgramacao(DB.cargas, hoje, hoje)
                   .some((c) => c.id === id); }""", entrada['id'])
        ck('entra no filtro do relatório do dia', noRelatorio)

        naoNoDeOntem = await pgL2.evaluate(
            """(id) => { const d = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
                 return !filtrarPorDataProgramacao(DB.cargas, d, d)
                   .some((c) => c.id === id); }""", entrada['id'])
        ck('NÃO entra no relatório de ontem (era o bug)', naoNoDeOntem)

        pgL = pgL2
        print('\n=== 4. A TORRE SEPARA A PROGRAMAÇÃO ANTIGA DA NOVA ===')
        # A mesma carga, agora com a PROGRAMAÇÃO envelhecida: é a sobra do
        # dia anterior que "não passou por todas as etapas".
        sql("UPDATE fact_viagens SET programado_em = now() - interval '1 day', "
            f"atualizado_em = now() WHERE carga_id = '{entrada['id']}'")

        ctxT, pgT = await abrir(nav, 'chefe@teste.local', 'torre')
        await pgT.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        await pgT.wait_for_timeout(1500)
        await pgT.click(".nav-tab[data-tab='torre']")
        await pgT.wait_for_timeout(1200)

        torre = await pgT.evaluate(
            """(id) => {
                 const stats = document.getElementById('torre-stats');
                 const caixa = [...stats.querySelectorAll('.stat-box')].find(
                   (b) => b.textContent.includes('Programação anterior'));
                 const corpo = document.getElementById('torre-tbody');
                 return {
                   temCaixa: !!caixa,
                   contagem: caixa ? Number(caixa.querySelector('.stat-num').textContent) : 0,
                   temFaixa: !!corpo.querySelector('tr.torre-sep'),
                   linhaMarcada: !!corpo.querySelector('tr.linha-prog-antiga'),
                   naTabela: corpo.innerHTML.includes('DATA-1'),
                 };
               }""", entrada['id'])
        ck('caixa "Programação anterior" existe', torre['temCaixa'])
        ck('a sobra de ontem é contada', torre['contagem'] >= 1, str(torre['contagem']))
        ck('a carga de ontem continua na Torre', torre['naTabela'])
        ck('a faixa separa os dois dias', torre['temFaixa'])
        ck('a linha de ontem sai marcada', torre['linhaMarcada'])

        # Clicar na caixa filtra só as sobras — sem misturar com hoje.
        await pgT.evaluate("() => filtrarTorrePorStatus('__PENDENTES_ANTIGAS__')")
        await pgT.wait_for_timeout(800)
        filtrada = await pgT.evaluate(
            """() => { const linhas = [...document.querySelectorAll('#torre-tbody tr')]
                   .filter((l) => !l.classList.contains('torre-sep'));
                 return {total: linhas.length,
                         todasAntigas: linhas.every((l) => l.classList.contains('linha-prog-antiga'))}; }""")
        ck('o filtro mostra só a programação anterior',
           filtrada['total'] > 0 and filtrada['todasAntigas'], str(filtrada))

        await pgL.evaluate(
            """async (id) => { try { await SuincoSharePoint.excluir(id, 'limpeza de teste'); }
                 catch (e) {} }""", entrada['id'])
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
