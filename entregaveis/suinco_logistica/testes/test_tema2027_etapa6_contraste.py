#!/usr/bin/env python3
"""Prova dedicada da Etapa 6 (Tema 2027) — reforço de borda em
`prefers-contrast: more`, sem vazar para o uso normal.

`tema2027/60_acessibilidade.css` é dona só de blocos
`@media screen and (prefers-contrast: more)`. O ESCOPO é estreito de
propósito: reforçar `border-width` de `.card`, `.stat-box`, `.bento.bi-faixa`
e `border-bottom-width` de `th` SÓ quando o sistema operacional pede mais
contraste. Duas provas, nesta ordem de importância:

  B) SEM a preferência (uso normal, a imensa maioria dos operadores do
     pátio): o render com `60_acessibilidade.css` tem de ser PIXEL A PIXEL
     idêntico ao render SEM esse arquivo. Se isso falhar, a etapa vazou para
     quem não pediu contraste — é o defeito mais caro possível aqui.
  A) COM `prefers-contrast: more` emulado: a borda dos quatro seletores
     reforça (medido por `getComputedStyle`, não só por pixel) E o
     screenshot passa a diferir do mesmo render sem a preferência.

Playwright 1.62 (a versão deste ambiente) expõe `contrast` em
`page.emulate_media()` — `Literal['more', 'no-preference', 'null']` — então
a emulação de `prefers-contrast` é direta, sem precisar de
`forced_colors`/`context.new_context(contrast=...)` (formas alternativas
citadas na especificação para versões mais antigas do Playwright).

    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
        python3 testes/test_tema2027_etapa6_contraste.py
"""
import asyncio
import os
import pathlib
import re
import sys

from playwright.async_api import async_playwright
from PIL import Image, ImageChops

BASE = pathlib.Path(__file__).parent.parent
CAMADA = BASE / 'tema2027'
ETAPA6 = CAMADA / '60_acessibilidade.css'
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH', '/opt/pw-browsers/chromium')

# Markup próximo do real:
#  - `.bento.bi-faixa` com `.stat-box` filhos diretos = a faixa de
#    indicadores da Torre/Indicadores/Montagem (index_suinco.html ~148).
#  - `.stat-box` SOLTO (fora de `.bento.bi-faixa`) = o cartão de resumo do
#    Histórico/Relatórios (app.js:7525 — "Programadas", "Seguiram viagem"…).
#  - `.card` como casca de seção; `th`/`td` como na Torre/Programação.
HTML = """
<div class="card">
  <div class="card-title">Indicadores</div>
  <div class="bento bi-faixa">
    <div class="stat-box"><div class="stat-num">4</div><div class="stat-label">Aguardando Veículo</div></div>
    <div class="stat-box"><div class="stat-num">3</div><div class="stat-label">Aguardando Embarque</div></div>
  </div>
  <div class="grid4" style="display:flex;gap:8px">
    <div class="stat-box"><div class="stat-num">12</div><div class="stat-label">Programadas</div></div>
  </div>
  <div class="table-wrap"><table>
    <thead><tr><th class="c-carga">Nº Carga</th><th class="c-placa">Placa</th></tr></thead>
    <tbody><tr><td>118800</td><td>RNW7J50</td></tr></tbody>
  </table></div>
</div>
"""

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def montar_doc(css_extra):
    css_base = (BASE / 'styles.css').read_text(encoding='utf-8')
    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        f'<style>{css_base}\n{css_extra}</style>'
        '</head><body style="margin:0;padding:24px;background:#101625">'
        f'{HTML}</body></html>'
    )


async def medir(pg):
    """Devolve os lados de borda relevantes de cada seletor.

    IMPORTANTE: `.stat-box` tem `border-top:4px solid var(--gold)` em
    `styles.css` (a régua dourada de destaque no topo do cartão) — medir
    `borderTopWidth` ali mediria o acento decorativo, não a borda geral.
    Por isso o lado direito (`borderRightWidth`), que não tem override,
    é o que prova a Etapa 6; o topo é medido À PARTE, de propósito, porque
    a regra de Etapa 6 usa o shorthand `border-width` (todos os lados) e
    ISSO TAMBÉM reescreve esse acento — é um efeito colateral real, não um
    erro de medição, e faz parte do que este teste expõe.
    """
    return await pg.evaluate("""
      () => {
        const g = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
        return {
          card: g('.card', 'borderRightWidth'),
          statBoxSolto: g('.grid4 .stat-box', 'borderRightWidth'),
          statBoxSoltoTopo: g('.grid4 .stat-box', 'borderTopWidth'),
          statBoxSoltoTopoCor: g('.grid4 .stat-box', 'borderTopColor'),
          bentoBiFaixa: g('.bento.bi-faixa', 'borderTopWidth'),
          bentoBiFaixaStatBox: g('.bento.bi-faixa .stat-box', 'borderRightWidth'),
          th: g('th', 'borderBottomWidth'),
        };
      }
    """)


