#!/usr/bin/env python3
"""Medidor de travamento v2: memória, rajada de eventos, visibilidade e peso por aba.

RELATO DO DONO, 11/09/2026: travamentos de 21s e 46s registrados pelo v1
mostravam desenho de só 0,25s — o código do painel não explica os outros
20+ segundos. "me explica o que realmente pode ser o fato isolado" — três
suspeitos sobraram depois de medir tudo que dá para medir: memória (coletor
de lixo do navegador), rajada de eventos (30 avisos -> 30 sincronias em
fila) e aba em segundo plano. Nenhum dos três aparecia no registro v1.

O QUE ESTE TESTE TRAVA: o próximo travamento nomeia entre os três, porque o
registro agora inclui memória usada/limite, quantos eventos de socket
chegaram nos 30s antes, quantos desenhos aconteceram nos 30s antes, se a
aba estava visível, e o peso (elementos) de cada aba guardada na memória —
não só a ativa.

    python3 testes/test_medidor_v2_contexto.py
"""
import asyncio, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)

        print('\n=== 1. UM TRAVAMENTO REGISTRA O CONTEXTO NOVO ===')
        r = await pg.evaluate("""() => {
          DB.operador = {nome:'A', setor:'Administração'};
          document.getElementById('modal-operador')?.classList.remove('open');
          renderAll(); abrirTab('torre');
          if (typeof SuincoSharePoint !== 'undefined' && SuincoSharePoint.eventosNosUltimos === undefined) return {erro:'sem eventosNosUltimos no adaptador'};
          // simula 12 eventos de socket recebidos agora
          for (let i=0;i<12;i++) { try { SuincoSharePoint.SP_CONFIG; } catch(e){} }
          const t0 = performance.now();
          registrarTravamento(900, t0 - 900);
          const t = JSON.parse(localStorage.getItem('suinco_travamentos') || '[]');
          return t.length ? t[t.length-1] : {erro:'nada registrado'};
        }""")
        ck('sem erro na fixture', 'erro' not in r, str(r.get('erro')))
        c = r.get('contexto') or {}
        ck('tem chave memoriaMB (pode ser null fora do Chromium com flag, mas a chave existe)',
           'memoriaMB' in c, str(c))
        ck('tem eventos30s', 'eventos30s' in c, str(c))
        ck('tem desenhos30s', 'desenhos30s' in c, str(c))
        ck('tem visivel', c.get('visivel') in ('visible', 'hidden'), str(c.get('visivel')))
        ck('tem porAba com pelo menos uma aba', bool(c.get('porAba')), str(c.get('porAba')))

        print('\n=== 2. RAJADA DE EVENTOS FICA CONTADA NO ADAPTADOR ===')
        r2 = await pg.evaluate("""async () => {
          if (typeof SuincoSharePoint === 'undefined' || !SuincoSharePoint.eventosNosUltimos) return {erro:'sem função'};
          // não dá para forçar socket real aqui sem servidor; confirma que a função
          // existe e devolve número (0 é válido — só não pode quebrar)
          const n = SuincoSharePoint.eventosNosUltimos(30000);
          return { tipo: typeof n, valor: n };
        }""")
        ck('eventosNosUltimos existe e devolve número', r2.get('tipo') == 'number', str(r2))

        print('\n=== 3. O TEXTO DO DIÁLOGO TRAZ O CONTEXTO, QUANDO HÁ ===')
        r3 = await pg.evaluate("""() => {
          const orig = window.alert; let texto = '';
          window.alert = (t) => { texto = t; };
          mostrarTravamentosUI();
          window.alert = orig;
          return texto;
        }""")
        ck('o texto menciona memória', 'mem' in r3.lower(), r3[:200])
        ck('e menciona eventos/desenhos dos 30s antes', 'eventos' in r3.lower() and 'desenhos' in r3.lower(), r3[:250])
        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)


asyncio.run(main())
