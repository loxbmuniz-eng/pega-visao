#!/usr/bin/env python3
"""A esteira da devolução com as DUAS balanças (27/08/2026).

O FLUXO REAL, contado pelo dono:

    "caminhão chega com devoluções, pesa na balança, vai pra expedição
     descarrega, depois volta pra balança pra pesar vazio (...) faturamento
     colocar o peso final depois que descarregou, porque depois que
     descarrega o motorista volta pra balança e pesa o peso final com o
     caminhão vazio (...) de lá vai pra controles internos e central de
     notas, que precisa só de um campo para só o CHECK do checklist pra
     confirmar a etapa, e observações para que eles possam comunicar com a
     próxima etapa"

O QUE ESTAVA ERRADO. A esteira tinha o Faturamento numa etapa só, ANTES da
Expedição, e um campo de peso só — chamado "peso final" e preenchido na
CHEGADA. Era o número do caminhão cheio gravado no campo do caminhão vazio,
e a segunda pesagem simplesmente não existia. Sem as duas pontas não há
conta: ninguém conseguia dizer quanto desceu do caminhão, nem comparar com
o que foi lançado no checklist.

O QUE ESTE TESTE EXIGE, na ordem do pátio:

  1. sete etapas, com a balança de saída ENTRE Expedição e Controles;
  2. a etapa da chegada pede o peso do caminhão CHEIO;
  3. a etapa nova pede o peso do caminhão VAZIO e mostra o devolvido
     enquanto se digita;
  4. o devolvido é a diferença, e o painel diz se bate com o lançado;
  5. Controles Internos e Central de Notas: só o check e o recado —
     nada de "Gerou RDC?" na tela;
  6. o recado de cada uma chega em quem vem depois.

Exige o backend local no ar, com a migração 038.

    python3 testes/test_esteira_devolucao_duas_balancas.py
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
    url = f'{API}/__esteira_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_timeout(1200)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(2800)
    return ctx, pg


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        erros = []
        ctx, pg = await abrir(nav, 'chefe@teste.local', 'adm')
        pg.on('pageerror', lambda e: erros.append(str(e)))

        print('\n=== 1. A ESTEIRA TEM AS DUAS BALANÇAS, NA ORDEM DO PÁTIO ===')
        ordem = await pg.evaluate("() => DEV_ETAPAS.map(e => e.status)")
        esperado = ['Lançada', 'Recebida na Portaria', 'Conferida no Faturamento',
                    'Descarga Conferida', 'Peso Final Registrado', 'Destinada']
        ck('as etapas estão na ordem certa', ordem == esperado, str(ordem))
        idx = {s: i for i, s in enumerate(ordem)}
        ck('a balança de saída fica DEPOIS da Expedição e ANTES dos Controles',
           idx['Descarga Conferida'] < idx['Peso Final Registrado'] < idx['Destinada'],
           str(idx))
        donos = await pg.evaluate(
            "() => Object.fromEntries(DEV_ETAPAS.map(e => [e.status, e.setores[0]]))")
        ck('as duas balanças são do Faturamento',
           donos['Recebida na Portaria'] == 'Faturamento'
           and donos['Descarga Conferida'] == 'Faturamento', str(donos))

        print('\n=== 2. O CAMINHÃO ANDA: CHEGA, PESA, DESCARREGA, PESA VAZIO ===')
        await pg.evaluate("() => abrirTab('devolucoes')")
        await pg.wait_for_timeout(1800)
        await pg.fill('#dev-operador-cod', '700001')
        await pg.select_option('#dev-rota', '500')
        await pg.click('button:has-text("➕ Criar checklist")')
        await pg.wait_for_timeout(2500)
        d = await pg.evaluate(
            "() => DEVOLUCOES.length ? { id: DEVOLUCOES[0].id } : null")
        ck('checklist criado', bool(d), str(d))
        if not d:
            await nav.close()
            return 1
        did = d['id']

        # Um item lançado, para haver com o que comparar a balança.
        r = await pg.evaluate("""async (id) => {
              await SuincoSharePoint.devolucoes.criarItem(id, {
                nota: '55001', cx: 10, peso: 7200, codProduto: '30110',
                numDev: 'DEV-7200', motivo: '607' });
              await carregarDevolucoes();
              const d = DEVOLUCOES.find(x => x.id === id);
              return { itens: d.itens.length, peso: d.itens[0] && d.itens[0].peso };
            }""", did)
        ck('um item de 7.200 kg lançado no checklist',
           r['itens'] == 1 and float(r['peso']) == 7200, str(r))

        passos = await pg.evaluate("""async (id) => {
              const et = (para, extra) => SuincoSharePoint.devolucoes.etapa(id, { para, ...extra });
              await et('Recebida na Portaria', { placa: 'AAK8958' });
              await et('Conferida no Faturamento', { pesoEntrada: 21500 });
              await et('Descarga Conferida', {});
              await carregarDevolucoes();
              const d = DEVOLUCOES.find(x => x.id === id);
              return { status: d.status, entrada: d.pesoEntrada, final: d.pesoFinal,
                       devolvido: d.pesoDevolvido };
            }""", did)
        ck('depois da descarga o checklist para na balança de saída',
           passos['status'] == 'Descarga Conferida', str(passos['status']))
        ck('o peso da CHEGADA ficou gravado', float(passos['entrada']) == 21500,
           str(passos['entrada']))
        ck('e o peso final ainda não existe — o caminhão nem voltou à balança',
           passos['final'] is None and passos['devolvido'] is None, str(passos))

        print('\n=== 3. A TELA PEDE O PESO DO CAMINHÃO VAZIO, E FAZ A CONTA ===')
        tela = await pg.evaluate("""(id) => {
              _devExpandida = id; renderListaDevolucoes();
              const campo = document.getElementById('dev-et-' + id + '-pesofinal');
              const conta = document.getElementById('dev-et-' + id + '-conta');
              return { temCampo: !!campo,
                       dica: campo ? campo.placeholder : null,
                       conta: conta ? conta.textContent : null };
            }""", did)
        ck('existe o campo do peso do caminhão vazio', tela['temCampo'] is True, str(tela))
        ck('e ele diz que é o caminhão VAZIO',
           'VAZIO' in (tela['dica'] or ''), str(tela['dica']))

        vivo = await pg.evaluate("""(id) => {
              const campo = document.getElementById('dev-et-' + id + '-pesofinal');
              campo.value = '14300';
              campo.dispatchEvent(new Event('input', { bubbles: true }));
              return (document.getElementById('dev-et-' + id + '-conta') || {}).textContent;
            }""", did)
        ck('a conta aparece enquanto se digita, sem precisar assinar',
           '7.200' in (vivo or ''), str(vivo))
        ck('e ela diz que BATE com o que foi lançado no checklist',
           'bate com o lançado' in (vivo or ''), str(vivo))

        errado = await pg.evaluate("""(id) => {
              const campo = document.getElementById('dev-et-' + id + '-pesofinal');
              campo.value = '9000';
              campo.dispatchEvent(new Event('input', { bubbles: true }));
              return (document.getElementById('dev-et-' + id + '-conta') || {}).textContent;
            }""", did)
        ck('peso torto é denunciado na hora, não no fim do mês',
           'não bate com o lançado' in (errado or ''), str(errado))

        print('\n=== 4. A ASSINATURA DA SEGUNDA BALANÇA ===')
        fim = await pg.evaluate("""async (id) => {
              await SuincoSharePoint.devolucoes.etapa(id, {
                para: 'Peso Final Registrado', pesoFinal: 14300 });
              await carregarDevolucoes();
              const d = DEVOLUCOES.find(x => x.id === id);
              return { status: d.status, final: d.pesoFinal, devolvido: d.pesoDevolvido,
                       carimboEntrada: !!d.carimbos.faturamento,
                       carimboSaida: !!d.carimbos.pesofinal };
            }""", did)
        ck('o peso final ficou gravado', float(fim['final']) == 14300, str(fim['final']))
        ck('o devolvido é a diferença, calculada pelo servidor',
           float(fim['devolvido']) == 7200, str(fim['devolvido']))
        ck('cada balança tem a SUA assinatura',
           fim['carimboEntrada'] and fim['carimboSaida'], str(fim))

        print('\n=== 5. CONTROLES INTERNOS E CENTRAL DE NOTAS: CHECK + RECADO ===')
        ci = await pg.evaluate("""async (id) => {
              await SuincoSharePoint.devolucoes.etapa(id, {
                para: 'Destinada', obsControles: 'Separado: 2 cx descarte' });
              await carregarDevolucoes();
              _devExpandida = id; renderListaDevolucoes();
              const acao = document.querySelector('.dev-card.dev-aberta .dev-etapa-acao');
              const d = DEVOLUCOES.find(x => x.id === id);
              return { obs: d.obsControles, status: d.status,
                       html: acao ? acao.innerHTML : '' };
            }""", did)
        ck('o recado dos Controles Internos ficou gravado',
           ci['obs'] == 'Separado: 2 cx descarte', str(ci['obs']))
        ck('a etapa da Central de Notas oferece o recado dela',
           f'dev-et-{did}-obs' in ci['html'], ci['html'][:90])
        ck('e não pergunta mais "Gerou RDC?" — saiu da tela a pedido do dono',
           'Gerou RDC' not in ci['html'], ci['html'][:90])

        cn = await pg.evaluate("""async (id) => {
              await SuincoSharePoint.devolucoes.etapa(id, {
                para: 'Nota Finalizada', obsNotas: 'NF 998877 emitida' });
              await carregarDevolucoes();
              const d = DEVOLUCOES.find(x => x.id === id);
              return { status: d.status, obsNotas: d.obsNotas };
            }""", did)
        ck('o ciclo fecha na Central de Notas',
           cn['status'] == 'Nota Finalizada', str(cn['status']))
        ck('com o recado dela guardado', cn['obsNotas'] == 'NF 998877 emitida',
           str(cn['obsNotas']))

        print('\n=== 6. O FATURAMENTO ENXERGA AS DUAS FILAS ===')
        # Antes de 27/08 o painel procurava UMA etapa por setor: a segunda
        # balança nunca chamava ninguém, e o checklist parava ali calado.
        filas = await pg.evaluate("""() => {
              DB.operador.setor = 'Faturamento';
              return minhasEtapasDev().map(e => e.status);
            }""")
        ck('as duas etapas do Faturamento contam como "sua vez"',
           sorted(filas) == ['Descarga Conferida', 'Recebida na Portaria'], str(filas))

        print('\n=== 7. SEM ERRO DE JAVASCRIPT ===')
        ck('console limpo', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print(f'    · {f}')
        return 1
    print('  Tudo verde.')
    return 0


sys.exit(asyncio.run(main()))
