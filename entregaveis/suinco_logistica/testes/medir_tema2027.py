#!/usr/bin/env python3
"""Ferramenta de medida do Tema 2027 — base de comparação das Etapas 1-7.

Copiado/adaptado de `camp/juiz_medidas.py` (o mesmo script que o juiz Fable
5.1 usou para julgar as dez camadas concorrentes), trocando os competidores
por `tema2027/*.css` e o `index.html` de teste pelo `index.html` real deste
repositório.

Abre `index.html` (o arquivo gerado, publicado ou local — ver `--arquivo`),
entra com login local (`mostrarLoginLocal()` + `#login-nome` + `#login-setor`
= Logística + `confirmarOperador()`, sem precisar de conta na API), semeia
16 cargas com a MESMA função `SEMEAR` que o juiz usou (direto no objeto `DB`
do front, sem passar pelo backend), e grava, para as 4 abas × 2 temas:
posição (`getBoundingClientRect`) de header/nav/main/card/faixa/tabela,
contraste computado de 12 pares texto/fundo, cortes de texto
(`scrollWidth > clientWidth`), cor/borda de input, tamanho de fonte e raio.

A API não está numa porta fixa neste ambiente: o script varre 3010-3015 por
`/health` antes de abrir o navegador (pode ser sobrescrito com --api).

Uso:
    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium python3 \
        testes/medir_tema2027.py --rotulo referencia --largura 1440
    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium python3 \
        testes/medir_tema2027.py --rotulo referencia --largura 390

    # depois que a camada tiver conteúdo (Etapas 1-6), medir com ela:
    testes/medir_tema2027.py --rotulo resultado --largura 1440 --com-camada

Grava em testes/tema2027_<rotulo>_<largura>.json.
"""
import argparse
import asyncio
import json
import os
import pathlib
import sys
import urllib.request
import urllib.error

from playwright.async_api import async_playwright

BASE = pathlib.Path(__file__).parent.parent
TESTES = pathlib.Path(__file__).parent
CAMADA_DIR = BASE / 'tema2027'
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH', '/opt/pw-browsers/chromium')

ABAS = ['torre', 'programacao', 'indicadores', 'devolucoes']

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

MEDIR = """()=>{
  const r=(s)=>{const e=document.querySelector(s); if(!e) return null; const b=e.getBoundingClientRect(); return [Math.round(b.x),Math.round(b.y),Math.round(b.width),Math.round(b.height)]};
  const cs=(s,p)=>{const e=document.querySelector(s); return e?getComputedStyle(e)[p]:null};
  function parse(c){const m=c.match(/[\\d.]+/g)||[0,0,0,1]; return [+m[0],+m[1],+m[2],m.length>3?+m[3]:1]}
  function bgEfetivo(e){let acc=null; while(e){const c=parse(getComputedStyle(e).backgroundColor);
    if(c[3]>0){ if(!acc) acc=c; else { const a=acc[3]; acc=[acc[0]*a+c[0]*(1-a),acc[1]*a+c[1]*(1-a),acc[2]*a+c[2]*(1-a),1]; }
      if(acc[3]>=1) break; } e=e.parentElement;} return acc||[0,0,0,1]}
  function lum([r,g,b]){const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(b)}
  function contraste(sel){const e=document.querySelector(sel); if(!e) return null; const fg=parse(getComputedStyle(e).color); const bg=bgEfetivo(e);
    const fgc=fg[3]<1?[fg[0]*fg[3]+bg[0]*(1-fg[3]),fg[1]*fg[3]+bg[1]*(1-fg[3]),fg[2]*fg[3]+bg[2]*(1-fg[3])]:fg;
    const l1=lum(fgc),l2=lum(bg); return +(((Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05)).toFixed(2))}
  const corte=(sel)=>{const out=[]; document.querySelectorAll(sel).forEach(e=>{ if(e.scrollWidth>e.clientWidth+1) out.push([e.textContent.trim().slice(0,30), e.scrollWidth, e.clientWidth, getComputedStyle(e).textOverflow]) }); return out.slice(0,6)};
  const inp=document.querySelector('#torre-tabela tbody td input[type="number"], #torre-tabela tbody td input.peso-input');
  return {
    pos:{header:r('#header'),nav:r('#nav'),main:r('#main'),card1:r('.tab-page.active .card'),faixa:r('.tab-page.active .bento'),thead:r('.tab-page.active thead'),tr1:r('.tab-page.active tbody tr'),tr2:r('.tab-page.active tbody tr:nth-child(2)'),btnFechar:r('#btn-fechar-programacao, .tab-page.active .btn-primary')},
    contraste:{statLabel:contraste('.tab-page.active .stat-label'),statNum:contraste('.tab-page.active .stat-num'),statNote:contraste('.tab-page.active .stat-note'),th:contraste('.tab-page.active th'),td:contraste('.tab-page.active tbody td'),textDim:contraste('.tab-page.active .card-sub'),btnDanger:contraste('.tab-page.active .btn-danger'),btnSec:contraste('.tab-page.active .btn-sec'),navTab:contraste('.nav-tab:not(.active)'),navActive:contraste('.nav-tab.active'),cardTitle:contraste('.tab-page.active .card-title'),badgeAgV:contraste('.badge-aguardando-veiculo'),etMini:contraste('.et-mini')},
    cortes:{badge:corte('.tab-page.active .badge'),btn:corte('.tab-page.active .btn'),statLabel:corte('.tab-page.active .stat-label'),th:corte('.tab-page.active th'),navTab:corte('.nav-tab')},
    input:inp?{border:getComputedStyle(inp).borderColor,bg:getComputedStyle(inp).backgroundColor}:null,
    fonts:{body:cs('body','fontFamily').slice(0,40),statNum:cs('.tab-page.active .stat-num','fontSize'),statLabel:cs('.tab-page.active .stat-label','fontSize'),td:cs('.tab-page.active tbody td','fontSize'),th:cs('.tab-page.active th','fontSize'),lh:cs('body','lineHeight')},
    radius:{card:cs('.tab-page.active .card','borderRadius'),btn:cs('.tab-page.active .btn','borderRadius'),badge:cs('.tab-page.active .badge','borderRadius')},
    scroll:[document.documentElement.scrollWidth, document.documentElement.clientWidth]
  }}"""


