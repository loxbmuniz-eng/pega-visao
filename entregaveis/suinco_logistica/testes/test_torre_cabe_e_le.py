#!/usr/bin/env python3
"""A Torre de Controle cabe na tela, e o status continua legível por inteiro.

O relato do dono foi GERAL: "tem hora que tem rolagem lateral sim e precisa
mover a barra pra ver o resto das informações, queria que não tivesse isso
em lugar nenhum". Eu consertei a Montagem do Dia e DEIXEI A TORRE PARA TRÁS
— que é a tela que mais gente abre. Medido, com 14 cargas em 1280:

    mostra 1.002 px · a tabela pedia 1.193 px · faltavam 191 px

A SEGUNDA CONFERÊNCIA É A QUE IMPORTA MAIS, e ela nasceu de um erro meu.
A primeira repartição de largura deu 120 px ao Status, a régua disse que
cabia, e o print mostrou o selo saindo como "AGUARDAND…". Isso pode ser
"Aguardando Veículo" ou "Aguardando Embarque" — duas etapas diferentes, de
setores diferentes. Coluna que corta no meio de um nome ambíguo não
economiza largura: troca largura por dúvida.

Por isso aqui não basta "cabe". O nome do status tem que aparecer INTEIRO,
e é isso que impede a próxima pessoa de resolver uma rolagem espremendo a
coluna errada.

A terceira trava a caixa zerada: ela recolhe, mas NÃO some — "pátio não se
apaga" vale para o indicador também — e o número-herói nunca recolhe,
porque zero em "Seguiu Viagem hoje" às sete da manhã é resposta, não
ausência de informação.
"""
import asyncio, os, sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


# Catorze cargas paradas em etapas diferentes, com textos do comprimento que
# a operação escreve de verdade — é o comprimento que decide a largura.
SEMEAR = """() => {
  const ag = new Date(), h = (m) => new Date(ag.getTime() - m*60000).toISOString();
  const F = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
             'Embarque Finalizado','Faturado'];
  const tr = ['BAIXOTES TRANSPORTE','AJB TRANSPORTES','MARQUES E SILVA','COOPEDIESEL'];
  const mo = ['WESLEY JUNIO BORGES NOGUEIRA','ROOSEVELT MARQUES DA SILVA',
              'ITALO AUGUSTO MEIRA DA SILVA'];
  const ro = [['519','Brasília'],['500','Patos de Minas'],['525','Bahia Capital'],
              ['538','São Paulo Interior · Marília']];
  const op = ['CROSS-DOCKING','ENTREGA DIRETA','RET FRIGO'];
  DB.cargas = []; DB.movimentacoes = [];
  for (let i = 0; i < 14; i++) {
    const id = 'tz' + i, e = [1,2,3,4][i % 4], r = ro[i % ro.length];
    DB.cargas.push({id, numeroCarga:String(118400+i), placa:'RNT5J0'+(i%10),
      transportadora:tr[i%tr.length], motorista:mo[i%mo.length],
      rota:r[0], rotaNome:r[1], pesoKg:12345+i*137, paletes:28,
      tipoVeiculo:'Carreta', tipoOperacao:op[i%op.length], ganchos:0,
      entregas:3+(i%9), status:F[e], sequencia:i+1,
      dataProgramacao:ag.toISOString().slice(0,10), criadaEm:h(400), atualizadaEm:h(20)});
    for (let k = 0; k <= e; k++)
      DB.movimentacoes.push({cargaId:id, status:F[k], quando:h(360-k*55), operador:'Ana'});
  }
  if (window.renderTorre) renderTorre();
  return DB.cargas.length;
}"""

