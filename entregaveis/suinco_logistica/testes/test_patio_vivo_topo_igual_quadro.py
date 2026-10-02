#!/usr/bin/env python3
"""Pátio ao vivo: o número do topo é o número de cartões do quadro (02/10/2026).

RELATO DO DONO, com print (02/10/2026): o topo dizia "10 caminhões no pátio
agora" e o quadro mostrava UM cartão entre Aguardando Embarque e Faturado —
"tá errado isso aí", "já apontei o erro uma vez e você não arrumou", "e no
gráfico também". A primeira vez foi em 30/09 ("às 14h tem 27 caminhões no
pátio"); a correção daquele dia fez o gráfico e o topo contarem igual, mas
NÃO igual ao quadro.

A CAUSA, reproduzida: a conta do topo e do gráfico (pvNoPatioEm) somava as
ENTRADAS SEM CARGA — caminhão registrado na Portaria sem programação
(aguardandoCarga). O quadro não as mostra, e a Torre as conta à parte
("Entradas sem carga — resolver na Programação"). Com 1 carga no quadro e 3
entradas sem carga, o topo mostrava 4.

O QUE ESTE TESTE TRAVA:
  1. o topo "caminhões no pátio agora" = cartões nas colunas Aguardando
     Embarque, Embarque Iniciado, Embarque Finalizado e Faturado;
  2. o último ponto do gráfico ("agora") = o topo;
  3. as entradas sem carga não somem: aparecem contadas à parte no topo;
  4. "parados há mais de 3 horas" conta só quem está no quadro.

Dados inventados e marcados (cargas 9008xx/9009xx, rota TESTE).

    bash testes/rodar_tudo.sh test_patio_vivo_topo_igual_quadro
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
PAINEL = 'file://' + os.path.join(os.path.dirname(AQUI), 'index.html')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


SEMEAR = """() => {
  DB.operador = {nome:'Teste', setor:'Administração'};
  document.getElementById('modal-operador')?.classList.remove('open');
  const ag = Date.now(), min = 60000, iso = t => new Date(t).toISOString();
  DB.cargas = []; DB.movimentacoes = [];
  const carga = (id, o) => { const c = Object.assign({ id, numeroCarga:id, placa:'TST' + id.slice(-4),
      rota:'TESTE', status:'Aguardando Embarque', criadoEm:iso(ag - 300 * min), programadoEm:iso(ag - 360 * min),
      atualizadoEm:iso(ag) }, o); DB.cargas.push(c); return c; };
  const mov = (c, st, t) => DB.movimentacoes.push({ id:'m-' + c.id + '-' + st, cargaId:c.id, placa:c.placa,
      statusNovo:st, setor:'Portaria', timestamp:iso(t) });
  // no quadro: uma em Aguardando Embarque há 4 h, uma em Faturado há 30 min
  const a = carga('900801', {}); mov(a, 'Aguardando Embarque', ag - 240 * min);
  const f = carga('900802', { status:'Faturado' });
  mov(f, 'Aguardando Embarque', ag - 90 * min); mov(f, 'Faturado', ag - 30 * min);
  // fora do quadro: programada que não chegou
  carga('900803', { status:'Aguardando Veículo' });
  // fora do quadro: três entradas sem carga (chegaram sem programação)
  for (let i = 0; i < 3; i++) carga('90090' + i, { aguardandoCarga:true, programadoEm:null,
      criadoEm:iso(ag - (200 + i) * min) });
  invalidarIndiceMovimentacoes(); renderAll(); abrirTab('patio');
}"""

LER = """() => {
  const cols = [...document.querySelectorAll('.pv-col')];
  const noQuadro = cols.slice(1, 5).reduce((s, c) => s + c.querySelectorAll('.pv-card').length, 0);
  const fato = document.getElementById('pv-k-patio').closest('.pv-fato');
  return { topo: document.getElementById('pv-k-patio').textContent.trim(), noQuadro,
           fato: fato.textContent.replace(/\\s+/g, ' ').trim(),
           parados: document.getElementById('pv-k-patio-sub').textContent.trim() };
}"""

# o último ponto do gráfico é desenhado por Graf.area — lido da própria conta
ULTIMO_PONTO = """() => DB.cargas.filter(c => pvNoPatioEm(c, new Date())).length"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        erros = []
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(800)
        await pg.evaluate(SEMEAR)
        await pg.wait_for_timeout(1500)
        r = await pg.evaluate(LER)
        ultimo = await pg.evaluate(ULTIMO_PONTO)
        print('  ', r, 'último ponto do gráfico:', ultimo)
        print('\n=== O TOPO É O QUADRO ===')
        ck('cartões no quadro (Aguardando Embarque a Faturado) = 2', r['noQuadro'] == 2, str(r['noQuadro']))
        ck('"caminhões no pátio agora" = cartões no quadro', r['topo'] == str(r['noQuadro']), f"topo {r['topo']} · quadro {r['noQuadro']}")
        ck('o último ponto do gráfico = o topo', str(ultimo) == r['topo'], f'gráfico {ultimo} · topo {r["topo"]}')
        print('\n=== AS ENTRADAS SEM CARGA NÃO SOMEM ===')
        ck('o topo diz quantas entradas sem carga ficaram fora da conta', '3 entradas sem carga' in r['fato'], r['fato'])
        print('\n=== PARADOS HÁ MAIS DE 3 HORAS: SÓ QUEM ESTÁ NO QUADRO ===')
        ck('1 parado há mais de 3 horas (a de Aguardando Embarque há 4 h)', r['parados'].startswith('1 parado'), r['parados'])
        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()
    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
