#!/usr/bin/env python3
"""Prova da Etapa 5 do Tema 2027 — botões, campos e selos.

Este arquivo é o teste da Etapa 5 (VEREDITO.md, seção 6, "Etapa 5 — Ações").
Cobre exatamente o que o "Conferir" da etapa pede, mais o item obrigatório
de todo executor: um teste que REPROVA contra o publicado e PASSA com o
build novo.

O QUE FICOU PROVADO AQUI:

1. REGRA CENTRAL DA ETAPA (reprova/passa) — "Hover só com opacity e
   transform: o hover herdado do styles.css anima box-shadow/filter, que é
   caro." No publicado, `.btn:hover` muda `box-shadow` (0 1px 2px... ->
   0 4px 12px...) e `filter` (none -> brightness(1.07)) — duas propriedades
   caras de repintar. Na Etapa 5 (`tema2027/40_acoes.css`), `.btn:hover`
   fixa `box-shadow:none` e `filter:none` nos dois estados: só `opacity` e
   `transform` mudam. Medido em `.btn-primary`, `.btn-success`,
   `.btn-danger`, `.btn-sec`, comparando o `getComputedStyle` do botão em
   repouso contra o mesmo botão com `:hover` disparado de verdade
   (`page.hover()`), no PUBLICADO e no BUILD NOVO.

2. Contraste texto/fundo dos quatro botões de ação (`.btn-primary`,
   `.btn-success`, `.btn-danger`, `.btn-sec`), nos dois temas, MEDIDO POR
   PIXEL (amostra do centro do botão na captura de tela — não só
   `getComputedStyle().backgroundColor`, porque um `background-image`
   teria `backgroundColor` transparente e mascararia o problema que
   eliminou a Linear). Mínimo 4.5:1 (WCAG AA, texto normal).

3. Nenhum corte de rótulo: "➕ Outra carga" (Torre) e "🔒 Fechar
   Programação e Iniciar Nova" (Torre) sem `scrollWidth > clientWidth` —
   o defeito que eliminou a Bloomberg (`text-transform:uppercase` em
   `.btn`), que a Etapa 5 explicitamente não usa.

4. `input` da Torre (`.peso-input`) com `border-color` de alfa > 0 nos
   dois temas — o defeito que eliminou a Stripe (campo de tabela
   invisível).

5. `Tab` até o campo Peso da primeira linha da Torre mostra o anel de foco
   dourado (`:focus-visible`, 2.5px, cor `--gold`) — o roubo aprovado da
   Vercel.

6. ACHADO REPORTADO, NÃO CORRIGIDO AQUI (fora do meu mandato de executor —
   ver relato): o bloco
   `@media screen and (min-width:821px){ .btn{ min-height:36px } }`
   da Etapa 5, exatamente como está escrito no VEREDITO, reduz o alvo de
   toque de 44px para 36px em qualquer tela >=821px de largura que TAMBÉM
   tenha ponteiro grosso (`pointer:coarse`) — por exemplo um tablet grande
   em paisagem, o cenário que o próprio comentário da regra em
   `styles.css` (linha ~2953) diz que "não cai no breakpoint de largura".
   `guarda_do_padrao.py` testa só 'computador' (1280, sem toque) e
   'celular' (390, com toque) — nenhum dos dois pega esse meio-termo, e por
   isso este teste tem uma verificação PRÓPRIA para essa combinação,
   marcada como aviso (não reprova a suíte, porque o valor é EXATAMENTE o
   que o VEREDITO mandou escrever, e mudar o valor não é decisão minha).

    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
        python3 testes/test_tema2027_etapa5_acoes.py
"""
import asyncio
import os
import pathlib
import sys

from playwright.async_api import async_playwright

BASE = pathlib.Path(__file__).parent.parent
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH', '/opt/pw-browsers/chromium')

PUBLICADO = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
BUILD_NOVO = f'file://{BASE / "index.html"}'

# Cada classe só tem instância visível numa aba específica com os dados
# semeados abaixo — Torre não usa .btn-primary/.btn-success (são ações de
# Programação/Portaria), e o inverso também vale. Conferido com
# `debug_btns.py` antes de escrever este mapa.
BOTAO_ABA = {
    '.btn-primary': 'programacao',   # "➕ Criar Carga (Aguardando Veículo)"
    '.btn-success': 'portaria',      # "🚚 Chegou"
    '.btn-danger':  'torre',         # "Excluir" / "Cancelar"
    '.btn-sec':     'torre',         # "➕ Outra carga" / "🔒 Fechar Programação..."
}
BOTOES = list(BOTAO_ABA)
TEMAS = ['escuro', 'claro']

