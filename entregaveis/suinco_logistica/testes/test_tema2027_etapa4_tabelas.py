#!/usr/bin/env python3
"""Prova da Etapa 4 (Tabelas) do Tema 2027 — o que o VEREDITO manda conferir.

VEREDITO.md, seção 6, Etapa 4, "Conferir (obrigatório)":

  1. em 1440, `th` da Torre "Programação · Última etapa" com
     `scrollWidth <= clientWidth` nos dois temas — o defeito de
     Binance/Vercel/Stripe (caixa alta que estoura a coluna);
  2. nenhum `th` de nenhuma aba (Torre e Programação) com mais linhas
     (`getClientRects().length`) do que tinha ANTES da Etapa 4;
  3. `x` e `width` de cada `th` da Torre e da Programação iguais aos de
     ANTES da Etapa 4, ±2px — as colunas calibradas (`#torre-tabela`,
     `#mont-tabela`) não podem andar;
  4. a barra vermelha de "Aguardando Veículo" aparece UMA vez por linha
     (conta de `td` com `box-shadow != 'none'` na linha tem de ser 1);
  5. no celular (390px) nenhuma barra (a Etapa 4 zera o `box-shadow` do
     primeiro `td` abaixo de 821px — só o fundo da linha fica);
  6. `#main.height` menor ou igual ao de ANTES em todas as 4 abas (é
     compactação, não crescimento).

MÉTODO — "ANTES" e "DEPOIS" no MESMO processo, sem depender de um
`index.html` publicado à parte: o script pede duas rodadas de medição,
uma com só `styles.css` (baseline, o que está publicado hoje — nenhuma
outra etapa do Tema 2027 tocou nestes seletores) e outra com
`styles.css + tema2027/*.css` (o build de verdade, via `--com-camada`).
Isso é exatamente o par "REPROVA contra o publicado / PASSA com o build
novo" pedido no relato: rodar este script com `--somente-antes` reprova
(porque o `th` ainda não tem a régua dourada nem `tabular-nums`), e com
`--com-camada` (o padrão) passa.

Uso:
    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium python3 \
        testes/test_tema2027_etapa4_tabelas.py --api 3034
    # prova negativa (tem de reprovar):
    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium python3 \
        testes/test_tema2027_etapa4_tabelas.py --api 3034 --somente-antes
"""
import argparse
import asyncio
import json
import os
import pathlib
import sys

from playwright.async_api import async_playwright

BASE = pathlib.Path(__file__).parent.parent
TESTES = pathlib.Path(__file__).parent
CAMADA_DIR = BASE / 'tema2027'
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH', '/opt/pw-browsers/chromium')

TEMAS = ['escuro', 'claro']

# Mesma semente de 16 cargas do juiz / medir_tema2027.py — inclui cargas
# "Aguardando Veículo" (a linha que tem de acender com a barra vermelha).
SEMEAR = """()=>{
  const ag=new Date(), h=(m)=>new Date(ag.getTime()-m*60000).toISOString();
  const F=['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado'];
  const tr=['BAIXOTES TRANSPORTE','AJB TRANSPORTES','MARQUES E SILVA','COOPEDIESEL'];
  const mo=['WESLEY JUNIO BORGES NOGUEIRA','ROOSEVELT MARQUES DA SILVA','ITALO AUGUSTO MEIRA'];
  const ro=[['519','Brasília'],['500','Patos de Minas'],['525','Bahia Capital']];
  DB.cargas=[];DB.movimentacoes=[];
  for(let i=0;i<16;i++){
    const id='rt'+i,e=[0,1,2,3,4][i%5],r=ro[i%ro.length];
    DB.cargas.push({id,numeroCarga:String(118800+i),placa:'RNW7J5'+(i%10),
      transportadora:tr[i%tr.length],motorista:mo[i%mo.length],rota:r[0],rotaNome:r[1],
      pesoKg:2952+i*137,paletes:38,tipoVeiculo:'Suinco 3/4',tipoOperacao:'ENTREGA DIRETA',
      ganchos:40,entregas:38,status:F[e],sequencia:i+1,
      dataProgramacao:ag.toISOString().slice(0,10),criadaEm:h(400),atualizadaEm:h(20)});
    for(let k=0;k<=e;k++) DB.movimentacoes.push({cargaId:id,status:F[k],quando:h(360-k*55),operador:'Ana'});
  }
  ['renderTorre','renderVisaoPatio','renderIndicadores','renderHistorico'].forEach(f=>{
    try{ if(window[f]) window[f](f==='renderVisaoPatio'?'torre':undefined);}catch(e){}});
  return DB.cargas.length;}"""