OLHAR = """() => {
  /* Acha a tabela pelo id, e sem ele pelo cabeçalho — que existe desde
     sempre. Sem essa volta, contra o painel publicado o teste reprovaria
     por não achar a tabela, ANTES de medir a rolagem e o selo cortado, que
     são o defeito de verdade. Guarda que reprova pelo motivo errado não
     prova nada. */
  const cab = document.getElementById('torre-thead');
  const t = document.getElementById('torre-tabela')
        || (cab && cab.closest('table'));
  if (!t) return {erro:'não achei a tabela da Torre'};
  let rol = t.parentElement;
  while (rol && !['auto','scroll'].includes(getComputedStyle(rol).overflowX))
    rol = rol.parentElement;
  const caixa = rol || t.parentElement;
  const selos = [...t.querySelectorAll('tbody .badge')];
  const caixas = [...document.querySelectorAll('#torre-stats .stat-box')].map(b => ({
    rot: (b.querySelector('.stat-label') || {}).textContent || '',
    num: (b.querySelector('.stat-num') || {}).textContent || '',
    destaque: b.classList.contains('stat-destaque'),
    zerada: b.classList.contains('stat-zerada'),
    opac: Number(getComputedStyle(b).opacity),
    visivel: b.getBoundingClientRect().width > 20,
    clicavel: b.classList.contains('stat-clicavel'),
  }));
  return {
    mostra: caixa.clientWidth, precisa: caixa.scrollWidth,
    colunas: t.querySelectorAll('thead th').length,
    linhas: t.querySelectorAll('tbody tr').length,
    /* Selo CORTADO é selo cujo conteúdo não coube na caixa dele. */
    selos: selos.map(s => ({
      txt: s.textContent.trim(),
      cortado: s.scrollWidth > s.clientWidth + 1 || s.scrollHeight > s.clientHeight + 1,
    })),
    caixas,
  };
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        html = open(PAINEL_ARQ, encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = f'{API}/__torre_cabe'
        # 1280 é o monitor onde o relato nasceu: área útil de 1.002 px.
        ctx = await nav.new_context(viewport={'width': 1280, 'height': 900})
        pg = await ctx.new_page()
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        await pg.wait_for_selector('#login-email', timeout=25000)
        await pg.fill('#login-email', 'ana@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3500)
        await pg.evaluate("()=>abrirTab('torre')")
        await pg.wait_for_timeout(1500)
        n = await pg.evaluate(SEMEAR)
        await pg.wait_for_timeout(1800)
        r = await pg.evaluate(OLHAR)
        if r.get('erro'):
            ck('a tabela da Torre existe', False, r['erro'])
            await nav.close()
            return 1

        print('\n=== 1. A TORRE CABE NA TELA ===')
        ck('o pátio foi semeado e a Torre desenhou', r['linhas'] >= 10,
           f"{n} cargas, {r['linhas']} linhas")
        ck('as doze colunas continuam na tabela', r['colunas'] == 12,
           f"{r['colunas']} colunas")
        falta = r['precisa'] - r['mostra']
        ck('nenhuma barra de rolagem lateral no monitor de 1280',
           falta <= 1, f"mostra {r['mostra']}px, precisa {r['precisa']}px (faltam {falta}px)")

        print('\n=== 2. O NOME DO STATUS APARECE INTEIRO ===')
        # A conferência que nasceu de um erro meu: a régua dizia que cabia e
        # o selo saía "AGUARDAND…", que pode ser Veículo ou Embarque.
        ck('há selo de status nas linhas', len(r['selos']) > 0, f"{len(r['selos'])} selos")
        cortados = [s['txt'] for s in r['selos'] if s['cortado']]
        ck('nenhum selo de status está cortado',
           not cortados, f"cortados: {cortados[:3]}")
        ambiguos = [s['txt'] for s in r['selos'] if s['txt'].rstrip('.…').strip() == 'AGUARDAND'
                    or s['txt'].endswith('…') or s['txt'].endswith('...')]
        ck('e nenhum termina em reticências',
           not ambiguos, f"{ambiguos[:3]}")

        print('\n=== 3. A CAIXA ZERADA RECOLHE, MAS NÃO SOME ===')
        zeradas = [b for b in r['caixas'] if b['zerada'] and not b['destaque']]
        ck('as caixas de status em zero estão marcadas',
           len(zeradas) >= 1, f'{len(zeradas)} zeradas de {len(r["caixas"])} caixas')
        if zeradas:
            ck('elas ficam mais discretas', all(b['opac'] < 1 for b in zeradas),
               str([b['opac'] for b in zeradas]))
            # "Pátio não se apaga" vale para o indicador: recolher não é sumir.
            ck('mas CONTINUAM na tela e clicáveis',
               all(b['visivel'] and b['clicavel'] for b in zeradas),
               str([(b['visivel'], b['clicavel']) for b in zeradas]))
        herois = [b for b in r['caixas'] if b['destaque']]
        ck('os números-herói existem', len(herois) == 2, f'{len(herois)} caixas de destaque')
        # Zero em "Seguiu Viagem hoje" às sete da manhã é RESPOSTA.
        ck('o número-herói NUNCA recolhe, nem valendo zero',
           all(b['opac'] >= 1 for b in herois),
           str([(b['rot'][:22], b['num'], b['opac']) for b in herois]))

        await nav.close()
    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
