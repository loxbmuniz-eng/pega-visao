#!/usr/bin/env python3
"""As três últimas etapas da devolução avançam com o checklist vazio (31/08/2026).

O PEDIDO, do dono, em duas mensagens:

    "a parte da expedicao e da destinacao precisam ter so o campo para dar o
     OK: CHECK e um campo para escrever observacoes, que sairao nos
     relatorios das devolucoes"

    "central de notas tambem só dar o ok check tambem e observacoes"

O QUE ELE QUER DIZER — e este arquivo já errou isto uma vez, com custo.

Quer dizer que dar o OK da etapa não pode DEPENDER de preencher item nenhum:
a Expedição fecha a descarga sem conferir caixa por caixa, os Controles
Internos destinam depois, a Central de Notas encerra sem tique por item. Cada
posto ganhou um campo de observações no cabeçalho, que chega em quem vem
depois e sai no relatório.

NÃO quer dizer que a conferência sai da tela. A primeira versão deste teste
exigia que os campos SUMISSEM. Ele ficou verde, a mudança passou pelo portão
e subiu — e a Bruna abriu um checklist novo e relatou: "sumiu a parte da
expedição, controles internos e central de notas". Sem esses campos ninguém
tem onde conferir quantidade, destinar caixa ou dar o tique, e a falta — que
é o que o checklist existe para apontar — nunca mais é calculada.

O código já dizia isso desde 28/08, no comentário da etapa da Expedição: a
conferência e a destinação "nunca travaram o OK, e tirá-las apagaria a
falta". Ocorrência #23.

O QUE ESTE TESTE EXIGE:

  1. as três etapas avançam com o checklist VAZIO — o pedido inteiro;
  2. a observação de cada uma é gravada e chega em quem vem depois;
  3. os campos de conferência, destinação e nota final CONTINUAM na tela num
     checklist recém-criado, que é o estado em que a Bruna abriu. Campo que
     só aparece depois que o dado existe é campo que nunca recebe dado;
  4. dado já gravado continua aparecendo.

Exige o backend local no ar.

    python3 testes/test_tres_etapas_so_check_e_recado.py
"""
import asyncio
import os
import sys

from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def abrir(nav, email, rotulo):
    ctx = await nav.new_context(viewport={'width': 1400, 'height': 950})
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__socheck_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_timeout(1200)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(2800)
    return ctx, pg


