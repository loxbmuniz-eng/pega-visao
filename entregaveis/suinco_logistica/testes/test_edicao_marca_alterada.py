#!/usr/bin/env python3
"""Todo campo editado na tela precisa CHEGAR aos outros setores.

RELATO (14/08/2026, programador de embarque): "estamos com um problema na
sequência de embarque. Tentamos alterá-la para ficar na ordem correta, mas
ela se desconfigura novamente. Já alterei três vezes e ela não se mantém na
torre de controle. É apenas um detalhe, mas faz o relatório ficar todo
desconfigurado."

A CAUSA
`atualizarSequenciaUI` (e `atualizarGanchosUI`) gravavam assim:

    c.sequencia = Number(val);
    SuincoStore.save();

sem tocar em `c.atualizadoEm`. E `sincronizarCargasAlteradas` decide o que
enviar comparando exatamente esse campo com a marca do que já subiu:

    const marca = c.atualizadoEm || c.criadoEm || '';
    if(this._ultimoSync.get(c.id) === marca) return;   // "nada mudou"

Sem carimbo novo, a carga era considerada inalterada e NUNCA subia. A
sequência ficava só naquela tela e voltava ao valor do servidor no
sincronismo seguinte — "alterei três vezes e não se mantém".

INTERAÇÃO COM A CORREÇÃO DA MARCA PERSISTIDA (mesmo dia): antes, a marca
vivia só em memória e um F5 a zerava, então a gravação seguinte reenviava
tudo — e a sequência subia POR ACIDENTE, às vezes. Ao persistir a marca
(que corrigiu perda de dado bem pior), esse acidente sumiu e o defeito
ficou visível toda vez. Um não causou o outro, mas um escondia o outro.

As outras oito funções de edição inline (rota, peso, paletizada, entregas,
motorista, pra-onde, placa, número da carga) já carimbavam corretamente.

    python3 testes/test_edicao_marca_alterada.py
"""
import asyncio
import os
import re
import sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAIL = os.environ.get('SUINCO_EMAIL', 'chefe@teste.local')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def abrir(ctx, rotulo):
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__painel_seq_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_timeout(1000)
    await pg.fill('#login-email', EMAIL)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    return pg


async def main():
    print('\n=== 0. NENHUMA FUNÇÃO DE EDIÇÃO PODE ESQUECER O CARIMBO ===')
    # Checagem de código: pega qualquer função nova que nasça com o mesmo
    # defeito, sem depender de alguém lembrar de escrever um teste de tela.
    app = open('/home/user/pega-visao/entregaveis/suinco_logistica/app.js',
               encoding='utf-8').read()
    sem_carimbo = []
    for m in re.finditer(r'^function (atualizar\w*UI)\(', app, re.MULTILINE):
        nome = m.group(1)
        fim = app.find('\n}', m.end())
        if 'atualizadoEm' not in app[m.end():fim]:
            sem_carimbo.append(nome)
    ck('toda função de edição marca a carga como alterada',
       not sem_carimbo, ', '.join(sem_carimbo))

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        ctxA = await nav.new_context()
        ctxB = await nav.new_context()

        print('\n=== 1. TERMINAL A CRIA A CARGA ===')
        pgA = await abrir(ctxA, 'a')
        num = await pgA.evaluate("""() => {
            const n = 'SEQ' + Date.now().toString().slice(-6);
            criarCargaProgramada({placa: DB.frota[15].placa, numeroCarga:n,
                peso:9000, rota:'500', sequencia:1, qtdGanchos:0, operador:'Ana'});
            SuincoStore.save();
            return n;
        }""")
        await pgA.wait_for_timeout(5000)

        print('\n=== 2. TERMINAL A ARRUMA A SEQUÊNCIA E OS GANCHOS ===')
        # Pelo mesmo caminho da tela: é a função que o onchange chama.
        await pgA.evaluate("""(n) => {
            const c = DB.cargas.find(x=>x.numeroCarga===n);
            atualizarSequenciaUI(c.id, '7');
            atualizarGanchosUI(c.id, '33');
        }""", num)
        await pgA.wait_for_timeout(6000)

        local = await pgA.evaluate("""(n) => {
            const c = DB.cargas.find(x=>x.numeroCarga===n);
            return {seq: c.sequencia, ganchos: c.qtdGanchos};
        }""", num)
        ck('a sequência mudou na tela de quem editou', local['seq'] == 7, str(local))

        print('\n=== 3. OUTRO TERMINAL PRECISA VER A MESMA SEQUÊNCIA ===')
        pgB = await abrir(ctxB, 'b')
        await pgB.wait_for_timeout(4000)
        remoto = await pgB.evaluate("""(n) => {
            const c = DB.cargas.find(x=>x.numeroCarga===n);
            return c ? {seq: c.sequencia, ganchos: c.qtdGanchos} : null;
        }""", num)
        ck('a carga chegou ao terminal B', remoto is not None)
        if remoto:
            ck('a SEQUÊNCIA chegou ao outro terminal', remoto['seq'] == 7,
               f"esperado 7, veio {remoto['seq']!r}")
            ck('os GANCHOS chegaram ao outro terminal', remoto['ganchos'] == 33,
               f"esperado 33, veio {remoto['ganchos']!r}")

        print('\n=== 4. E NÃO PODE VOLTAR SOZINHA DEPOIS ===')
        # É a queixa literal: "alterei três vezes e não se mantém".
        await pgA.wait_for_timeout(8000)
        depois = await pgA.evaluate("""(n) => {
            const c = DB.cargas.find(x=>x.numeroCarga===n);
            return {seq: c.sequencia, ganchos: c.qtdGanchos};
        }""", num)
        ck('a sequência continua 7 depois do sincronismo', depois['seq'] == 7,
           str(depois))

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
