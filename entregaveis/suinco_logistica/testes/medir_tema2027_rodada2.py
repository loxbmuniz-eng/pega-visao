#!/usr/bin/env python3
"""Medidor da RODADA 2 do Tema 2027 (juiz Fable 5.1).

Roda o MESMO html em vários cenários e grava medidas + prints:
  --html <index.html>  --rotulo ref|t27  --saida <dir>

Cenários:
  A  1440x900, escuro+claro, 4 abas: prints _full, posição, th da Torre e da
     Montagem (x/width/scrollWidth/clientWidth/linhas), cortes, faixa (altura,
     caixas, colunas, buracos), #main.height, fontes, contraste (MEDIR de
     test_contraste.py, lido por fatia do arquivo — não copiado).
  B  390x900, escuro+claro, 4 abas + indicadores/cadastros: prints, fontes < 11px,
     rolagem lateral, altura dos títulos-acordeão (A1).
  C  1280x900 escuro, Torre com 120 cargas + Montagem: table-wrap scroll (A2).
  D  1024x768 touch: matchMedia(pointer:coarse), alturas de .btn/.btn-sm (A3).
  E  1440 escuro Torre filtrando 'Aguardando Veículo': print, stat-ativo
     (bg/box-shadow), contraste dentro da caixa ativa (B1 escuro), barra na linha.
  F  1440 claro Torre: contraste .veic-tipo na linha acesa em repouso e em hover (B1 claro).
  G  1440 escuro Torre: Tab até o Peso da 1ª linha — outline (foco) + print.
  H  1440 claro Programação: hover em Excluir — print + contraste por PIXEL dos 4 botões.
  I  1280 escuro: CDP forcePseudoState(active) na 1ª .nav-tab — box-shadow (B2).
"""
import argparse, asyncio, json, pathlib, re, sys, urllib.request
from playwright.async_api import async_playwright
from PIL import Image

BASE = pathlib.Path('/home/user/pega-visao/entregaveis/suinco_logistica')
CHROMIUM = '/opt/pw-browsers/chromium'
ABAS = ['torre', 'programacao', 'indicadores', 'devolucoes']

# MEDIR de test_contraste.py, lido do arquivo (ele executa main() no import).
_src = (BASE / 'testes' / 'test_contraste.py').read_text(encoding='utf-8')
CONTRASTE_JS = _src.split('MEDIR = """', 1)[1].split('"""', 1)[0]
# o fonte Python escreve `\\d` dentro de uma string normal: o navegador tem
# de receber `\d`, como recebe quando test_contraste.py roda sozinho.
CONTRASTE_JS = CONTRASTE_JS.replace('\\\\', '\\')

