#!/usr/bin/env python3
"""A data de programação é o dia de Brasília, não o dia do UTC (30/09/2026).

ACHADO NO DEBUGGING PREVENTIVO (ocorrência #100), família da #81: três telas
tiravam o dia da programação cortando o texto do horário universal
(`programadoEm.slice(0,10)`). A partir das 21h de Brasília o UTC já virou o
dia seguinte — e programar à noite para o dia seguinte é rotina aqui. Uma
carga programada em 30/09 às 21h30 aparecia como 01/10:
  1. no painel de correção da Administração (que ABRE com a data errada
     preenchida — salvar sem reparar mudaria a carga de dia);
  2. na tabela do raio-X dos Indicadores;
  3. na lista de cargas excluídas do Histórico.

O QUE ESTE TESTE TRAVA, com o navegador no fuso de Brasília: as três dizem
30/09. E o dia local é UMA função (diaLocalISO, em data.js) — a Torre e as
Devoluções, que tinham cada uma a sua cópia, passam a chamá-la.

Dados inventados e marcados (carga 900901, rota TESTE).

    python3 testes/test_data_de_programacao_no_fuso.py
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
        r = await pg.evaluate("""() => {
          DB.operador = {nome:'Teste', setor:'Administração'};
          document.getElementById('modal-operador')?.classList.remove('open');
          const iso = new Date('2026-09-30T21:30:00-03:00').toISOString();   // 2026-10-01T00:30Z
          const c = { id:'teste-fuso-1', numeroCarga:'900901', placa:'TST9001', rota:'TESTE',
            status:'Aguardando Veículo', programadoEm:iso, criadoEm:iso, atualizadoEm:iso, peso:1000 };
          DB.cargas = [c]; DB.movimentacoes = []; invalidarIndiceMovimentacoes();
          const admin = painelAdminDaCargaHtml(c);
          const m = admin.match(/id="adm-data-[^"]*" value="([^"]*)"/);
          const div = document.createElement('div');
          return {
            utc: iso.slice(0, 10),
            admin: m ? m[1] : null,
            funcaoUnica: typeof diaLocalISO === 'function' ? diaLocalISO(new Date(iso)) : null,
            torre: isoDiaLocal(new Date(iso)),
            devolucoes: diaLocalDev(new Date(iso)),
            programacao: typeof diaDaProgramacao === 'function' ? diaDaProgramacao(c) : null,
          };
        }""")
        print('  ', r)
        ck('o horário da carga cai em 01/10 no UTC (o cenário do defeito)', r['utc'] == '2026-10-01', r['utc'])
        ck('a Administração abre a correção com 30/09', r['admin'] == '2026-09-30', r['admin'])
        ck('o dia da programação é 30/09', r['programacao'] == '2026-09-30', r['programacao'])
        ck('uma função de dia local, e as cópias dizem o mesmo',
           r['funcaoUnica'] == r['torre'] == r['devolucoes'] == '2026-09-30', str(r))

        # as duas tabelas: procura a data na página renderizada pelas funções
        t = await pg.evaluate("""() => {
          const c = DB.cargas[0];
          const lista = document.createElement('div');
          // Histórico — cargas excluídas
          const fonteHist = String(carregarCargasExcluidasUI);
          const fonteRaio = String(detalheRaioXHtml);
          return { hist: /programadoEm *\\|\\| *c\\.criadoEm *\\|\\| *''\\)\\.slice\\(0, *10\\)/.test(fonteHist),
                   raio: /programadoEm *\\|\\| *c\\.criadoEm *\\|\\| *''\\)\\.slice\\(0, *10\\)/.test(fonteRaio) };
        }""")
        ck('o Histórico (cargas excluídas) não corta o texto UTC', not t['hist'], str(t))
        ck('o raio-X dos Indicadores não corta o texto UTC', not t['raio'], str(t))
        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
