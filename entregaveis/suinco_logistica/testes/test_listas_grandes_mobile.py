#!/usr/bin/env python3
"""Lista grande sem limite = rolagem quase infinita no celular.

Achado na auditoria "refinamento em TODAS AS ABAS" (pedido do usuário,
08/08/2026), depois que Torre e Indicadores já tinham sido corrigidos.

Medido ANTES desta correção: a aba Cadastros, com a base real de frota
(749 placas), tinha scrollHeight = 98.676px no celular — o limite de 300
linhas já existia, mas desde que a tabela passou a virar CARTÃO de 2
colunas no celular (mesma sessão, mais cedo), cada linha foi de ~40px pra
~250-300px. 300 cartões empilhados = ~300 telas de celular de rolagem.

O Log Completo de Movimentações (Histórico) tinha o mesmo problema, só que
PIOR: nenhum limite, nem no desktop — um array que só cresce, dia após dia
de operação, sem nenhuma mudança de código precisar acontecer pra piorar.

Correção: limite dinâmico por breakpoint (o mesmo max-width:560px que ativa
o layout em cartão) — 300/500 no desktop (já era assim pra Frota; o
Histórico ganhou um teto que não tinha), 30/40 no celular. Mais recente
primeiro nos dois casos, então cortar mantém o que importa; quem precisa de
mais usa o filtro de busca/placa/setor que já existia.

    python3 testes/test_listas_grandes_mobile.py
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


async def preparar(pg, n_placas=60, n_movs=0):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(900)
    # Login local (offline) só oferece os 4 setores operacionais — Cadastros
    # e Histórico exigem Administração/Logística, que esse formulário não
    # lista. Define o operador direto, como os outros scripts de auditoria
    # desta sessão já fazem (ver /tmp/debug_ind_stats.py).
    await pg.evaluate("""() => {
        DB.operador = {nome:'Ana', setor:'Administração'};
        document.getElementById('modal-operador')?.classList.remove('open');
            renderAll();  // tela de entrada própria (16/08): painel só aparece após render com operador
    }""")
    await pg.wait_for_timeout(400)
    await pg.evaluate(f"""(n) => {{
        for(let i=0;i<n;i++){{
            const placa = 'TST' + String(i).padStart(4,'0');
            upsertFrota(placa, 'Transportadora ' + i, 'Truck', {{}});
        }}
    }}""", n_placas)
    if n_movs:
        await pg.evaluate(f"""(n) => {{
            const placa = DB.frota[0].placa;
            for(let i=0;i<n;i++){{
                DB.movimentacoes.push({{
                    id: 'sim'+i, placa, statusAnterior:'Aguardando Veículo',
                    statusNovo:'Aguardando Embarque', operador:'Ana', setor:'Logística',
                    timestamp: new Date(Date.now() - i*60000).toISOString()
                }});
            }}
        }}""", n_movs)
    await pg.evaluate("() => abrirTab('cadastros')")
    await pg.wait_for_timeout(300)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []

        print('\n=== 1. FROTA NO CELULAR: LIMITE BAIXO, SEM ROLAGEM ABSURDA ===')
        ctx = await nav.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await preparar(pg, n_placas=60)
        info = await pg.evaluate("""() => {
            const tb = document.getElementById('frota-tbody');
            const contagem = document.getElementById('frota-contagem').textContent;
            return { linhas: tb.querySelectorAll('tr').length, contagem, altura: document.body.scrollHeight };
        }""")
        ck('mostra no máximo 30 placas no celular', info['linhas'] <= 30, str(info['linhas']))
        ck('avisa que cortou e mais placas existem', 'Mostrando' in info['contagem'] and 'refine' in info['contagem'],
           info['contagem'])
        ck('altura da página fica em faixa razoável (< 20000px) com 60 placas',
           info['altura'] < 20000, f"{info['altura']}px")
        await ctx.close()

        print('\n=== 2. FROTA NO DESKTOP: LIMITE CONTINUA 300 (não regrediu) ===')
        ctx2 = await nav.new_context(viewport={'width': 1280, 'height': 900})
        pg2 = await ctx2.new_page()
        pg2.on('pageerror', lambda e: erros.append(str(e)))
        await preparar(pg2, n_placas=60)
        info2 = await pg2.evaluate("""() => {
            const tb = document.getElementById('frota-tbody');
            return { linhas: tb.querySelectorAll('tr').length, total: DB.frota.length };
        }""")
        # A base embutida no build já tem 749 placas — somada às 60 do teste
        # passa de 300, então o teto de desktop (que não mudou nesta
        # correção) continua sendo o que corta, não as 60 novas.
        ck('desktop respeita o teto de 300 (não regrediu para o valor do celular)',
           info2['linhas'] == min(300, info2['total']),
           f"{info2['linhas']} linhas de {info2['total']} placas")
        await ctx2.close()

        print('\n=== 3. HISTÓRICO (LOG COMPLETO) — TINHA ZERO LIMITE ANTES ===')
        ctx3 = await nav.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pg3 = await ctx3.new_page()
        pg3.on('pageerror', lambda e: erros.append(str(e)))
        await preparar(pg3, n_placas=0, n_movs=80)
        await pg3.evaluate("() => abrirTab('historico')")
        await pg3.wait_for_timeout(300)
        h = await pg3.evaluate("""() => {
            const tb = document.getElementById('hist-tbody');
            const contagem = document.getElementById('hist-contagem').textContent;
            return { linhas: tb.querySelectorAll('tr').length, contagem };
        }""")
        ck('log completo agora tem teto no celular (<=40)', h['linhas'] <= 40, str(h['linhas']))
        ck('avisa que só mostra as mais recentes', 'recentes' in h['contagem'], h['contagem'])
        await ctx3.close()

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
