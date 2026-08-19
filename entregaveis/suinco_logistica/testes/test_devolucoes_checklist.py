#!/usr/bin/env python3
"""Devoluções — o checklist digital, de ponta a ponta (fase 1, 18/08/2026).

O papel que hoje é impresso na Logística e levado à Portaria vira registro
no servidor. O que se prova aqui, no navegador de verdade contra o backend
local:

  1. A aba existe para Administração/Logística e NÃO existe para a Portaria
     (fase 1 — decisão da reunião: alimentar e auditar antes de abrir).
  2. Produto é cadastrado com código, nome e QUILO por caixa; o lançamento
     usa o quilo para sugerir o peso da linha (5 cx × 3,5 kg = 17,5).
  3. Um checklist junta REGIÃO + VÁRIAS ROTAS (pedido: "tem checklist que
     tem mais de uma rota — utilizar nome da região e código de rota").
  4. Conferência aponta a falta sozinha (5 lançadas, chegou 3 → falta 2) e
     divergência não apaga falta.
  5. As etapas carimbam operador + hora (lacre e nº da carga na Portaria).
  6. Outro terminal vê o checklist e recebe atualização em tempo real.

Exige o backend local no ar (com migrações 010–012) e os operadores de
teste (chefe@, bruno@, logistica@).

    python3 testes/test_devolucoes_checklist.py
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
    ctx = await nav.new_context(accept_downloads=True)
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__painel_dev_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_timeout(1000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    return ctx, pg


async def pg_texto_rotulo(pg):
    return await pg.evaluate(
        "() => (document.querySelector('.dev-card-rota')||{}).innerText || ''")


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)

        print('\n=== 1. A ABA EXISTE PARA ADMIN, E NÃO PARA A PORTARIA ===')
        ctxA, pgA = await abrir(nav, 'chefe@teste.local', 'admin')
        setor = await pgA.evaluate("() => DB.operador && DB.operador.setor")
        ck('admin logado', setor == 'Administração', str(setor))
        aba_visivel = await pgA.evaluate(
            "() => !document.querySelector('.nav-tab[data-tab=\\'devolucoes\\']').hidden")
        ck('aba Devoluções visível para Administração', aba_visivel)

        # Fase 2 (18/08): os setores do CICLO veem a aba — Portaria inclusive.
        # Quem fica de fora é quem não participa do ciclo (Comercial).
        ctxP, pgP = await abrir(nav, 'bruno@teste.local', 'portaria')
        aba_portaria = await pgP.evaluate(
            "() => document.querySelector('.nav-tab[data-tab=\\'devolucoes\\']').hidden")
        ck('aba Devoluções VISÍVEL para a Portaria (fase 2)', not aba_portaria)
        await ctxP.close()
        ctxC, pgC = await abrir(nav, 'comercial@teste.local', 'com')
        aba_com = await pgC.evaluate(
            "() => document.querySelector('.nav-tab[data-tab=\\'devolucoes\\']').hidden")
        ck('aba Devoluções escondida do Comercial (fora do ciclo)', aba_com)
        await ctxC.close()

        print('\n=== 2. PRODUTO COM CÓDIGO, NOME E QUILO ===')
        await pgA.evaluate("() => abrirTab('cadastros')")
        await pgA.wait_for_timeout(500)
        await pgA.fill('#cad-dev-prod-codigo', '30110')
        await pgA.fill('#cad-dev-prod-nome', 'LINGUIÇA')
        await pgA.fill('#cad-dev-prod-kg', '3.5')
        await pgA.click('#card-cad-devolucoes button:has-text("Produto")')
        await pgA.wait_for_timeout(1500)
        await pgA.fill('#cad-dev-supervisor', 'MAKSON')
        await pgA.click('#card-cad-devolucoes button:has-text("Supervisor")')
        await pgA.fill('#cad-dev-motivo', 'DATA PROXIMA')
        await pgA.click('#card-cad-devolucoes button:has-text("Motivo")')
        await pgA.wait_for_timeout(1500)
        cad = await pgA.evaluate("() => SuincoSharePoint.devolucoes.cadastros()")
        ck('produto no servidor com quilo', any(
            x['codigo'] == '30110' and x.get('pesoCaixaKg') == 3.5 for x in cad['produtos']),
            str(cad['produtos'][:3]))

        print('\n=== 3. CHECKLIST COM REGIÃO + DUAS ROTAS ===')
        await pgA.evaluate("() => abrirTab('devolucoes')")
        await pgA.wait_for_timeout(1500)
        # 19/08: o formulário ficou com data, rotas e código do operador. A
        # rotas e código do operador. A REGIÃO vem do nome da rota no
        # cadastro; transportadora, NT, placa e motorista são da Portaria.
        enxuto = await pgA.evaluate(
            "() => !document.getElementById('dev-placa')"
            " && !document.getElementById('dev-regiao')"
            " && !document.getElementById('dev-transportadora')"
            " && !document.getElementById('dev-nota-transf')")
        ck('lançamento sem os campos dos outros postos', enxuto)
        await pgA.fill('#dev-operador-cod', '102345')
        await pgA.select_option('#dev-rota', '500')
        await pgA.click('button:has-text("➕ Rota")')
        # A segunda rota fica SÓ no seletor — esquecer o clique no ➕ não
        # pode custar a rota (o criar inclui a selecionada).
        await pgA.select_option('#dev-rota', '501')
        await pgA.click('button:has-text("➕ Criar checklist")')
        await pgA.wait_for_timeout(2500)
        d0 = await pgA.evaluate("""() => DEVOLUCOES.length ? {
            id: DEVOLUCOES[0].id, numero: DEVOLUCOES[0].numero,
            rotas: DEVOLUCOES[0].rotas, regiao: DEVOLUCOES[0].regiao,
            operadorCodigo: DEVOLUCOES[0].operadorCodigo,
            criadaPor: DEVOLUCOES[0].criadaPor, status: DEVOLUCOES[0].status } : null""")
        ck('cód. do operador (monitoramento) gravado no lançamento',
           d0 and d0['operadorCodigo'] == '102345', str(d0 and d0['operadorCodigo']))
        ck('checklist criado com número gerado', bool(d0 and d0['numero'] >= 1), str(d0))
        ck('as DUAS rotas ficaram no checklist',
           d0 and sorted(d0['rotas']) == ['500', '501'], str(d0 and d0['rotas']))
        # A região é o NOME da rota no cadastro (500 = Patos de Minas), não
        # mais um campo digitado.
        ck('região veio do cadastro da rota',
           d0 and d0['regiao'] == 'Patos de Minas', str(d0 and d0['regiao']))
        ck('autoria discriminada', d0 and d0['criadaPor'] == 'Chefe', str(d0 and d0['criadaPor']))
        dev_id = d0['id']

        rotulo_card = await pgA.evaluate(
            "() => document.querySelector('.dev-card-rota').innerText")
        ck('o cartão identifica por REGIÃO + rotas', 'Patos de Minas' in rotulo_card
           and '500' in rotulo_card and '501' in rotulo_card, rotulo_card)

        print('\n=== 4. ITEM COM PESO SUGERIDO PELO QUILO ===')
        await pgA.fill(f'#dev-ni-{dev_id}-nota', '170664')
        await pgA.fill(f'#dev-ni-{dev_id}-cx', '5')
        await pgA.fill(f'#dev-ni-{dev_id}-produto', '30110')
        await pgA.fill(f'#dev-ni-{dev_id}-motivo', 'DATA PROXIMA')
        await pgA.click(f'.dev-linha-nova button')
        await pgA.wait_for_timeout(2000)
        item = await pgA.evaluate("""(id) => {
            const d = DEVOLUCOES.find(x=>x.id===id);
            return d && d.itens.length ? d.itens[0] : null;
        }""", dev_id)
        ck('item entrou no checklist', bool(item), str(item))
        ck('peso sugerido = 5 cx × 3,5 kg = 17,5', item and item['peso'] == 17.5,
           str(item and item['peso']))
        ck('produto ganhou o nome do cadastro', item and item['produtoNome'] == 'LINGUIÇA')

        print('\n=== 5. CONFERÊNCIA APONTA FALTA; DIVERGÊNCIA NÃO APAGA ===')
        await pgA.evaluate("""(a) => {
            editarItemDevolucaoUI(a.id, a.itemId, 'qtdRecebida', '3');
        }""", {'id': dev_id, 'itemId': item['itemId']})
        await pgA.wait_for_timeout(2000)
        falta = await pgA.evaluate("""(id) => {
            const d = DEVOLUCOES.find(x=>x.id===id);
            return d.itens[0].falta;
        }""", dev_id)
        ck('falta calculada = 2', falta == 2, str(falta))
        chip = await pgA.evaluate(
            "() => (document.querySelector('.dev-falta-chip')||{}).innerText || ''")
        ck('a tela mostra a falta em destaque', 'falta 2' in chip, chip)

        await pgA.fill(f'#dev-dv-{dev_id}-produto', '30063')
        await pgA.fill(f'#dev-dv-{dev_id}-cx', '1')
        await pgA.click('button:has-text("Lançar divergente")')
        await pgA.wait_for_timeout(2000)
        pos = await pgA.evaluate("""(id) => {
            const d = DEVOLUCOES.find(x=>x.id===id);
            return { divergencias: d.divergencias.length, falta: d.itens[0].falta };
        }""", dev_id)
        ck('divergente lançado', pos['divergencias'] == 1, str(pos))
        ck('a falta CONTINUA depois do divergente', pos['falta'] == 2, str(pos))

        print('\n=== 6. ETAPAS CARIMBAM (PORTARIA IMPUTA PLACA E MOTORISTA) ===')
        # Alinhamento de 18/08 (corrigido pelo usuário): os inputs da
        # Portaria são placa + motorista + LACRE. Nº da carga fica no
        # cabeçalho editável da Logística.
        # A placa é da Portaria — e puxa a Frota: digitou, transportadora e
        # motorista preenchem sozinhos (continuam editáveis).
        placa_frota = await pgA.evaluate("() => DB.frota[0].placa")
        await pgA.fill(f'#dev-et-{dev_id}-placa', placa_frota)
        # O preenchimento pela Frota dispara ao SAIR do campo (change).
        await pgA.dispatch_event(f'#dev-et-{dev_id}-placa', 'change')
        await pgA.wait_for_timeout(400)
        transp_auto = await pgA.evaluate(
            f"() => document.getElementById('dev-et-{dev_id}-transportadora').value")
        ck('placa da Portaria puxa a transportadora da Frota', bool(transp_auto),
           repr(transp_auto[:50]))
        await pgA.fill(f'#dev-et-{dev_id}-motorista', 'Lucas Motorista')
        await pgA.fill(f'#dev-et-{dev_id}-lacre1', '133476')
        await pgA.click('button:has-text("Receber na Portaria")')
        await pgA.wait_for_timeout(2000)
        await pgA.evaluate("""(id) => {
            editarDevolucaoCampoUI(id, 'cargaNumero', '2484');
        }""", dev_id)
        await pgA.wait_for_timeout(2000)
        et = await pgA.evaluate("""(id) => {
            const d = DEVOLUCOES.find(x=>x.id===id);
            return { status: d.status, motorista: d.motorista,
                     lacre1: d.lacre1, carga: d.cargaNumero,
                     carimbo: d.carimbos.portaria };
        }""", dev_id)
        ck('status avançou para Recebida na Portaria', et['status'] == 'Recebida na Portaria', str(et))
        ck('motorista imputado pela Portaria', et['motorista'] == 'Lucas Motorista', str(et['motorista']))
        ck('lacre e nº da carga pelo cabeçalho editável',
           et['lacre1'] == '133476' and et['carga'] == '2484', str(et))
        ck('carimbo com operador', et['carimbo'] and et['carimbo']['por'] == 'Chefe', str(et['carimbo']))

        # Observação da Bruna: o porteiro escrevia carga+placa num papel
        # para o motorista levar à balança. Agora o papel sai impresso.
        # Lê o rótulo do NOSSO cartão (o aberto) — a lista pode ter
        # checklists residuais de outras suítes na frente.
        rotulo = await pgA.evaluate(
            "() => (document.querySelector('.dev-card.dev-aberta .dev-card-rota')||{}).innerText || ''")
        ck('identificação Região — Rota / iniciais do operador',
           rotulo.endswith('/ C'), rotulo)
        botao_comp = await pgA.locator('button:has-text("Comprovante do motorista")').count()
        ck('comprovante do motorista disponível após o recebimento', botao_comp == 1,
           f'{botao_comp} botão(ões)')
        try:
            async with pgA.expect_download(timeout=60000) as dl:
                await pgA.click('button:has-text("Comprovante do motorista")')
            arquivo = (await dl.value).suggested_filename
            ck('comprovante sai como PDF', arquivo.endswith('.pdf')
               and 'Comprovante' in arquivo, arquivo)
        except Exception as e:
            ck('comprovante sai como PDF', False, str(e)[:120])

        print('\n=== 7. OUTRO TERMINAL VÊ, EM TEMPO REAL ===')
        # ana@teste.local: fixture da suíte do backend (sempre recriada) —
        # logistica@teste.local é apagada pelo before() de api.test.js.
        ctxB, pgB = await abrir(nav, 'ana@teste.local', 'log')
        await pgB.evaluate("() => abrirTab('devolucoes')")
        await pgB.wait_for_timeout(2500)
        remoto = await pgB.evaluate("""(id) => {
            const d = DEVOLUCOES.find(x=>x.id===id);
            return d ? { falta: d.itens[0].falta, transp: d.transportadora } : null;
        }""", dev_id)
        ck('a Logística vê o checklist com a falta', remoto and remoto['falta'] == 2, str(remoto))

        # Admin muda a transportadora; o terminal da Logística recebe pelo
        # socket sem F5 — a mesma promessa de tempo real das cargas.
        await pgA.evaluate("""(id) => editarDevolucaoCampoUI(id, 'transportadora', 'MUDOU-AO-VIVO')""", dev_id)
        await pgB.wait_for_timeout(4000)
        vivo = await pgB.evaluate("""(id) => {
            const d = DEVOLUCOES.find(x=>x.id===id);
            return d && d.transportadora;
        }""", dev_id)
        ck('atualização chegou ao outro terminal sem F5', vivo == 'MUDOU-AO-VIVO', str(vivo))

        print('\n=== 7b. A FILA "SUA VEZ" PASSA O BASTÃO ENTRE OS SETORES ===')
        # Novo checklist em "Lançada": a Portaria abre a aba, vê a esteira,
        # o aviso "é a sua vez" e o botão da ação dela — sem formulário de
        # criação (que é da Logística). Ao receber, o checklist entra na
        # fila do Faturamento.
        novo = await pgA.evaluate("""async () => {
            const d = await SuincoSharePoint.devolucoes.criar({
                dataDev: new Date().toLocaleDateString('sv'), rotas: ['500'],
                regiao: 'BH', itens: []});
            return d.id;
        }""")
        ctxP2, pgP2 = await abrir(nav, 'bruno@teste.local', 'p2')
        await pgP2.evaluate("() => abrirTab('devolucoes')")
        await pgP2.wait_for_timeout(2500)
        fila = await pgP2.evaluate("""(id) => ({
            criarOculto: document.getElementById('dev-card-novo').hidden,
            aviso: !document.getElementById('dev-sua-vez-aviso').hidden,
            chip: !!document.querySelector('.dev-chip-suavez'),
            pipeline: document.querySelectorAll('#dev-pipeline .stat-box').length,
        })""", novo)
        ck('Portaria não vê o formulário de criação', fila['criarOculto'])
        ck('aviso "é a sua vez" aparece para a Portaria', fila['aviso'])
        ck('checklist marcado com SUA VEZ', fila['chip'])
        ck('esteira com as 6 etapas', fila['pipeline'] == 6, str(fila['pipeline']))

        await pgP2.evaluate("(id) => { _devExpandida = id; renderListaDevolucoes(); }", novo)
        await pgP2.wait_for_timeout(400)
        await pgP2.fill(f'#dev-et-{novo}-placa', 'GFR8A80')
        await pgP2.fill(f'#dev-et-{novo}-motorista', 'Lucas')
        await pgP2.click(f'button:has-text("Receber na Portaria")')
        await pgP2.wait_for_timeout(2500)
        depois = await pgP2.evaluate("""(id) => {
            const d = DEVOLUCOES.find(x=>x.id===id);
            // Olha ESTE checklist (a lista pode ter outros em Lançada,
            // legitimamente ainda na fila da Portaria).
            return { status: d.status, minhaVez: ehMinhaVezDev(d) };
        }""", novo)
        ck('Portaria recebeu pela própria fila', depois['status'] == 'Recebida na Portaria', str(depois))
        ck('ESTE checklist saiu da fila da Portaria após a ação', not depois['minhaVez'])

        ctxF, pgF = await abrir(nav, 'diego@teste.local', 'fat')
        await pgF.evaluate("() => abrirTab('devolucoes')")
        await pgF.wait_for_timeout(2500)
        fat = await pgF.evaluate("""(id) => {
            const d = DEVOLUCOES.find(x=>x.id===id);
            return { minhaVez: d && typeof ehMinhaVezDev === 'function' && ehMinhaVezDev(d),
                     aviso: !document.getElementById('dev-sua-vez-aviso').hidden };
        }""", novo)
        ck('o checklist entrou na fila do FATURAMENTO', fat['minhaVez'], str(fat))
        ck('o Faturamento vê o próprio aviso de fila', fat['aviso'])
        await pgA.evaluate("(id) => SuincoSharePoint.devolucoes.excluir(id)", novo)
        await ctxP2.close(); await ctxF.close()

        print('\n=== 8. TIRAR UMA ROTA PELOS CHIPS ===')
        await pgA.evaluate("""(id) => tirarRotaDevolucaoUI(id, '501')""", dev_id)
        await pgA.wait_for_timeout(2000)
        rotas_fim = await pgA.evaluate(
            "(id) => DEVOLUCOES.find(x=>x.id===id).rotas", dev_id)
        ck('rota tirada — sobrou só a 500', rotas_fim == ['500'], str(rotas_fim))

        # Limpeza: o checklist de teste não fica para a operação ver.
        await pgA.evaluate("""(id) => SuincoSharePoint.devolucoes.excluir(id)""", dev_id)

        await ctxA.close(); await ctxB.close(); await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
