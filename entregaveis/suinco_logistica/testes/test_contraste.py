#!/usr/bin/env python3
"""Nenhum texto do painel pode sumir no próprio fundo.

O defeito que motivou isto: no painel "Cargas em aberto por status" o
número de cada etapa era pintado com `cor.texto` do status — que é o `-fg`
da badge, a cor feita para ficar EM CIMA do preenchimento colorido. Em
"Aguardando Embarque" esse valor é #1a1200, quase preto. Sobre a badge
laranja, perfeito; solto no card azul-escuro, invisível.

É o mesmo erro que já tinha acontecido no relatório impresso, em outra
superfície: confundir "cor do texto DENTRO do status" com "cor do status
COMO texto".

Este teste não confere um elemento: varre TODAS as abas, nos DOIS temas, e
mede cada texto visível contra o fundo que ele realmente tem — subindo a
árvore até achar um ancestral opaco, porque o painel usa superfícies
translúcidas e o fundo do elemento quase nunca é o que se vê.

Limiares (WCAG AA): 4.5 para texto normal, 3.0 para texto grande
(18px+, ou 14px+ em negrito).

    python3 testes/test_contraste.py
"""
import asyncio
import sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'

ABAS = ['torre', 'programacao', 'portaria', 'expedicao', 'faturamento',
        'indicadores', 'cadastros', 'historico', 'relatorios', 'usuarios']

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


