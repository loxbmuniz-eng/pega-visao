#!/usr/bin/env python3
"""Auditoria de celular — todas as abas, todos os setores, três tamanhos.

O `test_mobile.py` cobre o caminho principal. Esta auditoria é a varredura:
percorre cada aba que cada setor enxerga, em iPhone SE, iPhone 14 e tablet,
e cobra as regras que fazem um painel ser usável de pé, com uma mão, às
vezes de luva:

- a PÁGINA nunca rola de lado (tabela larga rola dentro da própria caixa);
- alvo de toque de 44 px nos botões, 52 px nos da Portaria;
- campo de digitação com fonte >= 16 px, senão o iOS dá zoom ao focar e
  desalinha a tela inteira;
- nada de texto minúsculo: 11 px é o piso do que se lê no pátio;
- modal cabe na tela e não estoura a altura;
- a Visão do Pátio, que tem seis colunas de etapa, rola dentro da caixa.

Roda sem backend: o painel abre em modo local.
"""
import asyncio
import sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'

APARELHOS = [
    ('iPhone SE',  320, 568),
    ('iPhone 14',  390, 844),
    ('Tablet',     820, 1180),
]

SETORES = {
    'Portaria':      ['portaria', 'historico'],
    # Indicadores entrou para a Expedição: é o posto que opera as duas
    # etapas mais longas do fluxo e pode agir sobre o número no mesmo turno.
    'Expedição':     ['expedicao', 'indicadores', 'historico'],
    'Faturamento':   ['faturamento', 'historico'],
    'Logística':     ['torre', 'programacao', 'portaria', 'expedicao', 'faturamento',
                      'indicadores', 'cadastros', 'historico', 'relatorios'],
}

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def preparar(pagina, setor):
    """Entra no painel e cria dados suficientes para as telas terem conteúdo.

    Tela vazia passa em qualquer teste de layout — é preciso ter linha, e
    linha com texto longo, para o estouro aparecer."""
    await pagina.evaluate("""(setor) => {
        DB.operador = {nome:'Auditor Mobile', setor, turno:'Manhã'};
        aplicarPermissoesSetor();
        document.getElementById('modal-operador').classList.remove('open');
        if (!DB.cargas.length) {
            const f = DB.frota;
            [0,1,2].forEach((i, n) => {
                criarCargaProgramada({
                    placa: f[i].placa, numeroCarga: '9900' + n, peso: 14250, rota:'500',
                    praOnde:'ENTREGA DIRETA', paletizada:'Sim', qtdGanchos:30,
                    qtdEntregas:2, operador:'Auditor'
                });
            });
            registrarChegadaPortaria(f[0].placa, 'Porteiro');
            const c = DB.cargas.find(x => x.placa === f[0].placa);
            avancarStatusCarga(c.id, 'Embarque Iniciado', 'Exp', 'Expedição');
        }
        renderAll();
    }""", setor)
    await pagina.wait_for_timeout(300)


async def medir_aba(pagina, aba):
    await pagina.evaluate("a => { abrirTab(a); renderAll(); }", aba)
    await pagina.wait_for_timeout(350)
    return await pagina.evaluate("""() => {
        const doc = document.documentElement;
        const estouro = doc.scrollWidth - doc.clientWidth;

        // Elemento culpado, quando houver: o que passa da borda direita.
        let culpado = null;
        if (estouro > 1) {
            const limite = window.innerWidth;
            for (const el of document.querySelectorAll('#main *')) {
                const r = el.getBoundingClientRect();
                if (r.width > 0 && r.right > limite + 1) {
                    culpado = (el.tagName + '.' + (el.className || '')).slice(0, 70);
                    break;
                }
            }
        }

        // Botões visíveis pequenos demais para o dedo.
        const pequenos = [...document.querySelectorAll('#main button:not([hidden])')]
            .filter(b => b.offsetParent !== null)
            .map(b => ({ t: b.textContent.trim().slice(0, 22),
                         h: Math.round(b.getBoundingClientRect().height) }))
            .filter(b => b.h > 0 && b.h < 44);

        // Campos que fazem o iOS dar zoom ao focar.
        const zoom = [...document.querySelectorAll('#main input, #main select, #main textarea')]
            .filter(c => c.offsetParent !== null && c.type !== 'hidden')
            .map(c => ({ id: c.id, f: parseFloat(getComputedStyle(c).fontSize) }))
            .filter(c => c.f < 16);

        // Texto pequeno demais para o pátio.
        const miudo = [...document.querySelectorAll('#main td, #main th, #main label')]
            .filter(e => e.offsetParent !== null && e.textContent.trim())
            .map(e => ({ t: e.textContent.trim().slice(0, 18),
                         f: parseFloat(getComputedStyle(e).fontSize) }))
            .filter(e => e.f < 11);

        return { estouro, culpado, pequenos, zoom, miudo };
    }""")


