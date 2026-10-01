#!/usr/bin/env python3
"""Sem código morto e sem função em dois arquivos (01/10/2026).

PEDIDO DO DONO: item 4 da fila de evolução — limpar "restos de código" de
muitas atualizações. Levantamento medido em 01/10/2026: 12 funções que
ninguém chamava (celulaEtapa, abreviarEtapa, ordenarPorEtapaDaTimeline,
corTextoSobre, compartilhadaDaCarga, textoSobre, estaFaturado,
rankingDoDia e rankingTransportadoras, que só ela chamava,
podeAvancarEtapaDev, minhaEtapaDev, filtroDevolucoesHoje) — removidas.
`snapshotCarga` chegou a ser removida por engano: a primeira versão desta
conta não via a chamada `...snapshotCarga(c)`. Voltou antes de publicar.

E uma função em DOIS arquivos: `fmtHora` em data.js e em app/30_torre.js. A
de baixo vencia em silêncio, e ela não tratava o vazio — fmtHora(null)
virava "21:00". Ficou uma só, em data.js, que trata vazio e data inválida.

O QUE ESTE TESTE TRAVA, em todas as fontes do painel (não no index.html):
  1. toda função declarada é chamada ou citada em algum lugar além da
     própria definição (comentário não conta; `...f(x)` conta). Exceção
     declarada abaixo;
  2. nenhuma função é declarada em dois arquivos;
  3. fmtHora(null) e fmtHora('lixo') dão "—".

    python3 testes/test_sem_codigo_morto.py
"""
import glob
import os
import re
import subprocess
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(AQUI)
falhas = []

# Funções sem chamador NO CÓDIGO, de propósito — cada uma com o motivo.
CHAMADAS_DE_FORA = {
    'limparTravamentosUI': 'ferramenta de suporte: chamada no console e pelo test_medidor_de_travamento',
}


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


fontes = (['suinco-api.js', 'data.js', 'qr.js', 'graficos2027.js']
          + sorted(os.path.relpath(f, BASE) for f in glob.glob(os.path.join(BASE, 'app', '*.js')))
          + ['devolucoes.js', 'patio_vivo.js'])
textos = {f: open(os.path.join(BASE, f), encoding='utf-8').read() for f in fontes}
html = open(os.path.join(BASE, 'index_suinco.html'), encoding='utf-8').read()
tudo = '\n'.join(textos.values()) + '\n' + html
sem_comentario = re.sub(r'(?m)//.*$', '', re.sub(r'/\*.*?\*/', '', tudo, flags=re.S))


def usos(nome, texto):
    """Quantas vezes o nome aparece como ele mesmo — não como `obj.nome`.
    O espalhamento `...nome(c)` É chamada: os três pontos viram espaço antes
    da conta. Sem isso, `snapshotCarga`, chamada em 5 lugares assim, contou
    como morta e foi removida — e criar carga e mudar de etapa quebravam
    (pego antes de publicar, 01/10/2026, #104)."""
    return len(re.findall(r'(?<![\w$.])' + re.escape(nome) + r'(?![\w$])', texto.replace('...', '... ')))

defs = {}
for f, t in textos.items():
    for m in re.finditer(r'(?m)^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(', t):
        defs.setdefault(m.group(1), []).append(f)

print('\n=== 1. TODA FUNÇÃO TEM QUEM A CHAME ===')
mortas = []
for n, fs in defs.items():
    if n in CHAMADAS_DE_FORA:
        continue
    if usos(n, sem_comentario) <= len(fs) and not re.search(r'["\'`]\s*' + re.escape(n) + r'\b', tudo):
        mortas.append(f'{fs[0]}:{n}')
ck('nenhuma função sem chamador', not mortas, ', '.join(mortas))
ck('a conta enxerga chamada por espalhamento (`...f(x)`) e ignora `obj.f(x)`',
   usos('f', 'const a = {...f(x)};') == 1 and usos('f', 'obj.f(x);') == 0)

print('\n=== 2. NENHUMA FUNÇÃO EM DOIS ARQUIVOS ===')
duplas = {n: fs for n, fs in defs.items() if len(fs) > 1}
ck('cada função mora num arquivo só', not duplas, str(duplas))

print('\n=== 3. fmtHora TRATA VAZIO E DATA INVÁLIDA ===')
corpo = re.search(r'(?ms)^function fmtHora\(iso\)\{.*?^\}', textos['data.js'])
ck('fmtHora está no data.js', corpo is not None)
if corpo:
    js = corpo.group(0) + "\nconsole.log(JSON.stringify([fmtHora(null), fmtHora(''), fmtHora('lixo')]));"
    r = subprocess.run(['node', '-e', js], capture_output=True, text=True)
    ck('null, vazio e lixo dão "—"', r.stdout.strip() == '["—","—","—"]', r.stdout.strip() or r.stderr[:200])

print('\n=== RESULTADO ===')
print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
sys.exit(1 if falhas else 0)
