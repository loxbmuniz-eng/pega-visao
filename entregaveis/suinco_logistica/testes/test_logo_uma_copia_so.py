#!/usr/bin/env python3
"""A logo entra no painel UMA vez, não uma por referência (16/09/2026).

Medindo o peso do painel a pedido do dono ("precisamos reduzir ao máximo
essas informações... o painel tem que ser mais leve e fluido"), apareceu
uma gordura que não é dado nenhum:

    $ grep -o "data:image/png;base64,..." index.html | sort | uniq -c
          5 x  123.902 bytes   <- A MESMA IMAGEM, cinco vezes

`build_arquivo_unico.py` troca o CAMINHO da logo pela imagem inteira em
base64, com `.replace()` global. O caminho aparecia em cinco lugares
(favicon, apple-touch-icon, chip do cabeçalho, tela de entrada e cabeçalho
do PDF), então o painel publicado levava cinco cópias: 464.545 bytes, 28%
do arquivo.

E o compressor não desfaz: a janela do DEFLATE é de 32 KB e a logo tem
124 KB em base64 — cada cópia viaja inteira.

MEDIDO, antes e depois:

    index.html cru   2.181.382 -> 1.620.485 bytes   (-25,7%)
    index.html gzip    998.761 ->   564.949 bytes   (-43,4%)

A CORREÇÃO tem duas metades:
  · a logo virou variável de CSS (--marca-suinco), citada uma vez; os três
    usos visuais puxam dali com imagem de fundo;
  · o favicon e o apple-touch-icon ganharam arquivo próprio e PEQUENO —
    eles não aceitam variável de CSS, e mandar 92 KB para um ícone de aba
    nunca fez sentido.

O QUE ESTE TESTE TRAVA:
  1. nenhuma imagem embutida aparece mais de DUAS vezes — duas do ícone
     (os <link> do <head>, que não aceitam variável de CSS) e duas da logo
     (a variável do CSS e o <img> do cabeçalho do documento);
  2. nenhuma imagem embutida passa de 40 KB;
  3. o peso comprimido do painel não volta a passar de 700 KB;
  4. a logo continua VISÍVEL — E ISSO SE MEDE EM PIXEL, NÃO EM NOME DE
     CLASSE. Na primeira versão deste teste eu conferi se a classe estava
     no arquivo. Estava — e a logo NÃO aparecia no PDF, porque `.doc-logo`
     vinha depois com o atalho `background:#fff` e apagava a imagem. O
     teste mediu o atalho, não a regra, e deu verde onde não havia prova.
     O portão pegou; o teste não. Agora ele RENDERIZA o cabeçalho do
     documento do mesmo jeito que o servidor renderiza e conta as cores;
  5. nenhuma fonte volta a apontar para o arquivo-mestre.
"""
import base64, gzip, re, subprocess, sys
from pathlib import Path