async def criar_checklist(pg, nota):
    await pg.evaluate("() => abrirTab('devolucoes')")
    await pg.wait_for_timeout(1600)
    await pg.fill('#dev-operador-cod', '700001')
    await pg.select_option('#dev-rota', '500')
    await pg.click('button:has-text("➕ Criar checklist")')
    await pg.wait_for_timeout(2200)
    d = await pg.evaluate("() => DEVOLUCOES.length ? DEVOLUCOES[0].id : null")
    if not d:
        return None
    await pg.evaluate("""async (o) => {
          await SuincoSharePoint.devolucoes.criarItem(o.id, {
            nota: o.nota, cx: 10, peso: 500, codProduto: '30110',
            numDev: 'DEV-' + o.nota, motivo: '607' });
          await carregarDevolucoes();
        }""", {'id': d, 'nota': nota})
    return d


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        erros = []
        ctx, pg = await abrir(nav, 'chefe@teste.local', 'adm')
        pg.on('pageerror', lambda e: erros.append(str(e)))

        print('\n=== 1. AS TRÊS ETAPAS AVANÇAM COM O CHECKLIST VAZIO ===')
        did = await criar_checklist(pg, '88001')
        ck('checklist criado', bool(did), str(did))
        if not did:
            await nav.close()
            return 1

        andou = await pg.evaluate("""async (id) => {
              const et = (para, extra) => SuincoSharePoint.devolucoes.etapa(id, { para, ...extra });
              await et('Recebida na Portaria', { placa: 'AAK8958' });
              await et('Conferida no Faturamento', { pesoEntrada: 21500 });
              // AS TRÊS, sem preencher NADA item a item:
              await et('Descarga Conferida', { obsExpedicao: 'descarga ok' });
              await et('Peso Final Registrado', { pesoFinal: 21000 });
              await et('Destinada', { obsControles: 'destinado ok' });
              await et('Nota Finalizada', { obsNotas: 'nota fechada' });
              await carregarDevolucoes();
              const d = DEVOLUCOES.find(x => x.id === id);
              return { status: d && d.status,
                       obsExp: d && d.obsExpedicao,
                       obsCtrl: d && d.obsControles,
                       obsNotas: d && d.obsNotas };
            }""", did)
        ck('as três etapas avançaram sem preencher item nenhum',
           andou['status'] == 'Nota Finalizada', str(andou.get('status')))
        ck('o recado da Expedição foi gravado', andou['obsExp'] == 'descarga ok', str(andou.get('obsExp')))
        ck('o recado dos Controles foi gravado', andou['obsCtrl'] == 'destinado ok', str(andou.get('obsCtrl')))
        ck('o recado da Central de Notas foi gravado', andou['obsNotas'] == 'nota fechada', str(andou.get('obsNotas')))

        print('\n=== 2. OS CAMPOS DE CONFERÊNCIA CONTINUAM NA TELA ===')
        # ESTE BLOCO EXIGIA O CONTRÁRIO, e foi por isso que o defeito passou.
        #
        # Eu li "só o campo para dar o OK: CHECK e observações" como "apague
        # a conferência item a item", escrevi o teste exigindo que os campos
        # sumissem, e o verde carimbou a leitura errada. Subiu, e a Bruna viu
        # na primeira abertura: "sumiu a parte da expedição, controles
        # internos e central de notas".
        #
        # O pedido é sobre o que o OK EXIGE (bloco 1: as etapas avançam com o
        # checklist vazio), não sobre o que a tela OFERECE. Sem estes campos
        # a Expedição não tem onde conferir quantidade, os Controles Internos
        # não têm onde destinar caixa e a Central de Notas não tem onde dar o
        # tique — e a falta, que é o que o checklist existe para apontar,
        # nunca mais é calculada.
        #
        # O checklist aqui está VAZIO de propósito: é o estado em que a
        # Bruna abriu. Se os campos só aparecessem quando já houvesse dado,
        # o dado nunca poderia ser digitado.
        novo = await criar_checklist(pg, '88002')
        await pg.evaluate("() => renderDevolucoes()")
        await pg.wait_for_timeout(1200)
        tela = await pg.evaluate("""(id) => {
            const html = document.getElementById('tab-devolucoes').innerHTML;
            return {
              qtdRecebida: /-qtdRecebida"/.test(html),
              destEstoque: /-destEstoque"/.test(html),
              destDescarte: /-destDescarte"/.test(html),
              destReprocesso: /-destReprocesso"/.test(html),
              notaFinal: /-notaFinal"/.test(html),
              okExpedicao: /-okExpedicao"/.test(html),
              okDestinacao: /-okDestinacao"/.test(html),
            };
        }""", novo)
        ck('a Expedição tem onde registrar a conferência (tique de OK)',
           tela['okExpedicao'], str(tela))
        ck('e o campo de quantidade continua ao lado, para apontar a falta',
           tela['qtdRecebida'], str(tela))
        # ESTA LINHA MUDOU DE PROPÓSITO NO MESMO DIA — e o motivo fica escrito
        # para ninguém depois ler como regressão.
        #
        # De manhã ela exigia as três caixas E/D/R, porque eu tinha apagado a
        # destinação inteira da tela e a Bruna ficou sem onde destinar
        # (ocorrência #23). A exigência estava certa: o posto precisa de um
        # lugar para registrar.
        #
        # À tarde o dono olhou a tela pronta e pediu outra coisa: "precisa que
        # expedição, destinação fica igual da central de nota, só colocar um
        # ok". Não é voltar atrás — é o mesmo requisito com outra forma. O
        # posto continua tendo onde registrar; o registro virou um tique, que
        # é o que serve para quem está no pátio com o caminhão esperando.
        #
        # O que NÃO pode voltar é a tela sem lugar nenhum, e é isso que este
        # bloco guarda. Os detalhes do tique estão em
        # test_ok_expedicao_e_destinacao.py.
        ck('os Controles Internos têm onde registrar a destinação (agora o tique de OK)',
           tela['okDestinacao'], str(tela))
        ck('a Central de Notas tem o tique da nota final',
           tela['notaFinal'], str(tela))

        print('\n=== 3. E O CABEÇALHO DELAS TAMBÉM, NO CHECKLIST VAZIO ===')
        cab = await pg.evaluate("""() => {
            const ths = [...document.querySelectorAll('#tab-devolucoes thead th')]
              .map(t => t.textContent.trim());
            return ths;
        }""")
        for coluna in ('Expedição', 'Destinações', 'Nota final', 'Falta'):
            ck(f'a coluna "{coluna}" está no checklist recém-criado',
               coluna in cab, ' | '.join(cab)[:150])

        print('\n=== 4. DADO VELHO NÃO SOME ===')
        # Um checklist que JÁ tem os três dados gravados continua mostrando.
        antigo = await criar_checklist(pg, '88003')
        gravou = await pg.evaluate("""async (id) => {
              await carregarDevolucoes();
              const d = DEVOLUCOES.find(x => x.id === id);
              const it = d.itens[0];
              await SuincoSharePoint.devolucoes.editarItem(id, it.itemId, {
                qtdRecebida: 8, destEstoque: 5, destDescarte: 3, notaFinal: true });
              await carregarDevolucoes();
              const dep = DEVOLUCOES.find(x => x.id === id).itens[0];
              return { qtd: dep.qtdRecebida, est: dep.destEstoque,
                       desc: dep.destDescarte, nf: dep.notaFinal };
            }""", antigo)
        ck('o dado antigo continua no banco',
           str(gravou['qtd']) == '8' and str(gravou['est']) == '5', str(gravou))

        await pg.evaluate("() => renderDevolucoes()")
        await pg.wait_for_timeout(1000)
        mostra = await pg.evaluate("""(id) => {
            const html = document.getElementById('tab-devolucoes').innerHTML;
            const cab = [...document.querySelectorAll('#tab-devolucoes thead th')]
              .map(t => t.textContent.trim());
            return { temColunaExpedicao: cab.includes('Expedição'),
                     temColunaDest: cab.includes('Destinações'),
                     temColunaNF: cab.includes('Nota final'),
                     mostraOito: />\\s*8\\s*</.test(html) };
        }""", antigo)
        ck('checklist COM o dado ainda mostra a coluna da Expedição',
           mostra['temColunaExpedicao'], str(mostra))
        ck('e a coluna de destinações', mostra['temColunaDest'], str(mostra))
        ck('e a coluna de nota final', mostra['temColunaNF'], str(mostra))

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


sys.exit(asyncio.run(main()))
