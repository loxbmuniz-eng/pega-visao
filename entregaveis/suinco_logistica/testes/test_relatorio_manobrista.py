#!/usr/bin/env python3
"""O papel do manobrista: placa e ganchos, na ordem da fila (09/09/2026).

PEDIDO DO DONO: "eu quero poder gerar na programacao ou na torre de controle
um relatorio da programacao do dia que traga a placa, numero de ganchos para
o manobrista".

E as respostas dele às quatro perguntas do PROMPT:
  1. quais cargas     → "so as que vao carregar"
  2. quais colunas    → "placa e numero de ganchos"
  3. onde             → "mandar no celular, da pra imprimir tambem, mesmo
                         padrao dos nossos relatorios"
  4. quem gera        → "so a logistica e admisnistracao"

POR QUE ELE EXISTE. O manobrista posiciona o caminhão e prepara o
equipamento. Ganchos não é detalhe de cadastro: 0 é caminhão liso, e um
número é gancheira — são duas preparações físicas diferentes, e descobrir
isso quando o caminhão já está na doca custa a vaga.

O QUE ESTE TESTE TRAVA
  1. só entra carga que AINDA VAI CARREGAR — quem já carregou, faturou ou
     saiu não é trabalho dele;
  2. as duas colunas que ele pediu, e a ORDEM DAS LINHAS é a da fila: sem
     isso a lista não é roteiro, é inventário;
  3. ganchos ZERO aparece como "Liso", não como vazio — zero é instrução, e
     célula vazia ao lado de uma placa é lida como "não sei";
  4. o botão existe nas DUAS telas que ele pediu (Programação e Torre);
  5. só Logística e Administração geram — na tela e no servidor.

    python3 testes/test_relatorio_manobrista.py
"""
import asyncio
import re
import sys
from pathlib import Path
from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
PAINEL = 'file://' + str(RAIZ / 'index.html')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def seed(setor='Logística'):
    return """() => {
  DB.operador = {nome:'Chefe', setor:'%s'};
  DB.frota = []; DB.cargas = []; DB.movimentacoes = [];
  const agora = Date.now(), iso = (t)=>new Date(t).toISOString();
  const st = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
              'Embarque Finalizado','Faturado','Seguiu Viagem'];
  function mk(id, numero, placa, status, seq, ganchos){
    const t0 = agora - 3*3600000;
    DB.frota.push({placa, transportadora:'ALFA', tipoVeiculo:'Truck', uf:'MG',
                   capacidadeKg:14000, atualizadoEm:iso(agora)});
    DB.cargas.push({ id, numeroCarga:numero, placa, transportadora:'ALFA', tipoVeiculo:'Truck',
      motorista:'M', cliente:'C', destino:'D', peso:10000, doca:'1', sequencia:seq,
      observacoes:'', praOnde:'ENTREGA DIRETA', rota:'500', paletizada:'Não',
      qtdGanchos:ganchos, qtdEntregas:1, status, aguardandoCarga:false,
      criadoEm:iso(t0), programadoEm:iso(t0), atualizadoEm:iso(t0), criadoPor:'Logística' });
    const ate = st.indexOf(status);
    for(let j=0;j<=ate;j++){
      DB.movimentacoes.push({id:'mov_'+id+'_'+j, cargaId:id, placa,
        statusAnterior:j?st[j-1]:null, statusNovo:st[j], operador:'Op', setor:'Portaria',
        timestamp:iso(t0 + j*20*60000), numeroCarga:numero});
    }
  }
  // Fora do trabalho do manobrista: já carregando, faturada, saiu.
  mk('c_carregando','CARREGANDO','CAR1A11','Embarque Iniciado',   1, 40);
  mk('c_faturada',  'FATURADA',  'FAT2B22','Faturado',            2, 30);
  mk('c_saiu',      'SAIU',      'SAI3C33','Seguiu Viagem',       3, 20);
  // O trabalho dele — fora de ordem de propósito, para provar que o
  // relatório ordena pela SEQUÊNCIA e não pela ordem de criação.
  mk('c_fila_c',    'FILA-C',    'FIC6F66','Aguardando Veículo',  9, 0);
  mk('c_fila_a',    'FILA-A',    'FIA4D44','Aguardando Veículo',  5, 60);
  mk('c_fila_b',    'FILA-B',    'FIB5E55','Aguardando Embarque', 7, 0);
  document.getElementById('modal-operador')?.classList.remove('open');
  renderAll();
}""" % setor


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(800)
        await pg.evaluate(seed())

        print('\n=== 1. SÓ QUEM AINDA VAI CARREGAR ===')
        ck('a função de dados existe',
           await pg.evaluate("() => typeof dadosManobrista === 'function'"))
        linhas = await pg.evaluate("() => dadosManobrista()")
        numeros = [l['numeroCarga'] for l in (linhas or [])]
        ck('as três da fila entram', set(numeros) == {'FILA-A', 'FILA-B', 'FILA-C'}, str(numeros))
        ck('quem já está carregando NÃO entra', 'CARREGANDO' not in numeros, str(numeros))
        ck('quem faturou NÃO entra', 'FATURADA' not in numeros, str(numeros))
        ck('quem saiu NÃO entra', 'SAIU' not in numeros, str(numeros))

        print('\n=== 2. A ORDEM É A DA FILA — SEM ISSO NÃO É ROTEIRO ===')
        ck('ordenado pela sequência, não pela ordem de criação',
           numeros == ['FILA-A', 'FILA-B', 'FILA-C'],
           f"{numeros} · sequências {[l['sequencia'] for l in linhas]}")

        print('\n=== 3. GANCHOS ZERO É "LISO", NÃO É VAZIO ===')
        # Zero é INSTRUÇÃO: caminhão liso. Célula vazia ao lado de uma placa
        # é lida como "não sei" — e aí o manobrista vai perguntar, que é
        # exatamente o telefonema que este papel existe para evitar.
        por_num = {l['numeroCarga']: l for l in linhas}
        ck('a carga com 60 ganchos traz 60', por_num['FILA-A']['ganchos'] == 60, str(por_num['FILA-A']))
        ck('a carga com 0 ganchos traz 0 — e não null',
           por_num['FILA-B']['ganchos'] == 0, str(por_num['FILA-B']))

        print('\n=== 4. O PDF: AS DUAS COLUNAS, E O LISO ESCRITO ===')
        ck('a função de exportar existe',
           await pg.evaluate("() => typeof exportarPdfManobrista === 'function'"))
        html = await pg.evaluate("""async () => {
            // Captura o HTML do documento sem subir nada ao servidor.
            const original = window.exportarViaServidor;
            let capturado = null;
            window.exportarViaServidor = async (el) => { capturado = el.innerHTML; };
            try { await exportarPdfManobrista(); } finally { window.exportarViaServidor = original; }
            return capturado;
        }""")
        ck('o documento foi montado', bool(html), str(html)[:80])
        html = html or ''
        ck('tem a coluna Placa', re.search(r'<th[^>]*>\s*Placa\s*<', html) is not None)
        ck('tem a coluna Ganchos', re.search(r'<th[^>]*>\s*Ganchos\s*<', html) is not None)
        ck('as três placas da fila estão no papel',
           all(p in html for p in ['FIA4D44', 'FIB5E55', 'FIC6F66']),
           'faltou ' + str([p for p in ['FIA4D44', 'FIB5E55', 'FIC6F66'] if p not in html]))
        ck('e nenhuma placa de quem já carregou',
           not any(p in html for p in ['CAR1A11', 'FAT2B22', 'SAI3C33']),
           'vazou ' + str([p for p in ['CAR1A11', 'FAT2B22', 'SAI3C33'] if p in html]))
        ck('ganchos 0 sai escrito "Liso"', 'Liso' in html, html[:0])
        ck('a placa vem na ordem da fila',
           html.index('FIA4D44') < html.index('FIB5E55') < html.index('FIC6F66'))
        ck('o cabeçalho padrão da casa está lá (título e logo)',
           'doc-cabecalho' in html and 'Manobrista' in html)

        print('\n=== 5. O BOTÃO NAS DUAS TELAS QUE ELE PEDIU ===')
        for tela, aba in [('Programação', 'programacao'), ('Torre de Controle', 'torre')]:
            await pg.evaluate("(a) => abrirTab(a)", aba)
            await pg.wait_for_timeout(350)
            n = await pg.evaluate("""(aba) => document.querySelectorAll(
                '#tab-'+aba+' [onclick*="exportarPdfManobrista"]').length""", aba)
            ck(f'{tela} tem o botão', n >= 1, f'{n} botão(ões)')

        print('\n=== 6. SÓ LOGÍSTICA E ADMINISTRAÇÃO ===')
        for setor in ['Portaria', 'Expedição', 'Faturamento', 'Comercial']:
            await pg.evaluate(seed(setor))
            await pg.evaluate("() => abrirTab('torre')")
            await pg.wait_for_timeout(250)
            visivel = await pg.evaluate("""() => [...document.querySelectorAll(
                '[onclick*=\\"exportarPdfManobrista\\"]')].some(b => b.offsetParent !== null)""")
            ck(f'{setor} não vê o botão', visivel is False, str(visivel))
        for setor in ['Logística', 'Administração']:
            await pg.evaluate(seed(setor))
            await pg.evaluate("() => abrirTab('torre')")
            await pg.wait_for_timeout(250)
            visivel = await pg.evaluate("""() => [...document.querySelectorAll(
                '[onclick*=\\"exportarPdfManobrista\\"]')].some(b => b.offsetParent !== null)""")
            ck(f'{setor} vê o botão', visivel is True, str(visivel))

        # E o servidor recusa, não só a tela: esconder é decoração.
        doc = (RAIZ / 'backend/src/dominio/documentos.js').read_text(encoding='utf-8')
        m = re.search(r"'programacao-manobrista':\s*\[([^\]]*)\]", doc)
        ck('o documento está na allowlist do servidor', bool(m), str(m))
        if m:
            donos = set(re.findall(r"'([^']+)'", m.group(1)))
            # Administração é sempre incluída por podeGerar — não se repete na lista.
            ck('e o dono é só a Logística (Administração entra por podeGerar)',
               donos == {'Logística'}, str(sorted(donos)))

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros)[:300])
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
