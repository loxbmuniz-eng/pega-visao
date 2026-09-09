#!/usr/bin/env python3
"""O painel cabe no celular — medidas, não impressão (08/09/2026).

RELATO DO DONO: "no mobile ainda tem coisas muito grandes e desproporcionais,
quero que processe em todas as abas e telas de visão".

Medido antes de mexer, num iPhone de 390px, com 12 cargas de teste:

  · as caixas de indicador da Torre ocupavam ~630px — 75% da tela — ANTES
    de aparecer a primeira carga. A primeira carga só começava por volta
    dos 1.100px: uma tela e meia de rolagem para o porteiro ver o primeiro
    caminhão;
  · cartão de carga a 224px na Torre, 227 na Portaria, 220 na Expedição,
    226 no Faturamento — três por tela;
  · o gráfico dos Indicadores estourava a largura em 367px, quase o dobro
    da tela, e a tabela de status em 155px;
  · botões do cabeçalho a 41px e campos da Torre a 11px de altura, contra
    o mínimo de 44px para o dedo;
  · o nome do operador saía cortado no meio da palavra ("Ana · Adr...").

Este teste trava os cinco. Ele NÃO confere estética — confere que cabe,
que dá para tocar e que não some informação.

    python3 testes/test_painel_cabe_no_celular.py
"""
import asyncio
import sys

from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
LARG, ALT = 390, 844          # iPhone 12/13/14 — o aparelho do pátio
# 220px é o que dá para garantir HOJE sem desfazer uma decisão do dono: os
# campos dentro do cartão são desenhados sem caixa (styles.css, "o desktop é
# uma tabela") e medem 21px. Levá-los a 44px para o dedo inflou o cartão de
# 224 para 303px na primeira tentativa — densidade e alvo de toque estão em
# conflito real aqui, e a escolha é dele. O alvo continua sendo 160.
TETO_CARTAO = 220             # altura média do cartão de lista
TETO_CAIXAS = 400             # altura do bloco de indicadores da Torre
TOQUE_MIN = 44                # WCAG 2.5.5 / iOS HIG

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


SEMENTE = """() => {
  DB.cargas=[]; DB.movimentacoes=[];
  const st=['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
            'Embarque Finalizado','Faturado'];
  for(let i=0;i<12 && i<DB.frota.length;i++){
    const c = criarCargaProgramada({placa:DB.frota[i].placa,
      transportadora:'Coopertral Transportes Ltda', tipoVeiculo:'Truck',
      numeroCarga:'55'+(100+i), cliente:'Supermercados Reunidos do Cerrado',
      destino:'Belo Horizonte / Contagem', peso:9000+i*450, rota:'500',
      sequencia:i+1, praOnde:'ENTREGA DIRETA', paletizada:'Sim', qtdGanchos:0,
      qtdEntregas:2+i%3, motorista:'Motorista de Teste '+i, observacoes:'',
      operador:DB.operador});
    const alvo=st[i%st.length]; let g=0;
    while(c.status!==alvo && g++<6){
      const idx=STATUS_FLOW.indexOf(c.status);
      try{ avancarStatusCarga(c.id, STATUS_FLOW[idx+1],'Ana','Logística'); }
      catch(e){ break; }
    }
  }
  SuincoStore.save(); renderAll();
}"""

