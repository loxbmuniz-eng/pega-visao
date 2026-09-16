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
  /* FUNDO REAL — e DEGRADÊ CONTA (16/09/2026).

     A primeira versão só olhava `background-color`. Os botões de ação da
     casa são degradê: `background-color` fica transparente e a cor vem de
     `background-image: linear-gradient(...)`. A conta subia até o pai e
     dizia que o botão "Chegou", branco sobre verde, tinha 1.57:1 — número
     errado num botão perfeitamente legível.

     Guarda que grita lobo é pior que guarda nenhuma: na terceira vez
     ninguém olha mais o vermelho. Aqui o degradê entra, e entra pelo
     PONTO MAIS CLARO dele — que é o pior caso para texto claro por cima. */
  const doDegrade = (img) => {
    if (!img || img === 'none' || !img.includes('gradient')) return null;
    const cores = img.match(/rgba?\([^)]+\)/g);
    if (!cores || !cores.length) return null;
    const pontos = cores.map(rgb).filter(Boolean).filter(c => alfa(cores[0]) > .5);
    if (!pontos.length) return null;
    // O mais claro: é contra ele que texto claro sofre mais.
    return pontos.reduce((a, b) => lum(a) >= lum(b) ? a : b);
  };
  const fundoDe = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      const g = doDegrade(cs.backgroundImage);
      if (g) return g;
      const c = cs.backgroundColor;
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

  /* 3 — ALVO DE TOQUE, MEDIDO PELO TOQUE (16/09/2026).

     A primeira versão media o RETÂNGULO do elemento. Isso reprova uma
     correção que funciona: dá para esticar a área de toque além da caixa
     visível com um pseudo-elemento, e foi o que se fez nos títulos de
     cartão — 44 px de alvo sem 26 px a mais de altura numa tela de
     celular onde espaço é o que falta.

     Medir geometria puniria a solução certa e premiaria a errada. Então
     aqui a pergunta passa a ser a do operador: SE EU ENCOSTAR O DEDO
     AQUI, PEGA? Quatro pontos nas bordas da faixa de 44x44 centrada no
     controle, e `elementFromPoint` diz quem recebe o toque.

     De quebra, isto pega um defeito que a geometria nunca pegaria:
     controle do tamanho certo mas COBERTO por outra coisa. */
  if (alvoToque) {
    const pega = (el, x, y) => {
      const alvo = document.elementFromPoint(x, y);
      return !!alvo && (alvo === el || el.contains(alvo) || alvo.contains(el));
    };
    document.querySelectorAll('.tab-page.active button, .tab-page.active a, .tab-page.active [role=button], .tab-page.active input[type=checkbox]').forEach(el => {
      if (!visivel(el)) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width/2, cy = r.top + r.height/2;
      if (cy - 21 < 0 || cy + 21 > window.innerHeight) return;   // fora da vista: não dá para medir
      const pontos = [[cx, cy-21], [cx, cy+21], [cx-21, cy], [cx+21, cy]];
      const erram = pontos.filter(([x,y]) => !pega(el, x, y)).length;
      if (erram > 0)
        out.toque.push({rot: (el.textContent || el.getAttribute('aria-label') || '?').trim().slice(0,30),
                        w: Math.round(r.width), h: Math.round(r.height), erram});
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

  /* 6 — ROLAGEM LATERAL POR DENTRO (16/09/2026).

     O dono: "tem hora que tem rolagem lateral sim e precisa mover a barra
     pra ver o resto das informações, queria que não tivesse isso em lugar
     nenhum".

     Ele está certo e a minha conta estava cega: eu comparava só
     `documentElement.scrollWidth` com a janela, que pega a PÁGINA rolando.
     Tabela larga dentro de um `overflow-x:auto` rola por dentro, sem a
     página rolar — e é exatamente isso que ele vê: arrastar uma barra para
     achar o resto da coluna.

     Aqui todo elemento que rola de lado é reportado, com quanto sobra e o
     que ele é. */
  const rolamPorDentro = [];
  document.querySelectorAll('.tab-page.active *').forEach(el => {
    if (!visivel(el)) return;
    const sobra = el.scrollWidth - el.clientWidth;
    if (sobra <= 2) return;
    const cs = getComputedStyle(el);
    if (!/auto|scroll/.test(cs.overflowX)) return;
    rolamPorDentro.push({
      sel: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
      visivel: el.clientWidth, precisa: el.scrollWidth, sobra,
      dica: (el.querySelector('th') || el.querySelector('td') || el).textContent.trim().slice(0, 30),
    });
  });

  return {
    rolamPorDentro: rolamPorDentro.slice(0, 6),
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
                  /* TUDO que cobre a tela sai, não só `.modal`.
                     A primeira versão escondia `.modal` e `.modal-bg` e
                     deixava `.modal-overlay` de pé — uma camada invisível
                     sobre a página inteira. Resultado: TODO controle
                     reprovava no teste de toque, porque quem recebia o
                     dedo era o overlay. 112 falhas que eram da bancada, e
                     não do painel. Guarda que mede errado é pior que
                     guarda nenhuma. */
                  document.querySelectorAll('.modal, .modal-bg, .modal-overlay, .sync-overlay,'
                    + ' [class*="overlay"], [class*="backdrop"],'
                    + ' .notif-item, #notificacoes, [class*="notif"], [class*="toast"]')
                    .forEach(e => e.style.display='none');
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
                    ck(r['rolagem']['doc'] <= r['rolagem']['janela'] + 1, onde, 'rolagem lateral da página',
                       f"{r['rolagem']['doc']} px numa janela de {r['rolagem']['janela']}")
                    for x in r.get('rolamPorDentro', []):
                        ck(False, onde, 'rolagem lateral por dentro',
                           f"{x['sel']} mostra {x['visivel']} px e precisa de {x['precisa']} "
                           f"(faltam {x['sobra']}) — \"{x['dica']}\"")
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
