#!/usr/bin/env python3
"""Clicar num gráfico do Custo de Frete não pode apagar os gráficos.

RELATO DO DONO (28/08/2026), com foto da tela no Mac dele:
  "os graficos somem quando tento interagir com eles"

A CAUSA, encontrada pela pilha do erro

  TypeError: this._fn is not a function
      at Cs.tick   (animador)
      at Cs.cancel
      at bt.stop
      at An.stop / An._stop   (destroy do gráfico)

  Cada filtro redesenha os oito gráficos, e redesenhar aqui é destruir e
  recriar (grafico() faz destroy + new Chart). Quando o destroy pegava uma
  ANIMAÇÃO em curso, o Chart.js cancelava um quadro que já tinha perdido a
  função dele e quebrava no meio do caminho: o painel ficava em branco.

  Havia um segundo defeito na mesma linha: o onClick chamava render() na
  hora, ou seja, o gráfico se destruía DENTRO do evento de clique que o
  próprio Chart.js ainda estava despachando.

O QUE ESTE TESTE MEDE
  Conta os pixels pintados de cada canvas antes e depois de clicar. Gráfico
  que "some" é um canvas que fica em branco — e branco é um número. Também
  reprova em qualquer erro de JavaScript: aqui o erro era a origem do
  sintoma, e um painel que quebra calado é o que faz o dono descobrir na
  frente da diretoria.

    python3 testes/test_custo_frete_clique_nao_apaga_grafico.py
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

ARQ = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..',
                   'Suinco_Custo_Frete_WRVDA551.html')
URL = 'file://' + os.path.normpath(ARQ)
falhas = []

# Os quatro gráficos que filtram ao clique, com os campos que cada um
# mexe. O gráfico de meses mexe em DOIS (recorta o mês clicado dos dois
# lados): olhar só o primeiro fazia o teste reprovar ao clicar em jan/26,
# que já era o começo do recorte — o filtro tinha sido aplicado, quem
# mediu errado fui eu.
CLICAVEIS = [('cItem', ['fItem']), ('cRegional', ['fRegional']),
             ('cTransp', ['fTransp']), ('cMes', ['fMesDe', 'fMesAte'])]

TINTA = """() => { const o={}; document.querySelectorAll('canvas').forEach(c=>{
  try{ const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data; let n=0;
    for(let i=3;i<d.length;i+=4){ if(d[i]>8) n++; } o[c.id]=n; }catch(e){ o[c.id]=-1; } }); return o; }"""


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def clicar_primeira_barra(pg, cid):
    """Clica no centro REAL da primeira barra, perguntando ao próprio
    gráfico onde ela está. Chutar coordenada faz o teste passar por não ter
    acertado nada — foi o que quase aconteceu ao investigar isto."""
    await pg.evaluate(f"() => document.getElementById('{cid}').scrollIntoView({{block:'center'}})")
    await pg.wait_for_timeout(250)
    pos = await pg.evaluate(f"""() => {{
      const c = G['{cid}']; if(!c) return null;
      const el = c.getDatasetMeta(0).data[0]; if(!el) return null;
      const p = el.getCenterPoint(); const b = c.canvas.getBoundingClientRect();
      return {{x: b.x + p.x, y: b.y + p.y}}; }}""")
    if not pos:
        return False
    await pg.mouse.click(pos['x'], pos['y'])
    await pg.wait_for_timeout(800)
    return True


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1600, 'height': 1000})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        pg.on('console', lambda m: erros.append('console: ' + m.text[:200])
              if m.type == 'error' else None)
        await pg.goto(URL)
        await pg.wait_for_timeout(2200)

        print('\n=== 1. OS OITO GRÁFICOS DESENHAM AO ABRIR ===')
        base = await pg.evaluate(TINTA)
        ck('o arquivo tem os oito gráficos', len(base) == 8, f"{len(base)} canvas")
        vazios = [k for k, v in base.items() if v < 500]
        ck('nenhum gráfico nasce em branco', not vazios, f"em branco: {vazios}")

        print('\n=== 2. A ANIMAÇÃO ESTÁ DESLIGADA (É A CAUSA DO ERRO) ===')
        anim = await pg.evaluate("() => Chart.defaults.animation")
        ck('animação desligada no padrão do Chart.js', anim is False, str(anim))

        print('\n=== 3. CLICAR FILTRA E NENHUM GRÁFICO SOME ===')
        for cid, campos in CLICAVEIS:
            await pg.evaluate("() => document.getElementById('btnLimpar').click()")
            await pg.wait_for_timeout(700)
            antes = await pg.evaluate(TINTA)
            ler = f"() => {campos!r}.map(id => document.getElementById(id).value)".replace("'", '"')
            valorAntes = await pg.evaluate(ler)
            acertou = await clicar_primeira_barra(pg, cid)
            ck(f'{cid}: o teste acertou uma barra de verdade', acertou)
            if not acertou:
                continue
            depois = await pg.evaluate(TINTA)
            valorDepois = await pg.evaluate(ler)

            brancos = [k for k, v in depois.items() if v < 500]
            ck(f'{cid}: nenhum gráfico ficou em branco depois do clique',
               not brancos, f"em branco: {brancos}")
            ck(f'{cid}: o clique aplicou o filtro em {"/".join(campos)}',
               valorDepois != valorAntes, f"{valorAntes} → {valorDepois}")
            mudaram = [k for k in depois if depois[k] != antes[k]]
            # O painel inteiro responde ao recorte: gráfico que não muda com
            # o filtro é a mesma doença por outro sintoma.
            ck(f'{cid}: o painel inteiro se redesenhou',
               len(mudaram) >= 6, f"{len(mudaram)} de 8 gráficos mudaram")

        print('\n=== 4. LIMPAR OS FILTROS DEVOLVE O PAINEL ===')
        await pg.evaluate("() => document.getElementById('btnLimpar').click()")
        await pg.wait_for_timeout(900)
        volta = await pg.evaluate(TINTA)
        ck('depois de limpar, o painel volta ao desenho original',
           volta == base, 'o desenho não voltou ao estado inicial')

        ck('nenhum erro de JavaScript em toda a sessão de cliques',
           not erros, ' | '.join(erros[:3]))
        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f"  {len(falhas)} FALHA(S):")
        for f in falhas:
            print(f"    - {f}")
        sys.exit(1)
    print('  Tudo verde.')


asyncio.run(main())