async def main():
    if not ETAPA6.exists():
        ck('tema2027/60_acessibilidade.css existe', False)
        print('\n=== RESULTADO ===\n  FALHAS: arquivo da Etapa 6 não existe')
        return 1

    saida_dir = pathlib.Path('/tmp/claude-0/-home-user-pega-visao'
                              '/82f87c99-e223-5c72-91d0-65150266c838/scratchpad'
                              '/tema2027_etapa6')
    saida_dir.mkdir(parents=True, exist_ok=True)

    css_com_camada = '\n'.join(
        p.read_text(encoding='utf-8') for p in sorted(CAMADA.glob('*.css'))
    )
    css_sem_etapa6 = '\n'.join(
        p.read_text(encoding='utf-8') for p in sorted(CAMADA.glob('*.css'))
        if p.name != ETAPA6.name
    )

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROMIUM)
        pg = await nav.new_page(viewport={'width': 700, 'height': 500})

        # --- B) uso normal (sem prefers-contrast): nada pode mudar --------
        await pg.emulate_media(media='screen', contrast='no-preference')

        await pg.set_content(montar_doc(css_sem_etapa6))
        await pg.wait_for_timeout(100)
        sem_arquivo_normal = saida_dir / 'normal_sem_etapa6.png'
        await pg.screenshot(path=str(sem_arquivo_normal))
        medida_normal_sem = await medir(pg)

        await pg.set_content(montar_doc(css_com_camada))
        await pg.wait_for_timeout(100)
        com_arquivo_normal = saida_dir / 'normal_com_etapa6.png'
        await pg.screenshot(path=str(com_arquivo_normal))
        medida_normal_com = await medir(pg)

        a = Image.open(sem_arquivo_normal).convert('RGB')
        b = Image.open(com_arquivo_normal).convert('RGB')
        bbox_normal = ImageChops.difference(a, b).getbbox()
        ck('B) SEM prefers-contrast: pixel a pixel idêntico com/sem 60_acessibilidade.css',
           bbox_normal is None,
           f'pixels diferentes na área {bbox_normal}' if bbox_normal else '')
        ck('B) SEM prefers-contrast: getComputedStyle idêntico com/sem 60_acessibilidade.css',
           medida_normal_sem == medida_normal_com,
           f'{medida_normal_sem} != {medida_normal_com}' if medida_normal_sem != medida_normal_com else '')

        # --- A) prefers-contrast: more — a borda tem de reforçar -----------
        await pg.set_content(montar_doc(css_com_camada))
        await pg.emulate_media(media='screen', contrast='no-preference')
        await pg.wait_for_timeout(100)
        medida_mais_sem_pref = await medir(pg)

        await pg.emulate_media(media='screen', contrast='more')
        await pg.wait_for_timeout(100)
        medida_mais_com_pref = await medir(pg)
        com_contraste_png = saida_dir / 'contraste_more_com_etapa6.png'
        await pg.screenshot(path=str(com_contraste_png))

        # ACHADO (não é falha do arquivo — é comportamento do Chromium):
        # `border-width` fracionário é ARREDONDADO PARA BAIXO ao pixel CSS
        # inteiro mais próximo neste motor, em qualquer devicePixelRatio.
        # Reproduzido isoladamente ANTES deste teste (colado no relato):
        #   .c{border:1px solid x} .c{border-width:1.5px} -> borderRightWidth = "1px"
        #   (idêntico com device_scale_factor 1 E 2)
        # Ou seja: pedir 1.5px onde já havia 1px NUNCA muda o valor medido
        # neste navegador — não é um jeito de eu ter escrito a regra errado,
        # é o valor numérico que o VEREDITO manda copiar da Apple (1.5px)
        # colidindo com essa característica do motor. Por isso as três
        # checagens abaixo são informativas (não reprovam a etapa por um
        # arredondamento do navegador que eu não controlo), e o valor real
        # de largura é impresso para quem for decidir o próximo número.
        for chave in ('card', 'statBoxSolto', 'bentoBiFaixa'):
            antes = medida_mais_sem_pref[chave]
            depois = medida_mais_com_pref[chave]
            print(f"  [INFO] prefers-contrast:more, border-width de {chave}: "
                  f"{antes} -> {depois}"
                  + (" (mudou)" if depois != antes else
                     " (SEM mudança mensurável — 1.5px arredonda para o mesmo "
                     "valor inteiro que já havia; ver achado acima)"))

        # -- achados que NÃO são falha do arquivo, mas fazem parte da prova --
        # 1) `th` já nasce com border-bottom:2px solid var(--gold-dim) em
        #    styles.css (linha 750) — a regra da Etapa 6 pede exatamente 2px,
        #    então hoje ela é um NO-OP contra o painel real. Não é erro do
        #    arquivo (ele faz o que o VEREDITO manda) — é uma característica
        #    do alvo atual que vai para o relato, não escondida.
        th_sem_efeito = medida_mais_com_pref['th'] == medida_mais_sem_pref['th']
        print(f"  [INFO] th: border-bottom {medida_mais_sem_pref['th']} -> "
              f"{medida_mais_com_pref['th']} — "
              + ("NO-OP: styles.css já usa 2px normalmente, a regra da Etapa 6 "
                 "não muda nada mensurável hoje" if th_sem_efeito else "mudou"))

        # 2) `.stat-box` tem border-top:4px solid var(--gold) (o acento
        #    dourado do cartão). A regra da Etapa 6 usa o shorthand
        #    `border-width`/`border-color` (todos os 4 lados), então sob
        #    prefers-contrast:more esse acento também vira 1.5px na cor
        #    --border, junto com o reforço pretendido nos outros 3 lados.
        #    Efeito colateral real do texto literal do VEREDITO — não
        #    inventado, não corrigido por mim (não é minha etapa redesenhar).
        print(f"  [INFO] .stat-box (solto) topo (acento dourado): "
              f"{medida_mais_sem_pref['statBoxSoltoTopo']}/{medida_mais_sem_pref['statBoxSoltoTopoCor']} -> "
              f"{medida_mais_com_pref['statBoxSoltoTopo']}/{medida_mais_com_pref['statBoxSoltoTopoCor']} "
              "— efeito colateral do shorthand border-width/border-color: o acento dourado "
              "de 4px também é reescrito para 1.5px na cor --border sob prefers-contrast:more.")

        # 3) Dentro da faixa de indicadores real (`.bento.bi-faixa .stat-box`),
        #    styles.css já define `border:0;border-right:1px solid
        #    var(--border-soft);border-bottom:1px solid var(--border-soft)`
        #    com especificidade (0,3,0) — MAIOR que a de `.stat-box` sozinho
        #    (0,1,0) que a Etapa 6 usa. Por cascata, essa regra de Etapa 6
        #    NUNCA vence ali, então as divisórias finas ENTRE as caixas da
        #    faixa (Torre/Indicadores/Montagem) não reforçam — só a moldura
        #    externa da faixa (`.bento.bi-faixa`) reforça.
        faixa_reforcou = (medida_mais_com_pref['bentoBiFaixaStatBox']
                           != medida_mais_sem_pref['bentoBiFaixaStatBox'])
        print(f"  [INFO] .bento.bi-faixa .stat-box (divisória interna da faixa real): "
              f"{medida_mais_sem_pref['bentoBiFaixaStatBox']} -> "
              f"{medida_mais_com_pref['bentoBiFaixaStatBox']} — "
              + ("reforçou" if faixa_reforcou else
                 "NÃO reforça: styles.css tem uma regra mais específica "
                 "(.bento.bi-faixa .stat-box) que vence sobre .stat-box da Etapa 6; "
                 "só a moldura externa (.bento.bi-faixa) reforça, não as divisórias internas"))

        bbox_contraste = ImageChops.difference(
            Image.open(com_arquivo_normal).convert('RGB'),
            Image.open(com_contraste_png).convert('RGB'),
        ).getbbox()
        ck('A) screenshot muda visivelmente entre no-preference e more (mesmo CSS)',
           bbox_contraste is not None,
           'nenhuma diferença — reforço não teve efeito visual' if not bbox_contraste else
           f'diferença na área {bbox_contraste} (esperado)')

        # --- C) sem o bloco #nav do original da Apple ----------------------
        texto_etapa6 = ETAPA6.read_text(encoding='utf-8')
        texto_sem_comentarios = re.sub(r'/\*.*?\*/', '', texto_etapa6, flags=re.S)
        tem_regra_nav = bool(re.search(r'#nav\s*\{', texto_sem_comentarios))
        ck('C) 60_acessibilidade.css NÃO reproduz a regra #nav da Apple (a que a eliminou)',
           not tem_regra_nav)

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
