#!/usr/bin/env python3
"""O gráfico do Pátio ao vivo conta só quem está NO PÁTIO (30/09/2026).

RELATO DO DONO: "no gráfico do pátio ao vivo tá aparecendo que às 14h tem 27
caminhões no pátio. Você precisa entender que só estão no pátio os
Aguardando Embarque até o Faturado; o resto, Aguardando Veículo e Seguiu
Viagem, não conta como NO PÁTIO".

A CAUSA (patio_vivo.js, pvGrafico, publicado em d26c24d): o gráfico não
olhava a etapa de cada caminhão em cada hora. Ele pegava o período "entrada
→ saída" do tempo de pátio e contava quem tocou o pátio EM QUALQUER MOMENTO
daquela hora. Três jeitos de contar quem não estava no pátio:
  1. quem chegou às 14h30 e seguiu viagem às 14h50 contava "às 14h";
  2. quem está em Seguiu Viagem mas não tem o carimbo da saída ficava
     "no pátio" até agora;
  3. quem voltou para Aguardando Veículo depois de entrar ficava "no pátio"
     até agora.

A REGRA QUE ESTE TESTE TRAVA: em cada hora cheia, conta a carga cuja etapa
NAQUELE instante (pela trilha de movimentações) está entre Aguardando
Embarque e Faturado; depois da última movimentação vale a etapa atual da
carga. O último ponto é "agora" e é igual a "caminhões no pátio agora", do
topo — a mesma conta nos dois lugares.

Relógio fixo às 16h30 de hoje, para o teste não depender da hora em que a
bateria roda. Dados inventados e marcados (cargas 900501+, rota TESTE).

    python3 testes/test_patio_vivo_grafico_so_patio.py
"""
import asyncio
import datetime
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
  const h = (hh, mm) => { const d = new Date(); d.setHours(hh, mm || 0, 0, 0); return d.toISOString(); };
  const cargas = [], movs = [];
  let n = 0;
  const carga = (o) => { const c = Object.assign({ id:'teste-gr-' + n, numeroCarga:String(900501 + n),
      placa:'TST' + (5000 + n), rota:'TESTE', peso:1000, qtdEntregas:1, sequencia:null,
      programadoEm:h(6), criadoEm:h(6), atualizadoEm:h(16) }, o); n++; cargas.push(c); return c; };
  const mov = (c, st, t) => movs.push({ id:'teste-gr-m-' + movs.length, cargaId:c.id, placa:c.placa,
      statusNovo:st, setor:'Logística', timestamp:t });
  // NO PÁTIO às 14h e agora
  const P1 = carga({ status:'Embarque Iniciado' }); mov(P1, 'Aguardando Embarque', h(13)); mov(P1, 'Embarque Iniciado', h(13, 30));
  const P2 = carga({ status:'Faturado' }); mov(P2, 'Aguardando Embarque', h(13, 10));
  mov(P2, 'Embarque Finalizado', h(14, 20)); mov(P2, 'Faturado', h(14, 40));
  const A1 = carga({ status:'Aguardando Embarque', aguardandoCarga:true, criadoEm:h(13, 45), programadoEm:null });
  // no pátio às 14h, saiu às 14h05
  const S1 = carga({ status:'Seguiu Viagem' }); mov(S1, 'Aguardando Embarque', h(12)); mov(S1, 'Seguiu Viagem', h(14, 5));
  // 1. chegou às 14h30 e saiu às 14h50: NÃO estava no pátio às 14h
  const S2 = carga({ status:'Seguiu Viagem' }); mov(S2, 'Aguardando Embarque', h(14, 30)); mov(S2, 'Seguiu Viagem', h(14, 50));
  // 2. Seguiu Viagem sem o carimbo da saída
  const X1 = carga({ status:'Seguiu Viagem' }); mov(X1, 'Aguardando Embarque', h(10));
  // 3. entrou e voltou para Aguardando Veículo
  const R1 = carga({ status:'Aguardando Veículo' }); mov(R1, 'Aguardando Embarque', h(11)); mov(R1, 'Aguardando Veículo', h(11, 30));
  // programada que nunca chegou
  carga({ status:'Aguardando Veículo' });
  DB.cargas = cargas; DB.movimentacoes = movs;
  invalidarIndiceMovimentacoes();
  renderAll(); abrirTab('patio');
}"""

LER = """() => {
  const a = document.getElementById('pv-grafico')._area;
  return { pontos: a ? a.pontos.map(p => [p.rotulo, p.valor]) : null,
           agora: document.getElementById('pv-k-patio').textContent.trim(),
           titulo: document.querySelector('#pv-grafico').closest('.pv-painel').querySelector('p').textContent };
}"""


async def main():
    hoje = datetime.datetime.now().replace(hour=16, minute=30, second=0, microsecond=0)
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.clock.set_fixed_time(hoje)
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(SEMEAR)
        await pg.wait_for_timeout(1200)
        r = await pg.evaluate(LER)
        print('  ', r['pontos'])
        pontos = dict(r['pontos'] or [])

        print('\n=== ÀS 14H: SÓ QUEM ESTAVA ENTRE AGUARDANDO EMBARQUE E FATURADO ===')
        ck('às 14h eram 4 no pátio (P1, P2, a chegada sem programação, e quem saiu às 14h05)',
           pontos.get('14h') == 4, str(pontos.get('14h')))
        ck('às 12h era 1: quem entrou às 12h (Seguiu Viagem sem carimbo e quem voltou para Aguardando Veículo não contam)',
           pontos.get('12h') == 1, str(pontos.get('12h')))

        print('\n=== O ÚLTIMO PONTO É AGORA, E BATE COM O TOPO ===')
        ck('o último ponto se chama "agora"', r['pontos'] and r['pontos'][-1][0] == 'agora', str(r['pontos'] and r['pontos'][-1]))
        ck('agora são 3 no pátio', r['pontos'] and r['pontos'][-1][1] == 3, str(r['pontos'] and r['pontos'][-1]))
        ck('o gráfico e "caminhões no pátio agora" dizem o mesmo número',
           r['pontos'] and str(r['pontos'][-1][1]) == r['agora'], f"{r['pontos'] and r['pontos'][-1][1]} x {r['agora']}")
        ck('a legenda do gráfico diz o que conta', 'Aguardando Embarque' in r['titulo'] and 'Faturado' in r['titulo'], r['titulo'])
        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