async def main():
    async with async_playwright() as p:
        navegador = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                            headless=True)
        erros = []

        for nome_ap, larg, alt in APARELHOS:
            print(f'\n{"="*66}\n{nome_ap} — {larg}x{alt}\n{"="*66}')
            ctx = await navegador.new_context(viewport={'width': larg, 'height': alt},
                                              is_mobile=larg < 820, has_touch=True,
                                              device_scale_factor=3)
            pagina = await ctx.new_page()
            pagina.on('pageerror', lambda e: erros.append(f'{nome_ap}: {e}'))
            await pagina.goto(PAINEL)
            await pagina.wait_for_timeout(1000)

            # O cabeçalho é medido UMA vez por aparelho, fora do laço de
            # abas: ele é fixo e não muda de aba para aba.
            #
            # Existe porque estourou: em 390px o conteúdo somava 588px. O
            # título recusava encolher (flex-shrink:0, herdado do desktop) e
            # empurrava o crachá do operador e os botões para fora da tela;
            # o relógio, com flex-wrap herdado, passava para uma segunda
            # linha e saía POR CIMA da caixa de altura fixa. Nada disso
            # aparecia nas outras conferências — elas mediam #main.
            await preparar(pagina, 'Portaria')
            cab = await pagina.evaluate("""() => {
                const h = document.getElementById('header');
                const fora = [...h.children]
                    .filter(e => e.getBoundingClientRect().right > h.clientWidth + 1)
                    .map(e => e.id || e.className);
                return { transbordaLargura: h.scrollWidth - h.clientWidth,
                         transbordaAltura: h.scrollHeight - h.clientHeight,
                         fora,
                         crachaVisivel: (document.getElementById('operator-name')
                                           .getBoundingClientRect().width) > 20 };
            }""")
            ck('cabeçalho não transborda a largura da tela',
               cab['transbordaLargura'] <= 1,
               f"{cab['transbordaLargura']}px · fora: {cab['fora']}")
            ck('cabeçalho não transborda a própria altura',
               cab['transbordaAltura'] <= 1, f"{cab['transbordaAltura']}px")
            ck('o crachá do operador continua visível', cab['crachaVisivel'],
               'é a única coisa que diz em nome de quem o registro vai ser gravado')

            for setor, abas in SETORES.items():
                await preparar(pagina, setor)
                print(f'\n  --- {setor} ---')
                for aba in abas:
                    r = await medir_aba(pagina, aba)
                    ck(f'{aba}: página não rola de lado', r['estouro'] <= 1,
                       f"{r['estouro']}px · culpado: {r['culpado']}")
                    ck(f'{aba}: todos os botões com 44px+',
                       not r['pequenos'], str(r['pequenos'][:3]))
                    if larg < 820:
                        ck(f'{aba}: nenhum campo dispara zoom do iOS',
                           not r['zoom'], str(r['zoom'][:3]))
                    ck(f'{aba}: nenhum texto abaixo de 11px',
                       not r['miudo'], str(r['miudo'][:3]))

            await ctx.close()

        # ---------------------------------------------------------------
        print(f'\n{"="*66}\nDETALHES QUE SÓ APARECEM NO CELULAR\n{"="*66}')
        ctx = await navegador.new_context(viewport={'width': 390, 'height': 844},
                                          is_mobile=True, has_touch=True)
        pagina = await ctx.new_page()
        pagina.on('pageerror', lambda e: erros.append(f'detalhes: {e}'))
        await pagina.goto(PAINEL)
        await pagina.wait_for_timeout(1000)
        await preparar(pagina, 'Expedição')

        print('\n=== A. A VISÃO DO PÁTIO CABE NA CAIXA ===')
        # ESTA REGRA MUDOU DE PROPÓSITO (25/08/2026).
        #
        # O que estava aqui exigia o contrário: que a tabela fosse MAIS LARGA
        # que a caixa e rolasse de lado. Era certo enquanto a linha era linha
        # — seis colunas de etapa não cabem em 390px.
        #
        # Desde 23/08 a linha vira CARTÃO no celular: empilha, não tem
        # colunas, não precisa de largura. O `min-width:640px` que sobrou
        # deixou de ser rolagem e virou CORTE — o dono mandou o print com
        # "Nº CARGA" aparecendo como "° CARGA" e "PLACA" como "LACA", o
        # cartão inteiro deslocado para fora da tela.
        #
        # A caixa continua com overflow:auto (é a rede de segurança para
        # conteúdo largo que apareça no futuro); o que mudou é que não sobra
        # nada para rolar. Ver test_torre_cabe_no_celular.py.
        await pagina.evaluate("() => { abrirTab('expedicao'); renderAll(); }")
        await pagina.wait_for_timeout(400)
        r = await pagina.evaluate("""() => {
            // Escopo na aba visível: as três abas de setor têm a mesma
            // tabela, e querySelector solto devolve a primeira do DOM —
            // que está escondida, e mede zero.
            const t = document.querySelector('#tab-expedicao .tabela-patio');
            const caixa = t.closest('.table-wrap');
            return {
                tabela: Math.round(t.scrollWidth),
                caixa: Math.round(caixa.clientWidth),
                rola: caixa.scrollWidth > caixa.clientWidth,
                overflow: getComputedStyle(caixa).overflowX,
                pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth
            };
        }""")
        ck('a caixa da tabela permite rolagem se precisar',
           r['overflow'] in ('auto', 'scroll'), str(r))
        ck('a tabela cabe na caixa — não sobra nada para rolar de lado',
           r['tabela'] <= r['caixa'] + 1, str(r))
        ck('mas a PÁGINA não rola de lado', r['pagina'] <= 1, str(r))

        print('\n=== B. FILTRO DE PERÍODO USÁVEL COM O POLEGAR ===')
        f = await pagina.evaluate("""() => {
            const campos = [...document.querySelectorAll('#tab-expedicao .filtro-periodo input')];
            return campos.map(c => ({
                id: c.id,
                alt: Math.round(c.getBoundingClientRect().height),
                dentro: c.getBoundingClientRect().right <= window.innerWidth + 1
            }));
        }""")
        ck('os três campos do filtro existem', len(f) == 3, str(f))
        ck('todos com 44px de altura', all(c['alt'] >= 44 for c in f), str(f))
        ck('todos dentro da tela', all(c['dentro'] for c in f), str(f))

        print('\n=== C. MODAL CABE NA TELA ===')
        await preparar(pagina, 'Logística')
        await pagina.evaluate("""() => {
            abrirTab('programacao');
            const placa = DB.frota[9].placa;
            registrarChegadaPortaria(placa, 'Porteiro');
            renderAll();
            const c = DB.cargas.find(x => x.aguardandoCarga);
            if (c) abrirCompletar(c.id);
        }""")
        await pagina.wait_for_timeout(400)
        m = await pagina.evaluate("""() => {
            const cx = document.querySelector('#modal-completar .modal-box');
            const r = cx.getBoundingClientRect();
            return { larg: Math.round(r.width), tela: window.innerWidth,
                     dentro: r.left >= -1 && r.right <= window.innerWidth + 1,
                     rolavel: cx.scrollHeight > cx.clientHeight
                              ? getComputedStyle(cx).overflowY : 'não precisa' };
        }""")
        ck('modal cabe na largura', m['dentro'], str(m))
        ck('modal alto demais consegue rolar',
           m['rolavel'] in ('auto', 'scroll', 'não precisa'), str(m))
        await pagina.evaluate("() => fecharModalCompletar()")

        print('\n=== D. NAVEGAÇÃO ALCANÇÁVEL ===')
        n = await pagina.evaluate("""() => {
            const nav = document.getElementById('nav');
            const abas = [...nav.querySelectorAll('.nav-tab')].filter(t => !t.hidden);
            return {
                rola: nav.scrollWidth > nav.clientWidth,
                overflow: getComputedStyle(nav).overflowX,
                altura: Math.round(abas[0].getBoundingClientRect().height),
                n: abas.length
            };
        }""")
        ck('a barra de abas rola quando não cabe',
           (not n['rola']) or n['overflow'] in ('auto', 'scroll'), str(n))
        ck('aba com alvo de toque de 40px+', n['altura'] >= 40, str(n))

        print('\n=== E. AVISO EM TEMPO REAL CABE NA TELA ===')
        a = await pagina.evaluate("""() => {
            const el = document.createElement('div');
            el.className = 'notif-item aviso-alteracao forte';
            el.innerHTML = '<div class="aviso-titulo">Carga 10245 alterada</div>'
              + '<div class="aviso-linha"><b>Placa:</b> <s>ABC1D23</s> → <b>XYZ4E56</b></div>'
              + '<div class="aviso-quem">por Fulano de Tal (Logística) · 14:32</div>';
            document.getElementById('notif').appendChild(el);
            // A animação de entrada começa em translateX(120%): medir no
            // primeiro quadro pega o aviso ainda fora da tela e acusa vazamento
            // que não existe. Desliga a animação para medir a posição final.
            el.style.animation = 'none';
            const r = el.getBoundingClientRect();
            const dentro = r.left >= -1 && r.right <= window.innerWidth + 1;
            const alt = Math.round(r.height);
            el.remove();
            return { dentro, alt, larg: Math.round(r.width), tela: window.innerWidth };
        }""")
        ck('aviso não vaza da tela', a['dentro'], str(a))
        ck('aviso usa a largura disponível', a['larg'] > a['tela'] * 0.8, str(a))

        print('\n=== F. CELULAR DEITADO ===')
        await pagina.set_viewport_size({'width': 844, 'height': 390})
        await pagina.evaluate("() => { abrirTab('portaria'); renderAll(); }")
        await pagina.wait_for_timeout(400)
        d = await pagina.evaluate("""() => ({
            estouro: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            header: Math.round(document.getElementById('header').getBoundingClientRect().height)
        })""")
        ck('deitado: sem estouro lateral', d['estouro'] <= 1, str(d))
        # Deitado a altura é o recurso escasso: cabeçalho gordo come a tela.
        ck('deitado: cabeçalho encolhe', d['header'] <= 50, f"{d['header']}px")

        await ctx.close()

        print('\n=== G. CONSOLE ===')
        ck('nenhum erro de página em nenhum aparelho', not erros, str(erros[:3]))

        await navegador.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
