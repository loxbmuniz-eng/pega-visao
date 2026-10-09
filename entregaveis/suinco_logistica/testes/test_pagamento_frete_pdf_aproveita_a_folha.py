#!/usr/bin/env python3
"""O PDF do Pagamento de Frete aproveita a folha e nunca separa a nota da sua carga (09/10/2026).

RELATO DO DONO, com o PDF de 09/10/2026 (32 cargas, 270 notas pendentes):

  "o relatorio ta saindo com algumas partes tipo uma linha pra uma pagina
   inteira" ... "eu quero que voce arrume o relatorio do painel pra sair certo"

O PDF tinha 20 folhas. Quatro delas (3, 6, 13 e 17) tinham UMA linha só: a
carga, com o resto da folha em branco — e as notas dela começando na folha
seguinte.

A CAUSA, reproduzida antes de qualquer correção (mesma família da #72):

    .frete-pdf tbody.fpdf-grupo{ break-inside:avoid; page-break-inside:avoid }

O `avoid` envolvia a carga E a lista inteira de notas dela. Quando o grupo não
cabe no que sobra da folha, o navegador empurra o grupo inteiro para a folha
seguinte (o vão no pé da folha anterior). Quando o grupo é maior que uma folha
inteira, o `avoid` não tem como ser cumprido: o navegador parte onde pode — e a
única fronteira que sobra é entre a linha da carga e a linha das notas (cada
<tr> é indivisível por `.print-page tr`). A carga fica sozinha numa folha e as
notas vão para a outra: exatamente o que a regra queria impedir ("nota
pendente numa folha e a carga dela na outra é o tipo de papel que faz pagar a
transportadora errada").

A CORREÇÃO muda a proteção de nível, como na #72:
  · a lista de notas PODE continuar na folha seguinte;
  · cada NOTA continua indivisível (`.print-page tr`);
  · a linha da carga não fica no pé da folha sem o começo das suas notas;
  · a identificação da carga (número e transportadora) fica no cabeçalho da
    lista de notas, que o navegador REPETE em cada folha de continuação —
    nenhuma folha tem nota sem dizer de que carga ela é.

E UM SEGUNDO VÃO, achado ao medir a primeira correção: a célula que segura a
lista tinha 8px de padding embaixo. Com eles o Chromium não começa a lista no
pé da folha — empurra carga e lista para a seguinte (folha 1 com 39% usada,
17 folhas). Sem eles, a lista começa onde a carga está. O respiro antes da
próxima carga continua, pela margem de 6px que toda tabela tem no papel.

O QUE ESTE TESTE TRAVA, medindo o PDF gerado do jeito que o servidor gera
(mesmo HTML de `freteMontarPdf()`, mesmo CSS de `coletarCssDoPainel()`, mesmo
`@page{size:A4 landscape;margin:5mm}` de backend/src/servicos/pdf.js):
  1. nenhuma folha termina numa carga sem o começo das notas dela;
  2. toda folha que tem nota diz de que carga ela é (linha da carga ou o
     cabeçalho repetido da lista);
  3. as 270 notas saem, cada uma exatamente uma vez;
  4. nenhuma folha, fora a última, fica com mais de um quarto em branco no pé.
     O maior bloco que não pode partir — uma carga com o título, o cabeçalho e
     a primeira nota da lista — ocupa uns 15% da folha; vão maior que 25% é a
     folha desperdiçada que o dono mandou arrumar.

MEDIDO com estes dados (Chromium 141, o da bateria, e 149, o do servidor —
resultado idêntico nos dois):
  · publicado (07b412e): 22 folhas, 4 com uma linha só, pior folha 7% usada;
  · só a lista partindo, com o padding: 17 folhas, pior folha 39% usada;
  · correção inteira: 16 folhas, nenhuma abaixo de 84% fora a última.

Os dados são INVENTADOS (cargas 9010xx), com a MESMA distribuição de notas por
carga do PDF de 09/10/2026 — é a forma do relatório que reproduz o defeito.
Precisa do `pdftotext` (poppler-utils) para ler o PDF.

    bash testes/rodar_tudo.sh pagamento_frete_pdf_aproveita_a_folha
"""
import asyncio
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
PAINEL = 'file://' + str(RAIZ / 'index.html')
DEMO = RAIZ / 'vitrine' / 'frete_demonstracao.json'
CHROMIUM = '/opt/pw-browsers/chromium'
falhas = []


