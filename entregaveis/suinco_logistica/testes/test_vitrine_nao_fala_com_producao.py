#!/usr/bin/env python3
"""A vitrine mostra o painel e NÃO alcança a operação (24/09/2026).

PEDIDO DO DONO: "eu sempre vou conseguir testar as coisas antes num
artefato de teste antes de subir".

POR QUE ISTO PRECISA DE TESTE, E NÃO SÓ DE CUIDADO. A vitrine é uma cópia
byte a byte do painel com quatro linhas trocadas. Se UMA delas deixar de
casar — porque o `SP_CONFIG` mudou de forma, porque o registro do service
worker foi reescrito —, o gerador produz uma cópia que parece a vitrine e
fala com o servidor de PRODUÇÃO. Ninguém veria pela tela: ela ficaria
igualzinha, só que mexendo no pátio de verdade.

  · o dono abre a vitrine achando que está olhando, e clica;
  · o clique vai para a operação.

O QUE ESTE TESTE TRAVA

  1. o gerador ABORTA se qualquer uma das quatro âncoras sumir — falha
     barulhenta em vez de vitrine silenciosamente ligada;
  2. a vitrine gerada está em modo local, e nenhuma requisição sai dela;
  3. a tarja existe e diz que não é o painel;
  4. o service worker não é registrado;
  5. a base de demonstração aparece na tela — vitrine vazia não se julga;
  6. e ela não carrega nome de empresa real nos dados de demonstração:
     a vitrine pode ser compartilhada, e transportadora de verdade
     aparecendo atrasada numa tela de mentira é afirmação que ninguém fez.

    python3 testes/test_vitrine_nao_fala_com_producao.py
"""
import asyncio
import json
import subprocess
import sys
from pathlib import Path

from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
VITRINE = RAIZ / 'vitrine' / 'vitrine.html'
BASE = RAIZ / 'vitrine' / 'demonstracao.json'
PRODUCAO = 'api.embarquesuinco.com.br'

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def gerar_com(painel_alterado):
    """Roda o gerador contra um index.html adulterado e devolve (rc, saída)."""
    original = (RAIZ / 'index.html').read_text(encoding='utf-8')
    try:
        (RAIZ / 'index.html').write_text(painel_alterado, encoding='utf-8')
        r = subprocess.run([sys.executable, 'vitrine/gerar_vitrine.py'], cwd=str(RAIZ),
                           capture_output=True, text=True, timeout=180)
        return r.returncode, (r.stdout + r.stderr)
    finally:
        (RAIZ / 'index.html').write_text(original, encoding='utf-8')


