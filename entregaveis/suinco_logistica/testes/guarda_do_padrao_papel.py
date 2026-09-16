#!/usr/bin/env python3
"""A outra metade da guarda: o que o SERVIDOR imprime, sobre papel branco.

PEDIDO DO DONO (16/09/2026): *"essas melhorias precisam ser uma via de mão
dupla entre servidor e navegador"*. Ele está certo, e o código prova:

    // backend/src/servicos/pdf.js:15
    export async function gerarPdf({ html, css, paisagem = true }) {
    ...
      + `<style>${css}</style><style>${folha}</style>` + ... + html

O navegador manda o HTML **e o CSS do painel** para o servidor, e o
servidor imprime o PDF com eles. Toda linha de estilo mexe em DUAS coisas:
a tela e todo documento que a Suinco emite.

A ARMADILHA QUE ISTO EXISTE PARA PEGAR. No painel o contraste se mede
sobre navy escuro; no PDF é TINTA SOBRE PAPEL BRANCO. Uma cor que passa
com folga no tema escuro pode sair cinza ilegível na folha que o motorista
recebe no portão. Medindo só na tela, a gente "melhora" o painel e estraga
o documento — e ninguém vê até alguém imprimir.

O que mede, por documento:
  1. contraste >= 4.5:1 SOBRE BRANCO (o papel), não sobre o fundo do tema;
  2. nada pintado de branco-sobre-branco (o modo escuro vazando para a folha);
  3. a largura cabe na folha A4 sem cortar coluna;
  4. a fonte embutida chegou (sem ela cada sistema troca por outra e o
     documento sai diferente em cada aparelho — regra de 08/08/2026).

MÉTODO. Reproduz o que `gerarPdf` faz: pega o MESMO html e o MESMO css que
o painel envia (`el.outerHTML` + `coletarCssDoPainel()`), monta o mesmo
documento e mede. Não depende do servidor estar no ar, e mede exatamente
o que ele mediria.
"""
import asyncio, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'

# id do elemento no painel -> nome do documento. São os que o painel monta
# numa <div> pronta antes de mandar ao servidor.
DOCUMENTOS = [
    ('relatorio-operacional', 'Relatório Operacional'),
    ('relatorio-executivo',   'Relatório Executivo'),
    ('administracao-fretes',  'Administração de Fretes'),
    ('programacao-do-dia',    'Programação do Dia'),
    ('programacao-manobrista','Fila do Manobrista'),
]

falhas = []
def ck(ok, doc, regra, det):
    if not ok: falhas.append(f'{doc} · {regra}: {det}')

MEDIR_PAPEL = r"""() => {
  const lum = (c) => { const f = v => { v/=255; return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055,2.4); };
                       return .2126*f(c[0]) + .7152*f(c[1]) + .0722*f(c[2]); };
  const rgb = (s) => { const m = String(s).match(/\d+(\.\d+)?/g); return m ? m.slice(0,3).map(Number) : null; };
  const alfa = (s) => { const m = String(s).match(/[\d.]+/g); return m && m.length > 3 ? parseFloat(m[3]) : 1; };
  const razao = (a,b) => { const [x,y] = [lum(a), lum(b)].sort((p,q)=>q-p); return (x+.05)/(y+.05); };
  const PAPEL = [255,255,255];
  const fundoDe = (el) => { let n = el;
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && alfa(c) > .85 && rgb(c)) return rgb(c);
      n = n.parentElement; }
    return PAPEL; };

  const ruins = [], invisiveis = [];
  document.querySelectorAll('*').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
    if (txt.length < 2) return;
    const cs = getComputedStyle(el), cor = rgb(cs.color); if (!cor) return;
    const px = parseFloat(cs.fontSize), peso = parseInt(cs.fontWeight) || 400;
    const min = (px >= 24 || (px >= 18.66 && peso >= 700)) ? 3.0 : 4.5;
    const fundo = fundoDe(el);
    const rz = razao(cor, fundo);
    if (rz < 1.6) invisiveis.push({txt: txt.slice(0,40), rz: +rz.toFixed(2)});
    else if (rz < min) ruins.push({txt: txt.slice(0,40), rz: +rz.toFixed(2), min, px});
  });

  // A4 paisagem, margem de 5mm dos dois lados => 287mm uteis.
  const MM = 96/25.4, UTIL = 287 * MM;
  return { ruins: ruins.slice(0,10), invisiveis: invisiveis.slice(0,6),
           largura: document.documentElement.scrollWidth, util: Math.round(UTIL),
           fontes: [...new Set([...document.querySelectorAll('*')].slice(0,400)
                     .map(e => getComputedStyle(e).fontFamily.split(',')[0].replace(/["']/g,'')))].slice(0,6) };
}"""

async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        await pg.goto(PAINEL)
        await pg.wait_for_function('typeof coletarCssDoPainel === "function"')
        await pg.evaluate("() => { document.body.classList.remove('pre-login');"
                          " document.querySelectorAll('.modal,.modal-bg').forEach(e=>e.style.display='none'); }")
        css = await pg.evaluate("() => coletarCssDoPainel()")
        print(f'CSS que o painel manda ao servidor: {len(css):,} bytes\n')

        for chave, nome in DOCUMENTOS:
            html = await pg.evaluate("""(c) => {
              const el = document.getElementById(c) || document.querySelector('[data-doc="'+c+'"]')
                      || document.querySelector('.print-page');
              return el ? el.outerHTML : null;
            }""", chave)
            if not html:
                print(f'  [PULOU ] {nome} — o painel não monta esse documento sem dado. NÃO MEDIDO.')
                continue
            # O MESMO documento que `gerarPdf` monta, na mesma ordem.
            folha = '@page{size:A4 landscape;margin:5mm}'
            doc = ('<!doctype html><html><head><meta charset="utf-8">'
                   f'<style>{css}</style><style>{folha}</style></head><body>{html}</body></html>')
            pg2 = await nav.new_page(viewport={'width': 1123, 'height': 794})
            await pg2.emulate_media(media='print')
            await pg2.set_content(doc, wait_until='load')
            await pg2.wait_for_timeout(200)
            r = await pg2.evaluate(MEDIR_PAPEL)
            for i in r['invisiveis']:
                ck(False, nome, 'INVISÍVEL NO PAPEL', f"{i['rz']}:1 em \"{i['txt']}\" — some na folha")
            for c in r['ruins']:
                ck(False, nome, 'contraste no papel', f"{c['rz']}:1 (mínimo {c['min']}) em \"{c['txt']}\"")
            ck(r['largura'] <= r['util'] + 2, nome, 'cabe na folha',
               f"{r['largura']} px de largura contra {r['util']} px úteis do A4")
            ck(any('Inter' in f for f in r['fontes']), nome, '~fonte embutida',
               f"fontes em uso: {', '.join(r['fontes'])}")
            print(f'  [medido] {nome} — {len(r["ruins"])} contraste(s) fraco(s), '
                  f'{len(r["invisiveis"])} invisível(is), {r["largura"]}px de largura')
            await pg2.close()
        await nav.close()

    print()
    if falhas:
        print(f'FALHAS NO PAPEL ({len(falhas)}):')
        for f in falhas[:30]: print('  ·', f)
        if len(falhas) > 30: print(f'  ... e mais {len(falhas)-30}')
        sys.exit(1)
    print('RESULTADO: o que o servidor imprime está legível no papel.')

asyncio.run(main())
