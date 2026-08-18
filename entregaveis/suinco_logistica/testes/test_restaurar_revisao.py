#!/usr/bin/env python3
"""O Administrador desfaz um erro em um clique — e mais ninguém.

Bloco B do upgrade (16/08/2026). Na semana de 14–15/08, cinco cargas
sobrescritas por eco de sincronização tiveram que ser restauradas a partir
de um PDF, porque nenhum log guardava os valores antigos completos. Agora:

  - o servidor guarda o estado ANTERIOR de toda mudança real (trigger);
  - a Administração vê a linha do tempo da carga na Torre (botão ↩) e
    restaura uma versão com confirmação;
  - a restauração fica auditada (quem, quando, para qual estado);
  - Logística NÃO vê o botão — restaurar é gestão, não operação.

Exige o backend local no ar e os operadores de teste.

    python3 testes/test_restaurar_revisao.py
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
    url = f'{API}/__painel_rev_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_timeout(1000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    return ctx, pg


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)

        print('\n=== 1. ADMIN CRIA A CARGA E ALGUÉM "ESTRAGA" O PESO ===')
        ctxA, pgA = await abrir(nav, 'chefe@teste.local', 'admin')
        setor = await pgA.evaluate("() => DB.operador && DB.operador.setor")
        ck('admin logado', setor == 'Administração', str(setor))

        num = await pgA.evaluate("""() => {
            const n = 'RV' + Date.now().toString().slice(-6);
            criarCargaProgramada({placa: DB.frota[45].placa, numeroCarga:n,
                peso:21500, rota:'500', qtdEntregas:44, operador:'Chefe'});
            SuincoStore.save();
            return n;
        }""")
        await pgA.wait_for_timeout(5000)
        # O "estrago": peso e rota sobrescritos — o tipo de dano da semana.
        await pgA.evaluate("""(n) => {
            const c = DB.cargas.find(x=>x.numeroCarga===n);
            atualizarPesoUI(c.id, '100');
            atualizarRotaUI && atualizarRotaUI(c.id, '');
        }""", num)
        await pgA.wait_for_timeout(5000)

        print('\n=== 2. O BOTÃO ↩ EXISTE PARA ADMIN E ABRE A LINHA DO TEMPO ===')
        await pgA.evaluate("() => abrirTab('torre')")
        await pgA.wait_for_timeout(500)
        tem_botao = await pgA.evaluate("""(n) => {
            const c = DB.cargas.find(x=>x.numeroCarga===n);
            return !!document.querySelector(`.btn-revisoes[onclick*="${c.id}"]`);
        }""", num)
        ck('botão ↩ na linha da Torre (admin)', tem_botao)

        await pgA.evaluate("""(n) => {
            const c = DB.cargas.find(x=>x.numeroCarga===n);
            abrirRevisoesUI(c.id);
        }""", num)
        await pgA.wait_for_timeout(2500)
        itens = await pgA.evaluate(
            "() => document.querySelectorAll('#revisoes-lista .revisao-item').length")
        ck('a linha do tempo lista revisões vindas do servidor', itens >= 1, f'{itens} itens')
        texto = await pgA.evaluate("() => document.getElementById('revisoes-lista').innerText")
        ck('a revisão mostra o peso ANTES do estrago (21,50 t)', '21,50' in texto,
           texto[:150])

        print('\n=== 3. RESTAURAR VOLTA O DADO — EM TODOS OS APARELHOS ===')
        pgA.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
        # Clica na revisão CERTA — a que mostra 21,50 t. Pode haver mais de
        # uma revisão (ecos de sincronização com mudança real também geram),
        # e a primeira da lista é a mais recente, não necessariamente a boa.
        await pgA.evaluate("""() => {
            const alvo = [...document.querySelectorAll('#revisoes-lista .revisao-item')]
                .find(el => el.innerText.includes('21,50'));
            alvo.querySelector('.btn').click();
        }""")
        await pgA.wait_for_timeout(3000)
        local = await pgA.evaluate("""(n) => {
            const c = DB.cargas.find(x=>x.numeroCarga===n);
            return {peso: c.peso, rota: c.rota};
        }""", num)
        ck('peso restaurado na tela do admin', local['peso'] == 21500, str(local))

        # ana@teste.local: fixture da suíte do backend (sempre recriada) —
        # logistica@teste.local é apagada pelo before() de api.test.js.
        ctxB, pgB = await abrir(nav, 'ana@teste.local', 'log')
        setorB = await pgB.evaluate("() => DB.operador && DB.operador.setor")
        ck('segundo terminal logado', setorB == 'Logística', str(setorB))
        await pgB.wait_for_timeout(5000)
        remoto = await pgB.evaluate("""(n) => {
            const c = DB.cargas.find(x=>x.numeroCarga===n);
            return c ? {peso: c.peso, rota: c.rota} : null;
        }""", num)
        ck('outro terminal recebe a versão restaurada',
           remoto and remoto['peso'] == 21500, str(remoto))

        print('\n=== 4. LOGÍSTICA NÃO VÊ O BOTÃO ===')
        await pgB.evaluate("() => abrirTab('torre')")
        await pgB.wait_for_timeout(500)
        botao_log = await pgB.evaluate(
            "() => document.querySelectorAll('.btn-revisoes').length")
        ck('nenhum botão ↩ para a Logística', botao_log == 0, f'{botao_log} botões')

        await ctxA.close(); await ctxB.close(); await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
