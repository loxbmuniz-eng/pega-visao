#!/usr/bin/env python3
"""Comentário de código não pode aparecer na tela do operador.

Aconteceu: um bloco `<!-- ... -->` da aba Portaria foi partido ao meio numa
edição. A abertura se perdeu e sobraram duas linhas soltas, que o navegador
passou a tratar como TEXTO. Entre o card de registro de placa e o do pátio,
o porteiro lia:

    O conteúdo é montado por renderVisaoPatio() — uma função só,
    alimentando as três abas. Duas cópias divergiriam na primeira
    correção feita com pressa. -->

Ficou no ar sem ninguém notar, porque nada olhava para isso: os testes
conferiam funções, contraste, colunas de tabela — nunca se havia texto de
manutenção vazando para a interface.

Duas conferências, e a segunda é a que importa:

1. ESTRUTURAL — os delimitadores de comentário fecham em pares no fonte.
   Pega o defeito no arquivo, apontando a linha.
2. RENDERIZADA — nenhum texto de código aparece nas abas do painel. Pega
   qualquer outra forma do mesmo problema, inclusive as que a checagem
   estrutural não prevê.

    python3 testes/test_comentarios_vazados.py
"""
import asyncio
import re
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE = Path(__file__).resolve().parent.parent
FONTE = BASE / 'index_suinco.html'
PAINEL = 'file://' + str(BASE / 'index.html')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def conferir_fonte():
    """Varre o HTML fonte procurando delimitador de comentário desemparelhado."""
    s = FONTE.read_text(encoding='utf-8')
    orfaos, i = [], 0
    while True:
        a, f = s.find('<!--', i), s.find('-->', i)
        if a == -1 and f == -1:
            break
        if a != -1 and (f == -1 or a < f):
            fim = s.find('-->', a)
            if fim == -1:
                orfaos.append(f'abertura sem fechamento na linha {s[:a].count(chr(10))+1}')
                break
            i = fim + 3
        else:
            orfaos.append(f'fechamento órfão na linha {s[:f].count(chr(10))+1}')
            i = f + 3
    ck('delimitadores de comentário emparelhados no fonte', not orfaos,
       '; '.join(orfaos) if orfaos else f"{s.count('<!--')} pares")


# Marcas de texto de código. Não é lista de palavras proibidas — é o que
# aparece em comentário de manutenção e nunca em texto para o operador.
MARCAS = [
    (r'-->', 'fechamento de comentário HTML'),
    (r'<!--', 'abertura de comentário HTML'),
    (r'\b\w+\(\)\s*—', 'chamada de função citada em prosa'),
    (r'/\*|\*/', 'delimitador de comentário JS/CSS'),
    (r'\bfunction\s+\w+\s*\(', 'declaração de função'),
]

ABAS = ['torre', 'programacao', 'portaria', 'expedicao', 'faturamento',
        'indicadores', 'cadastros', 'historico', 'relatorios']


async def conferir_tela():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(600)
        # Administração é o único setor que enxerga TODAS as abas, e o login
        # local não a oferece na lista (é setor de servidor). Promove depois
        # de entrar: a varredura precisa alcançar cada aba, inclusive a de
        # usuários — comentário vazado numa aba que ninguém varre continua
        # vazado.
        await pg.evaluate("""() => {
            DB.operador.setor = 'Administração';
            aplicarPermissoesSetor();
        }""")
        await pg.wait_for_timeout(300)

        achados = []
        for aba in ABAS:
            texto = await pg.evaluate("""(aba) => {
                const el = document.getElementById('tab-' + aba);
                if(!el) return null;
                abrirTab(aba);
                return el.innerText;
            }""", aba)
            if texto is None:
                continue
            for padrao, oque in MARCAS:
                for m in re.finditer(padrao, texto):
                    trecho = texto[max(0, m.start() - 40):m.start() + 40].replace('\n', ' ⏎ ')
                    achados.append(f'{aba}: {oque} → …{trecho.strip()}…')

        ck('nenhum texto de código visível nas abas', not achados,
           achados[0] if achados else f'{len(ABAS)} abas varridas')
        for a in achados[1:6]:
            print('        também:', a)

        await nav.close()


async def main():
    print('\n=== FONTE ===')
    conferir_fonte()
    print('\n=== TELA ===')
    await conferir_tela()
    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
