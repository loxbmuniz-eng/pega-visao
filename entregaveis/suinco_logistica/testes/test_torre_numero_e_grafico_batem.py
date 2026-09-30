#!/usr/bin/env python3
"""Na Torre, o número do quadro e o mini-gráfico dele contam a mesma coisa (30/09/2026).

ACHADOS NO DEBUGGING PREVENTIVO, família da #99 ("uma pergunta, duas contas"):

  #101 — "Cargas em aberto": o número grande não conta a chegada sem
  programação nem carga sem placa; o mini-gráfico e a seta "▲ N vs. ontem"
  contavam. Reproduzido: o número dizia 2 e o gráfico 3.

  #102 — "Quando a carga saiu" tinha três respostas. O número de "Seguiu
  Viagem hoje" usa o carimbo da saída; o mini-gráfico dele, a série de 14
  dias dos Indicadores e o ranking de atraso por placa caíam para
  `concluidoEm || atualizadoEm` — e `concluidoEm` o servidor nunca preenche,
  então valia a HORA DA ÚLTIMA EDIÇÃO. Uma carga em Seguiu Viagem sem
  carimbo, editada hoje, aparecia como "saiu hoje" no gráfico e não no
  número. Reproduzido: número 0, gráfico 1. Fere "fidelidade ao momento".

A REGRA QUE ESTE TESTE TRAVA:
  1. o último ponto do mini-gráfico de "Cargas em aberto" é o número do
     quadro, e a seta compara com o ontem da MESMA conta;
  2. "quando saiu" é uma função só (saidaDaCarga): o carimbo de Seguiu
     Viagem; sem carimbo, a carga não é contada como saída em dia nenhum —
     e também não é contada como aberta;
  3. o último ponto do mini-gráfico de "Seguiu Viagem hoje" é o número.

Relógio fixo às 22h de Brasília. Dados inventados (cargas 900951+).

    python3 testes/test_torre_numero_e_grafico_batem.py
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
  const iso = s => new Date(s).toISOString();
  const c = (o) => Object.assign({ rota:'TESTE', peso:1000, qtdEntregas:1 }, o);
  DB.cargas = [
    c({ id:'tn-1', numeroCarga:'900951', placa:'TST9501', status:'Aguardando Embarque',
        programadoEm:iso('2026-09-30T08:00:00-03:00'), criadoEm:iso('2026-09-30T08:00:00-03:00'), atualizadoEm:iso('2026-09-30T09:00:00-03:00') }),
    c({ id:'tn-2', numeroCarga:'900952', placa:'TST9502', status:'Aguardando Veículo',
        programadoEm:iso('2026-09-29T20:00:00-03:00'), criadoEm:iso('2026-09-29T20:00:00-03:00'), atualizadoEm:iso('2026-09-29T20:00:00-03:00') }),
    // chegada sem programação: fora do número "Cargas em aberto"
    c({ id:'tn-3', numeroCarga:'', placa:'TST9503', rota:'', status:'Aguardando Embarque', aguardandoCarga:true,
        programadoEm:null, criadoEm:iso('2026-09-30T10:00:00-03:00'), atualizadoEm:iso('2026-09-30T10:00:00-03:00'), peso:0 }),
    // Seguiu Viagem SEM carimbo, editada hoje, programada há 3 dias
    c({ id:'tn-4', numeroCarga:'900954', placa:'TST9504', status:'Seguiu Viagem',
        programadoEm:iso('2026-09-27T08:00:00-03:00'), criadoEm:iso('2026-09-27T08:00:00-03:00'), atualizadoEm:iso('2026-09-30T15:00:00-03:00') }),
    // Seguiu Viagem com carimbo, hoje
    c({ id:'tn-5', numeroCarga:'900955', placa:'TST9505', status:'Seguiu Viagem',
        programadoEm:iso('2026-09-30T06:00:00-03:00'), criadoEm:iso('2026-09-30T06:00:00-03:00'), atualizadoEm:iso('2026-09-30T12:00:00-03:00') }),
  ];
  DB.movimentacoes = [
    { id:'tn-m1', cargaId:'tn-1', placa:'TST9501', statusNovo:'Aguardando Embarque', setor:'Portaria', operador:'X', timestamp:iso('2026-09-30T09:00:00-03:00') },
    { id:'tn-m2', cargaId:'tn-4', placa:'TST9504', statusNovo:'Aguardando Embarque', setor:'Portaria', operador:'X', timestamp:iso('2026-09-27T09:00:00-03:00') },
    { id:'tn-m3', cargaId:'tn-5', placa:'TST9505', statusNovo:'Aguardando Embarque', setor:'Portaria', operador:'X', timestamp:iso('2026-09-30T07:00:00-03:00') },
    { id:'tn-m4', cargaId:'tn-5', placa:'TST9505', statusNovo:'Seguiu Viagem', setor:'Portaria', operador:'X', timestamp:iso('2026-09-30T12:00:00-03:00') },
  ];
  invalidarIndiceMovimentacoes();
  renderAll(); abrirTab('torre');
  const quadro = (rot) => { const d = [...document.querySelectorAll('#torre-stats > *')].find(x => x.textContent.includes(rot));
    return d ? d.textContent.replace(/\\s+/g, ' ').trim() : null; };
  const s = serieDoPatio(14);
  return { aberto: quadro('Cargas em aberto'), seguiu: quadro('Seguiu Viagem hoje'),
           serieAbertasHoje: s.abertas[13], serieAbertasOntem: s.abertas[12], serieSeguiuHoje: s.seguiu[13],
           funcaoSaida: typeof saidaDaCarga === 'function',
           saidaSemCarimbo: typeof saidaDaCarga === 'function' ? saidaDaCarga(DB.cargas[3]) : 'sem função' };
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        ctx = await nav.new_context(timezone_id='America/Sao_Paulo', viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        brasilia = datetime.timezone(datetime.timedelta(hours=-3))
        await pg.clock.set_fixed_time(datetime.datetime(2026, 9, 30, 22, 0, tzinfo=brasilia))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        r = await pg.evaluate(SEMEAR)
        print('  ', r)
        numero = int(r['aberto'].split(' ')[0]) if r['aberto'] else None
        seguiu = int(r['seguiu'].split(' ')[0]) if r['seguiu'] else None

        print('\n=== #101 — CARGAS EM ABERTO ===')
        ck('o número do quadro é 2 (a chegada sem programação fica de fora)', numero == 2, r['aberto'])
        ck('o último ponto do mini-gráfico é o número do quadro', r['serieAbertasHoje'] == numero,
           f"{r['serieAbertasHoje']} x {numero}")
        ck('a seta compara com o ontem da mesma conta (ontem: 1 — a programada às 20h de 29/09)',
           r['serieAbertasOntem'] == 1 and '▲ 1' in (r['aberto'] or ''), f"{r['serieAbertasOntem']} · {r['aberto']}")

        print('\n=== #102 — QUANDO A CARGA SAIU ===')
        ck('"quando saiu" é uma função só', r['funcaoSaida'])
        ck('sem carimbo de saída, não há hora de saída (não vale a hora da edição)', r['saidaSemCarimbo'] is None,
           repr(r['saidaSemCarimbo']))
        ck('"Seguiu Viagem hoje" é 1 (só a que tem carimbo)', seguiu == 1, r['seguiu'])
        ck('o último ponto do mini-gráfico de saídas é o número do quadro', r['serieSeguiuHoje'] == seguiu,
           f"{r['serieSeguiuHoje']} x {seguiu}")
        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
