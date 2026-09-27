#!/usr/bin/env python3
"""O que a pessoa digita não pode ir parar no campo de OUTRA carga (27/09/2026).

ACHADO AO PREPARAR A TORRE DESLIZANDO, reproduzido antes de qualquer
correção, no painel publicado:

  1. a Logística está digitando no Nº da carga da SEGUNDA linha da Torre;
  2. outro setor muda a sequência — a primeira linha vai para o fim;
  3. a Torre se redesenha (toda sincronia faz isso);
  4. o texto dela e o cursor vão parar no campo da carga que AGORA ocupa a
     segunda linha. Ao sair do campo, o número daquela outra carga é
     sobrescrito.

A CAUSA. A proteção de digitação (`_capturarDigitacao` / `_restaurarDigitacao`,
app.js) guarda o campo pelo `id` quando ele existe e, quando não existe,
pela POSIÇÃO: linha 2, coluna 2. Os campos da Torre não têm id. Posição de
linha não é identidade de carga — basta a ordem mudar.

A REGRA QUE ESTE TESTE TRAVA: o campo é achado pela CARGA (`data-carga` /
`data-id` da linha), nunca pela posição. Se a carga saiu da tela, o texto
não é devolvido em lugar nenhum — melhor perder a digitação em curso do que
gravá-la na carga errada.

    python3 testes/test_digitacao_nao_troca_de_carga.py
"""
import asyncio
import os
import re
import sys
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
PAINEL = 'file://' + os.path.join(os.path.dirname(AQUI), 'index.html')
SEED = re.search(r'SEED = """(.*?)"""',
                 open(os.path.join(AQUI, 'test_meta_patio_fora_dos_indicadores.py'), encoding='utf-8').read(),
                 re.S).group(1)
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


LER = """(alvo) => {
  const f = document.activeElement, tr = f && f.closest && f.closest('tr');
  const campos = [...document.querySelectorAll('#torre-tbody .numero-carga-input')]
    .map(i => [i.closest('tr').dataset.carga, i.value]);
  return { foco: tr ? tr.dataset.carga : null, alvo,
           comTexto: campos.filter(c => c[1].includes('XYZ')).map(c => c[0]) };
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(SEED)
        await pg.evaluate("() => { DB.operador = {nome:'Ana', setor:'Logística'}; abrirTab('torre'); renderAll(); }")
        await pg.wait_for_timeout(500)

        print('\n=== 1. OUTRO SETOR REORDENA ENQUANTO ELA DIGITA ===')
        ordem = await pg.evaluate("() => [...document.querySelectorAll('#torre-tbody tr[data-carga]')].map(tr => tr.dataset.carga)")
        ck('a Torre tem linhas editáveis para o teste', len(ordem) >= 3, str(ordem))
        campo = pg.locator('#torre-tbody tr[data-carga] .numero-carga-input').nth(1)
        await campo.click()
        await campo.press('End')
        await pg.keyboard.type('XYZ')
        await pg.evaluate("""(id) => { const c = DB.cargas.find(x => x.id === id);
            c.sequencia = 999; c.atualizadoEm = new Date().toISOString(); renderAll(); }""", ordem[0])
        await pg.wait_for_timeout(300)
        r = await pg.evaluate(LER, ordem[1])
        ck('o cursor continua na MESMA carga', r['foco'] == r['alvo'], f"digitava em {r['alvo']}, cursor em {r['foco']}")
        ck('o texto dela está só no campo da carga dela', r['comTexto'] == [r['alvo']], str(r['comTexto']))

        print('\n=== 2. SE A CARGA SAIU DA TELA, O TEXTO NÃO VAI PARA NENHUMA OUTRA ===')
        await pg.evaluate("() => renderAll()")
        campo = pg.locator(f'#torre-tbody tr[data-carga="{ordem[1]}"] .numero-carga-input')
        await campo.click()
        await campo.press('End')
        await pg.keyboard.type('XYZ')
        await pg.evaluate("""(id) => { const c = DB.cargas.find(x => x.id === id);
            c.status = 'Seguiu Viagem'; c.atualizadoEm = new Date().toISOString(); renderAll(); }""", ordem[1])
        await pg.wait_for_timeout(300)
        r2 = await pg.evaluate(LER, ordem[1])
        ck('nenhuma outra carga recebeu o texto', r2['comTexto'] == [], str(r2['comTexto']))
        ck('e o cursor não foi parar em outra carga', r2['foco'] in (None, ordem[1]), str(r2['foco']))

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
