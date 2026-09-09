#!/usr/bin/env python3
"""Números da Torre de Controle contam ao SUBIR, não em toda repintura.

Achado da auditoria de UI/UX (ui-ux-pro-max-skill, 07/08/2026): a Torre já
seguia o padrão "Executive Dashboard"/"Data-Dense Dashboard" recomendado
pela ferramenta em quase tudo — a lacuna real era o número do KPI trocar
sem nenhum aviso visual, igual antes e depois de mudar. Adicionado
animarContadoresTorre() em app.js: conta de um valor pro outro só quando o
valor muda de fato entre dois renders, nunca na primeira pintura (senão
todo 0→N na abertura da tela vira ruído) nem quando o número se repete.

    python3 testes/test_contador_torre.py
"""
import asyncio
import sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)

        # NADA DE TOKEN FALSO AQUI. Este teste roda em file://, sem servidor
        # nenhum no ar, e entra por "Entrar sem servidor" — modo local puro.
        #
        # A versão anterior plantava `suinco_token` no sessionStorage antes
        # de entrar. Isso fazia `estaConfigurado()` responder SIM (ativo +
        # api + token), e aí cada carga criada tentava subir para
        # api.embarquesuinco.com.br, que não existe neste ambiente. Depois
        # da trava de offline (31/08/2026) a resposta de uma tentativa sem
        # rede deixou de ser "guardei na fila" e passou a ser
        # `{recusado:true, offline:true}` — e criação nunca confirmada que é
        # recusada SAI da tela, de propósito (sincronizarCarga, data.js).
        #
        # Resultado: 18 das 20 cargas do bloco de baixo sumiam sozinhas
        # entre um bloco e o outro, e o teste reprovava acusando o contador
        # de animação por um estrago que era da trava de offline agindo
        # exatamente como o dono pediu. O contador nunca teve defeito.
        #
        # Sem token, `estaConfigurado()` é NÃO e nenhuma carga tenta subir —
        # que é o que este arquivo sempre quis medir: a animação do número.
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(400)

        print('\n=== PRIMEIRA PINTURA: NÚMERO CERTO NA HORA, SEM CONTAGEM ===')
        d = await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = [];
            const f = DB.frota[0];
            criarCargaProgramada({ placa:f.placa, numeroCarga:'1', peso:9000, rota:'500', operador:'Ana' });
            renderTorre();
            const el = document.querySelector('#torre-stats [data-contador="Cargas em aberto"]');
            return { textoImediato: el ? el.textContent.trim() : null };
        }""")
        ck('primeira pintura mostra o valor final na hora (sem "0" temporário)',
           d['textoImediato'] == '1', str(d))

        print('\n=== VALOR MUDA (SALTO GRANDE): CONTA VISIVELMENTE ATÉ CHEGAR NO NOVO NÚMERO ===')
        # Salto de 1 para 20 de propósito — com delta de só 1 (1→2) não hà
        # valor intermediário possível de observar (Math.round nunca mostra
        # fração), então o teste não provaria nada sobre a animação em si.
        d2 = await pg.evaluate("""async () => {
            for (let i = 1; i < 20; i++) {
                criarCargaProgramada({ placa:DB.frota[i].placa, numeroCarga:String(i+1), peso:9000, rota:'500', operador:'Ana' });
            }
            renderTorre();
            const el = document.querySelector('#torre-stats [data-contador="Cargas em aberto"]');
            const logoDepois = el.textContent.trim();
            await new Promise(r => setTimeout(r, 120));
            const noMeio = el.textContent.trim();
            await new Promise(r => setTimeout(r, 700));
            const final = el.textContent.trim();
            return { logoDepois, noMeio, final };
        }""")
        ck('o número final bate (20 cargas)', d2['final'] == '20', str(d2))
        ck('passou por um valor intermediário — prova que animou, não trocou seco',
           d2['noMeio'] not in ('1', '20'), str(d2))

        print('\n=== RENDER SEM MUDANÇA: NÃO REANIMA (evita ruído a cada sincronia) ===')
        d3 = await pg.evaluate("""async () => {
            renderTorre(); // mesmo total de cargas (20) — não devia animar de novo
            const el = document.querySelector('#torre-stats [data-contador="Cargas em aberto"]');
            const logo = el.textContent.trim();
            await new Promise(r => setTimeout(r, 50));
            const depoisDeUmPouco = el.textContent.trim();
            return { logo, depoisDeUmPouco };
        }""")
        ck('sem mudança de valor, o texto já nasce certo e fica parado',
           d3['logo'] == '20' and d3['depoisDeUmPouco'] == '20', str(d3))

        print('\n=== prefers-reduced-motion: TROCA DIRETA, SEM ANIMAÇÃO ===')
        ctx2 = await nav.new_context(reduced_motion='reduce')
        pg2 = await ctx2.new_page()
        await pg2.goto(PAINEL)
        await pg2.wait_for_timeout(900)
        await pg2.evaluate("() => mostrarLoginLocal()")
        await pg2.fill('#login-nome', 'Ana')
        await pg2.select_option('#login-setor', 'Logística')
        await pg2.click('button:has-text("Entrar sem servidor")')
        await pg2.wait_for_timeout(400)
        d4 = await pg2.evaluate("""async () => {
            DB.cargas = []; DB.movimentacoes = [];
            criarCargaProgramada({ placa:DB.frota[0].placa, numeroCarga:'1', peso:9000, rota:'500', operador:'Ana' });
            renderTorre();
            criarCargaProgramada({ placa:DB.frota[1].placa, numeroCarga:'2', peso:9000, rota:'500', operador:'Ana' });
            renderTorre();
            const el = document.querySelector('#torre-stats [data-contador="Cargas em aberto"]');
            const logo = el.textContent.trim();
            await new Promise(r => setTimeout(r, 100));
            return { logo, depois: el.textContent.trim() };
        }""")
        ck('com prefers-reduced-motion, o valor já chega pronto (2), sem intermediário',
           d4['logo'] == '2' and d4['depois'] == '2', str(d4))
        await ctx2.close()

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