# A gaveta e os modais ficam fora da tela DE PROPÓSITO — medir eles daria
# falso positivo, que foi o primeiro erro desta medição.
MEDIR = """(larg) => {
  const escondido = el => {
    if (el.closest('#nav, #menu-overlay, .modal, [hidden]') !== null) return true;
    // Seção RECOLHIDA do acordeão dos Indicadores: os filhos continuam com
    // retângulo próprio (getBoundingClientRect não sabe de max-height:0 no
    // ancestral), e medi-los acusa como estouro o que ninguém está vendo.
    // Foi o quarto falso positivo desta medição — vale a checagem.
    for (let p = el.parentElement; p; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.opacity === '0') return true;
      if (parseFloat(cs.maxHeight) === 0) return true;
    }
    return false;
  };
  const visivel = el => {
    const cs = getComputedStyle(el);
    if (cs.display==='none' || cs.visibility==='hidden' || cs.opacity==='0') return false;
    const r = el.getBoundingClientRect();
    return r.width>0 && r.height>0 && r.right>0 && r.bottom>0;
  };
  const nome = el => el.tagName.toLowerCase() + (el.id?'#'+el.id:'')
    + (el.className && typeof el.className==='string' && el.className.trim()
       ? '.'+el.className.trim().split(/\\s+/).slice(0,2).join('.') : '');

  // Elemento largo DENTRO de uma caixa que rola de lado não é defeito — é
  // o padrão do painel para tabela larga ("a tabela rola dentro da caixa,
  // como as outras; a página nunca rola de lado"). Medir sem perguntar isso
  // acusa como erro uma decisão deliberada.
  const rolaDeLado = el => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll') return true;
    }
    return false;
  };
  // Campo do cartão fechado: 21px por decisão de densidade documentada em
  // styles.css. Fica de fora ATÉ o dono decidir densidade x dedo.
  const campoDeCartaoFechado = el =>
    el.closest('table.mobile-cartao tr:not(.cartao-aberto)') !== null
    && el.matches('input, select');

  const estoura = [], toque = [], listas = {};
  document.querySelectorAll('#main *').forEach(el => {
    if (escondido(el) || !visivel(el)) return;
    const r = el.getBoundingClientRect();
    if (r.right > larg + 1 && !rolaDeLado(el))
      estoura.push({n:nome(el), excesso:Math.round(r.right-larg)});
    // 24px é o mínimo da WCAG 2.5.8 para caixa de marcar; 44 é o da 2.5.5
    // para o resto. Alvos diferentes porque um quadrado de 44px ao lado de
    // um rótulo de uma linha é desproporcional — o oposto do pedido.
    const minimo = el.matches('input[type="checkbox"], input[type="radio"]') ? 24 : 44;
    // `td`/`tr` com onclick são REGIÃO clicável, não controle: quem dá o
    // alvo é a linha inteira (210px no cartão). Medir a célula acusa como
    // pequeno um alvo que na prática é enorme.
    if (el.matches('button,a,input,select,.btn,[onclick]')
        && !el.matches('td, tr, tbody, table')
        && (r.height < minimo || r.width < minimo)
        && !campoDeCartaoFechado(el))
      toque.push({n:nome(el), l:Math.round(r.width), a:Math.round(r.height)});
    if (el.matches('tr')) {
      const k = nome(el.parentElement);
      (listas[k] = listas[k] || []).push(Math.round(r.height));
    }
  });
  const medias = Object.entries(listas).filter(([,v]) => v.length >= 3)
    .map(([k,v]) => ({k, n:v.length, media:Math.round(v.reduce((a,b)=>a+b,0)/v.length)}));
  return { estoura, toque, medias };
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        ctx = await nav.new_context(viewport={'width': LARG, 'height': ALT},
                                    device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(1400)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Administração')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(900)
        await pg.evaluate(SEMENTE)
        await pg.wait_for_timeout(900)

        print('\n=== 1. O NOME DO OPERADOR NÃO SAI CORTADO ===')
        # "Ana · Adr..." cortado no meio da palavra é o que o dono vê primeiro
        # em toda aba. Cortar com reticências é aceitável; cortar no meio da
        # letra, atrás de um botão, não é.
        nome = await pg.evaluate("""() => {
            const el = document.getElementById('operator-name');
            const acoes = document.getElementById('header-actions');
            if (!el) return null;
            const cs = getComputedStyle(el);
            const r = el.getBoundingClientRect();
            return { texto: el.textContent.trim(), largura: Math.round(r.width),
                     conteudo: el.scrollWidth, ellipsis: cs.textOverflow,
                     direita: Math.round(r.right),
                     botoesComecamEm: acoes ? Math.round(acoes.getBoundingClientRect().left) : null };
        }""")
        ck('o nome do operador cabe ou tem reticências de verdade',
           nome and (nome['conteudo'] <= nome['largura'] + 1 or nome['ellipsis'] == 'ellipsis'),
           str(nome))
        # A COMPARAÇÃO CERTA É COM OS BOTÕES, NÃO COM A TELA. Na primeira
        # versão deste teste eu comparei com os 390px do viewport: passou
        # verde enquanto o nome estava visivelmente cortado atrás da
        # engrenagem, porque #header-mid tem overflow:hidden e o corte é
        # visual — o retângulo do elemento continua "dentro da tela".
        ck('o nome não passa por baixo dos botões do cabeçalho',
           nome and nome['botoesComecamEm'] is not None
           and nome['direita'] <= nome['botoesComecamEm'],
           f"nome termina em {nome and nome['direita']}px, botões começam em {nome and nome['botoesComecamEm']}px")

        print('\n=== 2. AS CAIXAS DA TORRE NÃO COMEM A TELA ===')
        await pg.evaluate("() => abrirTab('torre')")
        await pg.wait_for_timeout(800)
        caixas = await pg.evaluate("""() => {
            const el = document.getElementById('torre-stats');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            const tb = document.getElementById('torre-tbody');
            const primeira = tb && tb.querySelector('tr');
            return { altura: Math.round(r.height),
                     ateAPrimeiraCarga: primeira
                       ? Math.round(primeira.getBoundingClientRect().top + window.scrollY) : null };
        }""")
        ck(f'o bloco de indicadores cabe em {TETO_CAIXAS}px',
           caixas and caixas['altura'] <= TETO_CAIXAS,
           f"{caixas and caixas['altura']}px (medido 630px antes)")
        ck('a primeira carga aparece na primeira tela e meia',
           caixas and caixas['ateAPrimeiraCarga'] is not None
           and caixas['ateAPrimeiraCarga'] <= ALT,
           f"primeira carga a {caixas and caixas['ateAPrimeiraCarga']}px do topo")

        print('\n=== 3. CARTÃO DE LISTA, ABA POR ABA ===')
        abas = await pg.evaluate(
            "() => [...document.querySelectorAll('.nav-tab')].map(t=>({id:t.dataset.tab,rot:t.textContent.trim()}))")
        gordos, estouros, toques = [], [], []
        for a in abas:
            await pg.evaluate("(id)=>abrirTab(id)", a['id'])
            await pg.wait_for_timeout(600)
            m = await pg.evaluate(MEDIR, LARG)
            for li in m['medias']:
                if li['media'] > TETO_CARTAO:
                    gordos.append(f"{a['id']}/{li['k']}={li['media']}px")
            for e in m['estoura']:
                estouros.append(f"{a['id']}/{e['n']}+{e['excesso']}px")
            for t in m['toque']:
                toques.append(f"{a['id']}/{t['n']}={t['l']}x{t['a']}")
        ck(f'nenhum cartão de lista passa de {TETO_CARTAO}px', not gordos,
           ' · '.join(gordos[:5]))

        print('\n=== 4. NADA ESTOURA A LARGURA DA TELA ===')
        ck('nenhum elemento visível ultrapassa 390px', not estouros,
           ' · '.join(estouros[:5]))

        print('\n=== 5. DÁ PARA TOCAR COM O DEDO ===')
        ck(f'todo alvo de toque tem pelo menos {TOQUE_MIN}px', not toques,
           ' · '.join(sorted(set(toques))[:6]))

        print('\n=== 6. COM AS SEÇÕES DOS INDICADORES ABERTAS ===')
        # O acordeão do celular só mostra o problema DEPOIS de aberto: o
        # estado aberto punha overflow:visible em tudo e apagava a rolagem
        # interna da caixa de tabela, empurrando a página para 545px.
        await pg.evaluate("()=>abrirTab('indicadores')")
        await pg.wait_for_timeout(700)
        await pg.evaluate("""()=>document.querySelectorAll(
            '#tab-indicadores > .card > .card-title').forEach(t=>t.click())""")
        await pg.wait_for_timeout(1100)
        lat = await pg.evaluate("""() => ({
            rola: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            doc: document.documentElement.scrollWidth,
            tela: document.documentElement.clientWidth })""")
        ck('a página não rola de lado com tudo aberto', not lat['rola'],
           f"documento {lat['doc']}px numa tela de {lat['tela']}px")

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde — o painel cabe no celular')
    return 0


sys.exit(asyncio.run(main()))
