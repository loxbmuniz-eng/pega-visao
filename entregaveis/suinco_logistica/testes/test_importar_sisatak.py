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
  4. a prévia NÃO pede CX nem Parcial/Total: isso se preenche depois, no
     checklist (decisão do dono) — a CX zerada vem marcada, e digitá-la
     traz o peso da conta quando o peso está vazio;
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

        print('\n=== 4. A PRÉVIA NÃO PEDE CX NEM PARCIAL/TOTAL — ISSO É DEPOIS ===')
        campos = await pg.evaluate("() => document.querySelectorAll('#modal-sisatak input[id$=\"-cx\"], #modal-sisatak select').length")
        ck('a prévia não tem campo de CX nem de Parcial/Total', campos == 0, str(campos))

        print('\n=== 5. O QUE ENTRA VAI PELA ROTA DE SEMPRE, COMO VEIO ===')
        await pg.evaluate("() => confirmarImportacaoSisatakUI()")
        await pg.wait_for_timeout(300)
        lan = await pg.evaluate("window.__lancadas")
        ck('duas linhas lançadas, no checklist certo', len(lan) == 2 and all(x[0] == 'dev-sis' for x in lan), str(len(lan)))
        if len(lan) == 2:
            a = lan[0][1]
            ck('Nº DEV inteiro', a['numDev'] == '103-001-990001-DEV', a['numDev'])
            ck('motivo como o Sisatak escreveu (não trocado pelo cadastro do painel)',
               a['motivo'] == '05 - TRANSPORTE/FALTA DE MERCADORIA', a['motivo'])
            ck('data do checklist', a['dataItem'] == '2026-09-28', str(a['dataItem']))
            ck('sem CX e sem Parcial/Total — ficam para o checklist',
               'cx' not in a and 'parcial' not in a, str(sorted(a.keys())))
        ck('a prévia fecha', not await pg.evaluate("document.getElementById('modal-sisatak').classList.contains('open')"))

        print('\n=== 5b. NO CHECKLIST: A CX ZERADA APARECE PARA PREENCHER, E TRAZ O PESO ===')
        marcada = await pg.evaluate("""() => {
          const d = DEVOLUCOES[0];
          d.itens = [{ itemId: 7, nota: '900101', parcial: true, parcialDesc: '', supervisor: '', vendedor: '',
            codCliente: '900001', clienteNome: '', cx: 0, peso: null, codProduto: '900501', produtoNome: '',
            numDev: '103-001-990001-DEV', cargaDev: '', dataItem: '2026-09-28', motivo: 'X', qtdRecebida: null,
            falta: null, pesoFaturamento: null, notaFinal: false, okExpedicao: false, okDestinacao: false }];
          DEV_CADASTROS.produtos = [{ codigo: '900501', nome: 'PRODUTO TESTE', pesoCaixaKg: 12.5 }];
          renderListaDevolucoes();
          const cel = document.getElementById('dev-it-7-cx');
          return !!cel && cel.closest('td').classList.contains('dev-preencher');
        }""")
        ck('a CX zerada vem marcada para preencher', marcada)
        editado = await pg.evaluate("""async () => {
          let pedido = null;
          const o = SuincoSharePoint.devolucoes.editarItem;
          SuincoSharePoint.devolucoes.editarItem = async (id, itemId, corpo) => { pedido = corpo; return corpo; };
          try { await editarItemDevolucaoUI('dev-sis', 7, 'cx', '4'); } finally { SuincoSharePoint.devolucoes.editarItem = o; }
          return pedido;
        }""")
        ck('digitar a CX depois grava a CX e o peso da conta (4 × 12,5 = 50)',
           editado and str(editado.get('cx')) == '4' and editado.get('peso') == 50, str(editado))
        manual = await pg.evaluate("""async () => {
          DEVOLUCOES[0].itens[0].peso = 33;
          let pedido = null;
          const o = SuincoSharePoint.devolucoes.editarItem;
          SuincoSharePoint.devolucoes.editarItem = async (id, itemId, corpo) => { pedido = corpo; return corpo; };
          try { await editarItemDevolucaoUI('dev-sis', 7, 'cx', '4'); } finally { SuincoSharePoint.devolucoes.editarItem = o; }
          return pedido;
        }""")
        ck('peso já digitado não é sobrescrito', manual and 'peso' not in manual, str(manual))

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
