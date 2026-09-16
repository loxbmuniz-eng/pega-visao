#!/usr/bin/env python3
"""Cada arquivo de tema2027/ só pode existir dentro de `@media screen`.

O painel usa a MESMA folha de estilo para a tela e para o PDF do relatório
(`gerarPdf()` junta todos os `<style>` da página e manda para `page.pdf()`
em mídia `print` — ver `test_tema2027_papel.py`). Uma regra do Tema 2027
escrita fora de `@media screen` — ou um `@keyframes` de nível superior, ou
um `!important` fora do bloco de `prefers-reduced-motion` — não fica presa
à tela: ela vaza para o papel, ou atropela uma transição que o usuário
pediu para não animar.

Este teste é ESTÁTICO (não abre navegador): lê cada `tema2027/*.css`, tira
os comentários `/* */` e caminha pelo texto de NÍVEL SUPERIOR (fora de
chaves). Qualquer coisa aí que não seja `@media screen` ou
`@media screen and (...)` reprova. `!important` só é aceito dentro de um
bloco cujo cabeçalho de nível superior é
`@media screen and (prefers-reduced-motion: reduce)`.

    python3 testes/test_tema2027_so_tela.py
"""
import pathlib
import re
import sys

BASE = pathlib.Path(__file__).parent.parent
CAMADA = BASE / 'tema2027'

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


PADRAO_TOPO = re.compile(
    r'^@media\s+screen(\s+and\s*\([^()]*\))*$',
    re.IGNORECASE,
)
PADRAO_REDUZIDO = re.compile(
    r'@media\s+screen\s+and\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)',
    re.IGNORECASE,
)


def verificar_arquivo(caminho):
    """Retorna a lista de problemas encontrados no arquivo (vazia = limpo)."""
    problemas = []
    original = caminho.read_text(encoding='utf-8')
    texto = re.sub(r'/\*.*?\*/', '', original, flags=re.S)
    n = len(texto)
    header_por_pos = [None] * n
    depth = 0
    header_atual = None
    buf_header = ''
    for i, ch in enumerate(texto):
        header_por_pos[i] = header_atual
        if ch == '{':
            if depth == 0:
                header = buf_header.strip()
                buf_header = ''
                if not PADRAO_TOPO.match(re.sub(r'\s+', ' ', header)):
                    problemas.append(f'bloco de nível superior fora de @media screen: {header!r}')
                header_atual = header
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth <= 0:
                if depth < 0:
                    problemas.append('chave de fechamento sem abertura correspondente')
                depth = 0
                header_atual = None
        else:
            if depth == 0:
                buf_header += ch

    if buf_header.strip():
        problemas.append(f'conteúdo de nível superior fora de bloco: {buf_header.strip()!r}')
    if depth != 0:
        problemas.append(f'chaves desbalanceadas (depth final={depth})')

    for m in re.finditer(r'!important', texto):
        header = header_por_pos[m.start()]
        header_norm = re.sub(r'\s+', ' ', header) if header else ''
        if not header or not PADRAO_REDUZIDO.search(header_norm):
            trecho = texto[max(0, m.start() - 40):m.start()].replace('\n', ' ').strip()
            problemas.append(
                f'!important fora de prefers-reduced-motion (contexto: {header_norm!r}, '
                f'perto de: ...{trecho})')

    return problemas


def main():
    if not CAMADA.is_dir():
        ck('pasta tema2027/ existe', False, str(CAMADA))
        print('\n=== RESULTADO ===\n  FALHAS: pasta tema2027/ não existe')
        return 1

    arquivos = sorted(CAMADA.glob('*.css'))
    ck('existe pelo menos um arquivo em tema2027/*.css', len(arquivos) > 0)

    for caminho in arquivos:
        problemas = verificar_arquivo(caminho)
        ck(f'{caminho.name}: só @media screen, sem !important solto',
           not problemas, '; '.join(problemas))

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(main())