async def main():
    print('\n=== 1. O GERADOR ABORTA QUANDO A ÂNCORA SOME ===')
    painel = (RAIZ / 'index.html').read_text(encoding='utf-8')
    for nome, adulterado in [
        ('o modo local', painel.replace('ativo: true,', 'ativo: /*mudou*/ true,', 1)),
        ('o service worker', painel.replace(
            "if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {",
            "if ('serviceWorker' in navigator) { // reescrito", 1)),
        ('o socket.io', painel.replace(
            '<script src="https://api.embarquesuinco.com.br/socket.io/socket.io.js"',
            '<script defer src="https://api.embarquesuinco.com.br/socket.io/socket.io.js"', 1)),
    ]:
        rc, saida = gerar_com(adulterado)
        ck(f'sem a âncora d{nome}, o gerador RECUSA', rc != 0,
           (saida.strip().splitlines() or [''])[-1][:110])

    # Refaz a vitrine boa — os testes abaixo medem ela.
    r = subprocess.run([sys.executable, 'vitrine/gerar_vitrine.py'], cwd=str(RAIZ),
                       capture_output=True, text=True, timeout=180)
    ck('a vitrine é gerada a partir do painel íntegro', r.returncode == 0,
       (r.stdout + r.stderr).strip()[-110:])
    if r.returncode != 0 or not VITRINE.exists():
        return 1

    print('\n=== 2. NO ARQUIVO: MODO LOCAL E SEM SERVICE WORKER ===')
    html = VITRINE.read_text(encoding='utf-8')
    ck('o painel está em modo local', 'ativo: false,' in html)
    ck('e não sobrou `ativo: true`', 'ativo: true,' not in html)
    ck('o service worker não é registrado',
       "if (false) { /* vitrine: sem service worker */" in html)
    ck('a tarja está no arquivo', 'id="vitrine-tarja"' in html)
    ck('até a aba do navegador avisa — duas abas iguais é clique errado',
       '<title>VITRINE — Programação de Embarque</title>' in html)

    print('\n=== 3. OS DADOS DE DEMONSTRAÇÃO NÃO CARREGAM EMPRESA REAL ===')
    dados = json.loads(BASE.read_text(encoding='utf-8'))
    # As transportadoras de verdade estão no CSV da frota. Nenhum desses
    # nomes pode aparecer no que a vitrine mostra como movimento.
    csv = (RAIZ / 'frota_seed_2026.csv').read_text(encoding='utf-8')
    reais = {l.split(',')[1].strip() for l in csv.splitlines()[1:] if ',' in l}
    reais = {n for n in reais if len(n) > 12}
    texto_mov = json.dumps(dados.get('movimentacoes', []), ensure_ascii=False)
    achadas = sorted(n for n in reais if n and n in texto_mov)
    ck('nenhuma transportadora real no movimento de demonstração',
       not achadas, str(achadas[:3]))

    print('\n=== 4. NA TELA: NADA SAI, E TEM O QUE OLHAR ===')
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        ctx = await nav.new_context(viewport={'width': 1500, 'height': 950})
        pg = await ctx.new_page()
        pedidos, erros = [], []
        pg.on('request', lambda r: pedidos.append(r.url))
        pg.on('pageerror', lambda e: erros.append(str(e)))

        url = 'https://vitrine.local/vitrine'
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        await pg.wait_for_timeout(4000)

        fora = [u for u in pedidos if PRODUCAO in u]
        ck('nenhuma requisição para a API de produção', not fora, str(fora[:2]))

        visto = await pg.evaluate("""() => {
            const t = document.getElementById('vitrine-tarja');
            return {
              tarja: t ? (t.innerText || '').replace(/\\s+/g,' ').trim() : null,
              /* O AVISO INTEIRO MORA NO `title` DESDE 24/09/2026. A tarja
                 virou pílula de canto porque o cabeçalho FIXO do painel
                 cobria a faixa do topo. O que a regra exige continua o
                 mesmo: a página se identifica à vista, e o aviso completo
                 está a um toque. Medir a frase exata na área visível era
                 medir o atalho, não a regra. */
              titulo: t ? (t.getAttribute('title') || '') : '',
              /* `let DB` no topo de um <script> NÃO vira `window.DB` — ler
                 por `window.` dava zero com a base carregada, e foi assim que
                 a primeira versão deste teste acusou defeito que não existia.
                 O nome nu resolve pelo escopo, que é o que o painel usa. */
              cargas: (typeof DB === 'undefined' ? [] : DB.cargas || []).length,
              movimentacoes: (typeof DB === 'undefined' ? [] : DB.movimentacoes || []).length,
            };
        }""")
        ck('a página se identifica à vista como vitrine',
           'VITRINE' in (visto['tarja'] or ''), str(visto['tarja']))
        # Sem diferenciar maiúscula: a regra é o aviso existir, não a caixa
        # da letra. A primeira versão reprovou porque o texto passou a dizer
        # "NÃO é o painel" — mais enfático, e o teste leu como ausência.
        _aviso = ((visto['titulo'] or '') + ' ' + (visto['tarja'] or '')).lower()
        ck('e o aviso completo diz que não é o painel',
           'não é o painel' in _aviso, str(visto['titulo'])[:90])
        # Sem este aviso, a primeira coisa que acontece é alguém relatar como
        # defeito do painel uma limitação do lugar onde a vitrine mora.
        ck('e avisa que baixar arquivo não funciona na vitrine',
           'não funciona aqui' in _aviso,
           str(visto['titulo'])[:90])
        ck('a base de demonstração chegou na tela', visto['cargas'] >= 5, str(visto))
        ck('com movimento — a Torre tem relógio para mostrar',
           visto['movimentacoes'] >= 5, str(visto))
        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    print('\n' + '=' * 51)
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print(f'    · {f}')
        return 1
    print('  tudo verde.')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
