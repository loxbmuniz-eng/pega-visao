#!/usr/bin/env python3
"""O KM da Programação chega ao relatório de Administração de Fretes (05/10/2026).

RELATO DO DONO: "eu coloquei um campo de quilometragem na programação (...)
essa quilometragem não está indo para o relatório de administração de
fretes, e a Daniela está sentindo falta disso. (...) mesmo que eu precise
consultar algo da semana passada ou retrasada, agora ele deve conseguir
relacioná-lo no próximo relatório que eu for gerar".

A RELAÇÃO, medida: o KM digitado na Montagem vira `kmDeslocamento` da carga
quando a linha é lançada (app/90_montagem.js), o servidor guarda em
`fact_viagens.km_deslocamento`, e o `/api/estado` completo devolve TODAS as
cargas não excluídas — sem janela de dias. A planilha (CSV) já levava o KM;
o PDF não tinha a coluna. É isso que este teste trava:

  1. a carga de duas semanas atrás, com KM, sai no PDF com o KM e o valor;
  2. KM corrigido na Montagem (corrigirKmDaCarga) é o que o relatório lê —
     uma fonte só, sem cópia;
  3. com desvio (KM ≠ tabela), o PDF mostra o KM da tabela ao lado;
  4. carga sem KM sai com "—" e NÃO com zero (null ≠ zero);
  5. a planilha e o PDF leem o MESMO número.

Roda sem servidor (modo local), como test_relatorio_na_sequencia.py.

    python3 testes/test_fretes_km_no_relatorio.py
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
        pg = await nav.new_page(viewport={'width': 1400, 'height': 1000})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Alysson')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)

        print('\n=== TRÊS CARGAS DE DUAS SEMANAS ATRÁS: COM KM, COM DESVIO, SEM KM ===')
        await pg.evaluate("""() => {
            const mk = (num, km, extra) => {
                const c = criarCargaProgramada({ placa: DB.frota[41 + Number(num.slice(-1))].placa, numeroCarga: num,
                    peso: 9000, rota: '500', sequencia: Number(num.slice(-1)), operador: 'Alysson',
                    kmDeslocamento: km, ...extra });
                c.programadoEm = new Date(2026, 8, 21, 9, 0).toISOString();   // 21/09, duas semanas antes de 05/10
                return c;
            };
            // kmDestino e freteValor são do SERVIDOR (cadastro do destino e tabela de
            // tarifa); em modo local o teste os põe direto na carga, como o /api/estado poria.
            const c1 = mk('KM-1', 583, {}); c1.kmDestino = 583; c1.freteValor = 1749;
            const desvio = mk('KM-2', 640, {}); desvio.kmDestino = 583; desvio.freteValor = 1920;
            mk('KM-3', undefined, {});
            SuincoStore.save();
        }""")
        await pg.wait_for_timeout(300)

        await pg.evaluate("() => abrirTab('relatorios')")
        await pg.wait_for_timeout(300)
        await pg.evaluate("""() => {
            document.getElementById('rel-data-de').value = '2026-09-21';
            document.getElementById('rel-data-ate').value = '2026-09-21';
            window.__pdf = null; window.__csv = null;
            window.exportarViaServidor = async (el) => { window.__pdf = el.innerHTML; };
            window.baixarCsvDoDia = (nome, cab, linhas) => { window.__csv = { cab, linhas }; };
            exportarPdfFretes(); exportarPlanilhaFretes();
        }""")
        await pg.wait_for_timeout(700)
        r = await pg.evaluate("""() => {
            const d = document.createElement('div'); d.innerHTML = window.__pdf || '';
            const cab = [...d.querySelectorAll('.tab-fretes thead th')].map(t => t.textContent.trim());
            const linhas = {};
            d.querySelectorAll('.tab-fretes tbody tr').forEach(tr => {
                const tds = [...tr.querySelectorAll('td')];
                if(!tds.length) return;
                const num = tr.querySelector('td.col-carga').textContent.trim();
                linhas[num] = { km: tr.querySelector('td.col-km').textContent.trim(),
                                valor: tr.querySelector('td.col-valor').textContent.trim(),
                                tab: (tr.querySelector('.km-tabela') || {}).textContent || '' };
            });
            const csv = window.__csv;
            const ik = csv.cab.indexOf('KM Deslocamento'), it = csv.cab.indexOf('KM Destino'), inum = csv.cab.indexOf('Nº da Carga');
            const planilha = {};
            csv.linhas.forEach(l => { if(l.length > inum) planilha[l[inum]] = { km: l[ik], tab: l[it] }; });
            return { cab, linhas, planilha };
        }""")
        ck('o PDF tem as colunas KM e Frete (R$)', 'KM' in r['cab'] and 'Frete (R$)' in r['cab'], str(r['cab']))
        L = r['linhas']
        ck('carga de duas semanas atrás está no PDF', set(L) >= {'KM-1', 'KM-2', 'KM-3'}, str(list(L)))
        ck('KM-1: o KM da Programação (583) e o valor (R$ 1.749,00)',
           L.get('KM-1', {}).get('km') == '583' and L['KM-1']['valor'] == 'R$ 1.749,00', str(L.get('KM-1')))
        ck('KM-2 com desvio: 640, e a tabela (583) ao lado',
           L.get('KM-2', {}).get('km', '').startswith('640') and 'tab. 583' in L['KM-2']['tab'], str(L.get('KM-2')))
        ck('KM-3 sem KM: sai "—", não zero', L.get('KM-3', {}).get('km') == '—', str(L.get('KM-3')))
        P = r['planilha']
        ck('a planilha lê o MESMO KM do PDF (583 / 640 / vazio)',
           P.get('KM-1', {}).get('km') == '583' and P.get('KM-2', {}).get('km') == '640' and P.get('KM-3', {}).get('km') == '',
           str(P))

        print('\n=== KM CORRIGIDO NA MONTAGEM É O QUE O RELATÓRIO LÊ ===')
        await pg.evaluate("""() => {
            const c = DB.cargas.find(x => x.numeroCarga === 'KM-1');
            corrigirKmDaCarga(c.id, 601, 'Alysson', 'Logística');
            window.__pdf = null;
            exportarPdfFretes();
        }""")
        await pg.wait_for_timeout(600)
        km = await pg.evaluate("""() => {
            const d = document.createElement('div'); d.innerHTML = window.__pdf || '';
            const tr = [...d.querySelectorAll('.tab-fretes tbody tr')].find(t => (t.querySelector('td.col-carga')||{}).textContent?.trim() === 'KM-1');
            return tr ? tr.querySelector('td.col-km').textContent.trim() : null;
        }""")
        ck('depois da correção, o PDF mostra 601 (com a tabela 583 ao lado)', km and km.startswith('601') and '583' in km, str(km))
        hist = await pg.evaluate("() => (DB.alteracoes || []).filter(a => a.campo === 'KM de deslocamento').length")
        ck('a correção ficou registrada no histórico', hist >= 1, str(hist))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()
    print('\n' + ('FALHAS: ' + '; '.join(falhas) if falhas else 'TUDO OK'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