def descobrir_api(preferida=None):
    """Varre 3010-3015 por /health e devolve a primeira porta viva.

    A API deste ambiente não fica numa porta fixa entre sessões — já esteve
    na 3010 e na 3013. Rodar isto às cegas contra 3010 (como o juiz fez)
    quebra silenciosamente se o servidor tiver subido em outra porta.
    """
    candidatas = [preferida] if preferida else [3010, 3011, 3012, 3013, 3014, 3015]
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


async def medir(arquivo, api_porta, largura, comp):
    API = f'http://127.0.0.1:{api_porta}'
    html = pathlib.Path(arquivo).read_text(encoding='utf-8')
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                         f'{API}/socket.io/socket.io.js')
    url = f'{API}/__retrato_tema2027'

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROMIUM)
        ctx = await nav.new_context(viewport={'width': largura, 'height': 900})
        pg = await ctx.new_page()

        async def cumprir(route):
            await route.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)

        await pg.route(url, cumprir)
        await pg.goto(url)
        await pg.wait_for_selector('#login-email', timeout=25000)
        await pg.evaluate("()=>mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.evaluate("()=>confirmarOperador()")
        await pg.wait_for_timeout(2500)
        n = await pg.evaluate(SEMEAR)
        print('cargas semeadas:', n)
        await pg.wait_for_timeout(1000)

        el = None
        if comp:
            css_junto = '\n'.join(pathlib.Path(c).read_text(encoding='utf-8') for c in comp)
            el = await pg.add_style_tag(content=css_junto)

        res = {}
        for tema in ['escuro', 'claro']:
            await pg.evaluate("(t)=>document.documentElement.setAttribute('data-tema',t)", tema)
            res[tema] = {}
            for aba in ABAS:
                await pg.evaluate("(a)=>abrirTab(a)", aba)
                await pg.wait_for_timeout(700)
                res[tema][aba] = await pg.evaluate(MEDIR)
                print('medido', tema, aba)

        if el is not None:
            await el.evaluate("e=>e.remove()")
        await nav.close()
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rotulo', required=True, help='ex.: referencia, resultado')
    ap.add_argument('--largura', type=int, default=1440)
    ap.add_argument('--arquivo', default=str(BASE / 'index.html'))
    ap.add_argument('--api', type=int, default=None, help='porta da API (padrão: descobrir)')
    ap.add_argument('--com-camada', action='store_true',
                     help='injeta tema2027/*.css antes de medir (padrão: sem camada, só o styles.css do arquivo)')
    args = ap.parse_args()

    porta = descobrir_api(args.api)
    if porta is None:
        sys.exit('ERRO: nenhuma API respondeu em /health nas portas 3010-3015. '
                  'Suba uma (backend/src/servidor.js) antes de medir.')
    print(f'API viva em 127.0.0.1:{porta}')

    comp = []
    if args.com_camada:
        comp = sorted(str(p) for p in CAMADA_DIR.glob('*.css'))
        print('injetando camada:', comp)

    resultado = asyncio.run(medir(args.arquivo, porta, args.largura, comp))

    saida = TESTES / f'tema2027_{args.rotulo}_{args.largura}.json'
    saida.write_text(json.dumps(resultado, indent=1, ensure_ascii=False), encoding='utf-8')
    n_chaves = sum(len(v) for tema in resultado.values() for v in tema.values() if isinstance(v, dict))
    print(f'OK: {saida} gravado ({len(json.dumps(resultado))} bytes, '
          f'{len(resultado)} temas × {sum(len(t) for t in resultado.values())} abas medidas)')


if __name__ == '__main__':
    main()