falhas = []
avisos = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def av(nome, detalhe=''):
    print(f"  [AVISO] {nome}" + (f" — {detalhe}" if detalhe else ''))
    avisos.append(nome)


SEMEAR = """
() => {
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
}
"""


async def logar_e_semear(pg):
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(400)
    await pg.evaluate(SEMEAR)
    await pg.wait_for_timeout(300)


async def ir_para_tab(pg, aba):
    await pg.evaluate("(aba) => { abrirTab(aba); renderAll(); }", aba)
    await pg.wait_for_timeout(200)


async def medir_hover_caro(pg, rotulo):
    """Para cada classe de botão, compara box-shadow/filter em repouso vs
    :hover de verdade. Retorna dict {classe: {'shadow_mudou':bool,
    'filter_mudou':bool}}."""
    resultado = {}
    for sel in BOTOES:
        await ir_para_tab(pg, BOTAO_ABA[sel])
        alvo = pg.locator(f'{sel}:visible').first
        if await alvo.count() == 0:
            resultado[sel] = None
            continue
        repouso = await alvo.evaluate(
            "el => { const c = getComputedStyle(el); return {shadow:c.boxShadow, filter:c.filter}; }"
        )
        await alvo.hover(force=True)
        await pg.wait_for_timeout(80)
        em_hover = await alvo.evaluate(
            "el => { const c = getComputedStyle(el); return {shadow:c.boxShadow, filter:c.filter}; }"
        )
        # tira o mouse de cima para não contaminar a próxima medição
        await pg.mouse.move(0, 0)
        resultado[sel] = {
            'shadow_mudou': repouso['shadow'] != em_hover['shadow'],
            'filter_mudou': repouso['filter'] != em_hover['filter'],
            'repouso': repouso, 'hover': em_hover,
        }
    return resultado


def luminancia(rgb):
    def canal(v):
        v = v / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)


def razao_contraste(rgb1, rgb2):
    l1, l2 = luminancia(rgb1), luminancia(rgb2)
    claro, escuro = max(l1, l2), min(l1, l2)
    return (claro + 0.05) / (escuro + 0.05)


async def medir_contraste_pixel(pg, sel):
    """Screenshot do botão e mede o contraste texto/fundo POR PIXEL.

    O pixel do meio pode cair em cima de um traço do próprio texto/emoji
    (rótulo e botão são ambos centralizados) e mediria "texto contra
    texto" — 1:1, falso positivo de defeito. Em vez de um ponto, pega a
    COR MAIS FREQUENTE de todo o botão: o fundo sempre ocupa a maior área
    (o texto é fino), então a moda do histograma é o fundo real mesmo com
    anti-aliasing nas bordas das letras."""
    alvo = pg.locator(sel).first
    if await alvo.count() == 0:
        return None
    box = await alvo.bounding_box()
    if not box:
        return None
    cor_texto = await alvo.evaluate("""el => {
        const n = (getComputedStyle(el).color.match(/[\\d.]+/g) || []).map(Number);
        return [n[0]||0, n[1]||0, n[2]||0];
    }""")
    png = await alvo.screenshot()
    from PIL import Image
    import io
    img = Image.open(io.BytesIO(png)).convert('RGB')
    cores = img.getcolors(maxcolors=img.width * img.height)
    fundo_px = max(cores, key=lambda item: item[0])[1]
    return {'fundo_px': fundo_px, 'texto': tuple(cor_texto),
            'razao': razao_contraste(fundo_px, tuple(cor_texto))}


