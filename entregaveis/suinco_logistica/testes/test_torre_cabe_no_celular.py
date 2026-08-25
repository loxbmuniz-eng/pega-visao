#!/usr/bin/env python3
"""No celular, o cartão da Torre cabe na tela. (25/08/2026)

O dono mandou um print da Torre no celular com o cartão cortado do lado
esquerdo: "Nº CARGA" aparecia como "° CARGA", "PLACA" como "LACA", "ROTA"
como "OTA" — o cartão inteiro deslocado para fora da tela.

CAUSA, medida: `.tabela-patio{min-width:640px}`.

O comentário que estava lá dizia "no celular a matriz de seis colunas não
cabe; a tabela rola dentro da própria caixa". Era verdade — até 23/08,
quando a linha passou a virar CARTÃO no celular. Depois disso o mínimo
deixou de ser rolagem e virou corte: em 390px, a linha de grupo
("🚛 TRANSPORTADORAS — 4 CARGA(S)") não quebrava, esticava a tabela para
640px dentro de uma caixa de 340, e TODAS as linhas herdavam a largura.

Cartão empilha; não precisa de largura mínima. O mínimo continua valendo
onde a tabela NÃO vira cartão.

O que este teste guarda: nenhuma linha da Torre no celular é mais larga
que a tela, o texto do grupo quebra em vez de esticar, e o desktop
continua com a largura que a linha do tempo precisa.

    python3 testes/test_torre_cabe_no_celular.py
"""
import asyncio
import sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
LARGURA = 390
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


MONTAR = """() => {
    DB.cargas = []; DB.movimentacoes = [];
    for(let i = 0; i < 5; i++){
      const c = criarCargaProgramada({placa: DB.frota[i].placa,
        numeroCarga: '11835' + i, peso: 9000, rota: '521', operador: 'Ana'});
      avancarStatusCarga(c.id, 'Aguardando Embarque', 'PORTARIA', 'Portaria');
    }
    // Uma parada há 20 dias: o "481h37" do print, que alarga a coluna de tempo.
    DB.movimentacoes[1].timestamp = new Date(Date.now() - 481 * 3600 * 1000).toISOString();
    abrirTab('torre'); renderAll();
  }"""


