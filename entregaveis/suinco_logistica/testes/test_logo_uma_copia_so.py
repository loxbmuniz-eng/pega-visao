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
  1. nenhuma imagem embutida aparece mais de DUAS vezes (os dois <link> do
     <head> são o único caso legítimo, e são do arquivo pequeno);
  2. nenhuma imagem embutida passa de 40 KB;
  3. o peso comprimido do painel não volta a passar de 700 KB;
  4. a logo continua VISÍVEL — economizar byte não pode apagar a marca;
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

print('\n=== 4. A MARCA CONTINUA NA TELA ===')
ck('a variável --marca-suinco existe e tem imagem', 
   bool(re.search(r'--marca-suinco:\s*url\(data:image/png;base64,', html)))
ck('o chip do cabeçalho usa a marca', 'id="logo-chip"' in html and 'marca-suinco' in html)
ck('o cabeçalho do PDF usa a marca', 'doc-logo marca-suinco' in html)
ck('a marca tem rótulo para leitor de tela', html.count('aria-label="Suinco"') >= 3,
   f'{html.count(chr(97)+"ria-label=" + chr(34) + "Suinco" + chr(34))} rótulos')

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
