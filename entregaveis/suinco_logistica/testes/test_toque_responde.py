#!/usr/bin/env python3
"""O que se clica responde ao dedo — e a resposta não apaga estado.

DE ONDE VEIO. Varri o painel no navegador perguntando quais seletores
declaram `:active`. A resposta eram DOIS: `.btn` e `.alca-arrastar`. E
contei quem aceita clique no HTML gerado:

    button ... 159   respondiam
    td .......  22   MUDOS
    div ......  13   MUDOS      <- as caixas de filtro da Torre
    th .......   6   MUDOS
    tr .......   4   MUDOS      <- a linha da Montagem, que abre ao clique
    span .....   1   MUDO

Quarenta e seis clicáveis sem sinal nenhum de que ouviram. O comentário da
própria folha de estilo já dizia por que isso importa: "no celular não
existe hover, e sem resposta visual o operador aperta duas vezes achando que
não pegou". Estava escrito para o botão e nunca chegou no resto.

POR QUE FORÇAR O ESTADO EM VEZ DE APERTAR COM O PONTEIRO. Apertar com o
ponteiro no navegador sem tela NÃO põe `:active` numa <tr> — medido, dá
False. Um teste assim mediria o Playwright, não a regra. `CSS.forcePseudoState`
põe o estado direto no elemento, que é o que a regra precisa para valer.

A SEGUNDA CONFERÊNCIA É A QUE IMPORTA MAIS. Três tentativas de pintar a
caixa da Torre apagaram o ANEL DOURADO que marca qual filtro está ativo.
Resposta ao toque que apaga estado é pior que toque mudo: a pessoa perde a
informação de onde está. Por isso aqui não basta "mudou" — o estado de
antes tem que sobreviver ao toque.
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


LER = """(sel)=>{
  const e = document.querySelector(sel);
  if (!e) return null;
  /* Numa <tr> quem pinta é a célula; o resto pinta em si mesmo. */
  const alvo = e.tagName === 'TR' ? (e.children[2] || e) : e;
  const c = getComputedStyle(alvo);
  return {transform:c.transform, fundo:c.backgroundColor, sombra:c.boxShadow};
}"""


async def apertado(pg, cdp, sel):
    """Lê o elemento em repouso e com :active forçado."""
    antes = await pg.evaluate(LER, sel)
    if antes is None:
        return None, None
    doc = await cdp.send('DOM.getDocument')
    no = await cdp.send('DOM.querySelector', {'nodeId': doc['root']['nodeId'], 'selector': sel})
    await cdp.send('CSS.forcePseudoState',
                   {'nodeId': no['nodeId'], 'forcedPseudoClasses': ['active']})
    await pg.wait_for_timeout(200)
    durante = await pg.evaluate(LER, sel)
    await cdp.send('CSS.forcePseudoState', {'nodeId': no['nodeId'], 'forcedPseudoClasses': []})
    return antes, durante


async def main():
    sql("DELETE FROM programacao_montagem WHERE numero_carga LIKE 'TQ-%'")
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        html = open(PAINEL_ARQ, encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = f'{API}/__toque'
        ctx = await nav.new_context(viewport={'width': 1280, 'height': 900})
        pg = await ctx.new_page()
        cdp = await ctx.new_cdp_session(pg)
        await cdp.send('DOM.enable')
        await cdp.send('CSS.enable')
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        await pg.wait_for_selector('#login-email', timeout=25000)
        await pg.fill('#login-email', 'ana@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3500)

        print('\n=== 1. A TORRE RESPONDE AO DEDO ===')
        await pg.evaluate("()=>abrirTab('torre')")
        await pg.wait_for_timeout(1600)

        antes, dur = await apertado(pg, cdp, '.stat-box.stat-clicavel')
        ck('a caixa de filtro da Torre existe na tela', antes is not None)
        if antes:
            ck('a caixa de filtro RESPONDE ao toque', antes != dur,
               f"repouso={antes['transform']} apertado={dur['transform']}")
            ck('e a resposta é encolher, como o botão',
               dur['transform'] != 'none' and dur['transform'] != antes['transform'],
               dur['transform'])
            # A CONFERÊNCIA QUE NASCEU DE UM DEFEITO MEU: três tentativas de
            # pintar esta caixa apagaram o anel da caixa que está filtrando.
            ck('o anel da caixa ativa SOBREVIVE ao toque',
               dur['sombra'] == antes['sombra'],
               f"repouso={antes['sombra'][:34]} / apertado={dur['sombra'][:34]}")

        antes, dur = await apertado(pg, cdp, '.nav-tab')
        ck('a aba do menu existe', antes is not None)
        if antes:
            ck('a aba RESPONDE ao toque', antes != dur)
            # Frequência manda: a aba é a coisa mais apertada do painel. A
            # regra é quanto mais vezes por dia, menos movimento — então ela
            # acende, não encolhe.
            ck('a aba NÃO encolhe (é a mais apertada do dia)',
               dur['transform'] == antes['transform'], dur['transform'])

        antes, dur = await apertado(pg, cdp, '.btn')
        if antes:
            ck('o botão continua respondendo como antes', antes != dur)

        print('\n=== 2. A LINHA DA MONTAGEM RESPONDE AO DEDO ===')
        rotas = sql("SELECT string_agg(codigo,'|') FROM (SELECT codigo FROM dim_rotas "
                    "WHERE ativa IS NOT FALSE ORDER BY codigo LIMIT 3) t")
        rotas = rotas[0].split('|') if rotas and rotas[0] else ['500']
        await pg.evaluate("""async ([r]) => {
            for (let i = 0; i < 3; i++) {
              try { await SuincoSharePoint.montagem.criar({
                rotaCodigo: r[i % r.length], numeroCarga: 'TQ-' + i,
                peso: 12000, qtdEntregas: 3}); } catch (e) {}
            }}""", [rotas])
        await pg.evaluate("()=>abrirTab('programacao')")
        await pg.wait_for_timeout(2600)

        antes, dur = await apertado(pg, cdp, 'tr.mont-linha')
        ck('há linha na Montagem do Dia', antes is not None)
        if antes:
            ck('a linha da Montagem RESPONDE ao toque', antes != dur,
               f"repouso={antes['fundo']} apertado={dur['fundo']}")
            # Numa <tr> o `transform` tem comportamento inconsistente entre
            # navegadores e cria bloco de contenção que bagunça tabela.
            ck('e responde com COR, não mexendo em layout',
               dur['fundo'] != antes['fundo'] and dur['transform'] == antes['transform'],
               f"fundo={dur['fundo']} transform={dur['transform']}")

        print('\n=== 3. NINGUÉM FICOU MUDO ===')
        mudos = await pg.evaluate("""() => {
            const comAtivo = new Set();
            const anda = (l) => { for (const x of l) {
              if (x.cssRules && x.cssRules.length) { anda(x.cssRules); continue; }
              if (x.selectorText && x.selectorText.includes(':active')) comAtivo.add(x.selectorText);
            }};
            for (const f of document.styleSheets) { try { anda(f.cssRules); } catch (e) {} }
            return comAtivo.size;
          }""")
        # Eram DOIS seletores no painel inteiro antes desta mudança.
        ck('o painel declara resposta ao toque em mais de 2 seletores',
           mudos > 2, f'{mudos} seletores com :active')

        await nav.close()
    sql("DELETE FROM programacao_montagem WHERE numero_carga LIKE 'TQ-%'")
    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
