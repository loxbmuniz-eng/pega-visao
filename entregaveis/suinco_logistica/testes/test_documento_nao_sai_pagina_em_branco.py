#!/usr/bin/env python3
"""Documento do servidor não sai com página em branco (16/09/2026).

RELATO DO DONO, com duas fotos do papel na mão:

  "os relatórios de devoluções estão saindo em branco, com a primeira
   página branca, e, depois da primeira página branca, saem as devoluções
   na página seguinte sem cabeçalho. Eu preciso que siga o mesmo padrão do
   relatório operacional... com cabeçalho em todas, sem quebra de dados,
   sem quebra de tabela."

A CAUSA, reproduzida antes de qualquer correção:

    .dev-doc-bloco{ margin-bottom:10px; break-inside:avoid; }      (4053)
    .dev-doc-checklist{ margin-bottom:14px; page-break-inside:avoid }  (3960)

O `avoid` estava envolvendo a TABELA INTEIRA. Com 12 linhas o bloco tem
1.274 px e a folha A4 deitada tem ~750 px úteis: não cabe, e não pode ser
partido. Sobra ao navegador uma saída só — empurrar o bloco inteiro para a
página seguinte, deixando a primeira com o cabeçalho e nada embaixo.

E o cabeçalho da tabela não repetia pelo mesmo motivo: a regra certa já
existe (`thead{display:table-header-group}`), mas ela só vale quando a
tabela PODE ser partida. Bloco indivisível, cabeçalho preso dentro dele.

MEDIDO, mesmo conteúdo, mesmos 12 registros:

    com  break-inside:avoid ... 3 páginas   <- a do meio é a branca
    sem  break-inside:avoid ... 2 páginas

O Relatório Operacional nunca teve isso porque a tabela dele não está
dentro de um bloco com `avoid`.

A CORREÇÃO é mover a proteção de nível: `break-inside:avoid` protege a
LINHA (para nenhum registro sair cortado ao meio) e não a tabela. A
proteção de linha já existe em `.print-page tr`.

O QUE ESTE TESTE TRAVA, medindo o RESULTADO e não a regra de CSS:
  1. nenhuma página em branco — o número de páginas é o mínimo que o
     conteúdo exige, não um a mais;
  2. o conteúdo começa na PRIMEIRA página, logo abaixo do cabeçalho;
  3. o cabeçalho da tabela se repete (thead = table-header-group);
  4. nenhuma linha é partida ao meio.
"""
import asyncio, re, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []
def ck(nome, ok, extra=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {extra}" if extra else ''))
    if not ok: falhas.append(nome)

def linhas_html(n):
    return ''.join(f"""<tr><td>70{800+i}</td><td>TOTAL</td><td>—</td>
      <td>101484 - Lucas Cotta Dias Oliveira</td>
      <td>810387 - Leandro Fernandes de Souza - (Norte de Minas)</td>
      <td>448208 - Nova Mercearia Nunes</td><td>1</td><td>2,52</td>
      <td>40026-APRESUNTADO FATIADO 180G - 14 PÇS</td><td>528{30+i}</td>
      <td>15/09/2026</td>
      <td>617 — Comercial/Pedido não solicitado pelo cliente.</td></tr>""" for i in range(n))

def documento(classe_bloco, n):
    return f"""<div class="print-page doc-normal">
      <div class="doc-cabecalho"><span class="doc-logo"></span>
        <div class="doc-identidade"><strong>Relação para o Operador — Checklist Nº 57</strong>
        <div>Norte de Minas · rota 516 · Dia 15/09/2026 · {n} linha(s)</div></div></div>
      <div class="{classe_bloco}">
        <div class="dev-doc-bloco-tit">Checklist Nº 57 · Norte de Minas</div>
        <table class="doc-tabela dev-doc-tabela"><thead><tr>
          <th>Nota</th><th>Parcial / Total</th><th>Nº parcial</th><th>Supervisor</th>
          <th>RCA</th><th>Cliente</th><th>CX</th><th>Peso (kg)</th><th>Produto</th>
          <th>Nº DEV</th><th>Data DEV</th><th>Motivo</th></tr></thead>
        <tbody>{linhas_html(n)}</tbody></table>
      </div></div>"""

async def medir(nav, css, classe, n):
    pg = await nav.new_page()
    doc = ('<!doctype html><html><head><meta charset="utf-8">'
           f'<style>{css}</style><style>@page{{size:A4 landscape;margin:5mm}}</style>'
           f'</head><body>{documento(classe, n)}</body></html>')
    await pg.set_content(doc, wait_until='load')
    await pg.emulate_media(media='print')
    await pg.wait_for_timeout(250)
    geo = await pg.evaluate("""() => {
      const cab = document.querySelector('.doc-cabecalho');
      const tr  = document.querySelector('tbody tr');
      const blo = document.querySelector('.dev-doc-bloco, .dev-doc-checklist');
      const th  = document.querySelector('thead');
      return {
        fimCabecalho: Math.round(cab.getBoundingClientRect().bottom),
        topoPrimeiraLinha: Math.round(tr.getBoundingClientRect().top),
        alturaBloco: Math.round(blo.getBoundingClientRect().height),
        alturaTotal: Math.round(document.body.scrollHeight),
        theadModo: getComputedStyle(th).display,
        quebraDoBloco: getComputedStyle(blo).breakInside,
        quebraDaLinha: getComputedStyle(tr).breakInside,
      };
    }""")
    pdf = await pg.pdf(format='A4', landscape=True,
                       margin={'top':'5mm','bottom':'5mm','left':'5mm','right':'5mm'})
    geo['paginas'] = len(re.findall(rb'/Type\s*/Page[^s]', pdf))
    await pg.close()
    return geo

async def main():
    N = 12
    # A4 deitada: 297x210mm, margem 5mm dos dois lados -> 200mm úteis de altura.
    UTIL_PX = 200 * (96/25.4)
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(); await pg.goto(PAINEL)
        await pg.wait_for_function('typeof coletarCssDoPainel === "function"')
        css = await pg.evaluate("() => coletarCssDoPainel()")
        await pg.close()

        for classe, rot in (('dev-doc-bloco', 'Relação para o Operador'),
                            ('dev-doc-checklist', 'Relatório de Devoluções')):
            print(f'\n=== {rot} ({classe}), {N} linhas ===')
            g = await medir(nav, css, classe, N)
            minimo = max(1, -(-g['alturaTotal'] // int(UTIL_PX)))

            ck(f'{rot}: sem página em branco',
               g['paginas'] <= minimo,
               f"saiu com {g['paginas']} página(s); o conteúdo exige {minimo}")

            ck(f'{rot}: a tabela começa na PRIMEIRA página',
               g['topoPrimeiraLinha'] - g['fimCabecalho'] < 120,
               f"primeira linha a {g['topoPrimeiraLinha']}px, cabeçalho termina em "
               f"{g['fimCabecalho']}px — um vão desse tamanho é página em branco")

            ck(f'{rot}: o cabeçalho da tabela se repete a cada página',
               g['theadModo'] == 'table-header-group', g['theadModo'])

            ck(f'{rot}: o BLOCO pode ser partido entre páginas',
               g['quebraDoBloco'] != 'avoid',
               f"break-inside do bloco = {g['quebraDoBloco']} — com a tabela inteira "
               f"indivisível ({g['alturaBloco']}px numa folha de {int(UTIL_PX)}px), "
               f"o navegador empurra tudo para a página seguinte")

            ck(f'{rot}: a LINHA continua protegida de ser cortada',
               g['quebraDaLinha'] == 'avoid',
               f"break-inside da linha = {g['quebraDaLinha']}")
        await nav.close()

    print()
    if falhas:
        print(f"RESULTADO: {len(falhas)} FALHA(S) — " + '; '.join(falhas)); sys.exit(1)
    print("RESULTADO: tudo verde")

asyncio.run(main())
