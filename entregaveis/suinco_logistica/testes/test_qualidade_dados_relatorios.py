#!/usr/bin/env python3
"""Auditoria de qualidade de dados em TODOS os relatórios. (21/08/2026)

Pedido do gestor: "todos os relatórios precisam estar intactos na
qualidade de dados".

O método: monta uma carga com TODOS os campos preenchidos (3 lacres,
lacre retido com motivo, chegada pela Portaria, ciclo completo) e uma
devolução completa (Nº DEV, carga do SIS ATAK, cliente com nome, item
parcial por extenso), captura o HTML exato que cada relatório mandaria
para o papel — interceptando exportarViaServidor e baixarArquivoTexto —
e audita cada um:

  · caça lixo de programação: undefined, NaN, [object, null solto;
  · confere que os campos de negócio chegaram inteiros no documento.

    python3 testes/test_qualidade_dados_relatorios.py
"""
import asyncio
import os
import re
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


# Lixo de programação que nunca pode chegar ao papel. O texto legítimo do
# painel não usa nenhuma dessas palavras: se aparecem, um campo vazou cru.
LIXO = re.compile(r'\bundefined\b|\bNaN\b|\[object |>null<|\bInvalid Date\b')


def auditar_lixo(nome, html):
    achados = LIXO.findall(html or '')
    ck(f'{nome}: sem undefined/NaN/[object/null', not achados,
       f'{achados[:3]} em {len(html or "")} bytes')


