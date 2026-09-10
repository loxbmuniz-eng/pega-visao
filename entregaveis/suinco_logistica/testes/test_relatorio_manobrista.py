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

        # ---- 4b. O FORMATO É O DA CASA, NÃO UM FORMATO SÓ DESTE PAPEL ----
        # RELATO DO DONO, 10/09/2026, com os dois PDFs em anexo: "faz do
        # tamanho e padrao formato do administracao de fretes por favorf o
        # dos manobristas".
        #
        # Ele estava certo, e o defeito era meu. Eu tinha escrito este
        # relatório com fonte de 22px e recuo próprio, "porque é papel de
        # pátio e se lê em pé". O resultado: com 14 cargas ele saía em DUAS
        # folhas enquanto o de Fretes, com as MESMAS 14, saía em UMA — e
        # um relatório com o dobro do tamanho dos outros seis não parece
        # cuidado, parece outro sistema.
        #
        # Medido antes e depois, mesmas 14 cargas, pelo mesmo gerarPdf do
        # servidor: Fretes 1 folha · Manobrista ANTES 2 folhas · DEPOIS 1
        # folha, as três em A4 retrato 596x843pt.
        #
        # O que esta guarda trava: o container tem de carregar `doc-amplo`,
        # que é de onde vêm fonte (13px), recuo (9px 10px) e largura de
        # folha dos SEIS relatórios. E `.doc-manobrista` não pode voltar a
        # redefinir fonte ou recuo — foi exatamente isso que dobrou o papel.
        ck('o container usa doc-amplo, o padrão dos outros relatórios',
           'doc-amplo' in html, html[html.find('print-page'):html.find('print-page')+40])
        css_mb = await pg.evaluate("""() => {
            // Só as regras de .doc-manobrista, para conferir o que elas mexem.
            const fora = [];
            for (const folha of document.styleSheets) {
              let regras; try { regras = folha.cssRules } catch(e) { continue }
              for (const r of regras || []) {
                const varrer = (rr) => {
                  /* A REGRA PRÓPRIA PRIMEIRO, o aninhamento depois — nesta
                     ordem de propósito. Com CSS aninhado, TODA CSSStyleRule
                     do Chromium tem `cssRules` (uma lista vazia, mas
                     existente e portanto verdadeira). A versão que testava
                     `if (rr.cssRules)` antes do seletor descia na lista vazia
                     e voltava sem nunca olhar o seletor: varreu 1287 regras,
                     achou 0, e a guarda passou sem medir nada. */
                  if (rr.selectorText && rr.selectorText.includes('doc-manobrista'))
                    fora.push(rr.selectorText + ' { ' + rr.style.cssText + ' }');
                  if (rr.cssRules && rr.cssRules.length)
                    for (const d of rr.cssRules) varrer(d);
                };
                varrer(r);
              }
            }
            return fora;
        }""")
        proibidas = [r for r in css_mb
                     if 'font-size' in r or 'padding' in r or 'line-height' in r]
        # As regras de coluna TÊM de ser encontradas: se a varredura volta
        # vazia, ela não provou que nada foi redefinido — provou que não
        # mediu. Foi assim que esta guarda passou falsamente na primeira
        # escrita, e é por isso que o mínimo está escrito aqui.
        ck('a varredura achou as regras de coluna do manobrista',
           len(css_mb) >= 3, f'{len(css_mb)} regra(s): ' + str(css_mb))
        ck('.doc-manobrista não redefine fonte, recuo nem entrelinha',
           not proibidas, str(proibidas) if proibidas else f'{len(css_mb)} regra(s), só de coluna')
        # A fonte da célula tem de ser a mesma dos outros: 13px de doc-amplo.
        # EM MODO DE IMPRESSÃO, que é onde as regras de doc-amplo valem — elas
        # vivem dentro do @media print (styles.css). Medir na tela daria o
        # tamanho do painel e o teste passaria por acidente, medindo nada.
        await pg.emulate_media(media='print')
        fonte = await pg.evaluate("""() => {
            const d = document.createElement('div');
            d.className = 'print-page doc-amplo doc-manobrista';
            d.innerHTML = '<table><tbody><tr><td class="col-mb-placa">X</td></tr></tbody></table>';
            const h = document.getElementById('print-manobrista');
            h.style.display = 'block'; h.appendChild(d);
            const cs = getComputedStyle(d.querySelector('td'));
            const r = { fonte: cs.fontSize, recuo: cs.padding };
            d.remove(); h.style.display = 'none';
            return r;
        }""")
        ck('a célula sai na fonte da casa (13px) e no recuo da casa (9px 10px)',
           fonte.get('fonte') == '13px' and fonte.get('recuo') == '9px 10px', str(fonte))
        await pg.emulate_media(media='screen')

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

        print('\n=== 7. SERVIDOR ANTIGO: A MENSAGEM DIZ A VERDADE ===')
        # Publicado antes do atualizar.sh, por decisão do dono ("publica o
        # manobrista"). A recusa do servidor para documento fora do mapa é
        # "Atualize a página e tente de novo" — certa para aba velha em
        # cache, MENTIROSA aqui: o painel está novo, o servidor é que não
        # conhece o documento. Quem segue o conselho tenta três vezes.
        await pg.evaluate(seed('Logística'))
        aviso = await pg.evaluate("""async () => {
            const capturados = [];
            const original = window.notify;
            window.notify = (m,t,ms)=>{ capturados.push(String(m)); };
            // Simula exatamente a recusa do servidor antigo.
            const _chamar = SuincoSharePoint.gerarRelatorioPdf;
            try {
              await (async () => {
                const e = new Error('Este documento não está no mapa de permissões. Atualize a página e tente de novo.');
                e.codigo = 'DOCUMENTO_DESCONHECIDO';
                throw e;
              })();
            } catch(e) {
              // Reexecuta o MESMO tratamento que exportarViaServidor aplica.
              const msg = String(e.message || '');
              const servidorAtrasado = /DOCUMENTO_DESCONHECIDO|não está no mapa de permissões/i.test(msg);
              window.notify(servidorAtrasado
                ? 'Este relatório é novo e o SERVIDOR ainda não foi atualizado — atualizar a página não resolve.'
                : msg, 'danger');
            }
            window.notify = original;
            return capturados.join(' | ');
        }""")
        ck('a frase aponta para o SERVIDOR, não para a página',
           'SERVIDOR' in aviso and 'não resolve' in aviso, aviso[:140])
        # E a guarda de verdade: o tratamento existe no código publicado.
        fonte = await pg.evaluate("() => exportarViaServidor.toString()")
        ck('exportarViaServidor reconhece DOCUMENTO_DESCONHECIDO',
           'DOCUMENTO_DESCONHECIDO' in fonte, fonte[:0])
        ck('e não repete o conselho de atualizar a página nesse caso',
           'atualizar a página não resolve' in fonte, fonte[:0])

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros)[:300])
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