BASE = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
falhas = []
def ck(nome, ok, extra=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {extra}" if extra else ''))
    if not ok: falhas.append(nome)

print('\n=== 1. NENHUMA IMAGEM REPETIDA ALÉM DOS DOIS <link> ===')
html = (BASE / 'index.html').read_text(encoding='utf-8')
achadas = re.findall(r'data:image/[a-z+]*;base64,([A-Za-z0-9+/=]{200,})', html)
contagem = {}
for a in achadas:
    contagem[a] = contagem.get(a, 0) + 1
pior = max(contagem.values()) if contagem else 0
ck('nenhuma imagem embutida aparece mais de 2x', pior <= 2,
   f'a mais repetida aparece {pior}x' + (' — eram 5 antes' if pior > 2 else ''))

print('\n=== 2. NENHUMA IMAGEM GIGANTE ===')
maior = max((len(base64.b64decode(a + '==')) for a in contagem), default=0)
ck('a maior imagem embutida cabe em 40 KB', maior <= 40 * 1024, f'{maior} bytes')

print('\n=== 3. O PESO QUE VIAJA PELA REDE ===')
cru = len(html.encode('utf-8'))
comprimido = len(gzip.compress(html.encode('utf-8'), 9))
ck('o painel comprimido cabe em 700 KB', comprimido <= 700 * 1024,
   f'{comprimido} bytes ({cru} crus)')

print('\n=== 4. A MARCA CONTINUA NA TELA E NO PAPEL ===')
ck('a variável --marca-suinco existe e tem imagem',
   bool(re.search(r'--marca-suinco:\s*url\(data:image/png;base64,', html)))
ck('o chip do cabeçalho usa a marca', 'id="logo-chip"' in html and 'marca-suinco' in html)
ck('o cabeçalho do documento usa <img>, não fundo de CSS',
   bool(re.search(r'<img src="data:image/png;base64,[^"]+" alt="Suinco" class="doc-logo">', html)),
   'num documento a marca é conteúdo — fundo de CSS some se alguém escrever background: depois')

# A PROVA QUE FALTOU DA PRIMEIRA VEZ: renderizar o cabeçalho do documento
# como o SERVIDOR renderiza (mesmo html + mesmo css, media=print) e contar
# as cores. Branco puro = 1 cor = a marca sumiu.
import asyncio
from playwright.async_api import async_playwright
from PIL import Image

async def _marca_no_papel():
    async with async_playwright() as pw:
        nav = await pw.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page()
        await pg.goto('file://' + str(BASE / 'index.html'))
        await pg.wait_for_function('typeof coletarCssDoPainel === "function"')
        css = await pg.evaluate('() => coletarCssDoPainel()')
        doc_html = ('<div class="print-page"><div class="doc-cabecalho">'
                    + re.search(r'<img src="data:image/png;base64,[^"]+" alt="Suinco" class="doc-logo">', html).group(0)
                    + '</div></div>')
        folha = '@page{size:A4 landscape;margin:5mm}'
        pg2 = await nav.new_page(viewport={'width': 1123, 'height': 794})
        await pg2.emulate_media(media='print')
        await pg2.set_content('<!doctype html><html><head><meta charset="utf-8">'
                              f'<style>{css}</style><style>{folha}</style></head>'
                              f'<body style="background:#fff">{doc_html}</body></html>', wait_until='load')
        await pg2.wait_for_timeout(300)
        cx = await pg2.evaluate("""() => { const e = document.querySelector('.doc-logo');
            if (!e) return null; const b = e.getBoundingClientRect();
            return {x: Math.round(b.x), y: Math.round(b.y),
                    width: Math.max(1, Math.round(b.width)),
                    height: Math.max(1, Math.round(b.height))}; }""")
        if not cx:
            await nav.close(); return 0, None
        await pg2.screenshot(path='/tmp/_marca_papel.png', clip=cx)
        await nav.close()
        return len(Image.open('/tmp/_marca_papel.png').convert('RGB').getcolors(maxcolors=10**6) or []), cx

cores, caixa = asyncio.run(_marca_no_papel())
ck('a marca PINTA no documento que o servidor imprime', cores > 50,
   f'{cores} cor(es) no recorte {caixa} — 1 cor significa branco puro, ou seja, marca ausente')
ck('a marca tem rótulo para leitor de tela', html.count('aria-label="Suinco"') >= 2
   or html.count('alt="Suinco"') >= 1)

print('\n=== 5. NINGUÉM APONTA PARA O ARQUIVO-MESTRE ===')
sobrou = [f for f in ('index_suinco.html', 'styles.css', 'app.js')
          if 'assets/logo_suinco.png' in (BASE / f).read_text(encoding='utf-8')]
ck('nenhuma fonte cita assets/logo_suinco.png', not sobrou, ', '.join(sobrou))
# E a guarda do build precisa REPROVAR se alguém citar — não basta não citar.
sujo = (BASE / 'styles.css').read_text(encoding='utf-8')
(BASE / 'styles.css').write_text(
    sujo.replace('assets/logo_suinco_web.png', 'assets/logo_suinco.png', 1), encoding='utf-8')
try:
    r = subprocess.run([sys.executable, 'build_arquivo_unico.py'], cwd=BASE,
                       capture_output=True, text=True)
    ck('o build RECUSA quem apontar para o arquivo-mestre', r.returncode != 0,
       f'saiu com {r.returncode}')
finally:
    (BASE / 'styles.css').write_text(sujo, encoding='utf-8')
    subprocess.run([sys.executable, 'build_arquivo_unico.py'], cwd=BASE, capture_output=True)

print()
if falhas:
    print(f"RESULTADO: {len(falhas)} FALHA(S) — " + '; '.join(falhas)); sys.exit(1)
print("RESULTADO: tudo verde")
