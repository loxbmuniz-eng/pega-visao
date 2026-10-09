#!/usr/bin/env python3
"""O que a pessoa lê sai inteiro e diz a verdade (09/10/2026, /impeccable Lote 5b).

ACHADO DA AUDITORIA (ocorrência #127), medido no navegador:
  · cabeçalho: em 1024×768 o relógio ficava 10 px ACIMA da tela (o relógio e o
    crachá quebravam em duas linhas num cabeçalho de altura fixa); em 600 e
    768 px — o tablet da Portaria em pé — relógio e crachá sumiam por inteiro
    (a caixa do meio ficava com 0 e 23 px); no celular o crachá virava "An…"
    e a pessoa não via com que setor entrou;
  · Faturamento: a carga já FATURADO continuava em "Cargas Aguardando
    Faturamento", com a ação "—" — que não diz quem age agora;
  · gráficos dos Indicadores: letra "Segoe UI" (o painel é Barlow), 10 px
    na sparkline vazia, e o último dia do gráfico de linha ("09/10") cortado
    na borda;
  · o nome comprido no ranking dos Indicadores saía cortado, sem o nome
    inteiro em lugar nenhum (nem passando o mouse) — e entrava como HTML;
  · o Pátio ao vivo dizia "Nenhuma linha com este filtro." numa seção sem
    filtro nenhum;
  · os títulos: "Rádio do pátio" (h2) e depois "Onde estão os caminhões
    agora" (h4), e nenhum cartão era título para o leitor de tela.

O QUE ESTE TESTE TRAVA, pela tela:
  1. em 12 larguras, do celular de 360 ao monitor de 1920: o SETOR do crachá
     aparece inteiro, o começo do nome aparece, e (acima de 560 px) o relógio
     aparece inteiro dentro do cabeçalho; nada do cabeçalho sai da tela —
     inclusive com o botão "Atenção" da Administração;
  2. Faturamento: as faturadas ficam (regra de 12/08: nada some da fila), mas
     o cartão diz que elas estão ali, e a linha diz quem age: a Portaria;
  3. gráficos em canvas com a letra do painel, nada abaixo de 12 px, nenhum
     rótulo fora da borda;
  4. nome cortado no ranking tem o nome inteiro no title; nome é texto, não HTML;
  5. o Pátio ao vivo vazio diz por que está vazio, sem falar de filtro;
  6. cada cartão é título de nível 2, e nenhuma aba pula nível.

    bash testes/rodar_tudo.sh test_le_inteiro_e_verdadeiro
"""
import asyncio
import os
import re
import sys
from playwright.async_api import async_playwright

