#!/usr/bin/env python3
"""O painel publicado sai enxuto, e o portão continua enxergando tudo (01/10/2026).

PEDIDO DO DONO: item 1 da fila de evolução — "painel mais leve". Medido:
708 KB comprimidos com os comentários; 379 KB sem (−46%). As fontes
continuam comentadas; só o index.html gerado sai sem comentário e sem espaço
sobrando, pelo esbuild (`--minify-whitespace`, nenhum nome trocado).

O CUIDADO QUE ESTE TESTE TRAVA: o portão confere "o build está em dia"
comparando o index.html regerado com o commitado e IGNORANDO a linha do
carimbo de versão. Antes ele ignorava QUALQUER linha que citasse
`SUINCO_BUILD` — e com o código enxuto numa linha só, a linha do código
inteiro cita `SUINCO_BUILD`. O portão ficaria cego para qualquer diferença
no código. Agora ele ignora só a linha exata do carimbo.

  1. o index.html comprimido fica abaixo de 450 KB (era 708);
  2. o carimbo está numa linha própria, no formato que o portão ignora;
  3. o filtro do portão ignora SÓ essa linha (e a do sw.js);
  4. o esbuild tem versão fixa — o mesmo build sai igual em qualquer lugar;
  5. o build parou de cortar comentário? Não: as fontes continuam com eles.

    python3 testes/test_painel_enxuto.py
"""
import gzip
import json
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(AQUI)
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


html = open(os.path.join(BASE, 'index.html'), encoding='utf-8').read()
kb = len(gzip.compress(html.encode('utf-8'), 9)) / 1024
print('\n=== 1. O PAINEL PUBLICADO É LEVE ===')
ck('o index.html comprimido fica abaixo de 450 KB', kb < 450, f'{kb:.0f} KB')

print('\n=== 2. O CARIMBO NUMA LINHA PRÓPRIA ===')
linhas = [l for l in html.splitlines() if 'window.SUINCO_BUILD = ' in l]
ck('uma linha só com o carimbo', len(linhas) == 1, str(len(linhas)))
ck('e ela começa por <script>window.SUINCO_BUILD = ',
   bool(linhas) and linhas[0].startswith('<script>window.SUINCO_BUILD = ') and len(linhas[0]) < 300,
   (linhas[0][:80] if linhas else ''))

print('\n=== 3. O PORTÃO IGNORA SÓ A LINHA DO CARIMBO ===')
portao = open(os.path.join(BASE, 'publicar.sh'), encoding='utf-8').read()
filtro = re.search(r"grep -vE '([^']*SUINCO_BUILD[^']*)'", portao)
ck('o filtro existe', filtro is not None)
if filtro:
    f = filtro.group(1)
    ck('ele é preso ao começo da linha do carimbo', f.startswith('^[+-]<script>window\\.SUINCO_BUILD = '), f)
    linha_codigo = '+' + next((l for l in html.splitlines() if 'SUINCO_BUILD' in l and l not in linhas), '')
    ck('uma linha de CÓDIGO que cita SUINCO_BUILD não é ignorada',
       len(linha_codigo) > 1 and not re.search(f, linha_codigo), linha_codigo[:60])

print('\n=== 4. A FERRAMENTA TEM VERSÃO FIXA ===')
pacote = json.load(open(os.path.join(BASE, 'ferramentas', 'package.json'), encoding='utf-8'))
v = (pacote.get('devDependencies') or {}).get('esbuild', '')
ck('esbuild com versão exata (sem ^ nem ~)', bool(re.fullmatch(r'\d+\.\d+\.\d+', v)), v)
ck('e o package-lock.json está no repositório', os.path.exists(os.path.join(BASE, 'ferramentas', 'package-lock.json')))

print('\n=== 5. AS FONTES CONTINUAM COMENTADAS ===')
data = open(os.path.join(BASE, 'data.js'), encoding='utf-8').read()
ck('o data.js ainda tem os comentários (só o publicado sai sem)', data.count('/*') > 100, str(data.count('/*')))
ck('e o publicado não tem os comentários das fontes',
   'UMA DEFINIÇÃO SÓ (movida de app.js em 09/09/2026)' not in html)

print('\n=== RESULTADO ===')
print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
sys.exit(1 if falhas else 0)