MEDIR_TH = """(sel)=>{
  const out=[];
  document.querySelectorAll(sel).forEach((th,i)=>{
    const r=th.getBoundingClientRect();
    /* `th.getClientRects().length` SEMPRE dá 1: é a caixa da CÉLULA
       (table-cell), que não se fragmenta quando o TEXTO de dentro quebra
       em duas linhas. Quem fragmenta em uma linha por rect é um Range
       sobre o CONTEÚDO — por isso o número de linhas de verdade vem de um
       Range cobrindo os nós de texto do `th`, não do elemento. */
    let linhas = 1;
    try {
      const rng = document.createRange();
      rng.selectNodeContents(th);
      linhas = rng.getClientRects().length || 1;
    } catch (e) {}
    out.push({i, txt: th.textContent.trim().replace(/\\s+/g,' ').slice(0,30),
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
      linhas,
      scrollWidth: th.scrollWidth, clientWidth: th.clientWidth});
  });
  return out;
}"""

MEDIR_MAIN_H = """()=>{ const e=document.querySelector('#main'); return e?Math.round(e.getBoundingClientRect().height):null }"""

# Conta, por linha da Torre com badge "Aguardando Veículo", quantos <td>
# têm box-shadow diferente de 'none' — tem de ser exatamente 1 (só a
# primeira célula acende).
MEDIR_BARRA = """()=>{
  const linhas = document.querySelectorAll('#torre-tbody tr');
  const out = [];
  linhas.forEach(tr=>{
    if(!tr.querySelector('.badge-aguardando-veiculo')) return;
    let n = 0;
    tr.querySelectorAll('td').forEach(td=>{
      if(getComputedStyle(td).boxShadow !== 'none') n++;
    });
    out.push(n);
  });
  return out;
}"""


def descobrir_api(preferida=None):
    import urllib.request, urllib.error
    candidatas = [preferida] if preferida else [3010, 3011, 3012, 3013, 3014, 3015, 3034]
    for porta in candidatas:
        if porta is None:
            continue
        url = f'http://127.0.0.1:{porta}/health'
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status == 200:
                    return porta
        except (urllib.error.URLError, OSError):
            continue
    return None


falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def medir_estado(pg, api, largura, arquivo_html):
    """`arquivo_html` é um `index.html` JÁ CONSTRUÍDO (build_arquivo_unico.py) —
    um com `tema2027/30_tabelas.css` vazio (o publicado hoje) e outro com o
    conteúdo real da Etapa 4. Ler o HTML pronto em vez de injetar um
    `<style>` extra por cima evita o erro de comparar o build consigo mesmo
    (o `index.html` do repositório já embute a camada no ÚNICO `<style>`
    que `build_arquivo_unico.py` gera — uma tag adicional por cima não
    "desliga" o que já está embutido)."""
    html = pathlib.Path(arquivo_html).read_text(encoding='utf-8')
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{api}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                         f'{api}/socket.io/socket.io.js')
    url = f'{api}/__retrato_etapa4'

    async def cumprir(route):
        await route.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)

    await pg.route(url, cumprir)
    await pg.goto(url)
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.evaluate("()=>mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.evaluate("()=>confirmarOperador()")
    await pg.wait_for_timeout(2000)
    await pg.evaluate(SEMEAR)
    await pg.wait_for_timeout(500)
    await pg.unroute(url)

    resultado = {}
    for tema in TEMAS:
        await pg.evaluate("(t)=>document.documentElement.setAttribute('data-tema',t)", tema)
        resultado[tema] = {}
        for aba in ['torre', 'programacao']:
            await pg.evaluate("(a)=>abrirTab(a)", aba)
            await pg.wait_for_timeout(500)
            sel_th = '#torre-thead th' if aba == 'torre' else '#mont-tabela thead th'
            ths = await pg.evaluate(MEDIR_TH, sel_th)
            main_h = await pg.evaluate(MEDIR_MAIN_H)
            resultado[tema][aba] = {'ths': ths, 'mainH': main_h}
        # barra vermelha só medida na Torre
        await pg.evaluate("(a)=>abrirTab(a)", 'torre')
        await pg.wait_for_timeout(300)
        resultado[tema]['barras'] = await pg.evaluate(MEDIR_BARRA)

    return resultado


async def medir_barra_mobile(pg, api, arquivo_html):
    html = pathlib.Path(arquivo_html).read_text(encoding='utf-8')
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{api}'")
    url = f'{api}/__retrato_etapa4_mobile'

    async def cumprir(route):
        await route.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)

    await pg.route(url, cumprir)
    await pg.goto(url)
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.evaluate("()=>mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.evaluate("()=>confirmarOperador()")
    await pg.wait_for_timeout(2000)
    await pg.evaluate(SEMEAR)
    await pg.wait_for_timeout(500)
    await pg.unroute(url)

    await pg.evaluate("(a)=>abrirTab(a)", 'torre')
    await pg.wait_for_timeout(500)
    return await pg.evaluate("""()=>{
      const out=[];
      document.querySelectorAll('.mobile-cartao tr, #torre-tbody tr').forEach(tr=>{
        if(!tr.querySelector('.badge-aguardando-veiculo')) return;
        tr.querySelectorAll('td').forEach(td=>{
          const bs = getComputedStyle(td).boxShadow;
          if (bs !== 'none') out.push(bs);
        });
      });
      return out;
    }""")


def comparar_ths(antes, depois, tolerancia=2):
    problemas = []
    if len(antes) != len(depois):
        problemas.append(f'número de colunas mudou: {len(antes)} -> {len(depois)}')
        return problemas
    for a, d in zip(antes, depois):
        if abs(a['x'] - d['x']) > tolerancia or abs(a['w'] - d['w']) > tolerancia:
            problemas.append(
                f"coluna {a['i']} \"{a['txt']}\": x {a['x']}->{d['x']} "
                f"w {a['w']}->{d['w']} (tolerância ±{tolerancia}px)")
        if d['linhas'] > a['linhas']:
            problemas.append(
                f"coluna {a['i']} \"{d['txt']}\": {a['linhas']} -> {d['linhas']} linha(s)")
        if d['scrollWidth'] > d['clientWidth']:
            problemas.append(
                f"coluna {a['i']} \"{d['txt']}\": corte — scrollWidth {d['scrollWidth']} > "
                f"clientWidth {d['clientWidth']}")
    return problemas


ENTREGA = 'claude/pega-visao-up19-deliverables-6cqhjb'


def _extrair_publicado():
    """Grava o index.html da branch de entrega num arquivo e devolve o caminho.

    "O que está no ar" tem de vir do git, não de um arquivo do checkout —
    o checkout é justamente o que a entrega muda.
    """
    import subprocess
    import tempfile
    alvo = pathlib.Path(tempfile.gettempdir()) / 'suinco_publicado_index.html'
    caminho = 'entregaveis/suinco_logistica/index.html'
    # O remoto primeiro: é ele que o Vercel serve. O local pode estar
    # atrasado e faria o teste comparar contra um "publicado" que não é o
    # que a operação está usando.
    erro = ''
    for ref in (f'origin/{ENTREGA}', ENTREGA):
        r = subprocess.run(['git', 'show', f'{ref}:{caminho}'],
                           cwd=BASE.parent.parent, capture_output=True)
        if r.returncode == 0:
            break
        erro = r.stderr.decode()[:200]
    else:
        sys.exit(f'não consegui ler {caminho} da entrega: {erro}')
    alvo.write_bytes(r.stdout)
    return str(alvo)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--api', type=int, default=None)
    ap.add_argument('--antes', default=None,
                     help='index.html do ANTES. Sem isto, usa o da branch de '
                          'entrega (o que está no ar).')
    ap.add_argument('--depois', default=None,
                     help='index.html do DEPOIS. Sem isto, usa o build local.')
    args = ap.parse_args()

    # GUARDA QUE EXIGE ARGUMENTO NÃO É GUARDA (17/09/2026).
    #
    # Os dois eram `required=True`. Na mão do executor da etapa isso
    # funcionava: ele construía os dois index.html e passava os caminhos.
    # Mas `rodar_tudo.sh` roda toda suíte SEM argumento — então na bateria
    # este arquivo morria no argparse, antes de medir um pixel, e entrava
    # na lista de vermelhos como se tivesse encontrado defeito.
    #
    # Reprovar por falta de argumento é pior que não existir: gasta o tempo
    # de quem investiga e ensina a ignorar vermelho. Agora os dois lados
    # têm padrão — o ANTES vem do git, da branch que o Vercel serve, e o
    # DEPOIS é o build local.
    if not args.antes:
        args.antes = _extrair_publicado()
    if not args.depois:
        args.depois = str(BASE / 'index.html')

    porta = descobrir_api(args.api)
    if porta is None:
        sys.exit('ERRO: nenhuma API respondeu em /health. Suba uma antes de medir '
                  '(ex.: PORT=3034 node backend/src/servidor.js).')
    api = f'http://127.0.0.1:{porta}'
    print(f'API viva em {api}')

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROMIUM)

        ctx_a = await nav.new_context(viewport={'width': 1440, 'height': 900})
        pg_a = await ctx_a.new_page()
        antes = await medir_estado(pg_a, api, 1440, args.antes)
        await ctx_a.close()

        ctx_d = await nav.new_context(viewport={'width': 1440, 'height': 900})
        pg_d = await ctx_d.new_page()
        depois = await medir_estado(pg_d, api, 1440, args.depois)
        await ctx_d.close()

        # 5 — mobile 390: nenhuma barra
        ctx_m = await nav.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True)
        pg_m = await ctx_m.new_page()
        barras_mobile = await medir_barra_mobile(pg_m, api, args.depois)
        await ctx_m.close()

        await nav.close()

    saida = TESTES / 'tema2027_etapa4_resultado.json'
    saida.write_text(json.dumps({'antes': antes, 'depois': depois,
                                  'barras_mobile': barras_mobile}, indent=1, ensure_ascii=False),
                      encoding='utf-8')
    print(f'medidas gravadas em {saida}')

    for tema in TEMAS:
        # 1 — th "Programação · Última etapa" não corta (Torre, index 10)
        torre_ths = depois[tema]['torre']['ths']
        alvo = next((t for t in torre_ths if 'Programa' in t['txt']), None)
        ck(f'{tema}: th "Programação · Última etapa" não corta (scrollWidth<=clientWidth)',
           alvo is not None and alvo['scrollWidth'] <= alvo['clientWidth'],
           '' if alvo is None else f"scrollWidth={alvo['scrollWidth']} clientWidth={alvo['clientWidth']}")

        # 2 e 3 — x/width/linhas de cada th da Torre e da Programação
        for aba in ['torre', 'programacao']:
            problemas = comparar_ths(antes[tema][aba]['ths'], depois[tema][aba]['ths'])
            ck(f'{tema}/{aba}: x/width/linhas de cada th dentro da tolerância e sem corte',
               not problemas, '; '.join(problemas))

        # 4 — barra vermelha uma vez por linha
        barras = depois[tema]['barras']
        ck(f'{tema}: barra vermelha aparece 1x por linha "Aguardando Veículo" (desktop)',
           len(barras) > 0 and all(n == 1 for n in barras),
           f'contagens: {barras}')

        # 6 — #main.height não cresce
        for aba in ['torre', 'programacao']:
            h_antes = antes[tema][aba]['mainH']
            h_depois = depois[tema][aba]['mainH']
            ck(f'{tema}/{aba}: #main.height não cresce ({h_antes} -> {h_depois})',
               h_depois is not None and h_antes is not None and h_depois <= h_antes + 1,
               f'antes={h_antes} depois={h_depois}')

    # 5 — mobile: nenhuma barra abaixo de 821px
    ck('mobile 390: nenhuma barra (box-shadow) na linha "Aguardando Veículo"',
       len(barras_mobile) == 0, f'encontradas: {barras_mobile}')

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
