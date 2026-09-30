#!/usr/bin/env python3
"""O código do painel dividido por assunto — e o painel publicado igual (30/09/2026).

PEDIDO DO DONO: dividir o app.js (13.916 linhas) "do jeito mais seguro
possível", "medindo a melhoria e qualidade que isso vai trazer".

COMO FOI FEITO: a pasta app/ tem pedaços CONSECUTIVOS do app.js antigo,
cortados nas divisões que ele já tinha, em linha em branco. Juntos, na
ordem do nome, dão o mesmo texto byte a byte. Na entrega, o index.html
gerado saiu idêntico ao anterior, fora o carimbo de versão (1.946.987 bytes
nos dois).

O QUE ESTE TESTE TRAVA (estático, sem navegador):
  1. o app.js antigo não voltou (editá-lo não teria efeito nenhum);
  2. o index_suinco.html lista os arquivos de app/ na ordem do build;
  3. nenhum arquivo passa de 2.000 linhas — o motivo da divisão;
  4. cada função do app/ está no index.html publicado (nada ficou de fora
     do arquivo único);
  5. nenhuma função é definida em dois arquivos de app/ (a mais nova
     venceria em silêncio — foi o caso do fmtHora entre data.js e app.js).

    python3 testes/test_app_dividido.py
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fonte_do_painel import BASE, arquivos_do_app  # noqa: E402

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


arquivos = arquivos_do_app()
print('\n=== 1. O ARQUIVO ANTIGO NÃO VOLTOU ===')
ck('app.js não existe mais', not (BASE / 'app.js').exists())
ck('a pasta app/ tem os arquivos do painel', len(arquivos) >= 10, str(len(arquivos)))

print('\n=== 2. O INDEX_SUINCO.HTML LISTA OS ARQUIVOS NA ORDEM DO BUILD ===')
fonte = (BASE / 'index_suinco.html').read_text(encoding='utf-8')
listados = re.findall(r'<script src="app/([^"]+)"></script>', fonte)
ck('mesmos arquivos, mesma ordem', listados == [a.name for a in arquivos], str(listados))

print('\n=== 3. NENHUM ARQUIVO GRANDE DEMAIS ===')
tamanhos = {a.name: a.read_text(encoding='utf-8').count('\n') for a in arquivos}
maior = max(tamanhos, key=tamanhos.get)
ck('nenhum arquivo passa de 2.000 linhas', tamanhos[maior] <= 2000, f'maior: {maior} ({tamanhos[maior]})')

print('\n=== 4. TUDO CHEGA AO PAINEL PUBLICADO ===')
publicado = (BASE / 'index.html').read_text(encoding='utf-8')
defs = {}
for a in arquivos:
    for m in re.finditer(r'^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(', a.read_text(encoding='utf-8'), re.M):
        defs.setdefault(m.group(1), []).append(a.name)
faltando = [n for n in defs if not re.search(r'function\s+' + re.escape(n) + r'\s*\(', publicado)]
ck('cada função de app/ está no index.html', not faltando, ', '.join(faltando[:5]))

print('\n=== 5. NENHUMA FUNÇÃO EM DOIS ARQUIVOS ===')
dupla = {n: fs for n, fs in defs.items() if len(fs) > 1}
ck('nenhuma função definida duas vezes dentro de app/', not dupla, str(dupla)[:200])

print('\n=== RESULTADO ===')
print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
sys.exit(1 if falhas else 0)