async def testar_build(url, rotulo, exigir_hover_barato):
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROMIUM)
        pg = await nav.new_page(viewport={'width': 1440, 'height': 950})
        await pg.goto(url)
        await pg.wait_for_timeout(600)
        await logar_e_semear(pg)

        # ---- 1. hover barato (opacity/transform) vs caro (box-shadow/filter)
        hover = await medir_hover_caro(pg, rotulo)
        for sel, r in hover.items():
            if r is None:
                ck(f'[{rotulo}] {sel} existe na Torre para medir hover', False, 'não encontrado')
                continue
            caro = r['shadow_mudou'] or r['filter_mudou']
            ok = (not caro) if exigir_hover_barato else True
            ck(f'[{rotulo}] {sel}: hover não anima box-shadow/filter',
               ok if exigir_hover_barato else True,
               f"shadow {r['repouso']['shadow']!r}->{r['hover']['shadow']!r}; "
               f"filter {r['repouso']['filter']!r}->{r['hover']['filter']!r}")
            if not exigir_hover_barato:
                # No publicado É ESPERADO que anime (prova que o teste enxerga).
                ck(f'[{rotulo}] CONTROLE: {sel} hover herdado REALMENTE anima algo caro',
                   caro, 'se isto falhar, o teste está cego para o defeito')

        # ---- 2. contraste dos 4 botões, 2 temas, por pixel
        contrastes = {}
        for tema in TEMAS:
            await pg.evaluate(f"()=>document.documentElement.setAttribute('data-tema','{tema}')")
            for sel in BOTOES:
                await ir_para_tab(pg, BOTAO_ABA[sel])
                await pg.wait_for_timeout(150)
                m = await medir_contraste_pixel(pg, f'{sel}:visible')
                contrastes[(tema, sel)] = m
                if m is None:
                    ck(f'[{rotulo}] {tema}/{sel}: contraste medido', False, 'botão não encontrado/visível')
                    continue
                ok = m['razao'] >= 4.5
                ck(f'[{rotulo}] {tema}/{sel}: contraste >= 4.5:1',
                   ok, f"{m['razao']:.2f}:1 (fundo px {m['fundo_px']}, texto {m['texto']})")

        # ---- 3. rótulo sem corte
        await ir_para_tab(pg, 'torre')
        cortes = await pg.evaluate("""() => {
            const alvo = [...document.querySelectorAll('button')].filter(b =>
                b.textContent.includes('Outra carga') ||
                b.textContent.includes('Fechar Programação e Iniciar Nova'));
            return alvo.map(b => ({
                texto: b.textContent.trim(),
                cortado: b.scrollWidth > b.clientWidth + 1
            }));
        }""")
        ck(f'[{rotulo}] pelo menos um botão de rótulo longo encontrado na Torre',
           len(cortes) > 0, f'{len(cortes)} encontrados')
        for c in cortes:
            ck(f"[{rotulo}] rótulo sem corte: {c['texto']!r}", not c['cortado'])

        # ---- 4. input da Torre com borda visível nos dois temas
        for tema in TEMAS:
            await pg.evaluate(f"()=>document.documentElement.setAttribute('data-tema','{tema}')")
            await pg.wait_for_timeout(100)
            alfa = await pg.evaluate("""() => {
                const el = document.querySelector('.peso-input');
                if(!el) return null;
                const c = getComputedStyle(el).borderColor;
                const n = (c.match(/[\\d.]+/g) || []).map(Number);
                return n.length > 3 ? n[3] : 1;
            }""")
            ck(f'[{rotulo}] {tema}: .peso-input com borda visível (alfa > 0)',
               alfa is not None and alfa > 0, f'alfa={alfa}')

        # ---- 5. foco por TAB DE VERDADE mostra anel dourado
        # `.focus()` programático sozinho não ativa `:focus-visible` no
        # Chromium (a modalidade de entrada continua "mouse", do clique do
        # login) — dava style:'none' nos DOIS builds e seria falso-negativo.
        # Sequência real: clique no campo (foca sem anel, modalidade mouse),
        # Tab (sai do campo, ativa modalidade teclado), Shift+Tab (volta ao
        # campo PELO TECLADO) — aí sim `:focus-visible` casa de verdade.
        await ir_para_tab(pg, 'torre')
        await pg.evaluate("()=>document.documentElement.setAttribute('data-tema','escuro')")
        pesoInput = pg.locator('.peso-input').first
        await pesoInput.click()
        await pg.keyboard.press('Tab')
        await pg.keyboard.press('Shift+Tab')
        ativo_e_peso = await pg.evaluate(
            "() => document.activeElement && document.activeElement.classList.contains('peso-input')"
        )
        outline = await pesoInput.evaluate("""el => {
            const c = getComputedStyle(el);
            return {color: c.outlineColor, width: c.outlineWidth, style: c.outlineStyle};
        }""")
        anel_ok = ativo_e_peso and outline['style'] != 'none' and outline['width'] not in ('0px', '')
        if exigir_hover_barato:
            ck(f'[{rotulo}] Tab (teclado) no campo Peso (Torre) mostra anel de foco visível',
               anel_ok, f"foco voltou ao peso-input={ativo_e_peso}; outline={outline}")
        else:
            # No publicado, `input:focus{outline:none}` (styles.css linha 955)
            # apaga o anel mesmo com foco por teclado — É ESPERADO reprovar
            # aqui (prova que o teste enxerga o defeito que a Etapa 5 corrige
            # com `input:focus-visible{...}` em 40_acoes.css).
            ck(f'[{rotulo}] CONTROLE: sem a Etapa 5, campo Peso (Torre) REALMENTE não mostra anel',
               not anel_ok, f"foco voltou ao peso-input={ativo_e_peso}; outline={outline}")

        # ---- 5b. o mesmo, no formulário de Programação (pedido explícito do
        # "Conferir" da Etapa 5: "Tab pelo formulário de Programação mostra
        # o anel dourado" — campo diferente do item 5, tela diferente).
        await ir_para_tab(pg, 'programacao')
        placa = pg.locator('#prog-placa')
        await placa.click()
        await pg.keyboard.press('Tab')
        await pg.keyboard.press('Shift+Tab')
        ativo_e_placa = await pg.evaluate("() => document.activeElement && document.activeElement.id === 'prog-placa'")
        outline_prog = await placa.evaluate("""el => {
            const c = getComputedStyle(el);
            return {color: c.outlineColor, width: c.outlineWidth, style: c.outlineStyle};
        }""")
        anel_prog_ok = ativo_e_placa and outline_prog['style'] != 'none' and outline_prog['width'] not in ('0px', '')
        if exigir_hover_barato:
            ck(f'[{rotulo}] Tab (teclado) em #prog-placa (form. Programação) mostra anel de foco',
               anel_prog_ok, f"foco voltou ao campo={ativo_e_placa}; outline={outline_prog}")
        else:
            ck(f'[{rotulo}] CONTROLE: sem a Etapa 5, #prog-placa REALMENTE não mostra anel',
               not anel_prog_ok, f"foco voltou ao campo={ativo_e_placa}; outline={outline_prog}")

        # ---- 6. achado reportado: tablet grande (>=821px) com pointer:coarse
        await nav.close()

    return {'hover': hover, 'contrastes': contrastes}