# A medição roda no navegador: só lá existe o valor calculado de cada
# elemento, com tema, herança e estilo inline já resolvidos.
MEDIR = """
() => {
  const val = t => {
    const n = (t.match(/[\\d.]+/g) || []).map(Number);
    return { r:n[0]||0, g:n[1]||0, b:n[2]||0, a:n.length>3 ? n[3] : 1 };
  };
  const sobre = (f, t) => ({
    r: f.r*f.a + t.r*(1-f.a),
    g: f.g*f.a + t.g*(1-f.a),
    b: f.b*f.a + t.b*(1-f.a),
    a: 1
  });
  const lum = c => {
    const ch = v => { v/=255; return v<=.03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); };
    return .2126*ch(c.r) + .7152*ch(c.g) + .0722*ch(c.b);
  };
  const razao = (a,b) => { const x=lum(a), y=lum(b);
    return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };

  // Gradiente conta como fundo. Um botão com `background:linear-gradient()`
  // tem backgroundColor TRANSPARENTE — a primeira versão deste teste subia
  // por cima dele e media o texto do botão contra o card, acusando 1.18 em
  // botões perfeitamente legíveis. Média das paradas de cor: para os
  // gradientes deste painel (variações do mesmo tom) é uma aproximação
  // justa do que o olho vê no meio do botão, que é onde o texto está.
  const doGradiente = g => {
    const img = g.backgroundImage;
    if(!img || img === 'none') return null;
    const paradas = img.match(/rgba?\\([^)]*\\)/g);
    if(!paradas || !paradas.length) return null;
    const cs = paradas.map(val).filter(c => c.a > .05);
    if(!cs.length) return null;
    return {
      r: cs.reduce((s,c)=>s+c.r,0)/cs.length,
      g: cs.reduce((s,c)=>s+c.g,0)/cs.length,
      b: cs.reduce((s,c)=>s+c.b,0)/cs.length,
      a: cs.reduce((s,c)=>s+c.a,0)/cs.length
    };
  };

  // O fundo REAL: sobe a árvore empilhando as camadas translúcidas até
  // encontrar uma opaca. O painel é feito de vidro — o background-color do
  // próprio elemento quase nunca é o que o olho vê.
  const fundoReal = el => {
    const pilha = [];
    for(let e = el; e; e = e.parentElement){
      const g = getComputedStyle(e);
      const grad = doGradiente(g);
      const c = grad || val(g.backgroundColor);
      if(c.a === 0) continue;
      pilha.push(c);
      if(c.a >= .999) break;
    }
    let base = pilha.pop() || {r:255,g:255,b:255,a:1};
    while(pilha.length) base = sobre(pilha.pop(), base);
    return base;
  };

  const achados = [];
  const raiz = document.querySelector('.tab-page.active');
  if(!raiz) return achados;

  raiz.querySelectorAll('*').forEach(el => {
    // Só elementos que pintam texto PRÓPRIO — nó de texto direto filho.
    const proprio = [...el.childNodes]
      .some(n => n.nodeType === 3 && n.textContent.trim().length > 0);
    if(!proprio) return;

    const g = getComputedStyle(el);
    if(g.visibility === 'hidden' || g.display === 'none' || +g.opacity === 0) return;
    const r = el.getBoundingClientRect();
    if(r.width < 2 || r.height < 2) return;

    const fundo = fundoReal(el);
    let cor = val(g.color);
    // opacity do elemento esmaece o texto CONTRA o fundo: entra na conta,
    // senão .st-zero (opacity .4) passaria sem ser medido.
    const op = +g.opacity;
    if(op < 1) cor = sobre({...cor, a: cor.a * op}, fundo);
    else if(cor.a < 1) cor = sobre(cor, fundo);

    const px = parseFloat(g.fontSize);
    const peso = parseInt(g.fontWeight) || 400;
    const grande = px >= 18 || (px >= 14 && peso >= 700);
    const minimo = grande ? 3.0 : 4.5;
    const rz = razao(cor, fundo);

    if(rz < minimo){
      achados.push({
        texto: el.textContent.trim().slice(0, 34),
        classe: (el.className || '').toString().slice(0, 46),
        tag: el.tagName.toLowerCase(),
        cor: g.color, fundo: `rgb(${fundo.r|0}, ${fundo.g|0}, ${fundo.b|0})`,
        razao: Math.round(rz*100)/100, minimo, px
      });
    }
  });
  return achados;
}
"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1440, 'height': 950})
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(1000)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)

        # Dados em TODAS as etapas: um status sem carga não pinta célula, e
        # a etapa que não aparece é justamente a que pode estar invisível.
        await pg.evaluate("""() => {
            DB.operador.setor = 'Administração'; aplicarPermissoesSetor();
            DB.cargas = []; DB.movimentacoes = [];
            const ordem = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
                           'Embarque Finalizado','Faturado','Seguiu Viagem'];
            ordem.forEach((alvo, k) => {
                for(let i = 0; i < 2; i++){
                    const n = DB.cargas.length, f = DB.frota[n];
                    criarCargaProgramada({ placa:f.placa, numeroCarga:String(10240+n),
                        peso:12000+n*500, rota:'50'+(n%5), motorista:'José da Silva',
                        qtdEntregas:1+(n%3), operador:'Ana' });
                    const c = DB.cargas[DB.cargas.length-1];
                    for(let s = 1; s <= k; s++){
                        avancarStatusCarga(c.id, ordem[s], 'Operador '+s, 'Logística');
                    }
                }
            });
            SuincoStore.save();
        }""")
        await pg.wait_for_timeout(400)

        total = 0
        resumo = {}
        for tema in ('escuro', 'claro'):
            print(f'\n=== TEMA {tema.upper()} ===')
            await pg.evaluate(f"()=>document.documentElement.setAttribute('data-tema','{tema}')")
            for aba in ABAS:
                existe = await pg.evaluate("""(aba) => {
                    const el = document.getElementById('tab-' + aba);
                    if(!el) return false;
                    abrirTab(aba); renderAll();
                    return true;
                }""", aba)
                if not existe:
                    continue
                await pg.wait_for_timeout(260)
                achados = await pg.evaluate(MEDIR)
                total += len(achados)
                ck(f'{aba}: todo texto legível sobre o próprio fundo', not achados,
                   f'{len(achados)} abaixo do mínimo')
                for a in achados:
                    # Agrupa por CLASSE: a mesma regra de estilo aparece
                    # dezenas de vezes (uma por linha de tabela). Listar cada
                    # ocorrência esconde o que importa, que é quantas regras
                    # distintas estão erradas.
                    chave = (tema, (a['classe'] or a['tag']).split()[0] or a['tag'])
                    resumo[chave] = resumo.get(chave, [0, a])
                    resumo[chave][0] += 1

        await nav.close()

    if resumo:
        print('\n=== POR REGRA DE ESTILO ===')
        for (tema, cls), (qtd, a) in sorted(resumo.items(), key=lambda x: -x[1][0]):
            print(f"  {tema:7} {cls:22} x{qtd:<4} razão {a['razao']:>5} (min {a['minimo']}) "
                  f"· {a['px']}px · {a['cor']} sobre {a['fundo']} · {a['texto'][:26]!r}")

    print('\n=== RESULTADO ===')
    print(f'  {total} elemento(s) abaixo do mínimo, em {len(resumo)} regra(s) de estilo')
    print('  FALHAS: ' + (f'{len(falhas)} aba(s)' if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
