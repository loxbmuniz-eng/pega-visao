#!/usr/bin/env python3
"""O Nº DEV sai curto nos papéis da devolução (29/09/2026).

PEDIDO DO DONO, com print do relatório do Sisatak marcando o bloco do meio:
"no relatório do operador de devoluções onde aparece o número da dev, eu
prefiro que apareça somente a última sequência de 5 números-dev, como por
exemplo 53193-dev" — e, perguntado, "nos dois relatórios de devoluções e
comprovante de checklist".

A REGRA QUE ESTE TESTE TRAVA:
  1. na Relação para o Operador, no Relatório de Devoluções do dia e no
     Comprovante da Portaria, `AAA-BBB-NNNNN-DEV` sai como `NNNNN-DEV`;
  2. número fora desse formato (digitado à mão) sai como foi digitado;
  3. é SÓ exibição: o item continua guardando o número inteiro — a busca,
     o "já está no checklist" e a importação do Sisatak usam o inteiro.

Não precisa do servidor: troca a busca e o envio do PDF por dublês e lê o
HTML que iria para o gerador.

    python3 testes/test_num_dev_curto_nos_relatorios.py
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


# Dados de teste, inventados e marcados como tal: os números 999-001-9000x
# não são devoluções reais.
NUMEROS = ['999-001-90001-DEV', '999-001-90002-DEV', 'DEV-TESTE-3', '90004']
ESPERADO = ['90001-DEV', '90002-DEV', 'DEV-TESTE-3', '90004']

PREPARAR = """(numeros) => {
  const item = (n, k) => ({ itemId: 'it' + k, nota: 'TESTE-NF-' + k, parcial: false, parcialDesc: '',
    supervisor: 'SUP TESTE', vendedor: 'RCA TESTE', codCliente: 'CLI-TESTE', clienteNome: '',
    cx: 2, peso: 10.5, codProduto: 'PROD-TESTE', produtoNome: '', numDev: n,
    dataItem: '2026-09-29', motivo: 'MOTIVO TESTE', pesoFaturamento: null, okExpedicao: false,
    qtdRecebida: null, falta: null, okDestinacao: false, notaFinal: false, cargaDev: '' });
  const d = { id: 'dev-teste', numero: 900001, tipo: 'DEVOLUCAO', status: 'Recebida na Portaria',
    dataDev: '2026-09-29', regiao: 'REGIAO TESTE', rotas: ['TESTE'], operadorCodigo: '',
    transportadora: '', notaTransferencia: '', placa: '', motorista: '',
    cargaNumero: '', lacre1: '', lacre2: '', lacre3: '', pesoEntrada: null, pesoFinal: null,
    pesoDevolvido: null, criadaPor: 'Teste', criadaSetor: 'Logística',
    obsControles: '', obsExpedicao: '', obsNotas: '', gerouRdc: null, chegouLacrado: null,
    itens: numeros.map(item), divergencias: [], carimbos: {} };
  window.devServidorOk = () => true;
  window.getDevolucao = () => d;
  SuincoSharePoint.devolucoes.listar = async () => [d];
  window.exportarViaServidor = async () => {};
}"""

COLUNA = """(sel) => {
  const tab = document.querySelector(sel + ' table.dev-doc-tabela');
  if(!tab) return null;
  const th = [...tab.querySelectorAll('thead th')].map(t => t.textContent.trim());
  const k = th.indexOf('Nº DEV');
  return [...tab.querySelectorAll('tbody tr')].map(tr => (tr.children[k] || {}).textContent.trim());
}"""

COMPROVANTE = """() => {
  const l = [...document.querySelectorAll('#print-devolucoes .dev-comp-linha')]
    .find(x => x.querySelector('.dev-comp-rot').textContent.trim() === 'Nº(S) DEV');
  return l ? l.querySelector('.dev-comp-val').textContent.trim() : null;
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(PREPARAR, NUMEROS)

        print('\n=== 1. RELAÇÃO PARA O OPERADOR ===')
        await pg.evaluate("() => relatorioOperadorDevolucoesUI('dev-teste')")
        r = await pg.evaluate(COLUNA, '#print-devolucoes-operador')
        ck('Nº DEV curto; fora do formato, como foi digitado', r == ESPERADO, str(r))

        print('\n=== 2. RELATÓRIO DE DEVOLUÇÕES DO DIA ===')
        await pg.evaluate("() => relatorioDevolucoesUI('2026-09-29')")
        r = await pg.evaluate(COLUNA, '#print-devolucoes')
        ck('Nº DEV curto; fora do formato, como foi digitado', r == ESPERADO, str(r))

        print('\n=== 3. COMPROVANTE DA PORTARIA ===')
        await pg.evaluate("() => comprovantePortariaUI('dev-teste')")
        r = await pg.evaluate(COMPROVANTE)
        ck('linha Nº(S) DEV com os números curtos', r == ' · '.join(ESPERADO), str(r))

        print('\n=== 4. SÓ EXIBIÇÃO: O ITEM GUARDA O NÚMERO INTEIRO ===')
        guardado = await pg.evaluate("() => getDevolucao().itens.map(i => i.numDev)")
        ck('os itens continuam com o número inteiro', guardado == NUMEROS, str(guardado))

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
