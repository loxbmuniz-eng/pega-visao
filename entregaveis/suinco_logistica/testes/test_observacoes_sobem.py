#!/usr/bin/env python3
"""A observação da carga precisa CHEGAR ao servidor e voltar para os outros.

INCIDENTE (14/08/2026) — relatado pelo gestor: "verifique o relatório de
observações. A Administração de Fretes não está puxando as observações,
nem de ontem nem de hoje."

CAUSA ENCONTRADA
O relatório estava certo; o dado é que nunca subia. `sincronizarCarga`
(data.js) monta o pacote que vai para o servidor com 20 campos — e
`Observacoes` não era um deles. Do outro lado, o adaptador lê exatamente
`campos.Observacoes` (suinco-api.js), que chegava sempre `undefined` e
virava string vazia.

Resultado: a observação existia só no navegador de quem digitou. Ninguém
mais via, e o relatório saía em branco para todo mundo — inclusive de
ontem, porque nunca houve observação no banco para nenhum dia.

Pior que sumir da tela: a carga é reenviada ao servidor a cada gravação,
sempre com observação vazia, então até quem digitou podia perdê-la quando
a versão do servidor voltasse na sincronização.

É a mesma família do bug do cadastro de Frota (que mandava 3 campos e
apagava capacidade e UF): campo esquecido no pacote de ida, silencioso,
sem erro nenhum na tela.

O que este teste garante, ponta a ponta e contra o servidor de verdade:
a observação digitada por um terminal aparece para OUTRO terminal, que
loga do zero — que é o que o relatório de Fretes consome.

Exige o backend local no ar e o operador de teste
(chefe@teste.local / Administração).

    python3 testes/test_observacoes_sobem.py
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAIL = os.environ.get('SUINCO_EMAIL', 'chefe@teste.local')

OBS = 'Frete negociado R$ 2.480 — cobrar pedágio à parte'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def abrir(nav, rotulo):
    ctx = await nav.new_context()
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__painel_obs_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_timeout(1000)
    await pg.fill('#login-email', EMAIL)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    setor = await pg.evaluate("() => DB.operador && DB.operador.setor")
    return ctx, pg, setor


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)

        print('\n=== 1. UM TERMINAL CRIA A CARGA COM OBSERVAÇÃO ===')
        ctxA, pgA, setorA = await abrir(nav, 'a')
        ck('terminal A logado', bool(setorA), str(setorA))
        num = await pgA.evaluate("""(obs) => {
            const placa = DB.frota[3].placa;
            const n = 'OBS' + Date.now().toString().slice(-6);
            criarCargaProgramada({placa, numeroCarga:n, peso:9000, rota:'500',
                observacoes: obs, operador:'Alysson'});
            SuincoStore.save();
            return n;
        }""", OBS)
        await pgA.wait_for_timeout(6000)
        localA = await pgA.evaluate("""(n) => {
            const c = DB.cargas.find(x=>x.numeroCarga===n);
            return c ? c.observacoes : null;
        }""", num)
        ck('a observação está no terminal que digitou', localA == OBS, str(localA))

        print('\n=== 2. O SERVIDOR GUARDOU A OBSERVAÇÃO ===')
        noServidor = await pgA.evaluate("""async (n) => {
            const t = SuincoSharePoint.SP_CONFIG;
            const r = await fetch(t.api + '/api/cargas', {
                headers: {authorization: 'Bearer ' + (window.__token||'')}
            });
            return {status: r.status};
        }""", num)
        # A leitura autenticada direta é chata daqui; o que vale mesmo é o
        # item 3: outro terminal, sessão nova, vendo o dado que veio do
        # servidor. Se ele passa, a observação subiu.
        print('   (consulta direta:', noServidor, '— a prova real é o item 3)')

        print('\n=== 3. OUTRO TERMINAL, LOGANDO DO ZERO, ENXERGA A OBSERVAÇÃO ===')
        ctxB, pgB, setorB = await abrir(nav, 'b')
        ck('terminal B logado', bool(setorB), str(setorB))
        await pgB.wait_for_timeout(3000)
        localB = await pgB.evaluate("""(n) => {
            const c = DB.cargas.find(x=>x.numeroCarga===n);
            return c ? {achou:true, obs:c.observacoes} : {achou:false};
        }""", num)
        ck('a carga chegou ao terminal B', localB.get('achou'), str(localB))
        ck('a OBSERVAÇÃO chegou junto', localB.get('obs') == OBS,
           repr(localB.get('obs')))

        print('\n=== 4. O RELATÓRIO DE FRETES MOSTRA A OBSERVAÇÃO NO TERMINAL B ===')
        # É o relatório que o gestor abriu. Testa o que ele viu, não só o dado.
        noRelatorio = await pgB.evaluate("""(n) => {
            const linhas = dadosAdministracaoFretes(DB.cargas);
            const l = linhas.find(x => x.numeroCarga === n);
            return l ? l.observacoes : null;
        }""", num)
        ck('a linha do relatório traz a observação', noRelatorio == OBS,
           repr(noRelatorio))

        await ctxA.close()
        await ctxB.close()
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
