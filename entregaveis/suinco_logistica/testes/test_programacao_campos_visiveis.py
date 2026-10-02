#!/usr/bin/env python3
"""Programação: todo campo de digitar é uma caixa que se vê (02/10/2026).

RELATO DO DONO, no dia em que o redesenho subiu: "na programação o contraste
e margem dos campos não preenchidos a serem editados, como motorista, placa,
tá aparecendo meio apagado, precisa estar bem destacado a margem de cada
campo, não precisa exagerar, mas tá meio desaparecendo", "meio translúcido".

A CAUSA: o redesenho (tema2027/90_hierarquia.css) fez a célula da Torre E a
da Montagem "parecerem texto" — fundo transparente, borda só embaixo. Na
Torre isso serve (é leitura com edição de passagem); na Programação é onde
se digita, e o campo vazio sumia.

O QUE ESTE TESTE TRAVA, em todos os campos visíveis da aba Programação
(formulário, Fila de Programados e Montagem do Dia), nos dois temas:
  1. borda nos QUATRO lados, sólida;
  2. fundo sólido (não transparente);
  3. contraste da borda contra o fundo do próprio campo E contra o fundo do
     cartão de 3:1 ou mais (o mínimo para a borda de um componente).
E que a Torre continua com a célula que parece texto.

Base: vitrine/demonstracao.json (dados inventados), só no navegador.

    bash testes/rodar_tudo.sh test_programacao_campos_visiveis
"""
import asyncio
import json
import os
import sys
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(AQUI)
PAINEL = os.environ.get('PAINEL') or ('file://' + os.path.join(BASE, 'index.html'))
DEMO = json.load(open(os.path.join(BASE, 'vitrine', 'demonstracao.json'), encoding='utf-8'))
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


SEMEAR = """(demo) => {
  ['cargas','movimentacoes','frota','transportadoras','rotasExtras'].forEach(k => { if(demo[k] !== undefined) DB[k] = demo[k]; });
  DB.operador = {nome:'Teste', setor:'Administração'};
  document.getElementById('modal-operador')?.classList.remove('open');
  if(typeof invalidarIndiceMovimentacoes === 'function') invalidarIndiceMovimentacoes();
  renderAll();
}"""

MEDIR = """(tema) => {
  document.documentElement.setAttribute('data-tema', tema);
  abrirTab('programacao');
  const rgba = s => { const n = (s.match(/[\\d.]+/g) || []).map(Number); return { r:n[0], g:n[1], b:n[2], a: n.length > 3 ? n[3] : 1 }; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
                     return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
  const contraste = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const fundoDe = el => { let e = el; while(e){ const c = rgba(getComputedStyle(e).backgroundColor); if(c.a > .95) return c; e = e.parentElement; } return {r:255,g:255,b:255,a:1}; };
  const ruins = []; let n = 0;
  for(const el of document.querySelectorAll('#tab-programacao input:not([type=hidden]):not([type=checkbox]):not([type=radio]), #tab-programacao select, #tab-programacao textarea')){
    if(!el.getClientRects().length || !el.offsetParent) continue;
    n++;
    const s = getComputedStyle(el);
    const lados = ['Top','Right','Bottom','Left'];
    const larg = lados.every(l => parseFloat(s['border' + l + 'Width']) >= 1 && s['border' + l + 'Style'] !== 'none');
    const borda = rgba(s.borderTopColor);
    const fundo = rgba(s.backgroundColor);
    const cartao = fundoDe(el.parentElement);
    const c1 = contraste(borda, fundo.a > .95 ? fundo : cartao), c2 = contraste(borda, cartao);
    const nome = el.id || el.className || el.tagName;
    if(!larg) ruins.push(nome + ': borda falta em algum lado');
    else if(borda.a < .95) ruins.push(nome + ': borda translúcida (' + borda.a + ')');
    else if(fundo.a < .95) ruins.push(nome + ': fundo translúcido (' + fundo.a + ')');
    else if(c1 < 3 || c2 < 3) ruins.push(nome + ': contraste da borda ' + c1.toFixed(2) + ' (campo) / ' + c2.toFixed(2) + ' (cartão) · borda ' + s.borderTopColor + ' · campo ' + s.backgroundColor + ' · cartão ' + JSON.stringify(cartao));
  }
  return { n, ruins };
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        erros = []
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(800)
        await pg.evaluate(SEMEAR, DEMO)
        await pg.wait_for_timeout(500)
        for tema in ('escuro', 'claro'):
            print(f'\n=== PROGRAMAÇÃO, TEMA {tema.upper()} ===')
            # troca o tema e ESPERA: a borda do campo tem transição de cor, e medir
            # logo depois da troca lê a cor do tema anterior, no meio do caminho.
            await pg.evaluate("(t) => { document.documentElement.setAttribute('data-tema', t); abrirTab('programacao'); }", tema)
            await pg.wait_for_timeout(600)
            r = await pg.evaluate(MEDIR, tema)
            ck(f'{tema}: há campos para conferir', r['n'] >= 10, f"{r['n']} campos")
            ck(f'{tema}: todo campo com borda nos 4 lados, fundo sólido e contraste >= 3:1',
               not r['ruins'], '; '.join(r['ruins'][:5]) + (f' (+{len(r["ruins"]) - 5})' if len(r['ruins']) > 5 else ''))
        print('\n=== A TORRE CONTINUA COM A CÉLULA QUE PARECE TEXTO ===')
        t = await pg.evaluate("""() => { document.documentElement.setAttribute('data-tema','escuro'); abrirTab('torre');
            const el = document.querySelector('#torre-tbody .peso-input'); if(!el) return null;
            return getComputedStyle(el).borderTopColor; }""")
        ck('Torre: campo sem borda em cima, em repouso', t is not None and t.replace(' ', '') in ('rgba(0,0,0,0)', 'transparent'), str(t))
        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()
    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
