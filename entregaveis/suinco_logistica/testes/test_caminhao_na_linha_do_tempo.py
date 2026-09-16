#!/usr/bin/env python3
"""O caminhão marca em qual etapa a carga está, na Visão do Pátio.

Pedido do dono: um caminhão no painel, "padrão logística", e ele mandou que
eu fizesse o juízo de onde. A Visão do Pátio é o lugar porque é o único onde
TODA linha é um veículo de verdade parado no pátio agora — na Montagem do Dia
a linha nasce sem placa, e desenhar caminhão para carga sem veículo seria
mostrar na tela o que não existe.

O QUE ESTE TESTE TRAVA, e por que cada conferência existe:

  1. O caminhão está na etapa ATUAL, e só nela. Se ele vazar para as
     cumpridas ou pendentes, deixa de ser posição e vira papel de parede.

  2. As marcas de texto `✓` e `·` SOBREVIVEM. Este painel decidiu que
     nenhuma informação depende só de cor; trocar as marcas por desenho
     seria trocar acessibilidade por enfeite. O desenho entrou no lugar de
     UMA marca, não das seis.

  3. A COR do caminhão é a da etapa, herdada por `currentColor`. As cores
     daqui são calibradas por teste de contraste, com dois achados escritos
     na folha de estilo. Uma cor própria para o caminhão seria uma terceira
     decisão para manter em dia — e a que sairia de dia primeiro.

  4. A TRILHA NÃO ENGORDOU. O argumento inteiro de pôr o caminhão aqui é
     que ele substitui a marca que já estava lá e custa zero de largura. Se
     a trilha crescer, o argumento caiu e a coluna rouba espaço de quem
     precisa. Esta é a conferência que impede a boa ideia de virar defeito.
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


# O pátio é semeado no próprio painel: a Visão do Pátio lê DB.cargas e monta
# as etapas a partir de DB.movimentacoes. Cada carga para numa etapa
# diferente — é o que permite conferir que o caminhão ACOMPANHA a etapa em
# vez de ficar sempre no mesmo lugar.
SEMEAR = """() => {
  const agora = new Date();
  const h = (min) => new Date(agora.getTime() - min * 60000).toISOString();
  const FLUXO = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
                 'Embarque Finalizado','Faturado'];
  const dados = [
    {p:'RTA7C41', n:'CT-1', t:'Transportadora Vale Norte', r:'519', ate:1},
    {p:'QWE2D88', n:'CT-2', t:'Log Sul Express',           r:'500', ate:3},
    {p:'MNB9F03', n:'CT-3', t:'Cooperativa Unidos',        r:'525', ate:0},
    {p:'JKL5A20', n:'CT-4', t:'Rodoflex Cargas',           r:'501', ate:4}];
  DB.cargas = []; DB.movimentacoes = [];
  dados.forEach((d, i) => {
    const id = 'ct' + i;
    DB.cargas.push({id, numeroCarga:d.n, placa:d.p, transportadora:d.t, rota:d.r,
      status:FLUXO[d.ate], sequencia:i+1,
      dataProgramacao: agora.toISOString().slice(0,10),
      criadaEm:h(400), atualizadaEm:h(20)});
    for (let k = 0; k <= d.ate; k++)
      DB.movimentacoes.push({cargaId:id, status:FLUXO[k], quando:h(360-k*55), operador:'Ana'});
  });
  if (window.renderTorre) renderTorre();
  if (window.renderVisaoPatio) renderVisaoPatio('torre');
  return DB.cargas.length;
}"""

OLHAR = """() => {
  const linhas = [...document.querySelectorAll('#torre-vp-tbody tr')]
    .filter(tr => tr.querySelector('.et-linha'));
  return linhas.map(tr => {
    const selos = [...tr.querySelectorAll('.et-mini')];
    return {
      total: selos.length,
      /* Em qual selo está o caminhão, e em qual está a marca de "agora". */
      camEm: selos.findIndex(s => s.querySelector('.et-cam')),
      atualEm: selos.findIndex(s => s.classList.contains('et-mini-atual')),
      cams: selos.filter(s => s.querySelector('.et-cam')).length,
      vistos: selos.filter(s => (s.textContent || '').includes('✓')).length,
      pontos: selos.filter(s => (s.textContent || '').includes('·')).length,
      /* O ponto preto `●` não pode ter sobrado em lugar nenhum. */
      bolinhas: selos.filter(s => (s.textContent || '').includes('●')).length,
      larguraTrilha: Math.round(tr.querySelector('.et-linha').getBoundingClientRect().width),
      corCam: (() => { const c = tr.querySelector('.et-cam');
        return c ? getComputedStyle(c.parentElement).color : null; })(),
      corSelo: (() => { const s = selos[selos.findIndex(x => x.classList.contains('et-mini-atual'))];
        return s ? getComputedStyle(s.querySelector('b')).color : null; })(),
      tamCam: (() => { const c = tr.querySelector('.et-cam');
        if (!c) return null; const r = c.getBoundingClientRect();
        return {l: Math.round(r.width), a: Math.round(r.height)}; })(),
    };
  });
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        html = open(PAINEL_ARQ, encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = f'{API}/__caminhao'
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
        await pg.wait_for_timeout(1500)
        linhas = await pg.evaluate(OLHAR)

        print('\n=== 1. O CAMINHÃO ESTÁ NA ETAPA DE AGORA ===')
        ck('o pátio foi semeado e a Visão do Pátio desenhou', len(linhas) >= 4,
           f'{n} cargas, {len(linhas)} linhas na trilha')
        if not linhas:
            await nav.close()
            return 1
        ck('toda linha tem UM caminhão, nem zero nem dois',
           all(l['cams'] == 1 for l in linhas), str([l['cams'] for l in linhas]))
        ck('o caminhão está exatamente no selo da etapa atual',
           all(l['camEm'] == l['atualEm'] and l['camEm'] >= 0 for l in linhas),
           str([(l['camEm'], l['atualEm']) for l in linhas]))
        # As quatro cargas param em etapas DIFERENTES: se o caminhão ficasse
        # sempre no mesmo lugar, a posição não seria informação nenhuma.
        ck('e ele ACOMPANHA a etapa — as posições são diferentes entre as cargas',
           len(set(l['camEm'] for l in linhas)) >= 3,
           str(sorted(l['camEm'] for l in linhas)))
        ck('nenhuma bolinha ● sobrou na trilha',
           all(l['bolinhas'] == 0 for l in linhas), str([l['bolinhas'] for l in linhas]))

        print('\n=== 2. AS MARCAS DE TEXTO SOBREVIVERAM ===')
        # A etapa 0 não tem nenhuma cumprida antes dela; as outras têm.
        ck('as etapas cumpridas continuam marcadas com ✓',
           all(l['vistos'] == l['camEm'] for l in linhas),
           str([(l['vistos'], l['camEm']) for l in linhas]))
        ck('as etapas que faltam continuam marcadas com ·',
           all(l['pontos'] == l['total'] - l['camEm'] - 1 for l in linhas),
           str([l['pontos'] for l in linhas]))

        print('\n=== 3. A COR VEM DA ETAPA, NÃO DO CAMINHÃO ===')
        ck('o caminhão herda a cor calibrada do selo da etapa atual',
           all(l['corCam'] and l['corCam'] == l['corSelo'] for l in linhas),
           str([(l['corCam'], l['corSelo']) for l in linhas[:1]]))

        print('\n=== 4. A TRILHA NÃO ENGORDOU ===')
        # O argumento inteiro é que o caminhão custa ZERO de largura. Seis
        # selos de min-width 26px + 5 vãos de 3px + padding: a trilha não
        # pode passar disso. O caminhão tem 17px e cabe dentro do selo.
        largura = max(l['larguraTrilha'] for l in linhas)
        ck('a trilha continua estreita — o caminhão coube no selo',
           largura <= 260, f'{largura}px de trilha (teto 260px)')
        tam = linhas[0]['tamCam']
        ck('o caminhão tem tamanho de marca, não de ilustração',
           tam and 12 <= tam['l'] <= 22 and 6 <= tam['a'] <= 14, str(tam))

        await nav.close()
    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
