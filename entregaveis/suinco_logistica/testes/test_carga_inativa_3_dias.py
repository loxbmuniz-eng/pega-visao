#!/usr/bin/env python3
"""Carga sem movimentação há mais de 3 dias é INATIVA (07/10/2026, decisão 29).

DECISÃO DO DONO, em duas mensagens: "caminhão no pátio com mais de 7 dias
considerado inativo, some dos indicadores e para de poluir dados, mesmo
para cargas" — e logo depois: "na verdade 3 dias após última
movimentação". Na Torre, a recomendação aceita: sai da fila principal para
um bloco recolhido "Inativos (mais de 3 dias)".

O QUE ESTE TESTE TRAVA, pela tela:
  1. a regra: inativa = ainda não seguiu viagem e mais de 3 dias desde a
     ÚLTIMA movimentação; carga programada para daqui a dias, sem
     movimentação, NÃO é inativa (a referência é a mais nova entre a
     última movimentação e a programação);
  2. Pátio ao vivo: o inativo não vira cartão nem entra no "caminhões no
     pátio agora";
  3. Indicadores: "parados além da meta" não conta o inativo;
  4. Torre: o inativo sai da tabela principal e aparece no bloco recolhido
     "Inativos (mais de 3 dias)" — ninguém perde de vista;
  5. NADA É APAGADO: a carga continua no Histórico;
  6. a trava de duplicidade de placa continua enxergando o inativo
     (`cargasAbertasPorPlaca`) — inativo não é caminhão que sumiu;
  7. movimentação nova reativa sozinha.
Dados inventados e marcados (cargas 9530xx, rota TESTE).

    bash testes/rodar_tudo.sh test_carga_inativa_3_dias
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
  const ag = Date.now(), h = 3600e3, dia = 24 * h, iso = t => new Date(t).toISOString();
  DB.cargas = []; DB.movimentacoes = [];
  const carga = (id, o) => { const c = Object.assign({ id, numeroCarga:id, placa:'INA' + id.slice(-4),
      rota:'TESTE', status:'Aguardando Embarque', criadoEm:iso(ag - 5 * dia), programadoEm:iso(ag - 5 * dia),
      atualizadoEm:iso(ag) }, o); DB.cargas.push(c); return c; };
  const mov = (c, st, t) => DB.movimentacoes.push({ id:'m-' + c.id + '-' + st, cargaId:c.id, placa:c.placa,
      statusNovo:st, setor:'Portaria', timestamp:iso(t) });
  // ATIVA: chegou há 5 dias, mexeu há 4 horas
  const a = carga('953001', {}); mov(a, 'Aguardando Embarque', ag - 5 * dia); mov(a, 'Embarque Iniciado', ag - 4 * h);
  a.status = 'Embarque Iniciado';
  // INATIVA: última movimentação há 4 dias
  const i = carga('953002', {}); mov(i, 'Aguardando Embarque', ag - 4 * dia);
  // ATIVA no limite: última movimentação há 2 dias e 23 horas
  const l = carga('953003', {}); mov(l, 'Aguardando Embarque', ag - (3 * dia - h));
  // ATIVA: programada para daqui a 2 dias, sem movimentação
  carga('953004', { status:'Aguardando Veículo', placa:'INA3004', programadoEm:iso(ag + 2 * dia), criadoEm:iso(ag - 5 * dia) });
  // INATIVA: programada há 5 dias e nunca se mexeu
  carga('953005', { status:'Aguardando Veículo', placa:'INA3005' });
  invalidarIndiceMovimentacoes(); renderAll();
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1440, 'height': 1000})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(800)
        await pg.evaluate(SEMEAR)
        await pg.wait_for_timeout(300)

        print('\n=== 1. A REGRA ===')
        r = await pg.evaluate("""() => {
            const f = (typeof cargaInativa === 'function') ? cargaInativa : null;
            if (!f) return { existe: false };
            const g = id => f(getCarga(id));
            return { existe: true, a: g('953001'), i: g('953002'), l: g('953003'), fut: g('953004'), nunca: g('953005') };
        }""")
        ck('existe UMA função que decide (cargaInativa)', r.get('existe'), str(r))
        if r.get('existe'):
            ck('mexeu há 4 horas: ATIVA', r['a'] is False)
            ck('última movimentação há 4 dias: INATIVA', r['i'] is True)
            ck('2 dias e 23 horas: ainda ATIVA', r['l'] is False)
            ck('programada para daqui a 2 dias, sem movimentação: ATIVA', r['fut'] is False)
            ck('programada há 5 dias e nunca se mexeu: INATIVA', r['nunca'] is True)

        print('\n=== 2. PÁTIO AO VIVO ===')
        await pg.evaluate("() => abrirTab('patio')")
        await pg.wait_for_timeout(400)
        pv = await pg.evaluate("""() => {
            const cards = [...document.querySelectorAll('.pv-card')].map(c => c.textContent);
            return { topo: (document.getElementById('pv-k-patio') || {}).textContent || '',
                     temInativa: cards.some(t => t.includes('INA3002') || t.includes('953002')),
                     temAtiva: cards.some(t => t.includes('INA3001') || t.includes('953001')) };
        }""")
        ck('a ativa continua no quadro', pv['temAtiva'], str(pv))
        ck('a inativa não vira cartão', not pv['temInativa'], str(pv))
        ck('"caminhões no pátio agora" não conta a inativa (2: a de 4 h e a do limite)',
           pv['topo'].strip() == '2', pv['topo'])

        print('\n=== 3. INDICADORES ===')
        ind = await pg.evaluate("() => paradasAlemDaMeta()")
        ck('"parados além da meta" não conta a inativa', ind['total'] == 2, str(ind))

        print('\n=== 4. TORRE ===')
        await pg.evaluate("() => abrirTab('torre')")
        await pg.wait_for_timeout(400)
        tr = await pg.evaluate("""() => {
            // a linha é marcada por data-carga; o número fica num campo
            // editável para a Administração, que o textContent não lê
            const ids = [...document.querySelectorAll('#torre-tbody tr[data-carga]')].map(t => t.dataset.carga);
            const corpo = ids.join(' ');
            const bloco = document.getElementById('torre-inativas');
            return { naTabela: corpo.includes('953002'), ativaNaTabela: corpo.includes('953001'),
                     bloco: !!bloco, recolhido: bloco ? !bloco.open : null,
                     titulo: bloco ? (bloco.querySelector('summary') || {}).textContent || '' : '',
                     noBloco: bloco ? bloco.textContent.includes('953002') && bloco.textContent.includes('953005') : false };
        }""")
        ck('a ativa continua na tabela da Torre', tr['ativaNaTabela'], str(tr))
        ck('a inativa SAI da tabela principal', not tr['naTabela'], str(tr))
        ck('existe o bloco "Inativos (mais de 3 dias)"', tr['bloco'] and 'Inativos' in tr['titulo'], str(tr))
        ck('o bloco nasce recolhido', tr['recolhido'] is True, str(tr))
        ck('as duas inativas estão no bloco', tr['noBloco'], str(tr))

        print('\n=== 5. NADA É APAGADO ===')
        hist = await pg.evaluate("() => !!getCarga('953002') && historicoDaCarga('953002').length")
        ck('a inativa continua na base e no histórico', hist == 1, str(hist))
        trava = await pg.evaluate("() => cargasAbertasPorPlaca('INA3002').length")
        ck('a trava de duplicidade de placa continua vendo a inativa', trava == 1, str(trava))

        print('\n=== 6. MOVIMENTAÇÃO NOVA REATIVA ===')
        volta = await pg.evaluate("""() => {
            const c = getCarga('953002');
            DB.movimentacoes.push({ id:'m-volta', cargaId:c.id, placa:c.placa, statusNovo:'Embarque Iniciado',
                                    setor:'Expedição', timestamp:new Date().toISOString() });
            c.status = 'Embarque Iniciado';
            invalidarIndiceMovimentacoes(); renderAll();
            return { inativa: cargaInativa(c), naTorre: [...document.querySelectorAll('#torre-tbody tr[data-carga]')].some(t => t.dataset.carga === '953002') };
        }""")
        ck('voltou a ser ativa', volta['inativa'] is False, str(volta))
        ck('e voltou para a tabela da Torre', volta['naTorre'], str(volta))

        ck('nenhum erro de JavaScript na página', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\nRESULTADO:', 'OK' if not falhas else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
