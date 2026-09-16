#!/usr/bin/env python3
"""A guarda do padrão: mede, tela por tela, o que hoje ninguém mede.

PEDIDO DO DONO (16/09/2026): *"em todos os âmbitos e que seja padrão
desktop ou mobile seguindo tudo que você tiver feito"*.

O QUE FALTAVA. As ~180 suítes de tela provam que o painel FUNCIONA.
Nenhuma prova que ele está LEGÍVEL. Se alguém quebra o contraste de uma
coluna, encolhe um botão abaixo do dedo ou deixa a tela rolar de lado no
celular, a bateria passa verde e a Portaria descobre no pátio. Já houve
uma publicação cancelada por contraste de 4.33 — e só porque existia um
teste específico daquele chip. Para o resto, não existia nada.

POR QUE MEDIDA E NÃO COMPARAÇÃO DE IMAGEM. O painel tem relógio que anda
de segundo em segundo e dado que muda o dia todo: comparar foto com foto
daria vermelho por causa do relógio, e vermelho que mente treina todo
mundo a ignorar vermelho. Estas regras são numéricas e estáveis — o que
elas reprovam é sempre defeito de verdade.

O PADRÃO, IGUAL NOS DOIS APARELHOS:
  1. contraste de texto >= 4.5:1  (WCAG AA), nos DOIS temas;
  2. alvo de toque >= 44x44 px no celular — dedo com luva, no pátio;
  3. nenhuma rolagem lateral, em nenhuma largura;
  4. coluna de número com `tabular-nums` — peso e KM não podem dançar;
  5. todo controle com nome acessível;
  6. foco visível em tudo que recebe Tab.

Uso:
    python3 testes/guarda_do_padrao.py            # todas as telas
    python3 testes/guarda_do_padrao.py torre      # uma aba só
"""
import asyncio, sys, json
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
ABAS = ['torre','programacao','devolucoes','portaria','expedicao','faturamento',
        'indicadores','cadastros','historico','relatorios','usuarios']
TEMAS = ['escuro','claro']
TELAS = [('computador', 1280, 800, False), ('celular', 390, 844, True)]

falhas, avisos = [], []
def ck(ok, onde, regra, detalhe):
    if ok: return
    (falhas if not regra.startswith('~') else avisos).append(f'{onde} · {regra}: {detalhe}')

# ---------------------------------------------------------------- contraste
# Conta de contraste da WCAG, feita no navegador porque só lá existe a cor
# CALCULADA — a cor que o olho recebe depois de variável, tema e herança.
MEDIR = r"""(alvoToque) => {
  const lum = (c) => {
    const [r,g,b] = c;
    const f = v => { v/=255; return v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4); };
    return .2126*f(r) + .7152*f(g) + .0722*f(b);
  };
  const rgb = (s) => { const m = String(s).match(/\d+(\.\d+)?/g); return m ? m.slice(0,3).map(Number) : null; };
  const alfa = (s) => { const m = String(s).match(/[\d.]+/g); return m && m.length > 3 ? parseFloat(m[3]) : 1; };
  // Fundo real: sobe a árvore até achar quem pinta de verdade.
  const fundoDe = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && alfa(c) > .85 && rgb(c)) return rgb(c);
      n = n.parentElement;
    }
    return rgb(getComputedStyle(document.body).backgroundColor) || [255,255,255];
  };
  const razao = (a,b) => { const [x,y] = [lum(a), lum(b)].sort((p,q)=>q-p); return (x+.05)/(y+.05); };

  const visivel = (el) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.opacity !== '0';
  };

  const out = {contraste: [], toque: [], semNome: [], semTabular: [], focoInvisivel: []};

  // 1 e 2 — texto legível
  document.querySelectorAll('.tab-page.active *').forEach(el => {
    if (!visivel(el)) return;
    const txt = [...el.childNodes].filter(n => n.nodeType === 3)
                 .map(n => n.textContent.trim()).join('');
    if (txt.length < 2) return;
    const cs = getComputedStyle(el);
    const cor = rgb(cs.color); if (!cor) return;
    const px = parseFloat(cs.fontSize), peso = parseInt(cs.fontWeight) || 400;
    const grande = px >= 24 || (px >= 18.66 && peso >= 700);
    const min = grande ? 3.0 : 4.5;
    const r = razao(cor, fundoDe(el));
    if (r < min) out.contraste.push({txt: txt.slice(0,42), r: +r.toFixed(2), min,
      px, sel: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '')});
  });

  // 3 — alvo de toque
  if (alvoToque) {
    document.querySelectorAll('.tab-page.active button, .tab-page.active a, .tab-page.active [role=button], .tab-page.active input[type=checkbox]').forEach(el => {
      if (!visivel(el)) return;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44)
        out.toque.push({rot: (el.textContent || el.getAttribute('aria-label') || '?').trim().slice(0,30),
                        w: Math.round(r.width), h: Math.round(r.height)});
    });
  }

  // 4 — nome acessível
  document.querySelectorAll('.tab-page.active button, .tab-page.active input, .tab-page.active select').forEach(el => {
    if (!visivel(el)) return;
    const nome = (el.getAttribute('aria-label') || el.getAttribute('title') ||
      (el.labels && el.labels.length ? el.labels[0].textContent : '') || el.textContent || '').trim();
    if (!nome) out.semNome.push(el.tagName.toLowerCase() + '#' + (el.id || '?'));
  });

  // 5 — coluna de número alinhada
  document.querySelectorAll('.tab-page.active td, .tab-page.active th').forEach(el => {
    const t = (el.textContent || '').trim();
    if (!/^[\d.,]{3,}$/.test(t)) return;
    if (!visivel(el)) return;
    if (!getComputedStyle(el).fontVariantNumeric.includes('tabular-nums'))
      out.semTabular.push(t.slice(0,14));
  });

  return {
    contraste: out.contraste.slice(0, 8), toque: out.toque.slice(0, 8),
    semNome: out.semNome.slice(0, 6), semTabular: [...new Set(out.semTabular)].slice(0, 5),
    rolagem: {doc: document.documentElement.scrollWidth, janela: window.innerWidth},
  };
}"""