PAINEL = os.environ.get('SUINCO_PAINEL', 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def entrar(pg, setor='Administração', nome='Ana'):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(900)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', nome)
    await pg.select_option('#login-setor', setor)
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(600)


# Uma carga em Embarque Finalizado e outra já Faturado; uma terceira no pátio
# com transportadora de nome comprido (e com "<i>", que tem de sair como texto).
NOME_LONGO = 'Transportes e Armazenagem de Cargas Refrigeradas do Brasil <i>Ltda</i>'
SEMEAR = """(nomeLongo) => {
  DB.cargas = []; DB.movimentacoes = [];
  const ordem = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado'];
  [3, 4, 1].forEach((ate, n) => {
    const f = DB.frota[n];
    criarCargaProgramada({freteObservacao:'TABELA', placa:f.placa, numeroCarga:String(40700+n), peso:12000,
      rota:'50'+n, motorista:'José da Silva', qtdEntregas:1, operador:'Ana' });
    const c = DB.cargas[DB.cargas.length-1];
    if(n === 2) c.transportadora = nomeLongo;
    for(let s = 1; s <= ate; s++) avancarStatusCarga(c.id, ordem[s], 'Operador '+s, 'Logística');
  });
  SuincoStore.save();
  renderAll();
}"""

# Onde o texto do setor está na tela, medido pelo próprio texto (Range), e se
# ele cabe na caixa que o recorta. Funciona com o crachá em uma ou duas peças.
CRACHA = """(setor) => {
  const el = document.getElementById('operator-name');
  const caixa = el.getBoundingClientRect();
  const meio = document.getElementById('header-mid').getBoundingClientRect();
  const recorte = { l: Math.max(caixa.left, meio.left, 0), r: Math.min(caixa.right, meio.right, innerWidth),
                    t: Math.max(caixa.top, meio.top, 0), b: Math.min(caixa.bottom, meio.bottom) };
  const ret = (txt) => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n; while((n = w.nextNode())){
      const i = n.textContent.indexOf(txt);
      if(i >= 0){ const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + txt.length); return r.getBoundingClientRect(); }
    }
    return null;
  };
  const s = ret(setor), n1 = ret(el.textContent.trim().charAt(0));
  const dentro = r => !!r && r.width > 0 && r.left >= recorte.l - 0.5 && r.right <= recorte.r + 0.5
                     && r.top >= recorte.t - 0.5 && r.bottom <= recorte.b + 0.5;
  const ponto = s ? document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2) : null;
  return { texto: el.textContent.trim(), setorInteiro: dentro(s) && !!ponto && el.contains(ponto),
           nomeComeca: dentro(n1),
           setor: s && [Math.round(s.left), Math.round(s.right)], recorte: [Math.round(recorte.l), Math.round(recorte.r)] };
}"""

RELOGIO = """() => {
  const c = document.getElementById('clock'), h = document.getElementById('header');
  const b = c.getBoundingClientRect(), hb = h.getBoundingClientRect();
  const meio = document.getElementById('header-mid').getBoundingClientRect();
  if(!b.width) return { visivel:false, motivo:'sem largura' };
  const e = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return { visivel: b.top >= hb.top - 0.5 && b.bottom <= hb.bottom + 0.5 && b.left >= meio.left - 0.5
                    && b.right <= meio.right + 0.5 && !!e && (e === c || c.contains(e)),
           top: Math.round(b.top), bottom: Math.round(b.bottom), esq: Math.round(b.left), dir: Math.round(b.right),
           meio: [Math.round(meio.left), Math.round(meio.right)] };
}"""

FORA = """() => [...document.querySelectorAll('#header > *, #header-actions > *, #header-mid > *')]
  .filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden')
  .filter(e => { const r = e.getBoundingClientRect(); return r.left < -0.5 || r.right > innerWidth + 0.5; })
  .map(e => e.id || e.className)"""

LARGURAS = [(360, 780), (390, 844), (430, 932), (600, 960), (768, 1024), (820, 1180),
            (1024, 768), (1180, 820), (1280, 800), (1366, 768), (1440, 900), (1920, 1080)]


async def cabecalho(nav):
    print('\n=== 1. CABEÇALHO: SETOR INTEIRO, RELÓGIO INTEIRO, NADA FORA DA TELA ===')
    casos = [('Administração', 'Ana', True), ('Pagamento de Frete', 'Maria Aparecida dos Santos', False),
             ('Portaria', 'José', False)]
    for w, h in LARGURAS:
        for setor, nome, atencao in casos:
            ctx = await nav.new_context(viewport={'width': w, 'height': h}, is_mobile=w < 600, has_touch=w <= 1180)
            pg = await ctx.new_page()
            await entrar(pg, setor, nome)
            if atencao:
                # O estado que a Administração vê em produção quando há ponto de
                # atenção: o botão a mais no cabeçalho. Aqui é medida de ESPAÇO
                # (o cabeçalho com o máximo de botões), não prova do botão.
                await pg.evaluate("""() => { const b = document.getElementById('btn-atencao'); b.hidden = false;
                    const n = document.getElementById('atencao-contador'); n.hidden = false; n.textContent = '3'; }""")
                await pg.wait_for_timeout(150)
            onde = f'{w}×{h} {setor}' + (' +Atenção' if atencao else '')
            c = await pg.evaluate(CRACHA, setor)
            ck(f'{onde}: o setor aparece inteiro no crachá', c['setorInteiro'], str(c))
            ck(f'{onde}: o nome começa à vista', c['nomeComeca'], c['texto'])
            if w > 560:
                r = await pg.evaluate(RELOGIO)
                ck(f'{onde}: o relógio aparece inteiro dentro do cabeçalho', r['visivel'], str(r))
            fora = await pg.evaluate(FORA)
            ck(f'{onde}: nada do cabeçalho sai da tela', not fora, str(fora))
            await ctx.close()


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        await cabecalho(nav)

        ctx = await nav.new_context(viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        # A letra de cada canvas e cada rótulo escrito: gravados enquanto o
        # painel desenha, sem mudar o desenho.
        await pg.add_init_script("""(() => {
          window.__fontes = []; window.__rotulos = [];
          const P = CanvasRenderingContext2D.prototype;
          const d = Object.getOwnPropertyDescriptor(P, 'font');
          Object.defineProperty(P, 'font', { configurable:true, get(){ return d.get.call(this); },
            set(v){ window.__fontes.push(v); d.set.call(this, v); } });
          const ft = P.fillText;
          P.fillText = function(t, x, y){
            const larg = this.measureText(String(t)).width, esc = this.getTransform().a || 1;
            window.__rotulos.push({ t:String(t), x, larg, al:this.textAlign, w:this.canvas.width / esc, id:this.canvas.id || this.canvas.className });
            return ft.apply(this, arguments); };
        })()""")
        await entrar(pg)
        await pg.evaluate(SEMEAR, NOME_LONGO)

        # ---- 2. Faturamento ------------------------------------------------
        print('\n=== 2. FATURAMENTO: AS FATURADAS FICAM, E A TELA DIZ POR QUÊ ===')
        await pg.click('.nav-tab[data-tab="faturamento"]')
        await pg.wait_for_timeout(500)
        fat = await pg.evaluate("""() => { const card = document.getElementById('fat-tbody').closest('.card');
            return { titulo: card.querySelector('.card-title').innerText.trim(),
                     sub: (card.querySelector('.card-sub') || {}).innerText || '',
                     linhas: [...document.querySelectorAll('#fat-tbody tr')].map(tr => ({
                        status: tr.querySelector('.badge').innerText.trim().toUpperCase(),
                        acao: tr.lastElementChild.innerText.trim(),
                        botao: !!tr.lastElementChild.querySelector('button') })) }; }""")
        faturada = [l for l in fat['linhas'] if l['status'] == 'FATURADO']
        finalizada = [l for l in fat['linhas'] if l['status'] == 'EMBARQUE FINALIZADO']
        ck('2. (a fila tem a finalizada e a faturada)', faturada and finalizada, str(fat['linhas']))
        ck('2. a finalizada tem o botão FATURADO', finalizada and finalizada[0]['botao'], str(finalizada))
        ck('2. a faturada diz quem age agora (a Portaria), em vez de "—"',
           faturada and 'Portaria' in faturada[0]['acao'] and not faturada[0]['botao'], str(faturada))
        texto = (fat['titulo'] + ' ' + fat['sub']).lower()
        ck('2. o cartão diz que as faturadas estão ali até a saída na Portaria',
           'faturad' in fat['sub'].lower() and 'portaria' in fat['sub'].lower()
           and fat['titulo'] != 'Cargas Aguardando Faturamento', f"{fat['titulo']} | {fat['sub'][:160]}")

        # ---- 3 e 4. Indicadores --------------------------------------------
        print('\n=== 3. GRÁFICOS EM CANVAS: LETRA DO PAINEL, 12 PX, DENTRO DA BORDA ===')
        await pg.evaluate("() => { window.__fontes = []; window.__rotulos = []; }")
        await pg.click('.nav-tab[data-tab="indicadores"]')
        await pg.wait_for_timeout(1500)
        # a sparkline sem série também desenha texto: força o caminho dela
        await pg.evaluate("""() => { const c = document.createElement('canvas'); c.className = 'spark';
            c.dataset.serie = '[]'; c.style.width = '120px'; c.style.height = '28px';
            const d = document.createElement('div'); d.appendChild(c); document.body.appendChild(d);
            desenharSparklines(d); d.remove(); }""")
        fontes = await pg.evaluate("() => [...new Set(window.__fontes)]")
        corpo = await pg.evaluate("() => getComputedStyle(document.body).fontFamily.split(',')[0].replace(/[\"']/g,'').trim()")
        ck('3. (os gráficos desenharam texto)', bool(fontes), str(fontes))
        alheias = [f for f in fontes if corpo not in f]
        ck(f'3. toda letra de canvas é a do painel ({corpo})', fontes and not alheias, str(alheias or fontes))
        pequenas = [f for f in fontes if int(re.search(r'(\d+(?:\.\d+)?)px', f).group(1).split('.')[0]) < 12]
        ck('3. nenhuma letra de canvas abaixo de 12 px', not pequenas, str(pequenas))
        cortados = await pg.evaluate("""() => window.__rotulos.filter(o => {
            const x0 = o.al === 'center' ? o.x - o.larg/2 : (o.al === 'right' || o.al === 'end') ? o.x - o.larg : o.x;
            return x0 < -0.5 || x0 + o.larg > o.w + 0.5; }).map(o => o.id + ': ' + o.t)""")
        ck('3. nenhum rótulo sai pela borda do gráfico', not cortados, str(cortados[:6]))

        print('\n=== 4. RANKING: NOME CORTADO TEM O NOME INTEIRO, E NOME É TEXTO ===')
        rank = await pg.evaluate("""() => [...document.querySelectorAll('#tab-indicadores .graf-rank-nome')]
            .filter(e => e.getClientRects().length).map(e => ({ t: e.textContent.replace(/^▲\\s*/, '').trim(),
              corta: e.scrollWidth > e.clientWidth + 1, title: e.title, html: !!e.querySelector('i') }))""")
        longo = [r for r in rank if 'Refrigeradas' in r['t']]
        ck('4. (o nome comprido está no ranking)', bool(longo), str(rank)[:300])
        sem_title = [r['t'] for r in rank if r['corta'] and r['title'] != r['t']]
        ck('4. todo nome cortado tem o nome inteiro ao passar o mouse', not sem_title, str(sem_title))
        ck('4. o nome sai como texto ("<i>" à vista, não itálico)',
           longo and '<i>Ltda</i>' in longo[0]['t'] and not longo[0]['html'], str(longo))

        # ---- 5. Pátio ao vivo ------------------------------------------------
        print('\n=== 5. PÁTIO AO VIVO VAZIO DIZ POR QUÊ ===')
        await pg.click('.nav-tab[data-tab="patio"]')
        await pg.wait_for_timeout(800)
        vazio = await pg.evaluate("() => { const e = document.querySelector('#pv-rank .graf-vazio'); return e ? e.innerText.trim() : null; }")
        ck('5. (nenhuma carga saiu hoje: o ranking está vazio)', vazio is not None, str(vazio))
        ck('5. o vazio não fala de filtro (a seção não tem filtro) e diz o que falta',
           vazio and 'filtro' not in vazio.lower() and 'saiu' in vazio.lower(), str(vazio))

        # ---- 6. Títulos --------------------------------------------------------
        print('\n=== 6. TÍTULOS: CADA CARTÃO É TÍTULO, NENHUMA ABA PULA NÍVEL ===')
        abas = await pg.evaluate("() => [...document.querySelectorAll('.nav-tab')].filter(t => t.offsetParent).map(t => t.dataset.tab)")
        for a in abas:
            await pg.evaluate(f"() => irParaTab('{a}')")
            await pg.wait_for_timeout(350)
            r = await pg.evaluate(f"""() => {{ const t = document.getElementById('tab-{a}');
              const vis = e => e.getClientRects().length && !e.closest('[hidden]');
              // o <summary> do cartão que abre e fecha é BOTÃO (Lote 3), não título
              const cartoes = [...t.querySelectorAll('.card > .card-title:not(summary)')].filter(vis)
                .filter(e => !(e.getAttribute('role') === 'heading' && e.getAttribute('aria-level') === '2'))
                .map(e => e.textContent.trim().slice(0, 30));
              const niveis = [...t.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].filter(vis)
                .map(e => [Number(e.getAttribute('aria-level') || e.tagName.slice(1)), e.textContent.trim().slice(0, 30)]);
              const pulos = []; let antes = 1;
              niveis.forEach(([n, txt]) => {{ if(n > antes + 1) pulos.push(antes + '→' + n + ' ' + txt); antes = n; }});
              return {{ cartoes, pulos }}; }}""")
            ck(f'6. {a}: todo cartão é título de nível 2', not r['cartoes'], str(r['cartoes'][:4]))
            ck(f'6. {a}: nenhum título pula nível', not r['pulos'], str(r['pulos'][:4]))

        ck('sem erro de JavaScript', not erros, ' | '.join(erros[:3]))
        await nav.close()

    print(f"\n{len(falhas)} FALHA(S)" + (': ' + ', '.join(falhas[:12]) if falhas else ''))
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
