#!/usr/bin/env python3
"""Nenhum texto do painel abaixo de 12 px (redesenho de 01/10/2026).

PEDIDO DO DONO: auditar letra, espaço e escala, para "o usuário saber o que
olhar primeiro" — respostas "1 b" (as 12 abas) e "2 b". Medido no painel
publicado (eaa842e): havia texto de 8,5 a 11,5 px em 9 abas — cabeçalho da
Torre a 10 px, status a 9,5–10,5 px, legenda de gráfico a 9 px, rótulos da
faixa de números a 9,5 px no celular. No chão do pátio isso não se lê.

O QUE ESTE TESTE TRAVA: nas 12 abas, no computador (1440) e no celular
(390), nenhum elemento VISÍVEL com texto próprio fica abaixo de 12 px. A
camada é tema2027/90_hierarquia.css; os relatórios em papel (@media print)
não entram — o papel tem a escala dele.

E prova que a régua funciona: um texto de 10 px plantado na página tem de
ser encontrado.

Base: vitrine/demonstracao.json (dados inventados), só no navegador.

    bash testes/rodar_tudo.sh test_piso_de_12px
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
ABAS = ['torre', 'patio', 'programacao', 'devolucoes', 'portaria', 'expedicao', 'faturamento',
        'indicadores', 'cadastros', 'historico', 'relatorios', 'frete', 'usuarios']
# A aba Pagamento de Frete (05/10/2026) não lê o localStorage: sem servidor ela
# desenha a demonstração gerada pela mesma função da API (vitrine/frete_demonstracao.json).
DEMO['frete'] = json.load(open(os.path.join(BASE, 'vitrine', 'frete_demonstracao.json'), encoding='utf-8'))
PISO = 12
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


SEMEAR = """(demo) => {
  // a base anda para hoje, como na vitrine (vitrine/rejuvenescer.js, decisão 29):
  // sem isso, toda carga dela fica "inativa" e a Torre sai vazia
  demo = rejuvenescerDemonstracao(demo);
  ['cargas','movimentacoes','frota','transportadoras','rotasExtras','alteracoes'].forEach(k => {
    if(demo[k] !== undefined) DB[k] = demo[k]; });
  /* Casos que a demonstração não tem e que têm letra própria: a mesma placa
     com duas cargas (chip "1 de 2"). Sem isto a régua não vê o chip. */
  const base = (DB.cargas || []).find(c => c.status !== 'Seguiu Viagem' && c.placa);
  if(base) DB.cargas.push(Object.assign({}, base, { id: base.id + '-dupla', numeroCarga: '900999', sequencia: 99 }));
  DB.operador = {nome:'Teste', setor:'Administração'};
  if(demo.frete) window.FRETE_DEMONSTRACAO = demo.frete;
  document.getElementById('modal-operador')?.classList.remove('open');
  if(typeof invalidarIndiceMovimentacoes === 'function') invalidarIndiceMovimentacoes();
  renderAll();
}"""

MEDIR = """([aba, piso]) => {
  abrirTab(aba);
  const achados = new Map();
  for(const e of document.querySelectorAll('#header *, #nav *, .tab-page.active *')){
    if(!e.offsetParent) continue;
    if(![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const fs = parseFloat(getComputedStyle(e).fontSize);
    if(fs < piso){
      const k = e.tagName.toLowerCase() + (e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : '')
        + ' ' + (Math.round(fs * 10) / 10) + 'px';
      achados.set(k, (achados.get(k) || 0) + 1);
    }
  }
  return [...achados.entries()].map(([k, n]) => k + ' ×' + n);
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        erros = []
        for nome, w, h, cel in [('computador (1440)', 1440, 900, False), ('celular (390)', 390, 844, True)]:
            print(f'\n=== {nome.upper()} ===')
            pg = await nav.new_page(viewport={'width': w, 'height': h}, is_mobile=cel, has_touch=cel)
            pg.on('pageerror', lambda e: erros.append(str(e)))
            await pg.goto(PAINEL)
            await pg.wait_for_timeout(800)
            await pg.add_script_tag(path=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'vitrine', 'rejuvenescer.js'))
            await pg.evaluate(SEMEAR, DEMO)
            await pg.wait_for_timeout(400)
            for aba in ABAS:
                r = await pg.evaluate(MEDIR, [aba, PISO])
                ck(f'{nome}, {aba}: nada abaixo de {PISO} px', not r, '; '.join(r[:6]))
            # a régua acha o que existe
            achou = await pg.evaluate("""(piso) => {
              const s = document.createElement('span'); s.textContent = 'régua'; s.style.fontSize = '10px';
              document.querySelector('.tab-page.active').appendChild(s);
              const v = parseFloat(getComputedStyle(s).fontSize) < piso && !!s.offsetParent; s.remove(); return v; }""", PISO)
            ck(f'{nome}: a régua encontra um texto de 10 px plantado', achou)
            await pg.close()
        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()
    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
