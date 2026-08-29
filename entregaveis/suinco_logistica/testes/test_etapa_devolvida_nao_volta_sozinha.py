#!/usr/bin/env python3
"""A etapa devolvida pela Administração não volta a andar sem ninguém saber.

O RELATO, do dono, 29/08/2026, palavra por palavra:

    "TO TENTANDO MUDAR O STATUS DE UMA CARGA QUE TA ERRADA EU TENTO COLOCAR
     AGUARDANDO VEICULO AO INVES DE AGUARDANDO EMBARQUE E NAO CONSIGO PPOIS
     FICA VOLTANDO PRA AGUARDANDO EMBARQUE FTZ2138"

O QUE A INVESTIGAÇÃO ACHOU. Não era a correção de etapa: ela grava certo, e
chega nos outros terminais. O que acontece depois é que, ao voltar para
"Aguardando Veículo", a carga REAPARECE NA FILA DA PORTARIA como "não
chegou" — com o botão "Chegou" ativo e NENHUM sinal de que aquilo foi uma
correção deliberada. O porteiro vê um caminhão que ele já deixou entrar
listado como se não tivesse chegado, clica "Chegou", e a carga volta para
"Aguardando Embarque" na hora. Sem confirmação, sem aviso, e sem quem
corrigiu ficar sabendo.

Reprodução que fechou o diagnóstico (dois painéis abertos ao mesmo tempo):

    depois da correção, ADM vê:  Aguardando Veículo
    PORTARIA vê:                 Aguardando Veículo
    aviso de que foi correção:   []            <- nenhum
    porteiro clicou "Chegou":    atualizadas=1, bloqueada=False
    ADM vê agora:                Aguardando Embarque   <- voltou

O QUE ESTE TESTE EXIGE — e por que cada item:

  1. A carga sabe dizer que teve a etapa DEVOLVIDA, com quem e quando. Sem
     isso não há como nenhuma tela avisar coisa nenhuma.
  2. A Portaria VÊ a marca antes de clicar. Aviso que só aparece depois do
     clique chega tarde.
  3. O "Chegou" PERGUNTA antes, e recusando, a carga NÃO anda. É o ponto
     onde o laço se fecha hoje.
  4. Confirmando, a carga ANDA. A Portaria tem autoridade — o caminhão pode
     de fato ter chegado de novo. Botão desabilitado não ensina o caminho,
     só nega.
  5. Quem corrigiu FICA SABENDO quando a carga volta a andar. Foi a falta
     disso que fez o dono tentar de novo achando que não tinha gravado.

    python3 testes/test_etapa_devolvida_nao_volta_sozinha.py
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
    ctx = await nav.new_context()
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__devolvida_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    return ctx, pg


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        ctxA, pgA = await abrir(nav, 'chefe@teste.local', 'adm')
        ctxP, pgP = await abrir(nav, 'bruno@teste.local', 'port')
        erros = []
        pgP.on('pageerror', lambda e: erros.append(str(e)))
        pgA.on('pageerror', lambda e: erros.append(str(e)))

        # A carga nasce, o caminhão chega, e a Administração devolve a etapa.
        carga = await pgA.evaluate("""async () => {
            const usadas = new Set(DB.cargas.map(c => c.placa));
            const f = DB.frota.find(x => x.placa && x.transportadora && !usadas.has(x.placa));
            const c = criarCargaProgramada({placa: f.placa, numeroCarga: 'DEV-1',
              cliente: 'CLIENTE', destino: 'DESTINO', peso: 3000, operador: 'Chefe'});
            SuincoStore.save();
            await SuincoSharePoint.sincronizarAgora();
            for (let i = 0; i < 5; i++) {
              const r = await SuincoSharePoint.mudarStatus(c.id, 'Aguardando Embarque');
              if (r && r.item) break;
              await new Promise(x => setTimeout(x, 600));
            }
            await SuincoSharePoint.corrigirEtapa(c.id, 'Aguardando Veículo',
              'porteiro clicou por engano, caminhao nao chegou');
            await SuincoSharePoint.sincronizarAgora();
            return {id: c.id, placa: f.placa};
        }""")
        await pgA.wait_for_timeout(1500)
        est = await pgA.evaluate("(id) => (getCarga(id) || {}).status", carga['id'])
        ck('a correção gravou (pré-condição do teste)', est == 'Aguardando Veículo', str(est))

        await pgP.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        await pgP.wait_for_timeout(2000)

        print('\n=== 1. A CARGA SABE DIZER QUE TEVE A ETAPA DEVOLVIDA ===')
        marca = await pgP.evaluate("""(id) => {
            if (typeof etapaDevolvida !== 'function') return {semFuncao: true};
            const m = etapaDevolvida(getCarga(id));
            return m ? {quem: m.quem, de: m.de, para: m.para, quando: !!m.quando} : null;
        }""", carga['id'])
        ck('etapaDevolvida() existe e reconhece a devolução',
           bool(marca) and not marca.get('semFuncao'), str(marca))
        if marca and not marca.get('semFuncao'):
            ck('a marca diz de onde para onde voltou',
               marca.get('de') == 'Aguardando Embarque'
               and marca.get('para') == 'Aguardando Veículo', str(marca))
            ck('a marca diz quem devolveu e quando',
               bool(marca.get('quem')) and marca.get('quando') is True, str(marca))

        print('\n=== 2. A PORTARIA VÊ A MARCA ANTES DE CLICAR ===')
        await pgP.click(".nav-tab[data-tab='portaria']")
        await pgP.wait_for_timeout(900)
        texto = await pgP.evaluate("() => document.body.innerText")
        ck('a tela da Portaria avisa que a etapa foi devolvida',
           'devolv' in texto.lower(),
           'marca presente' if 'devolv' in texto.lower()
           else 'nenhuma menção a "devolvida" na tela da Portaria')

        print('\n=== 3. O "CHEGOU" PERGUNTA — E RECUSANDO, A CARGA NÃO ANDA ===')
        perguntas = []
        # UM tratador só, com modo mutável: dois tratadores registrados no
        # mesmo evento brigam pelo diálogo ("already handled").
        modo = {'aceitar': False}

        async def responder(d):
            perguntas.append(d.message)
            if modo['aceitar']:
                await d.accept()
            else:
                await d.dismiss()

        pgP.on('dialog', lambda d: asyncio.ensure_future(responder(d)))
        await pgP.fill('#portaria-placa', carga['placa'])
        await pgP.evaluate("async () => { await acaoChegadaUI(); }")
        await pgP.wait_for_timeout(2500)
        ck('o painel PERGUNTOU antes de registrar a chegada',
           len(perguntas) > 0,
           f'{len(perguntas)} pergunta(s)' if perguntas else 'nenhuma pergunta apareceu')
        if perguntas:
            ck('a pergunta explica que a Administração devolveu a etapa',
               'devolv' in perguntas[0].lower(), perguntas[0][:120])
        depois = await pgP.evaluate("(id) => (getCarga(id) || {}).status", carga['id'])
        ck('recusando, a carga NÃO andou', depois == 'Aguardando Veículo', str(depois))
        await pgA.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        await pgA.wait_for_timeout(1500)
        noServidor = await pgA.evaluate("(id) => (getCarga(id) || {}).status", carga['id'])
        ck('e no servidor também continua em Aguardando Veículo',
           noServidor == 'Aguardando Veículo', str(noServidor))

        print('\n=== 4. CONFIRMANDO, A PORTARIA ANDA (a autoridade dela fica) ===')
        modo['aceitar'] = True
        await pgP.fill('#portaria-placa', carga['placa'])
        await pgP.evaluate("async () => { await acaoChegadaUI(); }")
        await pgP.wait_for_timeout(3000)
        andou = await pgP.evaluate("(id) => (getCarga(id) || {}).status", carga['id'])
        ck('confirmando, a carga anda para Aguardando Embarque',
           andou == 'Aguardando Embarque', str(andou))

        print('\n=== 5. QUEM CORRIGIU FICA SABENDO ===')
        await pgA.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        await pgA.wait_for_timeout(2500)
        aviso = await pgA.evaluate("""() => {
            const t = document.body.innerText;
            return {
              temAviso: /VOLTOU A ANDAR/.test(t),
              trecho: (t.match(/.{0,80}VOLTOU A ANDAR.{0,80}/) || [''])[0]
            };
        }""")
        ck('o painel de quem corrigiu avisa que a carga voltou a andar',
           aviso['temAviso'], aviso['trecho'].strip() or 'nenhum aviso na tela')

        print('\n=== 6. A MARCA NÃO PODE TRAVAR A TELA ===')
        # POR QUE ESTA GUARDA EXISTE (29/08/2026).
        #
        # A primeira versão de `etapaDevolvida` varria DB.movimentacoes
        # INTEIRO a cada chamada — e a marca é desenhada uma vez por linha.
        # Com 300 linhas (o teto do desktop), medido no navegador:
        #
        #      5.000 movimentações →  50 ms
        #     20.000               → 114 ms
        #     50.000               → 252 ms
        #
        # A cada renderAll(), que roda de 15 em 15 segundos. Um quarto de
        # segundo de tela travada, e num celular do pátio bem pior.
        #
        # Não aparecia em nenhum teste porque o banco de teste é pequeno: é
        # o defeito que só cresce em produção até virar "o painel ficou
        # lento" sem ninguém saber por quê. Por isso a medida virou teste.
        #
        # O teto de 60 ms é folgado de propósito — a versão com índice mede
        # uns poucos milissegundos, e máquina de bateria carregada varia. O
        # que ele pega é a volta da varredura por linha, que era 4x isso.
        perf = await pgP.evaluate("""(N) => {
            const cargas = [], movs = [];
            for(let i=0;i<300;i++) cargas.push({id:'perf'+i, placa:'AAA0A0'+(i%10),
              numeroCarga:''+i, status:'Aguardando Veículo'});
            for(let i=0;i<N;i++) movs.push({id:'pm'+i, cargaId:'perf'+(i%300),
              statusAnterior:'Aguardando Veículo', statusNovo:'Aguardando Embarque',
              timestamp:new Date().toISOString(), operador:'X', setor:'Portaria'});
            const guardaC = DB.cargas, guardaM = DB.movimentacoes;
            DB.cargas = cargas; DB.movimentacoes = movs;
            const t0 = performance.now();
            cargas.forEach(c => marcaEtapaDevolvidaHtml(c));
            const ms = performance.now() - t0;
            DB.cargas = guardaC; DB.movimentacoes = guardaM;
            return Math.round(ms);
        }""", 50000)
        ck('300 linhas com 50 mil movimentações desenham rápido',
           perf < 60, f'{perf} ms (teto 60 ms; a versão que varria por linha media ~252 ms)')

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        sys.exit(1)
    print('tudo verde')


asyncio.run(main())