async def abrir(nav, email, rotulo):
    ctx = await nav.new_context()
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__qualidade_{rotulo}'
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

        # Limpeza de execuções anteriores, ANTES de qualquer login.
        sql("DELETE FROM fact_statusfrota WHERE placa IN "
            "(SELECT placa FROM fact_viagens WHERE numero_carga = 'QLD-1')")
        sql("DELETE FROM fact_viagens WHERE numero_carga = 'QLD-1'")
        sql("DELETE FROM devolucao_itens WHERE num_dev = '77441'")

        print('\n=== 0. MATÉRIA-PRIMA: UMA CARGA E UMA DEVOLUÇÃO COMPLETAS ===')
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

        cargaId = await pgL.evaluate(
            """async (placa) => {
                 await SuincoSharePoint.sincronizarAgora();
                 const c = criarCargaProgramada({numeroCarga: 'QLD-1', placa,
                   cliente: 'Kid Lanches', destino: 'Patos de Minas', peso: 12345,
                   rota: '500', operador: 'Ana', qtdEntregas: 3,
                   observacoes: 'Observacao de auditoria de dados'});
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
                 return c.id;
               }""", placa)

        # Chegada REAL pela Portaria — é ela que cria o fato "entrada no
        # pátio" que os relatórios precisam distinguir da data de criação.
        # Cada passo é confirmado no SERVIDOR (lição do teste do Raio-X: a
        # tela é otimista e clicar rápido demais corre contra a fila).
        def status_srv():
            r = sql(f"SELECT status_atual FROM fact_viagens WHERE carga_id = '{cargaId}'")
            return r[0] if r else None

        ctxP, pgP = await abrir(nav, 'bruno@teste.local', 'portaria')
        await pgP.click(".nav-tab[data-tab='portaria']")
        for _ in range(5):
            await pgP.fill('#portaria-placa', placa)
            await pgP.click("button:has-text('Chegou')")
            await pgP.wait_for_timeout(1800)
            if status_srv() == 'Aguardando Embarque':
                break
        ck('a chegada chegou ao servidor', status_srv() == 'Aguardando Embarque',
           str(status_srv()))

        CADEIA = ['Aguardando Embarque', 'Embarque Iniciado', 'Embarque Finalizado', 'Faturado']
        for _ in range(20):
            atual = status_srv()
            if atual == 'Faturado':
                break
            if atual in CADEIA[:-1]:
                await pgL.evaluate(
                    "([id, s]) => SuincoSharePoint.mudarStatus(id, s)",
                    [cargaId, CADEIA[CADEIA.index(atual) + 1]])
            await pgL.wait_for_timeout(400)
        ck('a carga chegou a Faturado no servidor', status_srv() == 'Faturado',
           str(status_srv()))

        # Saída com os TRÊS lacres, e depois a retenção com motivo.
        await pgP.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        for _ in range(5):
            await pgP.fill('#portaria-placa', placa)
            await pgP.fill('#portaria-lacre', '111001')
            await pgP.fill('#portaria-lacre-2', '111002')
            await pgP.fill('#portaria-lacre-3', '111003')
            await pgP.click("button:has-text('Saiu')")
            await pgP.wait_for_timeout(1800)
            if status_srv() == 'Seguiu Viagem':
                break
        for _ in range(5):
            await pgP.fill('#lacre-ret-placa', placa)
            await pgP.fill('#lacre-ret-numero', '111001')
            await pgP.fill('#lacre-ret-novo', '999001')
            await pgP.fill('#lacre-ret-motivo', 'conferencia da auditoria')
            await pgP.click("button:has-text('Registrar retenção')")
            await pgP.wait_for_timeout(1800)
            r = sql(f"SELECT lacre_retido FROM fact_viagens WHERE carga_id = '{cargaId}'")
            if r and r[0] == '111001':
                break

        noBanco = sql(f"SELECT status_atual, lacre, lacre_2, lacre_3, lacre_retido, "
                      f"lacre_retido_motivo FROM fact_viagens WHERE carga_id = '{cargaId}'")
        ck('a carga completou o ciclo com lacres e retenção no banco',
           noBanco and noBanco[0] == 'Seguiu Viagem' and noBanco[4] == '111001',
           str(noBanco))

        # A devolução completa: Nº DEV das meninas, carga do SIS ATAK pela
        # Portaria, cliente com nome, item PARCIAL com descrição.
        dev = await pgL.evaluate(
            """async () => {
                 const hoje = new Date().toISOString().slice(0, 10);
                 const d = await SuincoSharePoint.devolucoes.criar({
                   dataDev: hoje, rotas: ['500'], regiao: 'Patos de Minas',
                   operadorCodigo: '82205', itens: [],
                 });
                 const i = await SuincoSharePoint.devolucoes.criarItem(d.id, {
                   nota: '778899', cx: 4, numDev: '77441', motivo: '602',
                   codCliente: '417300', codProduto: '30110',
                   parcial: 1, parcialDesc: '2 caixas avariadas',
                 });
                 return {id: d.id, itemId: i.itemId, clienteNome: i.clienteNome,
                         produtoNome: i.produtoNome};
               }""")
        ck('o servidor completou o NOME do cliente a partir do código',
           bool(dev.get('clienteNome')), str(dev))
        await pgP.evaluate(
            """async ({id, itemId}) => {
                 await SuincoSharePoint.devolucoes.editar(id, {cargaNumero: '224466'});
                 await SuincoSharePoint.devolucoes.editarItem(id, itemId, {cargaDev: '224466'});
               }""", {'id': dev['id'], 'itemId': dev['itemId']})

        print('\n=== 1. CAPTURA DO QUE CADA RELATÓRIO MANDA PARA O PAPEL ===')
        ctxA, pgA = await abrir(nav, 'chefe@teste.local', 'adm')
        await pgA.evaluate(
            """async () => {
                 await SuincoSharePoint.sincronizarAgora();
                 window.__cap = {};
                 exportarViaServidor = async (el, nome) => { window.__cap[nome] = el.outerHTML; };
                 baixarArquivoTexto = (nome, conteudo) => { window.__cap[nome] = conteudo; };
                 baixarCsvCadastro = (nome, cab, linhas) => {
                   window.__cap[nome] = [cab, ...linhas].map((l) => l.join(';')).join('\\n');
                 };
                 // O comprovante e a relação do operador leem o estado das
                 // devoluções desta página — que só carrega ao abrir a aba.
                 await carregarDevolucoes();
               }""")

        async def gerar(nome, js, arg=None):
            try:
                await pgA.evaluate(js, arg)
            except Exception as e:
                ck(f'{nome}: gera sem erro', False, str(e)[:160])
                return None
            cap = await pgA.evaluate('() => window.__cap')
            for chave, html in (cap or {}).items():
                if nome.lower().split()[0] in chave.lower() or len(cap) == 1:
                    await pgA.evaluate('() => { window.__cap = {}; }')
                    ck(f'{nome}: gera sem erro', True)
                    return html
            await pgA.evaluate('() => { window.__cap = {}; }')
            ck(f'{nome}: gera sem erro', False, f'nada capturado ({list((cap or {}).keys())})')
            return None

        print('\n=== 2. RELATÓRIO OPERACIONAL ===')
        h = await gerar('Relatorio-Operacional', 'async () => { await exportarPdfOperacional(); }')
        if h:
            auditar_lixo('Operacional', h)
            ck('Operacional: traz a carga QLD-1', 'QLD-1' in h)
            ck('Operacional: traz a placa', placa in h)
            ck('Operacional: traz o bloco de lacres', 'lacre' in h.lower())
            ck('Operacional: traz o lacre vigente pós-retenção', '999001' in h)
            ck('Operacional: traz o retido com motivo',
               '111001' in h and 'conferencia da auditoria' in h)

        print('\n=== 3. RELATÓRIO EXECUTIVO ===')
        h = await gerar('Relatorio-Executivo', 'async () => { await exportarPdfExecutivo(); }')
        if h:
            auditar_lixo('Executivo', h)

        print('\n=== 4. ADMINISTRAÇÃO DE FRETES ===')
        h = await gerar('Administracao-de-Fretes', 'async () => { await exportarPdfFretes(); }')
        if h:
            auditar_lixo('Fretes', h)
            ck('Fretes: traz a carga QLD-1 com a observação',
               'QLD-1' in h and 'Observacao de auditoria' in h)
            # PLACA — pedido do dono (25/08/2026): "está faltando uma coluna
            # placa". Quem confere frete negocia com a TRANSPORTADORA, e é a
            # placa que liga a linha ao veículo que rodou; o número da carga
            # é o índice do sistema, não o que se fala no telefone.
            ck('Fretes: tem a coluna Placa no cabeçalho', '>Placa<' in h,
               'cabeçalho sem a coluna')
            ck('Fretes: e a placa da carga aparece na linha', placa in h,
               f'esperava {placa}')

        print('\n=== 5. RELATÓRIO INDIVIDUAL DA CARGA ===')
        h = await gerar('Carga', 'async (id) => { await relatorioDaCargaUI(id); }', cargaId)
        if h:
            auditar_lixo('Carga individual', h)
            ck('Carga: identifica a carga e a placa', 'QLD-1' in h and placa in h)
            ck('Carga: linha do tempo desenhada', 'pdf-timeline' in h or 'pdf-tl' in h)
            ck('Carga: as datas têm nomes distintos (entrada ≠ criação)',
               'Entrada no pátio' in h and 'criado' in h.lower())
            ck('Carga: lacres da saída presentes',
               '111002' in h and '111003' in h)
            ck('Carga: retenção com motivo presente',
               '111001' in h and 'conferencia da auditoria' in h)

        print('\n=== 6. COMPROVANTE DA DEVOLUÇÃO (PORTARIA) ===')
        h = await gerar('Comprovante', 'async (id) => { await comprovantePortariaUI(id); }',
                        dev['id'])
        if h:
            auditar_lixo('Comprovante devolução', h)
            ck('Comprovante: Nº DEV e Nº da carga convivem',
               '77441' in h and '224466' in h)

        print('\n=== 7. RELATÓRIO DE DEVOLUÇÕES DO DIA ===')
        h = await gerar('Devolucoes', 'async () => { await relatorioDevolucoesUI(); }')
        if h:
            auditar_lixo('Devoluções do dia', h)
            ck('Devoluções: nome do cliente sai junto do código',
               'Kid Lanches' in h, '(esperava "Kid Lanches" para 417300)')
            ck('Devoluções: PARCIAL por extenso (não abreviado)', 'PARCIAL' in h)
            ck('Devoluções: descrição do parcial presente', '2 caixas avariadas' in h)
            ck('Devoluções: nome do produto sai junto do código',
               'LINGUIÇA' in h or 'LINGUICA' in h)
            ck('Devoluções: Nº da carga do SIS ATAK presente', '224466' in h)

        print('\n=== 8. RELATÓRIO POR OPERADOR ===')
        h = await gerar('Operador',
                        'async (id) => { await relatorioOperadorDevolucoesUI(id); }', dev['id'])
        if h:
            auditar_lixo('Devolução por operador', h)
            ck('Operador: Nº DEV presente', '77441' in h)

        print('\n=== 9. EXPORTAÇÕES CSV ===')
        for nome, fn in [('Frota', 'exportarFrotaCsv'), ('Rotas', 'exportarRotasCsv'),
                         ('Transportadoras', 'exportarTransportadorasCsv')]:
            h = await gerar(nome, f'() => {{ {fn}(); }}')
            if h:
                auditar_lixo(f'CSV {nome}', h)
        # Os downloads do Power BI saem escalonados (setTimeout de 250 ms por
        # arquivo) — a leitura da captura precisa esperar todos caírem.
        await pgA.evaluate('() => { window.__cap = {}; exportarCsvPowerBI(); }')
        await pgA.wait_for_timeout(2500)
        cap = await pgA.evaluate('() => { const c = window.__cap; window.__cap = {}; return c; }')
        ck('PowerBI: os 5 CSVs saem', len(cap or {}) >= 5, str(list((cap or {}).keys())))
        for nome, conteudo in (cap or {}).items():
            auditar_lixo(f'PowerBI {nome}', conteudo)
        # Dim_Transportadora lia a lista legada (vazia) em vez da frota viva:
        # a dimensão saía sem linhas e o cruzamento no Power BI não fechava.
        transp = (cap or {}).get('Dim_Transportadora.csv', '')
        ck('PowerBI: Dim_Transportadora tem linhas (derivada da frota)',
           len(transp.splitlines()) > 5, f'{len(transp.splitlines())} linha(s)')

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
