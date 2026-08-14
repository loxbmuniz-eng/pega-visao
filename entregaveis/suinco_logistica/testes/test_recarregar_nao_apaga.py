#!/usr/bin/env python3
"""Recarregar o painel não pode desfazer o que outro setor gravou.

INCIDENTE (14/08/2026) — a raiz de três reclamações seguidas do gestor:
observação sumindo do relatório de Fretes, e a data de programação voltando
para a data de chegada mesmo depois do servidor atualizado. Tratei os dois
como bugs separados; eram o mesmo.

A CAUSA
`SuincoStore._ultimoSync` guarda "esta versão da carga já subiu ao
servidor" — e era só um Map em MEMÓRIA. A cada recarregamento da página ele
nascia vazio. Aí a primeira gravação chamava `sincronizarCargasAlteradas`,
que não reconhecia nada como já enviado e reenviava TODAS as cargas do
cache local, com os valores daquele navegador.

Como o painel reenvia a carga INTEIRA (não só o campo mexido), um terminal
que estava apenas com a tela aberta sobrescrevia o que outro setor tinha
acabado de gravar. Ninguém editou nada — o dado sumia sozinho.

Ficou visível no banco de produção: 109 cargas com `atualizado_em` nos
MESMOS dois instantes, minutos depois de o serviço reiniciar e os painéis
recarregarem. E a auto-atualização publicada no mesmo dia (que recarrega a
aba sozinha) transformou isso de raro em rotina.

O que este teste prova, com dois navegadores de verdade contra o servidor:
o terminal B recarrega, grava qualquer coisa, e o que o terminal A escreveu
CONTINUA lá.

Exige o backend local no ar e o operador de teste.

    python3 testes/test_recarregar_nao_apaga.py
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAIL = os.environ.get('SUINCO_EMAIL', 'chefe@teste.local')

OBS = 'Frete R$ 3.150 — negociado, cobrar pedagio'
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
    url = f'{API}/__painel_rec_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_timeout(1000)
    ja = await pg.evaluate("() => !!(DB.operador && DB.operador.setor)")
    if not ja:
        await pg.fill('#login-email', EMAIL)
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3000)
    return pg, url


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)

        # Dois contextos = dois navegadores de verdade, cada um com seu cache.
        ctxA = await nav.new_context()
        ctxB = await nav.new_context()

        print('\n=== 1. TERMINAL A CRIA A CARGA (sem observação) ===')
        pgA, _ = await abrir(ctxA, 'a')
        num = await pgA.evaluate("""() => {
            const n = 'REC' + Date.now().toString().slice(-6);
            criarCargaProgramada({placa: DB.frota[12].placa, numeroCarga:n,
                peso:9000, rota:'500', operador:'Ana'});
            SuincoStore.save();
            return n;
        }""")
        await pgA.wait_for_timeout(5000)

        print('\n=== 2. TERMINAL B ABRE E RECEBE A CARGA ===')
        pgB, urlB = await abrir(ctxB, 'b')
        await pgB.wait_for_timeout(4000)
        temB = await pgB.evaluate("(n) => !!DB.cargas.find(c=>c.numeroCarga===n)", num)
        ck('terminal B recebeu a carga', temB)

        print('\n=== 3. TERMINAL A ESCREVE A OBSERVAÇÃO ===')
        await pgA.evaluate("""([n, obs]) => {
            const c = DB.cargas.find(x=>x.numeroCarga===n);
            c.observacoes = obs;
            c.atualizadoEm = new Date().toISOString();
            SuincoStore.save();
        }""", [num, OBS])
        await pgA.wait_for_timeout(5000)

        print('\n=== 4. TERMINAL B RECARREGA (F5) E GRAVA OUTRA COISA ===')
        # É o cenário exato: o colega só recarregou a tela — inclusive
        # sozinho, pela auto-atualização — e gravou qualquer coisa depois.
        await pgB.reload()
        await pgB.wait_for_timeout(4000)
        await pgB.evaluate("""() => {
            // Qualquer gravação dispara a sincronização de tudo que o
            // terminal considera "alterado".
            SuincoStore.save();
        }""")
        await pgB.wait_for_timeout(6000)

        print('\n=== 5. A OBSERVAÇÃO DO TERMINAL A CONTINUA LÁ? ===')
        # Lido de um TERCEIRO navegador, que só pode saber pelo servidor.
        ctxC = await nav.new_context()
        pgC, _ = await abrir(ctxC, 'c')
        await pgC.wait_for_timeout(4000)
        visto = await pgC.evaluate("""(n) => {
            const c = DB.cargas.find(x=>x.numeroCarga===n);
            return c ? (c.observacoes || '') : null;
        }""", num)
        ck('a observação sobreviveu ao F5 do colega', visto == OBS, repr(visto))

        print('\n=== 6. O TERMINAL QUE SÓ RECARREGOU NÃO REENVIA TUDO ===')
        # A prova da causa: depois do F5, o painel precisa saber o que já
        # subiu. Sem isso, ele reenvia o cache inteiro e o passo 5 quebra.
        marca = await pgB.evaluate("""() => ({
            persistida: Object.keys(DB._sincronizado || {}).length,
            emMemoria: SuincoStore._ultimoSync.size,
        })""")
        ck('a marca do que já subiu sobreviveu ao F5',
           marca['persistida'] > 0 and marca['emMemoria'] > 0, str(marca))

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
