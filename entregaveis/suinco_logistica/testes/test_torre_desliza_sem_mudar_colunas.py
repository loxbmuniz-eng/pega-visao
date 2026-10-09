#!/usr/bin/env python3
"""A Torre desliza, e as colunas e os campos continuam os mesmos (27/09/2026).

PEDIDO DO DONO, depois de tocar na "Torre de brinquedo": a linha que muda de
lugar desliza até a posição nova — e, com as palavras dele, "as partes
principais precisam manter sua estrutura (...) torre de controle editável
seguindo o formato de colunas e campos editáveis que foram estabelecidos".

A Torre é ordenada pela SEQUÊNCIA (e, sem sequência, pela última
atualização). Então o que desliza é a linha cuja sequência mudou — alguém
arrastou, digitou outra posição, apertou "Reorganizar", ou outro setor fez
isso. Mudança de ETAPA não move a linha: faz o selo de status pulsar.

O QUE ESTE TESTE TRAVA
  1. as 12 colunas são exatamente as de antes, na mesma ordem, e cada linha
     editável tem os mesmos campos de edição;
  2. sequência mudou → a linha que mudou de lugar anima; as que não mudaram,
     não;
  3. sincronia sem mudança → NADA anima (a tela não treme);
  4. etapa mudou → o selo de status daquela linha pulsa, e só dela;
  5. linha em edição não foge: com o cursor num campo da Torre, a ordem fica
     como estava; quando a pessoa sai do campo, a Torre se reorganiza;
  6. com movimento reduzido, a ordem muda sem animação nenhuma.

    python3 testes/test_torre_desliza_sem_mudar_colunas.py
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

COLUNAS = ['Seq.', 'Nº Carga', 'Veículo', 'Motorista', 'Rota', 'Peso (kg)', 'Palet.',
           'Tipo de Operação', 'Ganchos · Entr.', 'Status', 'Programação · Última etapa', 'Ação']


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


PREPARAR = """() => {
  DB.operador = {nome:'Ana', setor:'Logística'};
  cargasAbertas().forEach((c, i) => { c.sequencia = i + 1; });
  abrirTab('torre'); renderAll();
}"""
ANIMANDO = """() => [...document.querySelectorAll('#torre-tbody tr[data-carga]')]
  .filter(tr => tr.getAnimations().some(a => a.playState === 'running'))
  .map(tr => tr.dataset.carga)"""
ORDEM = "() => [...document.querySelectorAll('#torre-tbody tr[data-carga]')].map(tr => tr.dataset.carga)"


async def abrir(nav, reduzido=False):
    ctx = await nav.new_context(viewport={'width': 1440, 'height': 900},
                                reduced_motion='reduce' if reduzido else 'no-preference')
    pg = await ctx.new_page()
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(700)
    await pg.evaluate(SEED)
    await pg.evaluate(PREPARAR)
    await pg.wait_for_timeout(600)
    return ctx, pg


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []
        ctx, pg = await abrir(nav)
        pg.on('pageerror', lambda e: erros.append(str(e)))

        print('\n=== 1. A ESTRUTURA É A MESMA ===')
        cab = await pg.evaluate("() => [...document.querySelectorAll('#torre-thead th')].map(t => t.innerText.trim())")
        ck('as 12 colunas, na mesma ordem', cab == COLUNAS, str(cab))
        campos = await pg.evaluate("""() => { const tr = document.querySelector('#torre-tbody tr[data-carga]');
            return ['.seq-input','.numero-carga-input','.placa-input'].map(s => !!tr.querySelector(s)); }""")
        ck('a linha editável tem sequência, nº da carga e placa editáveis', all(campos), str(campos))

        print('\n=== 2. SEQUÊNCIA MUDOU: SÓ QUEM MUDOU DE LUGAR DESLIZA ===')
        ordem = await pg.evaluate(ORDEM)
        ck('há linhas bastantes', len(ordem) >= 4, str(ordem))
        await pg.evaluate("""(id) => { const c = DB.cargas.find(x => x.id === id);
            c.sequencia = 999; c.atualizadoEm = new Date().toISOString(); renderAll(); }""", ordem[0])
        anim = await pg.evaluate(ANIMANDO)
        ck('a linha que foi para o fim desliza', ordem[0] in anim, str(anim))
        ck('as que subiram uma casa deslizam junto (abrem o espaço)', ordem[1] in anim, str(anim))
        await pg.wait_for_timeout(600)

        print('\n=== 3. SINCRONIA SEM MUDANÇA: NADA SE MEXE ===')
        await pg.evaluate("() => renderAll()")
        ck('nenhuma linha anima', await pg.evaluate(ANIMANDO) == [])
        ck('nenhum selo pulsa', await pg.evaluate(
            "() => [...document.querySelectorAll('#torre-tbody .badge')].filter(b => b.getAnimations().length).length") == 0)

        print('\n=== 4. MUDOU DE ETAPA: O SELO PULSA, A LINHA FICA ===')
        alvo = (await pg.evaluate(ORDEM))[1]
        await pg.evaluate("""(id) => { const c = DB.cargas.find(x => x.id === id);
            c.status = c.status === 'Faturado' ? 'Embarque Finalizado' : 'Faturado';
            renderAll(); }""", alvo)
        selos = await pg.evaluate("""() => [...document.querySelectorAll('#torre-tbody tr[data-carga]')]
            .filter(tr => { const b = tr.querySelector('.badge'); return b && b.getAnimations().length; })
            .map(tr => tr.dataset.carga)""")
        ck('só o selo daquela carga pulsa', selos == [alvo], str(selos))
        await pg.wait_for_timeout(600)

        print('\n=== 5. LINHA EM EDIÇÃO NÃO FOGE ===')
        ordem = await pg.evaluate(ORDEM)
        campo = pg.locator(f'#torre-tbody tr[data-carga="{ordem[2]}"] .numero-carga-input')
        await campo.click()
        await pg.evaluate("""(id) => { const c = DB.cargas.find(x => x.id === id);
            c.sequencia = 999; c.atualizadoEm = new Date().toISOString(); renderAll(); }""", ordem[0])
        durante = await pg.evaluate(ORDEM)
        ck('com o cursor num campo, a ordem fica como estava', durante == ordem, f'{ordem} → {durante}')
        ck('e o cursor continua na mesma carga', await pg.evaluate(
            "() => document.activeElement.closest('tr').dataset.carga") == ordem[2])
        await pg.evaluate("() => document.activeElement.blur()")
        await pg.wait_for_timeout(500)
        depois = await pg.evaluate(ORDEM)
        ck('ao sair da tabela, a Torre se reorganiza', depois[-1] == ordem[0] and depois != ordem, str(depois))

        print('\n=== 5b. A MUDANÇA DA PRÓPRIA PESSOA VALE NA HORA ===')
        # Uma carga que já carregou: o número dela é registro e é gravado na
        # hora, sem servidor — dá para ver a linha ir para onde ela mandou.
        ordem = await pg.evaluate(ORDEM)
        alvo = ordem[0]
        await pg.evaluate("(id) => { DB.cargas.find(x => x.id === id).status = 'Faturado'; renderAll(); }", alvo)
        ck('a carga de teste já carregou (o número dela é registro)',
           await pg.evaluate("(id) => !aindaVaiCarregar(DB.cargas.find(x => x.id === id))", alvo))
        seq = pg.locator(f'#torre-tbody tr[data-carga="{alvo}"] .seq-input')
        await seq.fill('5000')
        await seq.dispatch_event('change')
        # A REGRA MUDOU DE PROPÓSITO (09/10/2026, #131): 5000 pula para depois
        # da maior sequência do dia, e o painel PERGUNTA antes de gravar. A
        # pessoa confirma; o que este bloco trava continua igual — a linha vai
        # na hora e o cursor volta para o campo dela.
        await pg.wait_for_selector('#pergunta-ok', timeout=3000)
        ck('5000 depois da maior do dia: o painel pergunta antes',
           '5000' in (await pg.inner_text('#pergunta-titulo')))
        await pg.click('#pergunta-ok')
        await pg.wait_for_timeout(150)
        agora = await pg.evaluate(ORDEM)
        ck('ela digitou a posição: a linha vai na hora, com o cursor ainda no campo',
           agora[-1] == alvo, str(agora))
        ck('e o cursor continua na linha dela', await pg.evaluate(
            "() => (document.activeElement.closest('tr') || {dataset:{}}).dataset.carga") == alvo)
        await ctx.close()

        print('\n=== 6. MOVIMENTO REDUZIDO: MUDA SEM ANIMAR ===')
        ctx2, pg2 = await abrir(nav, reduzido=True)
        pg2.on('pageerror', lambda e: erros.append(str(e)))
        ordem = await pg2.evaluate(ORDEM)
        await pg2.evaluate("""(id) => { const c = DB.cargas.find(x => x.id === id);
            c.sequencia = 999; c.atualizadoEm = new Date().toISOString(); renderAll(); }""", ordem[0])
        ck('a ordem mudou', (await pg2.evaluate(ORDEM))[-1] == ordem[0])
        ck('sem nenhuma linha animando', await pg2.evaluate(ANIMANDO) == [])
        await ctx2.close()

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
