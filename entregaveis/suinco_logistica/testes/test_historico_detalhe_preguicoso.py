#!/usr/bin/env python3
"""O detalhe do Histórico nasce vazio — só é construído quando alguém abre a linha.

MEDIDO, 11/09/2026, com o volume exato do relato do dono (500 cargas, 2.813
movimentações, 30 linhas de montagem): o Histórico sozinho respondia por
47.469 dos 57.196 elementos da página inteira — 83% do peso, o número que
apareceu no registro de travamento ("57001 elementos na tela"). A causa:
`detalheHistoricoHtml(m)` monta ~95 nós por linha — grade de campos, lacres,
datas, dois botões — para as 500 linhas do teto de desktop de uma vez, mesmo
que quase nenhuma seja aberta.

O QUE ESTE TESTE TRAVA
  1. a linha nasce com o <td> do detalhe VAZIO;
  2. o primeiro clique CONSTRÓI o detalhe (mesmo conteúdo de sempre) e marca
     um carimbo (`dataset.construido`);
  3. o segundo clique (fechar) e o terceiro (abrir de novo) NÃO reconstroem —
     o carimbo evita retrabalho;
  4. o total de elementos da página cai de forma proporcional ao número de
     linhas NÃO abertas — a prova de que o emagrecimento é real, não só
     teórico;
  5. carga que não está mais no painel continua com o aviso de sempre,
     construído na hora, sem quebrar.

    python3 testes/test_historico_detalhe_preguicoso.py
"""
import asyncio, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