def ck(nome, ok, extra=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {extra}" if extra else ''))
    if not ok:
        falhas.append(nome)


# Notas pendentes por carga, na ordem do PDF de 09/10/2026.
NOTAS_POR_CARGA = [2, 13, 2, 11, 30, 9, 50, 15, 1, 22, 4, 1, 2, 1, 1, 6,
                   1, 2, 2, 44, 1, 1, 1, 1, 1, 1, 36, 2, 0, 6, 1, 0]
TRANSPORTADORAS = ['Transp. Exemplo A', 'Transportadora Exemplo de Nome Comprido Ltda',
                   'Exemplo Logística e Transportes Ltda', 'Cooperativa Exemplo de Transportes de Cargas Ltda']
CLIENTES = ['Mercado Exemplo Ltda ME', 'Comercial Exemplo de Alimentos e Bebidas Ltda EPP',
            'Supermercado Exemplo', 'Atacadista Exemplo de Gêneros Alimentícios e Varejo Ltda']
CIDADES = ['Uberlândia', 'São Gonçalo do Sapucaí', 'Anápolis', 'Aparecida de Goiânia']


def montar_dados():
    """Mesmo formato da saída de montarGrade() (a da API), com 32 cargas."""
    demo = json.loads(DEMO.read_text(encoding='utf-8'))
    colunas = demo['colunas']
    ix = {c['chave']: i for i, c in enumerate(colunas)}
    linhas, nota_da_carga = [], {}
    for k, n in enumerate(NOTAS_POR_CARGA):
        carga = 901000 + k
        transp = TRANSPORTADORAS[k % len(TRANSPORTADORAS)]
        base = [None] * len(colunas)
        base[ix['data']] = '2026-10-08'
        base[ix['carga']] = carga
        base[ix['qtdSist']] = n + 20
        base[ix['qtdB2b']] = n + 18
        base[ix['finalizadas']] = 20
        base[ix['situacao']] = 'PENDENTE' if n else 'LIBERADA'
        base[ix['statusPagamento']] = 'A PAGAR' if n else 'INTEGRAL'
        base[ix['transportadora']] = transp
        base[ix['entregue']] = 0.5
        base[ix['liberado']] = 0.5
        base[ix['aPagar']] = 0.5
        base[ix['canhoto']] = 'NÃO'
        if not n:
            base[ix['resumo']] = 'SEM PENDÊNCIA'
            linhas.append(dict(carga=carga, primeira=True, nota=None, categoria=None, cliente='', cidade='',
                               obsNota='', obsCarga='', vistoEm=None, idadeDias=None, v=base))
            continue
        for j in range(n):
            nota = str(7100000 + k * 100 + j)
            nota_da_carga[nota] = carga
            v = list(base) if j == 0 else [None] * len(colunas)
            if j:
                v[ix['data']] = '2026-10-08'
                v[ix['carga']] = carga
                v[ix['situacao']] = 'PENDENTE'
                v[ix['transportadora']] = transp
            v[ix['resumo']] = f'{nota} (Aguardando)'
            linhas.append(dict(carga=carga, primeira=(j == 0), nota=nota, categoria='aguardando',
                               cliente=CLIENTES[(k + j) % len(CLIENTES)], cidade=CIDADES[(k * 3 + j) % len(CIDADES)],
                               obsNota='', obsCarga='', vistoEm=None, idadeDias=(j % 3), v=v))
    dados = dict(demo)
    dados['linhas'] = linhas
    return dados, nota_da_carga


def texto_por_folha(pdf_bytes):
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / 'frete.pdf'
        arq.write_bytes(pdf_bytes)
        n = len(re.findall(rb'/Type\s*/Page[^s]', pdf_bytes))
        folhas = []
        for p in range(1, n + 1):
            r = subprocess.run(['pdftotext', '-layout', '-f', str(p), '-l', str(p), str(arq), '-'],
                               capture_output=True, text=True, errors='replace')
            folhas.append(r.stdout)
        return folhas


def uso_por_folha(pdf_bytes):
    """Quanto da altura útil de cada folha o conteúdo ocupa (%), do topo até o
    pé do texto mais baixo. Útil = altura da folha menos 5mm em cima e embaixo."""
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / 'frete.pdf'
        arq.write_bytes(pdf_bytes)
        xml = subprocess.run(['pdftotext', '-bbox', str(arq), '-'],
                             capture_output=True, text=True, errors='replace').stdout
    margem = 5 / 25.4 * 72
    uso = []
    for altura, corpo in re.findall(r'<page width="[\d.]+" height="([\d.]+)">(.*?)</page>', xml, re.S):
        util = float(altura) - 2 * margem
        pes = [float(y) for y in re.findall(r'yMax="([\d.]+)"', corpo)]
        uso.append(round((max(pes) - margem) / util * 100) if pes else 0)
    return uso


def eventos(txt, nota_da_carga):
    """Na ordem da folha: ('carga', n) | ('titulo', n) | ('vazio', None) | ('nota', n)."""
    ev = []
    for linha in txt.splitlines():
        m = re.match(r'\s*\d\d/\d\d/\d{4}\s+(\d{6})\b', linha)
        if m:
            ev.append(('carga', int(m.group(1))))
            continue
        m = re.search(r'DA CARGA (\d{6})', linha, re.I)
        if m:
            ev.append(('titulo', int(m.group(1))))
            continue
        if 'Nenhuma nota pendente' in linha:
            ev.append(('vazio', None))
            continue
        m = re.match(r'\s*(\d{7})\b', linha)
        if m and m.group(1) in nota_da_carga:
            ev.append(('nota', m.group(1)))
    return ev


async def main():
    # Sem o leitor de PDF o teste não enxerga nada — e "não vi defeito" não
    # pode passar por "não tem defeito".
    if not shutil.which('pdftotext'):
        print('  [FALHA] pdftotext não instalado (apt-get install poppler-utils): sem ele não há como ler o PDF')
        sys.exit(1)
    dados, nota_da_carga = montar_dados()
    total_notas = len(nota_da_carga)
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROMIUM)
        pg = await nav.new_page()
        await pg.goto(PAINEL)
        await pg.wait_for_function('typeof freteMontarPdf === "function" && typeof coletarCssDoPainel === "function"')
        html = await pg.evaluate("""(d) => { FRETE.dados = d; return freteMontarPdf().html; }""", dados)
        css = await pg.evaluate('() => coletarCssDoPainel()')
        await pg.close()

        # Exatamente como backend/src/servicos/pdf.js monta e imprime.
        folha = '@page{size:A4 landscape;margin:5mm}'
        doc = (f'<!doctype html><html><head><meta charset="utf-8"><style>{css}</style>'
               f'<style>{folha}</style></head><body>{html}</body></html>')
        pg = await nav.new_page()
        await pg.set_content(doc, wait_until='load')
        await pg.evaluate('() => document.fonts.ready')
        await pg.emulate_media(media='print')
        altura = await pg.evaluate("() => Math.round(document.querySelector('.frete-pdf').getBoundingClientRect().height)")
        pdf = await pg.pdf(format='A4', landscape=True, print_background=True)
        await nav.close()

    folhas = texto_por_folha(pdf)
    uso = uso_por_folha(pdf)
    UTIL_PX = 200 * 96 / 25.4          # 210mm − 2×5mm de margem
    minimo = math.ceil(altura / UTIL_PX)
    print(f'\n  {len(NOTAS_POR_CARGA)} cargas, {total_notas} notas · conteúdo {altura}px · '
          f'{minimo} folha(s) se não houvesse cabeçalho repetido nem quebra · saiu {len(folhas)}')
    print(f'  uso de cada folha (%): {uso}')

    sozinhas, sem_dono, vistas = [], [], {}
    for n, txt in enumerate(folhas, 1):
        ev = eventos(txt, nota_da_carga)
        # Folha que termina na carga, ou no título da lista sem nenhuma nota
        # embaixo, é a mesma folha com uma linha só que o dono mandou.
        if ev and ev[-1][0] in ('carga', 'titulo'):
            sozinhas.append((n, ev[-1][1]))
        ident = {c for t, c in ev if t in ('carga', 'titulo')}
        for t, nota in ev:
            if t == 'nota':
                vistas[nota] = vistas.get(nota, 0) + 1
                if nota_da_carga[nota] not in ident:
                    sem_dono.append((n, nota_da_carga[nota]))

    ck('nenhuma folha termina numa carga sem o começo das notas dela', not sozinhas,
       f'folha/carga: {sozinhas[:6]}' if sozinhas else '')
    sd = sorted(set(sem_dono))
    ck('toda folha com nota diz de que carga ela é', not sd, f'folha/carga sem identificação: {sd[:6]}' if sd else '')
    faltando = [nt for nt in nota_da_carga if nt not in vistas]
    repetidas = [nt for nt, q in vistas.items() if q > 1]
    ck(f'as {total_notas} notas saem, cada uma uma vez só', not faltando and not repetidas,
       f'faltando {len(faltando)}, repetidas {len(repetidas)}' if (faltando or repetidas) else '')
    USO_MINIMO = 75
    desperdicadas = [(n, u) for n, u in enumerate(uso[:-1], 1) if u < USO_MINIMO]
    ck(f'nenhuma folha, fora a última, fica com mais de {100 - USO_MINIMO}% em branco no pé',
       len(uso) == len(folhas) and not desperdicadas,
       f'folha/uso%: {desperdicadas[:8]}' if desperdicadas else
       ('' if len(uso) == len(folhas) else f'leitura do PDF divergiu: {len(uso)} vs {len(folhas)} folhas'))

    print()
    if falhas:
        print(f'REPROVADO: {len(falhas)} falha(s)')
        sys.exit(1)
    print('APROVADO')


asyncio.run(main())