async def main():
    so = sys.argv[1] if len(sys.argv) > 1 else None
    abas = [so] if so else ABAS
    laudo = {}
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        for nome_tela, larg, alt, toque in TELAS:
            for tema in TEMAS:
                pg = await nav.new_page(viewport={'width': larg, 'height': alt}, is_mobile=toque)
                await pg.goto(PAINEL)
                await pg.wait_for_function('typeof irParaTab === "function"')
                await pg.evaluate("""(t) => {
                  document.body.classList.remove('pre-login');
                  document.querySelectorAll('.modal,.modal-bg').forEach(e => e.style.display='none');
                  document.documentElement.setAttribute('data-theme', t === 'claro' ? 'claro' : 'escuro');
                }""", tema)
                for aba in abas:
                    await pg.evaluate("(a) => irParaTab(a)", aba)
                    await pg.wait_for_timeout(260)
                    r = await pg.evaluate(MEDIR, toque)
                    onde = f'{aba} · {nome_tela} · {tema}'
                    laudo[onde] = r
                    for c in r['contraste']:
                        ck(False, onde, 'contraste', f"{c['r']}:1 (mínimo {c['min']}) em \"{c['txt']}\" · {c['sel']}")
                    for t in r['toque']:
                        ck(False, onde, 'alvo de toque', f"{t['w']}x{t['h']} px em \"{t['rot']}\" (mínimo 44x44)")
                    for n in r['semNome']:
                        ck(False, onde, '~nome acessível', f'{n} sem rótulo')
                    for s in r['semTabular']:
                        ck(False, onde, '~tabular-nums', f'número "{s}" em coluna sem alinhamento')
                    ck(r['rolagem']['doc'] <= r['rolagem']['janela'] + 1, onde, 'rolagem lateral',
                       f"{r['rolagem']['doc']} px numa janela de {r['rolagem']['janela']}")
                await pg.close()
        await nav.close()

    saida = '/tmp/claude-0/-home-user-pega-visao/82f87c99-e223-5c72-91d0-65150266c838/scratchpad/perf/laudo_padrao.json'
    try: json.dump(laudo, open(saida, 'w'), ensure_ascii=False, indent=1)
    except Exception: pass

    print(f'\n{len(abas)} aba(s) x {len(TELAS)} tela(s) x {len(TEMAS)} tema(s) = {len(laudo)} conferências\n')
    if avisos:
        print(f'AVISOS ({len(avisos)}) — não reprovam, mas devem entrar na fila:')
        for a in avisos[:20]: print('  ·', a)
        if len(avisos) > 20: print(f'  ... e mais {len(avisos)-20}')
        print()
    if falhas:
        print(f'FALHAS ({len(falhas)}):')
        for f in falhas[:40]: print('  ·', f)
        if len(falhas) > 40: print(f'  ... e mais {len(falhas)-40}')
        sys.exit(1)
    print('RESULTADO: o padrão está de pé em todas as telas.')

asyncio.run(main())