async def entrar(pg):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(1100)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(800)
    await pg.evaluate(MONTAR)
    await pg.wait_for_timeout(800)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        erros = []

        print('\n=== 1. NENHUMA LINHA PASSA DA LARGURA DA TELA ===')
        ctx = await nav.new_context(viewport={'width': LARGURA, 'height': 844},
                                    is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)

        d = await pg.evaluate("""(larg) => {
              const trs = [...document.querySelectorAll('.tab-page.active table tbody tr')]
                .filter(t => t.getBoundingClientRect().height > 0);
              const fora = trs.filter(t => t.getBoundingClientRect().right > larg + 1)
                .map(t => ({ cls: t.className,
                             larg: Math.round(t.getBoundingClientRect().width),
                             dir: Math.round(t.getBoundingClientRect().right) }));
              return { linhas: trs.length, fora,
                       maisLarga: Math.max(...trs.map(t => Math.round(t.getBoundingClientRect().width))) };
            }""", LARGURA)
        ck('a Torre tem linhas para medir', d['linhas'] >= 5, str(d['linhas']))
        ck('nenhuma linha passa da tela', not d['fora'], str(d['fora'][:2]))
        ck('e a mais larga cabe na tela',
           d['maisLarga'] <= LARGURA, f"{d['maisLarga']}px em {LARGURA}px")

        print('\n=== 2. A TABELA NÃO CARREGA MAIS A LARGURA MÍNIMA DE 640px ===')
        # A causa exata. Sem esta checagem, alguém "restaura" o min-width
        # achando que é o que faz a tabela caber, e o corte volta.
        d = await pg.evaluate("""() => {
              const t = document.querySelector('.tab-page.active table.tabela-patio');
              if(!t) return { achou: false };
              const g = getComputedStyle(t);
              return { achou: true, minWidth: g.minWidth,
                       ehCartao: t.classList.contains('mobile-cartao'),
                       scrollW: t.scrollWidth, clientW: t.clientWidth };
            }""")
        ck('a tabela do pátio está em modo cartão', d.get('ehCartao'), str(d))
        ck('sem largura mínima no modo cartão',
           d.get('minWidth') in ('0px', 'auto', '0'), str(d.get('minWidth')))
        ck('e não sobra nada para rolar de lado dentro dela',
           (d.get('scrollW') or 0) <= (d.get('clientW') or 0) + 1,
           f"{d.get('scrollW')} / {d.get('clientW')}")

        print('\n=== 3. O TÍTULO DO GRUPO QUEBRA EM VEZ DE ESTICAR ===')
        d = await pg.evaluate("""(larg) => {
              const td = document.querySelector('.tab-page.active tr.vp-grupo td');
              if(!td) return { achou: false };
              const r = td.getBoundingClientRect();
              return { achou: true, larg: Math.round(r.width), dir: Math.round(r.right),
                       quebra: getComputedStyle(td).whiteSpace,
                       texto: td.textContent.trim().slice(0, 40) };
            }""", LARGURA)
        if d.get('achou'):
            ck('o título do grupo cabe na tela',
               d['dir'] <= LARGURA + 1, f"{d['larg']}px, borda em {d['dir']}px")
            ck('e o texto pode quebrar', d['quebra'] != 'nowrap', str(d['quebra']))
        else:
            ck('há linha de grupo para medir', False, 'não encontrada')

        print('\n=== 4. A PÁGINA NÃO ROLA DE LADO ===')
        d = await pg.evaluate("""() => ({
              scrollW: document.documentElement.scrollWidth,
              clientW: document.documentElement.clientWidth })""")
        ck('a página não vaza para os lados',
           d['scrollW'] <= d['clientW'] + 1, str(d))
        await ctx.close()

        print('\n=== 5. NO DESKTOP A TABELA CONTINUA LARGA ===')
        # Escrevi este bloco esperando `min-width:640px` no desktop e ele
        # reprovou — porque aquele mínimo era SÓ do celular, dentro do
        # @media (max-width:820px). Existia para forçar a rolagem lateral
        # quando a linha ainda era linha; no desktop a tabela sempre teve a
        # largura do container.
        #
        # O que importa medir aqui, então, é o que a linha do tempo de seis
        # etapas realmente precisa: espaço. E disso o desktop tem de sobra.
        ctx2 = await nav.new_context(viewport={'width': 1360, 'height': 900})
        pg2 = await ctx2.new_page()
        pg2.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg2)
        d = await pg2.evaluate("""() => {
              const t = document.querySelector('.tab-page.active table.tabela-patio');
              // `.et-mini`, não `.et`: a Visão do Pátio resume a jornada numa
              // coluna só, com marcas pequenas. `.et` é da OUTRA tabela, a
              // linha do tempo expandida — medir a classe errada dava zero.
              const et = document.querySelectorAll('.tab-page.active .tabela-patio .et-mini').length;
              return t ? { larg: Math.round(t.getBoundingClientRect().width),
                           colunasDeEtapa: et } : {};
            }""")
        ck('no desktop a tabela tem largura de sobra para a linha do tempo',
           (d.get('larg') or 0) >= 640, f"{d.get('larg')}px")
        ck('e as colunas de etapa continuam desenhadas',
           (d.get('colunasDeEtapa') or 0) > 0, str(d.get('colunasDeEtapa')))
        await ctx2.close()

        print('\n=== 6. SEM ERRO DE JAVASCRIPT ===')
        ck('console limpo', not erros, '; '.join(erros[:3]))

        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('  Tudo verde.')
    return 0


sys.exit(asyncio.run(main()))