# Semente do medir_tema2027.py (16 cargas), parametrizada em N.
SEMEAR = """(N)=>{
  const ag=new Date(), h=(m)=>new Date(ag.getTime()-m*60000).toISOString();
  const F=['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado'];
  const tr=['BAIXOTES TRANSPORTE','AJB TRANSPORTES','MARQUES E SILVA','COOPEDIESEL'];
  const mo=['WESLEY JUNIO BORGES NOGUEIRA','ROOSEVELT MARQUES DA SILVA','ITALO AUGUSTO MEIRA'];
  const ro=[['519','Brasília'],['500','Patos de Minas'],['525','Bahia Capital']];
  DB.cargas=[];DB.movimentacoes=[];
  for(let i=0;i<N;i++){
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

MEDIR_ABA = """()=>{
  const r=(s)=>{const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return [Math.round(b.x),Math.round(b.y),Math.round(b.width),Math.round(b.height)]};
  const cs=(s,p)=>{const e=document.querySelector(s); return e?getComputedStyle(e)[p]:null};
  const vis=(e)=>{const b=e.getBoundingClientRect(); return b.width>0&&b.height>0};
  const ths=(sel)=>[...document.querySelectorAll(sel)].filter(vis).map((e,i)=>{const b=e.getBoundingClientRect(); const g=getComputedStyle(e);
     return {i,txt:e.textContent.trim().slice(0,32),x:Math.round(b.x),w:Math.round(b.width),h:Math.round(b.height),sw:e.scrollWidth,cw:e.clientWidth,
             fs:g.fontSize,fw:g.fontWeight,tt:g.textTransform,ls:g.letterSpacing,linhas:Math.round(b.height/parseFloat(g.lineHeight||g.fontSize)*1)}});
  const corte=(sel)=>{const out=[]; document.querySelectorAll(sel).forEach(e=>{ if(vis(e)&&e.scrollWidth>e.clientWidth) out.push([e.textContent.trim().slice(0,30), e.scrollWidth, e.clientWidth]) }); return out.slice(0,8)};
  const wraps=[...document.querySelectorAll('.tab-page.active .table-wrap')].filter(vis).map(w=>({sw:w.scrollWidth,cw:w.clientWidth,tabela:(w.querySelector('table')||{}).id||''}));
  const faixa=document.querySelector('.tab-page.active .bento.bi-faixa');
  let fx=null;
  if(faixa&&vis(faixa)){ const g=getComputedStyle(faixa); const cols=g.gridTemplateColumns.split(' ').length;
    const boxes=[...faixa.querySelectorAll(':scope > .stat-box')]; const tops=boxes.map(b=>Math.round(b.getBoundingClientRect().top));
    const maxTop=Math.max(...tops); const ult=boxes.filter((b,i)=>tops[i]===maxTop);
    const span=(b)=>{const gc=getComputedStyle(b).gridColumnStart; return /span/.test(gc)?parseInt(gc.replace(/\\D/g,''))||1:1};
    const ocupadas=ult.reduce((a,b)=>a+span(b),0);
    fx={h:Math.round(faixa.getBoundingClientRect().height),caixas:boxes.length,cols,linhas:new Set(tops).size,buracos:cols-ocupadas,
        rotulos:boxes.map(b=>{const l=b.querySelector('.stat-label'); if(!l) return null; const rg=document.createRange(); rg.selectNodeContents(l);
            const linhas=new Set([...rg.getClientRects()].map(x=>Math.round(x.top))).size; return [l.textContent.trim().slice(0,24),linhas,l.scrollWidth>l.clientWidth,Math.round(b.getBoundingClientRect().width)]})};
  }
  const pequenos=[...document.querySelectorAll('.tab-page.active *')].filter(e=>vis(e)&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>({t:e.textContent.trim().slice(0,22),f:parseFloat(getComputedStyle(e).fontSize)})).filter(o=>o.f<11).slice(0,8);
  const titulos=[...document.querySelectorAll('.tab-page.active .card-title')].filter(vis).slice(0,6).map(t=>{const b=t.getBoundingClientRect(); return {t:t.textContent.trim().slice(0,28),h:Math.round(b.height),fs:getComputedStyle(t).fontSize,linhas:Math.round(b.height/parseFloat(getComputedStyle(t).lineHeight))}});
  return {
    pos:{header:r('#header'),nav:r('#nav'),main:r('#main'),card1:r('.tab-page.active .card'),thead:r('.tab-page.active thead'),tr1:r('.tab-page.active tbody tr')},
    posFixo:{header:cs('#header','position'),nav:cs('#nav','position'),headerBlur:cs('#header','backdropFilter'),navBlur:cs('#nav','backdropFilter')},
    thTorre:ths('#torre-thead th'), thMont:ths('#mont-tabela thead th'),
    cortes:{badge:corte('.tab-page.active .badge'),btn:corte('.tab-page.active .btn'),statLabel:corte('.tab-page.active .stat-label'),th:corte('.tab-page.active th'),navTab:corte('.nav-tab')},
    wraps, faixa:fx, pequenos, titulos,
    fonts:{th:cs('.tab-page.active th','fontSize'),td:cs('.tab-page.active tbody td','fontSize'),cardTitle:cs('.tab-page.active .card-title','fontSize'),statNum:cs('.tab-page.active .stat-num','fontSize'),body:cs('body','fontFamily').slice(0,30)},
    scroll:[document.documentElement.scrollWidth, document.documentElement.clientWidth],
    cardBg:cs('.tab-page.active .card','backgroundColor'),
  }}"""


def api_viva():
    for p in range(3010, 3016):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{p}/health', timeout=2) as r:
                if r.status == 200:
                    return f'http://127.0.0.1:{p}'
        except Exception:
            pass
    sys.exit('API fora do ar')


async def abrir(nav, html, api, viewport, n=16, **kw):
    ctx = await nav.new_context(viewport=viewport, **kw)
    pg = await ctx.new_page()
    url = f'{api}/__juiz2'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.evaluate('()=>mostrarLoginLocal()')
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.evaluate('()=>confirmarOperador()')
    await pg.wait_for_timeout(1500)
    await pg.evaluate(SEMEAR, n)
    await pg.wait_for_timeout(400)
    await pg.unroute(url)
    return ctx, pg


async def tema(pg, t):
    await pg.evaluate("(t)=>document.documentElement.setAttribute('data-tema',t)", t)
    await pg.wait_for_timeout(120)


async def aba(pg, a):
    await pg.evaluate("(a)=>{abrirTab(a); try{renderAll()}catch(e){}}", a)
    await pg.wait_for_timeout(350)


def lum(c):
    def f(v):
        v /= 255
        return v / 12.92 if v <= .03928 else ((v + .055) / 1.055) ** 2.4
    return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2])


def razao(a, b):
    l1, l2 = lum(a), lum(b)
    return round((max(l1, l2) + .05) / (min(l1, l2) + .05), 2)


def contraste_pixel(png):
    im = Image.open(png).convert('RGB')
    w, h = im.size
    im = im.crop((3, 3, max(4, w - 3), max(4, h - 3)))
    cores = im.getcolors(im.size[0] * im.size[1]) or []
    cores.sort(reverse=True)
    fundo = cores[0][1]
    lf = lum(fundo)
    # texto = pixel mais distante em luminância do fundo (o miolo do glifo)
    texto = max((c for _, c in cores), key=lambda c: abs(lum(c) - lf))
    return {'fundo': fundo, 'texto': texto, 'razao': razao(texto, fundo)}


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--html', required=True)
    ap.add_argument('--rotulo', required=True)
    ap.add_argument('--saida', required=True)
    ap.add_argument('--so', default='', help='letras dos cenários, ex. ACE')
    args = ap.parse_args()
    so = args.so or 'ABCDEFGHI'
    saida = pathlib.Path(args.saida); saida.mkdir(parents=True, exist_ok=True)
    api = api_viva()
    html = pathlib.Path(args.html).read_text(encoding='utf-8')
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{api}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js', f'{api}/socket.io/socket.io.js')
    R = args.rotulo
    out = {}

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROMIUM)

        if 'A' in so:
            ctx, pg = await abrir(nav, html, api, {'width': 1440, 'height': 900})
            out['1440'] = {}
            for t in ('escuro', 'claro'):
                await tema(pg, t); out['1440'][t] = {}
                for a in ABAS:
                    await aba(pg, a)
                    m = await pg.evaluate(MEDIR_ABA)
                    m['contraste_baixo'] = await pg.evaluate(CONTRASTE_JS)
                    out['1440'][t][a] = m
                    await pg.screenshot(path=str(saida / f'{R}_{a}_{t}_1440_full.png'))
            await ctx.close()

        if 'B' in so:
            ctx, pg = await abrir(nav, html, api, {'width': 390, 'height': 900}, is_mobile=True, has_touch=True)
            out['390'] = {}
            for t in ('escuro', 'claro'):
                await tema(pg, t); out['390'][t] = {}
                for a in ABAS + ['cadastros']:
                    await aba(pg, a)
                    m = await pg.evaluate(MEDIR_ABA)
                    m['acordeao'] = await pg.evaluate("""()=>[...document.querySelectorAll('#tab-indicadores > .card > .card-title, #tab-cadastros > .card > .card-title, #tab-cadastros > .grid2 > .card > .card-title')].slice(0,4).map(e=>{const b=e.getBoundingClientRect(); return {t:e.textContent.trim().slice(0,24),h:Math.round(b.height*10)/10,fs:getComputedStyle(e).fontSize}})""")
                    m['maisLargo'] = await pg.evaluate("""()=>{const W=document.documentElement.clientWidth; let pior=null; document.querySelectorAll('.tab-page.active *').forEach(e=>{const b=e.getBoundingClientRect(); if(b.right>W+1&&(!pior||b.right>pior.r)) pior={r:Math.round(b.right),tag:e.tagName,cls:(e.className||'').toString().slice(0,40),t:e.textContent.trim().slice(0,20)}}); return pior}""")
                    out['390'][t][a] = m
                    if a in ABAS:
                        await pg.screenshot(path=str(saida / f'{R}_{a}_{t}_390_full.png'))
            await ctx.close()

        if 'C' in so:
            ctx, pg = await abrir(nav, html, api, {'width': 1280, 'height': 900}, n=120)
            await tema(pg, 'escuro')
            out['1280'] = {}
            for a in ('torre', 'programacao'):
                await aba(pg, a)
                m = await pg.evaluate(MEDIR_ABA)
                out['1280'][a] = {k: m[k] for k in ('wraps', 'thTorre', 'thMont', 'cortes', 'faixa', 'scroll', 'pos')}
            await pg.screenshot(path=str(saida / f'{R}_torre_escuro_1280_120cargas.png'))
            await ctx.close()

        if 'D' in so:
            ctx, pg = await abrir(nav, html, api, {'width': 1024, 'height': 768}, has_touch=True)
            await aba(pg, 'torre')
            out['tablet'] = await pg.evaluate("""()=>{const vis=e=>{const b=e.getBoundingClientRect();return b.width>0&&b.height>0};
              const h=(sel)=>{const e=[...document.querySelectorAll(sel)].find(vis); if(!e) return null; const b=e.getBoundingClientRect(); return {h:Math.round(b.height*10)/10,minH:getComputedStyle(e).minHeight,t:e.textContent.trim().slice(0,16)}};
              return {coarse:matchMedia('(pointer:coarse)').matches, fine:matchMedia('(pointer:fine)').matches, btn:h('.tab-page.active .btn'), btnSm:h('.tab-page.active .btn-sm'), input:h('.tab-page.active input'), navTab:h('.nav-tab')}}""")
            await ctx.close()

        if 'E' in so or 'G' in so:
            ctx, pg = await abrir(nav, html, api, {'width': 1440, 'height': 900})
            await tema(pg, 'escuro'); await aba(pg, 'torre')
            if 'E' in so:
                await pg.evaluate("()=>filtrarTorrePorStatus('Aguardando Veículo')")
                await pg.wait_for_timeout(400)
                await pg.mouse.move(1430, 890)
                out['filtrando'] = await pg.evaluate("""()=>{const a=document.querySelector('.stat-ativo'); const g=a?getComputedStyle(a):null;
                  const lin=document.querySelector('#torre-tbody tr:has(.badge-aguardando-veiculo)');
                  const tds=lin?[...lin.children]:[]; const comBarra=tds.filter(td=>getComputedStyle(td).boxShadow!=='none').length;
                  return {ativoBg:g&&g.backgroundColor, ativoSombra:g&&g.boxShadow, ativoRotulo:a&&a.querySelector('.stat-label').textContent.trim(),
                          linhaAcesa:!!lin, tdComBarra:comBarra, tdBg:tds[0]&&getComputedStyle(tds[0]).backgroundColor, carga:lin&&lin.textContent.trim().slice(0,12)}}""")
                out['filtrando']['contraste_baixo'] = await pg.evaluate(CONTRASTE_JS)
                await pg.screenshot(path=str(saida / f'{R}_torre_escuro_1440_filtrando.png'))
                await pg.evaluate("()=>filtrarTorrePorStatus('Aguardando Veículo')")  # desliga
                await pg.wait_for_timeout(300)
            if 'G' in so:
                await pg.click('#main .card-title', position={'x': 5, 'y': 5})
                foco = None
                for _ in range(80):
                    await pg.keyboard.press('Tab')
                    foco = await pg.evaluate("""()=>{const e=document.activeElement; if(!e) return null; const tr=e.closest('#torre-tbody tr'); if(!tr||tr!==document.querySelector('#torre-tbody tr')) return null;
                      if(!(e.tagName==='INPUT'&&e.type==='number')) return null; const g=getComputedStyle(e); return {outline:g.outlineStyle+' '+g.outlineWidth+' '+g.outlineColor, borda:g.borderColor, fv:e.matches(':focus-visible')}}""")
                    if foco: break
                out['foco'] = foco
                await pg.screenshot(path=str(saida / f'{R}_torre_escuro_1440_foco.png'))
            await ctx.close()

        if 'F' in so:
            ctx, pg = await abrir(nav, html, api, {'width': 1440, 'height': 900})
            await tema(pg, 'claro'); await aba(pg, 'torre')
            await pg.mouse.move(1430, 890)
            JS = """()=>{const lin=document.querySelector('#torre-tbody tr:has(.badge-aguardando-veiculo)'); if(!lin) return null;
               const vt=lin.querySelector('.veic-tipo'); const achados=(%s)();
               return {tdBg:getComputedStyle(lin.children[0]).backgroundColor, trBg:getComputedStyle(lin).backgroundColor,
                       veic:achados.filter(x=>/veic-tipo/.test(x.classe)), todos:achados.length}}""" % CONTRASTE_JS.strip().rstrip(';')
            repouso = await pg.evaluate(JS)
            await pg.hover('#torre-tbody tr:has(.badge-aguardando-veiculo) td:nth-child(3)')
            await pg.wait_for_timeout(200)
            hover = await pg.evaluate(JS)
            out['linhaAcesaClaro'] = {'repouso': repouso, 'hover': hover}
            await ctx.close()

        if 'H' in so:
            ctx, pg = await abrir(nav, html, api, {'width': 1440, 'height': 900})
            out['botoes'] = {}
            for t in ('escuro', 'claro'):
                await tema(pg, t); out['botoes'][t] = {}
                for sel, a in (('.btn-danger', 'programacao'), ('.btn-success', 'torre'), ('.btn-primary', 'programacao'), ('.btn-sec', 'torre')):
                    await aba(pg, a)
                    loc = pg.locator(f'.tab-page.active {sel}:visible').first
                    if await loc.count() == 0:
                        out['botoes'][t][sel] = None; continue
                    await loc.scroll_into_view_if_needed()
                    png = saida / f'_btn_{R}_{t}_{sel[1:]}.png'
                    await loc.screenshot(path=str(png))
                    rep = contraste_pixel(png)
                    await loc.hover(); await pg.wait_for_timeout(250)
                    await loc.screenshot(path=str(png))
                    hov = contraste_pixel(png)
                    out['botoes'][t][sel] = {'repouso': rep['razao'], 'hover': hov['razao'], 'fundoHover': hov['fundo']}
                    if t == 'claro' and sel == '.btn-danger':
                        await pg.screenshot(path=str(saida / f'{R}_programacao_claro_1440_hover.png'))
                    await pg.mouse.move(1430, 890)
            await ctx.close()

        if 'I' in so:
            ctx, pg = await abrir(nav, html, api, {'width': 1280, 'height': 900})
            cdp = await ctx.new_cdp_session(pg)
            await cdp.send('DOM.enable'); await cdp.send('CSS.enable')
            await aba(pg, 'torre')
            LER = "()=>{const e=document.querySelector('.nav-tab'); const c=getComputedStyle(e); return {ativa:e.classList.contains('active'),sombra:c.boxShadow,fundo:c.backgroundColor,transform:c.transform}}"
            antes = await pg.evaluate(LER)
            doc = await cdp.send('DOM.getDocument')
            no = await cdp.send('DOM.querySelector', {'nodeId': doc['root']['nodeId'], 'selector': '.nav-tab'})
            await cdp.send('CSS.forcePseudoState', {'nodeId': no['nodeId'], 'forcedPseudoClasses': ['active']})
            await pg.wait_for_timeout(200)
            durante = await pg.evaluate(LER)
            await cdp.send('CSS.forcePseudoState', {'nodeId': no['nodeId'], 'forcedPseudoClasses': []})
            out['toqueAba'] = {'antes': antes, 'durante': durante, 'responde': antes != durante}
            await ctx.close()

        await nav.close()

    (saida / f'medidas_{R}.json').write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'ok: {saida / f"medidas_{R}.json"}')


asyncio.run(main())
