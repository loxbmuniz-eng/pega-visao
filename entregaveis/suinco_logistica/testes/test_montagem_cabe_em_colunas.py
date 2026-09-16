#!/usr/bin/env python3
"""A Montagem do Dia cabe na tela EM COLUNAS, uma linha por carga.

DUAS ENTREGAS, DOIS RELATOS.

16/09, de manhã — "ta tendo barra de rolagem na montagem do dia, barra de
rolagem lateral". Entregue em DUAS FAIXAS: a linha virava grade, operação
em cima, números embaixo. Publicado.

16/09, à tarde — "nao ficou legal assim com duas linhas, foi reprovado pela
operacao, pode fazer do jeito que estava com as colunas mesmo cabendo na
tela de forma inteligente e organizada".

Então são DUAS exigências ao mesmo tempo, e é por isso que este teste existe:
uma sozinha já foi satisfeita antes e não bastou.

  1. TABELA DE VERDADE, uma linha por carga. O desenho em duas faixas
     escondia o <thead> e punha a <table> em `display:block`. Aqui o
     cabeçalho tem que estar visível e a linha tem que ser uma <tr> só.

  2. SEM BARRA LATERAL no monitor. Nenhum arrasto para ver Destino, KM,
     Frete ou o botão de Ação.

E uma terceira, que é o que impede a correção de virar outro defeito:

  3. NADA SUMIU. As catorze colunas continuam na linha, e os campos que se
     digitam continuam VISÍVEIS — a primeira tentativa desta correção
     cortou a célula com reticências e engoliu o campo da sequência, que é
     o que o dono mais mexe nesta tela.
"""
import asyncio, os, subprocess, sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
falhas = []


def sql(consulta):
    s = subprocess.run(['sudo', '-u', 'postgres', 'psql', '-tAF', '|',
                        '-P', 'pager=off', '-d', 'embarque_suinco', '-c', consulta],
                       capture_output=True, text=True)
    ls = [l for l in s.stdout.strip().splitlines() if l]
    return ls[0].split('|') if ls else None


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


MEDE = """() => {
  const t = document.getElementById('mont-tabela');
  if (!t) return {erro: 'sem #mont-tabela'};
  let rol = t.parentElement;
  while (rol && !['auto','scroll'].includes(getComputedStyle(rol).overflowX))
    rol = rol.parentElement;
  const caixa = rol || t.parentElement;
  const thead = t.querySelector('thead');
  const linhas = [...t.querySelectorAll('tbody tr.mont-linha')];
  const l1 = linhas[0];
  /* Campo VISÍVEL é campo com largura de verdade na tela. Um <input> dentro
     de uma célula cortada por `text-overflow` continua existindo no DOM e
     não serve para ninguém — foi assim que a sequência sumiu. */
  const campo = (sel) => {
    const e = l1 && l1.querySelector(sel);
    if (!e) return 0;
    const r = e.getBoundingClientRect();
    return (r.width >= 24 && r.height >= 12) ? Math.round(r.width) : 0;
  };
  return {
    displayTabela: getComputedStyle(t).display,
    displayCabecalho: thead ? getComputedStyle(thead).display : 'sem-thead',
    colunasNoCabecalho: t.querySelectorAll('thead th').length,
    linhas: linhas.length,
    celulasNaPrimeiraLinha: l1 ? l1.children.length : 0,
    mostra: caixa.clientWidth, precisa: caixa.scrollWidth,
    seq: campo('.seq-input'), numero: campo('.numero-carga-input'),
    placa: campo('.placa-input'), peso: campo('.peso-input'),
    entregas: campo('.entregas-input'), rota: campo('.rota-inline'),
  };
}"""


async def main():
    sql("DELETE FROM programacao_montagem WHERE numero_carga LIKE 'MC-%'")
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        html = open(PAINEL_ARQ, encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = f'{API}/__montagem_colunas'
        # 1280 é o monitor onde o relato nasceu, e onde a conta foi feita:
        # a área útil da tabela ali é de 1.002 px.
        ctx = await nav.new_context(viewport={'width': 1280, 'height': 900})
        pg = await ctx.new_page()
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        await pg.wait_for_selector('#login-email', timeout=25000)
        await pg.fill('#login-email', 'ana@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3000)

        rotas = sql("SELECT string_agg(codigo,'|') FROM (SELECT codigo FROM dim_rotas "
                    "WHERE ativa IS NOT FALSE ORDER BY codigo LIMIT 6) t")
        rotas = rotas[0].split('|') if rotas and rotas[0] else ['500']
        criadas = await pg.evaluate("""async ([rotas]) => {
            /* Os textos têm o COMPRIMENTO do que a operação escreve de
               verdade — é o comprimento que decide a largura da coluna. */
            const mot = ['WESLEY JUNIO BORGES NOGUEIRA','ROOSEVELT MARQUES DA SILVA',
                         'ITALO AUGUSTO MEIRA DA SILVA'];
            let n = 0;
            for (let i = 0; i < 10; i++) {
              try {
                const r = await SuincoSharePoint.montagem.criar({
                  rotaCodigo: rotas[i % rotas.length], numeroCarga: 'MC-' + i,
                  peso: 12345 + i * 137, qtdEntregas: 3 + (i % 9), qtdGanchos: 0,
                  motorista: mot[i % mot.length]});
                if (r && r.montagem) n++;
              } catch (e) {}
            }
            return n;
          }""", [rotas])
        await pg.evaluate("()=>abrirTab('programacao')")
        await pg.wait_for_timeout(2500)
        r = await pg.evaluate(MEDE)

        print('\n=== 1. É TABELA DE COLUNAS, NÃO GRADE DE DUAS FAIXAS ===')
        if r.get('erro'):
            ck('a tabela da Montagem existe na tela', False, r['erro'])
            await nav.close()
            return 1
        ck('a Montagem foi semeada', criadas >= 8, f'{criadas} montagens')
        ck('a <table> continua sendo tabela',
           r['displayTabela'].startswith('table'), r['displayTabela'])
        ck('o cabeçalho das colunas está VISÍVEL',
           r['displayCabecalho'] != 'none', f"display={r['displayCabecalho']}")
        ck('as 14 colunas continuam no cabeçalho',
           r['colunasNoCabecalho'] == 14, f"{r['colunasNoCabecalho']} colunas")
        ck('cada carga é UMA linha, com as 14 células',
           r['celulasNaPrimeiraLinha'] == 14, f"{r['celulasNaPrimeiraLinha']} células")

        print('\n=== 2. CABE NA TELA, SEM ARRASTAR A BARRA ===')
        falta = r['precisa'] - r['mostra']
        ck('nenhuma barra de rolagem lateral no monitor de 1280',
           falta <= 1, f"mostra {r['mostra']}px, precisa {r['precisa']}px "
                       f"(faltam {falta}px)")

        print('\n=== 3. O QUE SE DIGITA CONTINUA VISÍVEL ===')
        # A primeira tentativa desta correção cortava a CÉLULA com
        # reticências — e a célula tem o campo dentro. Medir o campo, e não
        # a coluna, é o que separa "cabe" de "dá para usar".
        for rot, chave in [('sequência', 'seq'), ('número da carga', 'numero'),
                           ('placa', 'placa'), ('peso', 'peso'),
                           ('entregas', 'entregas'), ('seletor de rota', 'rota')]:
            ck(f'o campo de {rot} aparece e dá para clicar',
               r[chave] >= 24, f"{r[chave]}px de largura")

        await nav.close()
    sql("DELETE FROM programacao_montagem WHERE numero_carga LIKE 'MC-%'")
    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
