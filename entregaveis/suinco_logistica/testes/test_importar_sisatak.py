#!/usr/bin/env python3
"""Importar o relatório do Sisatak no checklist de devolução (28/09/2026).

PEDIDO DO DONO: trazer o WRMVE790 para dentro das devoluções "facilitando
assim o retrabalho de ficar colocando item por item, coluna por coluna,
célula por célula". Decisões dele: só devolução física ("DEN não entra, só o
que é DEV"); linha sem documento fica fora; Nº DEV inteiro; a CX o operador
digita.

O QUE ESTE TESTE TRAVA NA TELA (a leitura do arquivo é do servidor e tem o
teste dela em backend/testes/devolucoes.test.js, bloco 20):
  1. quem lança item vê o botão; a Portaria não;
  2. a prévia diz quantas linhas entram e quantas ficaram fora, e por quê;
  3. linha que já está noutro checklist vem DESMARCADA, dizendo qual;
  4. sem a CX, ou sem escolher Parcial/Total, nada é gravado — e o aviso
     diz qual linha falta;
  5. o que entra vai pela MESMA rota da digitação (`criarItem`), com o Nº
     DEV inteiro, o motivo como o Sisatak escreveu e a data do checklist;
  6. cancelar não grava nada.

Roda sem servidor: a ida ao servidor é trocada por dublês e o que se mede é
o que a tela manda.

    python3 testes/test_importar_sisatak.py
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


# Dados INVENTADOS, no formato que o servidor devolve para a planilha limpa.
PREPARAR = """(setor) => {
  DB.operador = { nome: 'Teste', setor };
  const dev = { id: 'dev-sis', numero: 900001, tipo: 'DEVOLUCAO', status: 'Lançada', dataDev: '2026-09-28',
    regiao: 'REGIAO TESTE', rotas: ['TESTE'], operadorCodigo: '', transportadora: '', notaTransferencia: '',
    placa: '', motorista: '', cargaNumero: '', lacre1: '', lacre2: '', lacre3: '', pesoEntrada: null,
    pesoFinal: null, pesoDevolvido: null, criadaPor: 'Teste', criadaSetor: 'Logística', obsControles: '',
    obsExpedicao: '', obsNotas: '', gerouRdc: null, chegouLacrado: null, itens: [], divergencias: [], carimbos: {} };
  const item = (n, ja) => ({ nota: '90010' + n, notaDocumento: '103-003-90010' + n + '-NE',
    supervisor: 'SUPERVISOR TESTE', vendedor: 'REPRESENTANTE TESTE', codCliente: '90000' + n,
    clienteNome: 'CLIENTE TESTE ' + n, codProduto: '90050' + n, produtoNome: 'PRODUTO TESTE ' + n,
    numDev: '103-001-99000' + n + '-DEV', dataItem: null, motivo: '05 - TRANSPORTE/FALTA DE MERCADORIA',
    parcialSugerido: null, jaNoChecklist: ja });
  window.__lancadas = [];
  window.devServidorOk = () => true;
  SuincoSharePoint.devolucoes = Object.assign({}, SuincoSharePoint.devolucoes, {
    listar: async () => [dev],
    cadastros: async () => ({ supervisores: [], produtos: [], motivos: ['05 MOTIVO DO PAINEL QUE NÃO É O DO SISATAK'] }),
    previaSisatak: async () => ({ itens: [item(1, null), item(2, null), item(3, 900777)],
      fora: { outroTipo: { 'documento DEN (não é devolução física)': 34 }, semDocumento: 5 } }),
    criarItem: async (id, corpo) => { window.__lancadas.push([id, corpo]); return corpo; },
  });
  DEVOLUCOES = [dev];
  _devExpandida = 'dev-sis';
  renderAll();
  // A janela de escolher operador abre sozinha no painel sem login; aqui o
  // operador já está definido acima.
  const m = document.getElementById('modal-operador'); if (m) m.classList.remove('open');
  abrirTab('devolucoes');
  renderListaDevolucoes();
}"""


async def abrir(nav, setor):
    pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(800)
    await pg.evaluate(PREPARAR, setor)
    await pg.wait_for_timeout(400)
    return pg, erros


async def previa(pg):
    async with pg.expect_file_chooser() as fc:
        await pg.click("button:has-text('Importar do Sisatak')")
    await (await fc.value).set_files(os.path.join(os.path.dirname(AQUI),
                                                  'backend/testes/fixtures/sisatak_limpo_exemplo.xls'))
    await pg.wait_for_timeout(600)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)

        print('\n=== 1. QUEM LANÇA ITEM VÊ O BOTÃO ===')
        pg, erros = await abrir(nav, 'Logística')
        ck('a Logística vê "Importar do Sisatak"',
           await pg.locator("button:has-text('Importar do Sisatak')").count() == 1)
        pgp, errp = await abrir(nav, 'Portaria')
        ck('a Portaria não vê', await pgp.locator("button:has-text('Importar do Sisatak')").count() == 0)
        await pgp.close()

        print('\n=== 2. A PRÉVIA DIZ O QUE ENTRA E O QUE FICOU FORA ===')
        await previa(pg)
        topo = await pg.inner_text('#modal-sisatak .card-sub')
        ck('diz quantas entram', '3 linha(s) de devolução física' in topo, topo[:120])
        ck('e o que ficou fora, com o motivo',
           '34 de documento DEN' in topo and '5 sem documento' in topo, topo[:200])

        print('\n=== 3. A QUE JÁ ESTÁ NOUTRO CHECKLIST VEM DESMARCADA ===')
        marc = await pg.evaluate("() => [0,1,2].map(k => document.getElementById('sis-'+k+'-ok').checked)")
        ck('as novas marcadas, a repetida não', marc == [True, True, False], str(marc))
        ck('e diz em qual checklist ela está', 'checklist Nº 900777' in await pg.inner_text('#modal-sisatak'))

        print('\n=== 4. SEM CX OU SEM PARCIAL/TOTAL, NADA É GRAVADO ===')
        avisos = await pg.evaluate("""async () => { const a = []; const o = window.notify;
            window.notify = (m) => a.push(String(m));
            try { await confirmarImportacaoSisatakUI(); } finally { window.notify = o; } return a; }""")
        ck('sem CX: não grava', await pg.evaluate("window.__lancadas.length") == 0)
        ck('e o aviso diz a linha', any('CX' in a and 'linha 1' in a for a in avisos), str(avisos)[:120])
        await pg.fill('#sis-0-cx', '4')
        await pg.fill('#sis-1-cx', '2')
        avisos = await pg.evaluate("""async () => { const a = []; const o = window.notify;
            window.notify = (m) => a.push(String(m));
            try { await confirmarImportacaoSisatakUI(); } finally { window.notify = o; } return a; }""")
        ck('sem escolher Parcial/Total: não grava', await pg.evaluate("window.__lancadas.length") == 0)
        ck('e o aviso pede a escolha', any('Parcial ou Total' in a for a in avisos), str(avisos)[:120])

        print('\n=== 5. O QUE ENTRA VAI PELA ROTA DE SEMPRE, COMO VEIO ===')
        await pg.select_option('#sis-0-parcial', 'T')
        await pg.select_option('#sis-1-parcial', 'P')
        await pg.fill('#sis-1-pdesc', '123')
        await pg.evaluate("() => confirmarImportacaoSisatakUI()")
        await pg.wait_for_timeout(300)
        lan = await pg.evaluate("window.__lancadas")
        ck('duas linhas lançadas, no checklist certo', len(lan) == 2 and all(x[0] == 'dev-sis' for x in lan), str(len(lan)))
        if len(lan) == 2:
            a, b = lan[0][1], lan[1][1]
            ck('Nº DEV inteiro', a['numDev'] == '103-001-990001-DEV', a['numDev'])
            ck('motivo como o Sisatak escreveu (não trocado pelo cadastro do painel)',
               a['motivo'] == '05 - TRANSPORTE/FALTA DE MERCADORIA', a['motivo'])
            ck('data do checklist', a['dataItem'] == '2026-09-28', str(a['dataItem']))
            ck('CX digitada', a['cx'] == 4 and b['cx'] == 2, f"{a['cx']} {b['cx']}")
            ck('Total e Parcial como escolhidos, com o Nº parcial',
               a['parcial'] is False and b['parcial'] is True and b['parcialDesc'] == '123', str(b))
        ck('a prévia fecha', not await pg.evaluate("document.getElementById('modal-sisatak').classList.contains('open')"))

        print('\n=== 6. CANCELAR NÃO GRAVA NADA ===')
        await pg.evaluate("window.__lancadas = []")
        await previa(pg)
        await pg.click("#modal-sisatak button:has-text('Cancelar')")
        ck('nada lançado', await pg.evaluate("window.__lancadas.length") == 0)

        ck('nenhum erro de JavaScript', not erros and not errp, '; '.join((erros + errp)[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
