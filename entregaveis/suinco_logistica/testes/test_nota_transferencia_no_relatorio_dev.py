#!/usr/bin/env python3
"""A nota de transferência da filial sai na LINHA do relatório de devolução (28/09/2026).

RELATO DO DONO: "no relatório de devoluções não está aparecendo o número da
nota de transferência que é colocado pelo pessoal das filiais, e precisa
aparecer no relatório de dev na mesma linha onde falam o número da
devolução e a data".

O QUE ESTAVA ERRADO, visto no código publicado antes de corrigir:
  · na Relação para o Operador — o PDF que a filial gera — a nota de
    transferência não saía em lugar nenhum;
  · no Relatório de Devoluções do dia ela saía só no subtítulo do
    checklist ("NT ..."), nunca na linha, ao lado do Nº DEV e da Data DEV.

A REGRA QUE ESTE TESTE TRAVA, nos dois relatórios:
  1. checklist com nota de transferência tem a coluna "Nota transf.", e
     cada linha traz o número ao lado do Nº DEV e da Data DEV;
  2. a linha de TOTAL continua fechando alinhada com o cabeçalho;
  3. checklist sem nota de transferência (os da matriz) não ganha coluna
     vazia — o relatório deles fica como estava.

Não precisa do servidor: troca só a busca e o envio do PDF por dublês e lê
o HTML que iria para o gerador.

    python3 testes/test_nota_transferencia_no_relatorio_dev.py
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


# Dados de teste, inventados e marcados como tal: nenhum é nota, cliente ou
# devolução real.
PREPARAR = """(comNT) => {
  const item = (n) => ({ itemId: 'it' + n, nota: 'TESTE-NF-' + n, parcial: false, parcialDesc: '',
    supervisor: 'SUP TESTE', vendedor: 'RCA TESTE', codCliente: 'CLI-TESTE', clienteNome: '',
    cx: 2, peso: 10.5, codProduto: 'PROD-TESTE', produtoNome: '', numDev: 'DEV-TESTE-' + n,
    dataItem: '2026-09-28', motivo: 'MOTIVO TESTE', pesoFaturamento: null, okExpedicao: false,
    qtdRecebida: null, falta: null, okDestinacao: false, notaFinal: false, cargaDev: '' });
  const d = { id: 'dev-teste', numero: 900001, tipo: 'DEVOLUCAO', status: 'Lançada',
    dataDev: '2026-09-28', regiao: 'REGIAO TESTE', rotas: ['TESTE'], operadorCodigo: '',
    transportadora: '', notaTransferencia: comNT ? 'NT-TESTE-777' : '', placa: '', motorista: '',
    cargaNumero: '', lacre1: '', lacre2: '', lacre3: '', pesoEntrada: null, pesoFinal: null,
    pesoDevolvido: null, criadaPor: 'Teste', criadaSetor: comNT ? 'Filial 105' : 'Logística',
    obsControles: '', obsExpedicao: '', obsNotas: '', gerouRdc: null, chegouLacrado: null,
    itens: [item(1), item(2)], divergencias: [], carimbos: {} };
  window.devServidorOk = () => true;
  window.getDevolucao = () => d;
  SuincoSharePoint.devolucoes.listar = async () => [d];
  window.exportarViaServidor = async () => {};
}"""

LER = """(sel) => {
  const tab = document.querySelector(sel + ' table.dev-doc-tabela');
  if(!tab) return null;
  const th = [...tab.querySelectorAll('thead th')].map(t => t.textContent.trim());
  const linhas = [...tab.querySelectorAll('tbody tr')].map(tr =>
    [...tr.children].map(td => td.textContent.trim()));
  const tot = tab.querySelector('tfoot tr');
  const larguraTotal = tot ? [...tot.children].reduce((s, td) => s + (Number(td.getAttribute('colspan')) || 1), 0) : -1;
  return { th, linhas, larguraTotal };
}"""


def conferir(r, rotulo, com_nt):
    if r is None:
        ck(f'{rotulo}: a tabela foi desenhada', False)
        return
    col = next((k for k, t in enumerate(r['th']) if 'transf' in t.lower()), -1)
    if com_nt:
        ck(f'{rotulo}: tem a coluna da nota de transferência', col >= 0, str(r['th']))
        dev = r['th'].index('Nº DEV') if 'Nº DEV' in r['th'] else -1
        data = r['th'].index('Data DEV') if 'Data DEV' in r['th'] else -1
        ck(f'{rotulo}: ela fica junto do Nº DEV e da Data DEV',
           col >= 0 and dev >= 0 and data >= 0 and min(dev, data) - 1 <= col <= max(dev, data) + 1,
           f'Nº DEV {dev} · NT {col} · Data {data}')
        ck(f'{rotulo}: cada linha traz o número da nota de transferência',
           col >= 0 and all(len(l) > col and l[col] == 'NT-TESTE-777' for l in r['linhas']),
           str([l[col] if col >= 0 and len(l) > col else None for l in r['linhas']]))
    else:
        ck(f'{rotulo}: sem nota de transferência, nenhuma coluna vazia a mais', col < 0, str(r['th']))
    ck(f'{rotulo}: cada linha tem uma célula por coluna',
       all(len(l) == len(r['th']) for l in r['linhas']), f"{len(r['th'])} colunas")
    ck(f'{rotulo}: a linha de TOTAL fecha alinhada com o cabeçalho',
       r['larguraTotal'] == len(r['th']), f"total {r['larguraTotal']} × cabeçalho {len(r['th'])}")


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)

        for com_nt in (True, False):
            quem = 'checklist de FILIAL' if com_nt else 'checklist da MATRIZ'
            print(f'\n=== {quem.upper()} ===')
            await pg.evaluate(PREPARAR, com_nt)
            await pg.evaluate("() => relatorioOperadorDevolucoesUI('dev-teste')")
            conferir(await pg.evaluate(LER, '#print-devolucoes-operador'), f'Relação para o Operador ({quem})', com_nt)
            await pg.evaluate("() => relatorioDevolucoesUI('2026-09-28')")
            conferir(await pg.evaluate(LER, '#print-devolucoes'), f'Relatório de Devoluções ({quem})', com_nt)

        print('\n=== FILIAL COM Nº CARGA DEV: AS DUAS COLUNAS OPCIONAIS JUNTAS ===')
        await pg.evaluate(PREPARAR, True)
        await pg.evaluate("() => { getDevolucao().cargaNumero = 'CARGA-TESTE'; }")
        await pg.evaluate("() => relatorioOperadorDevolucoesUI('dev-teste')")
        conferir(await pg.evaluate(LER, '#print-devolucoes-operador'), 'Relação para o Operador (com carga dev)', True)
        await pg.evaluate("() => relatorioDevolucoesUI('2026-09-28')")
        conferir(await pg.evaluate(LER, '#print-devolucoes'), 'Relatório de Devoluções (com carga dev)', True)

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
