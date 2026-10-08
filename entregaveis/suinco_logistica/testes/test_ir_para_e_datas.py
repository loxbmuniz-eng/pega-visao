#!/usr/bin/env python3
"""Programação e Cadastros com "Ir para", e as duas datas que se avisam (08/10/2026, /impeccable Lote 4).

ACHADO DA AUDITORIA (ocorrência #125), medido a 1440×900:
  · a Programação tem 6 seções e a Montagem do dia — onde a Logística monta
    o dia — começava a 1.268 px do topo;
  · o Cadastros tem 17.534 px; as 300 linhas da Frota vêm antes de tudo, e
    "Cadastrar Rota" ficava a 14.822 px, sem âncora nem aba interna;
  · a Fila e a Montagem têm cada uma a sua data: mudar a da Fila deixava a
    Montagem na outra, sem aviso nenhum.

O QUE ESTE TESTE TRAVA, pela tela:
  1. a barra "Ir para" está no topo das duas abas, com as seções que a pessoa
     VÊ, na ordem da tela (a Logística não vê o que é da Administração);
  2. um clique leva o título da seção para baixo do cabeçalho, à vista, com o
     foco nele; pelo teclado (Enter) também;
  3. no celular, ir para uma seção recolhida do Cadastros a ABRE;
  4. o redesenho de 15 s não tira o foco de quem está na barra;
  5. Montagem e Fila em dias diferentes: a Montagem diz as duas datas e um
     botão põe a Fila no mesmo dia; iguais, o aviso some.

    bash testes/rodar_tudo.sh test_ir_para_e_datas
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

PAINEL = os.environ.get('SUINCO_PAINEL', 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html')
falhas = []

PROG = ['Fila', 'Nova carga', 'Montagem do dia', 'Rotas da semana', 'Aguardando carga', 'Como o dia foi feito']
PROG_IDS = ['card-fila-programados', 'card-nova-carga', 'card-montagem', 'card-modelo-semana',
            'card-aguardando-carga', 'card-programacao-dia']
CAD = ['Frota', 'Transportadoras', 'Rotas', 'Tabela de Frete', 'Devoluções']


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def entrar(pg, setor):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(900)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', setor)
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(500)


async def abrir_aba(pg, aba, celular=False):
    if celular:
        await pg.click('#btn-menu')
        await pg.wait_for_timeout(300)
    await pg.click(f'.nav-tab[data-tab="{aba}"]')
    await pg.wait_for_timeout(500)


LER_BARRA = """(aba) => {
  const nav = document.querySelector(`.ir-para[data-ir-para="${aba}"]`);
  if(!nav) return null;
  const r = nav.getBoundingClientRect();
  return {
    visivel: !nav.hidden && r.height > 0,
    topo: Math.round(r.top + scrollY),
    itens: [...nav.querySelectorAll('.ir-para-item')].map(b => b.textContent.trim()),
    alvos: [...nav.querySelectorAll('.ir-para-item')].map(b => b.dataset.alvo),
  };
}"""

VISIVEIS = """(ids) => ids.filter(id => { const e = document.getElementById(id);
  return !!e && !e.hidden && !e.closest('[hidden]'); })"""

POSICAO = """(id) => { const e = document.getElementById(id); const t = e.querySelector(':scope > .card-title') || e;
  const r = t.getBoundingClientRect();
  return { topo: Math.round(r.top), base: Math.round(r.bottom), alto: innerHeight,
           y: Math.round(e.getBoundingClientRect().top + scrollY),
           foco: document.activeElement === t,
           aberta: e.classList.contains('sec-aberta') }; }"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        erros = []

        # ---- Administração, computador -------------------------------------
        ctx = await nav.new_context(viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg, 'Administração')
        await abrir_aba(pg, 'programacao')
        b = await pg.evaluate(LER_BARRA, 'programacao')
        ck('1. a Programação tem a barra "Ir para"', bool(b and b['visivel']), str(b)[:120])
        if b and b['visivel']:
            ck('1. a barra está no topo da aba (acima da dobra)', b['topo'] < 400, str(b['topo']))
            vis = await pg.evaluate(VISIVEIS, PROG_IDS)
            ck('1. lista as seções visíveis, na ordem da tela', b['alvos'] == vis and b['itens'][:3] == PROG[:3],
               f"{b['itens']} / {vis}")
            antes = await pg.evaluate(POSICAO, 'card-montagem')
            ck('2. (a Montagem começa abaixo da dobra)', antes['y'] > 900, str(antes['y']))
            await pg.click('.ir-para[data-ir-para="programacao"] .ir-para-item[data-alvo="card-montagem"]')
            await pg.wait_for_timeout(300)
            d = await pg.evaluate(POSICAO, 'card-montagem')
            ck('2. "Montagem do dia" leva o título para cima, à vista e abaixo do cabeçalho',
               100 <= d['topo'] <= 260 and d['base'] < d['alto'], str(d))
            ck('2. e o foco vai para o título da seção', d['foco'])
            # teclado ("Como o dia foi feito" nasce escondido — abre pelo rodapé
            # do Controle — e por isso não está na barra; o teclado vai a outro)
            await pg.evaluate("() => scrollTo(0, 0)")
            sel = '.ir-para[data-ir-para="programacao"] .ir-para-item[data-alvo="card-aguardando-carga"]'
            if await pg.locator(sel).count():
                await pg.focus(sel)
                await pg.keyboard.press('Enter')
                await pg.wait_for_timeout(300)
                d = await pg.evaluate(POSICAO, 'card-aguardando-carga')
                # é a última seção: a página acaba antes de o título subir ao topo
                ck('2. pelo teclado (Enter) também: título inteiro à vista e com foco',
                   d['topo'] >= 100 and d['base'] <= d['alto'] and d['foco'], str(d))
            else:
                ck('2. pelo teclado (Enter) também', False, '"Aguardando carga" não está na barra')
            ck('1. a seção escondida (Controle da programação) não aparece na barra',
               'card-programacao-dia' not in b['alvos'])
            # o redesenho não tira o foco da barra
            await pg.evaluate("() => scrollTo(0, 0)")
            await pg.focus('.ir-para[data-ir-para="programacao"] .ir-para-item[data-alvo="card-nova-carga"]')
            await pg.evaluate("() => renderAll()")
            await pg.wait_for_timeout(300)
            foco = await pg.evaluate("() => document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.alvo : null")
            ck('4. o redesenho de 15 s não tira o foco de quem está na barra', foco == 'card-nova-carga', str(foco))

        # ---- as duas datas -------------------------------------------------
        await pg.evaluate("() => scrollTo(0, 0)")
        amanha = await pg.evaluate("() => { const d = new Date(); d.setDate(d.getDate() + 1); return diaLocalISO(d); }")
        fila = await pg.input_value('#prog-fila-dia')
        await pg.fill('#mont-data', amanha)
        await pg.dispatch_event('#mont-data', 'change')
        await pg.wait_for_timeout(600)
        aviso = await pg.evaluate("""() => { const e = document.getElementById('mont-aviso-datas');
            return e ? { visivel: !e.hidden && e.getBoundingClientRect().height > 0, texto: e.innerText } : null; }""")
        ck('5. Montagem em outro dia: a tela avisa', bool(aviso and aviso['visivel']), str(aviso)[:160])
        if aviso and aviso['visivel']:
            d_mont = amanha[8:10] + '/' + amanha[5:7]
            ck('5. o aviso diz as DUAS datas', d_mont in aviso['texto'] and 'Fila' in aviso['texto'], aviso['texto'][:160])
            await pg.click('#mont-alinhar-fila')
            await pg.wait_for_timeout(600)
            fila2 = await pg.input_value('#prog-fila-dia')
            ck('5. o botão põe a Fila no dia da Montagem', fila2 == amanha, f'{fila} → {fila2}')
            some = await pg.evaluate("() => document.getElementById('mont-aviso-datas').hidden")
            ck('5. com as duas iguais, o aviso some', some)

        # ---- Administração, Cadastros ---------------------------------------
        await abrir_aba(pg, 'cadastros')
        b = await pg.evaluate(LER_BARRA, 'cadastros')
        ck('1. o Cadastros tem a barra "Ir para"', bool(b and b['visivel']), str(b)[:120])
        if b and b['visivel']:
            ck('1. a Administração vê as cinco seções', b['itens'] == CAD, str(b['itens']))
            await pg.click('.ir-para[data-ir-para="cadastros"] .ir-para-item[data-alvo="card-tabela-frete"]')
            await pg.wait_for_timeout(300)
            d = await pg.evaluate(POSICAO, 'card-tabela-frete')
            ck('2. "Tabela de Frete" à vista, sem rolar 16 mil pixels', 100 <= d['topo'] <= 260, str(d))
        ck('sem erro de JavaScript (Administração)', not erros, ' | '.join(erros[:3]))
        await ctx.close()

        # ---- Logística: só o que ela vê -----------------------------------
        ctx = await nav.new_context(viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        await entrar(pg, 'Logística')
        await abrir_aba(pg, 'cadastros')
        b = await pg.evaluate(LER_BARRA, 'cadastros')
        if b:
            todos = ['card-frota', 'card-transportadoras', 'card-cadastrar-rota', 'card-tabela-frete', 'card-cad-devolucoes']
            vis = await pg.evaluate(VISIVEIS, todos)
            ck('1. a Logística vê na barra exatamente as seções que aparecem para ela',
               b['alvos'] == vis, f"barra {b['alvos']} / tela {vis}")
        else:
            ck('1. a Logística tem a barra no Cadastros', False)
        await ctx.close()

        # ---- celular: a seção recolhida abre ---------------------------------
        ctx = await nav.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        await entrar(pg, 'Administração')
        await abrir_aba(pg, 'cadastros', celular=True)
        b = await pg.evaluate(LER_BARRA, 'cadastros')
        ck('3. no celular a barra aparece', bool(b and b['visivel']), str(b)[:120])
        if b and b['visivel']:
            antes = await pg.evaluate(POSICAO, 'card-cadastrar-rota')
            ck('3. (a seção "Rotas" começa recolhida)', not antes['aberta'])
            await pg.click('.ir-para[data-ir-para="cadastros"] .ir-para-item[data-alvo="card-cadastrar-rota"]')
            await pg.wait_for_timeout(400)
            d = await pg.evaluate(POSICAO, 'card-cadastrar-rota')
            ck('3. tocar em "Rotas" abre a seção e a mostra', d['aberta'] and 0 <= d['topo'] <= 300, str(d))
            alvo = await pg.evaluate("""() => { const b = document.querySelector('.ir-para-item');
                const r = b.getBoundingClientRect(); return Math.round(r.height); }""")
            ck('3. os botões da barra têm 44 px para o dedo', alvo >= 44, str(alvo))
            largura = await pg.evaluate("() => document.documentElement.scrollWidth")
            ck('3. a página não rola de lado', largura <= 390, str(largura))
        await ctx.close()
        await nav.close()

    print(f"\n{len(falhas)} FALHA(S)" + (': ' + ', '.join(falhas) if falhas else ''))
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