FIXTURE = """(N) => {
  DB.operador = {nome:'A', setor:'Administração'};
  document.getElementById('modal-operador')?.classList.remove('open');
  const agora = Date.now();
  DB.cargas = []; DB.movimentacoes = [];
  const st = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado','Seguiu Viagem'];
  for (let i=0;i<N;i++) DB.cargas.push({ id:'c'+i, numeroCarga:'11'+i, placa:'ABC'+String(1000+i), transportadora:'T', tipoVeiculo:'Truck',
    status:'Seguiu Viagem', criadoEm:new Date(agora-i*3600e3).toISOString(), programadoEm:new Date(agora-i*3600e3).toISOString(),
    atualizadoEm:new Date(agora-60e3).toISOString(), sequencia:i+1, rota:'500', paletizada:'Não', qtdGanchos:0, qtdEntregas:1,
    peso:1000, cliente:'Cliente '+i, destino:'Destino '+i, observacoes:'obs' });
  for (let i=0;i<N;i++) DB.movimentacoes.push({ id:'m'+i, cargaId:'c'+i, placa:'ABC'+String(1000+i), statusAnterior: st[i%5], statusNovo: st[(i%5)+1],
    setor:'Portaria', operador:'Op '+i, data:new Date(agora - i*60e3).toISOString(), timestamp:new Date(agora - i*60e3).toISOString() });
  if (typeof invalidarIndiceMovimentacoes === 'function') invalidarIndiceMovimentacoes();
  renderAll(); abrirTab('historico');
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)

        print('\n=== 1. AS LINHAS NASCEM COM O DETALHE VAZIO ===')
        r = await pg.evaluate("""(N) => { """ + FIXTURE[FIXTURE.index('{')+1:FIXTURE.rindex('}')] + """
          const detalhes = [...document.querySelectorAll('#hist-tbody tr.hist-detalhe')];
          const vazios = detalhes.filter(d => (d.querySelector('td')||{}).innerHTML === '').length;
          const total = document.getElementsByTagName('*').length;
          return { linhas: detalhes.length, vazios, totalElementos: total };
        }""", 300)
        ck('300 linhas de detalhe desenhadas', r['linhas'] == 300, str(r['linhas']))
        ck('TODAS nascem vazias (nenhuma pré-construída)', r['vazios'] == 300, str(r))
        print(f"    total de elementos na página com 300 linhas, nenhuma aberta: {r['totalElementos']}")

        print('\n=== 2. O PRIMEIRO CLIQUE CONSTRÓI, COM O CONTEÚDO DE SEMPRE ===')
        r2 = await pg.evaluate("""() => {
          const tr = document.querySelector('#hist-tbody tr.hist-linha');
          tr.click();
          const det = tr.nextElementSibling;
          const txt = det.textContent;
          return { aberto: !det.hidden, construido: det.dataset.construido === '1',
                   temSecoes: /Este registro/.test(txt) && /A carga/.test(txt) && /Cliente 0/.test(txt),
                   temBotao: !!det.querySelector('button') };
        }""")
        ck('abriu', r2['aberto'] is True, str(r2))
        ck('marcou como construído', r2['construido'] is True, str(r2))
        ck('o conteúdo é o de sempre — seções e dados da carga', r2['temSecoes'], str(r2))
        ck('com os botões de sempre', r2['temBotao'], str(r2))

        print('\n=== 3. FECHAR E ABRIR DE NOVO NÃO RECONSTRÓI (o carimbo funciona) ===')
        r3 = await pg.evaluate("""() => {
          const tr = document.querySelector('#hist-tbody tr.hist-linha');
          const det = tr.nextElementSibling;
          const noh1 = det.querySelector('td').firstElementChild;
          tr.click();  // fecha
          const fechouEscondendo = det.hidden && det.querySelector('td').firstElementChild === noh1;
          tr.click();  // abre de novo
          const mesmoNo = det.querySelector('td').firstElementChild === noh1;
          return { fechouEscondendo, mesmoNo, aindaAberto: !det.hidden };
        }""")
        ck('fechar só esconde (o nó continua o mesmo)', r3['fechouEscondendo'], str(r3))
        ck('abrir de novo reaproveita o mesmo nó — não reconstruiu', r3['mesmoNo'], str(r3))
        ck('e está aberto', r3['aindaAberto'], str(r3))

        print('\n=== 4. O PESO CAI DE VERDADE: 300 LINHAS FECHADAS < 300 LINHAS ABERTAS ===')
        r4 = await pg.evaluate("""(N) => { """ + FIXTURE[FIXTURE.index('{')+1:FIXTURE.rindex('}')] + """
          return document.getElementsByTagName('*').length;
        }""", 300)
        r5 = await pg.evaluate("""() => {
          document.querySelectorAll('#hist-tbody tr.hist-linha').forEach(tr => tr.click());
          return document.getElementsByTagName('*').length;
        }""")
        ck('com as 300 linhas TODAS abertas o peso é maior (prova que o vazio economiza)',
           r5 > r4, f"fechado {r4} · todas abertas {r5}")
        economia = r5 - r4
        ck('a economia é proporcional ao volume (na casa das dezenas de milhares para 300 linhas)',
           economia > 10000, f"economia de {economia} elementos")

        print('\n=== 5. CARGA QUE SUMIU DO PAINEL CONTINUA MOSTRANDO O AVISO, CONSTRUÍDO NA HORA ===')
        r6 = await pg.evaluate("""() => {
          DB.cargas = []; DB.movimentacoes = [{ id:'orfa', cargaId:'nao-existe-mais', placa:'ZZZ9Z99',
            statusAnterior:'', statusNovo:'Aguardando Embarque', setor:'Portaria', operador:'X',
            data:new Date().toISOString(), timestamp:new Date().toISOString() }];
          if (typeof invalidarIndiceMovimentacoes === 'function') invalidarIndiceMovimentacoes();
          renderHistorico();
          const tr = document.querySelector('#hist-tbody tr.hist-linha');
          tr.click();
          const det = tr.nextElementSibling;
          return { aberto: !det.hidden, avisa: /não está mais no painel/.test(det.textContent) };
        }""")
        ck('abre mesmo sem a carga', r6['aberto'] is True, str(r6))
        ck('e mostra o aviso de sempre', r6['avisa'] is True, str(r6))
        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)


asyncio.run(main())