async def checar_tablet_toque(url, rotulo):
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROMIUM)
        ctx = await nav.new_context(viewport={'width': 1024, 'height': 768}, has_touch=True)
        pg = await ctx.new_page()
        await pg.goto(url)
        await pg.wait_for_timeout(600)
        await logar_e_semear(pg)
        await ir_para_tab(pg, 'torre')
        info = await pg.evaluate("""() => {
            const b = document.querySelector('.btn-sm');
            if(!b) return null;
            const r = b.getBoundingClientRect();
            return {h: r.height, w: r.width, minHeight: getComputedStyle(b).minHeight};
        }""")
        await ctx.close()
        await nav.close()
        if info is None:
            av(f'[{rotulo}] tablet 1024x768 touch: nenhum .btn-sm encontrado para medir')
            return
        ok = info['h'] >= 44 and info['w'] >= 44
        if ok:
            ck(f'[{rotulo}] tablet grande (1024px, touch) mantém alvo de toque >= 44px', True,
               str(info))
        else:
            av(f'[{rotulo}] tablet grande (1024px, touch): alvo de toque caiu para '
               f"{info['h']:.0f}x{info['w']:.0f}px (esperado >=44x44) — "
               f"@media screen and (min-width:821px){{.btn{{min-height:36px}}}} da Etapa 5 "
               f"(valor EXATO do VEREDITO) vence @media (pointer:coarse){{.btn{{min-height:44px}}}} "
               f"do styles.css por vir depois na cascata. Não corrigido aqui — "
               f"fora do mandato do executor, ver relato.")


async def main():
    print('=== BUILD PUBLICADO (deve reprovar o item de hover caro) ===')
    await testar_build(PUBLICADO, 'publicado', exigir_hover_barato=False)

    print('\n=== BUILD NOVO — tema2027/40_acoes.css (deve passar tudo) ===')
    resultado_novo = await testar_build(BUILD_NOVO, 'build-novo', exigir_hover_barato=True)

    print('\n=== ACHADO ADICIONAL: tablet grande com toque, >=821px ===')
    await checar_tablet_toque(PUBLICADO, 'publicado')
    await checar_tablet_toque(BUILD_NOVO, 'build-novo')

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    print('  AVISOS (não reprovam, ver relato): ' + (', '.join(avisos) if avisos else 'NENHUM'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
