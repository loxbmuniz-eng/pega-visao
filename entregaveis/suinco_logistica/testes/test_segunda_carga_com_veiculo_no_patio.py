#!/usr/bin/env python3
"""A segunda carga do caminhão que JÁ ESTÁ no pátio (20/08/2026).

Relato do programador de embarque, com print da tela: a placa aparecia em
"Veículos no Pátio Agora" às 18:06 e, ao mesmo tempo, embaixo, a segunda
carga dela constava "AGUARDANDO VEÍCULO".

    "na segunda carga a placa está dando que o veículo não chegou, só que o
     veículo está no pátio... aí você dá a entrada nele e não dá. É isso que
     está dando interferência... as duas cargas têm de subir para cima."

Duas coisas se provam aqui:

  1. A trava de reentrada (criada na véspera para o caminhão que saiu sem
     baixa) NÃO pode barrar a segunda carga do MESMO dia — e não barra mais.
  2. Enquanto a segunda carga espera o clique da Portaria, a tela diz que o
     veículo já está no pátio, em vez de deixar quem lê concluir o oposto.

    python3 testes/test_segunda_carga_com_veiculo_no_patio.py
"""
import asyncio
import os
import subprocess
import sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')

falhas = []


def sql(consulta):
    saida = subprocess.run(
        ['sudo', '-u', 'postgres', 'psql', '-tAF', '|', '-P', 'pager=off',
         '-d', 'embarque_suinco', '-c', consulta],
        capture_output=True, text=True)
    linhas = [l for l in saida.stdout.strip().splitlines() if l]
    return linhas[0].split('|') if linhas else None


async def esperar_status(carga_id, alvo, segundos=20):
    """A promoção sobe pela rota de status, que é assíncrona — cravar um
    `wait_for_timeout` deixaria o teste instável (foi o que aconteceu na
    primeira execução). Aqui se espera o FATO, não o relógio."""
    for _ in range(segundos * 2):
        r = sql(f"SELECT status_atual FROM fact_viagens WHERE carga_id = '{carga_id}'")
        if r and r[0] == alvo:
            return r[0]
        await asyncio.sleep(0.5)
    r = sql(f"SELECT status_atual FROM fact_viagens WHERE carga_id = '{carga_id}'")
    return r[0] if r else None


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
    url = f'{API}/__segunda_{rotulo}'
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
        ctxL, pgL = await abrir(nav, 'ana@teste.local', 'log')

        placa = await pgL.evaluate(
            """() => { const u = new Set(DB.cargas.map((c) => c.placa));
                 const f = DB.frota.find((x) => x.placa && x.transportadora && !u.has(x.placa));
                 return f ? f.placa : null; }""")
        ck('placa livre', bool(placa), str(placa))
        if not placa:
            await nav.close()
            return 1
        sql(f"DELETE FROM fact_statusfrota WHERE placa = '{placa}'")
        sql(f"DELETE FROM fact_viagens WHERE placa = '{placa}'")

        print('\n=== 1. O CAMINHÃO CHEGA COM UMA CARGA ===')
        primeira = await pgL.evaluate(
            """async (placa) => {
                 await SuincoSharePoint.sincronizarAgora();
                 const c = criarCargaProgramada({numeroCarga: '118287', placa, cliente: 'CLI',
                   destino: 'SP', peso: 3000, rota: '500', operador: 'Ana'});
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
                 return c.id;
               }""", placa)

        ctxP, pgP = await abrir(nav, 'bruno@teste.local', 'portaria')
        await pgP.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        await pgP.click(".nav-tab[data-tab='portaria']")
        await pgP.fill('#portaria-placa', placa)
        await pgP.click("button:has-text('Chegou')")
        st = await esperar_status(primeira, 'Aguardando Embarque')
        ck('a primeira carga entrou no pátio', st == 'Aguardando Embarque', str(st))
        # O painel da Logística precisa enxergar isso para marcar a segunda.
        await pgL.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        await pgL.wait_for_timeout(1200)

        print('\n=== 2. A SEGUNDA CARGA É PROGRAMADA DEPOIS ===')
        segunda = await pgL.evaluate(
            """async (placa) => {
                 await SuincoSharePoint.sincronizarAgora();
                 const c = criarCargaProgramada({numeroCarga: '118288', placa, cliente: 'CLI',
                   destino: 'RJ', peso: 2000, rota: '517', operador: 'Ana'});
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
                 return c.id;
               }""", placa)
        ck('segunda carga criada', bool(segunda), str(segunda))

        marca = await pgL.evaluate(
            """(id) => { const c = getCarga(id);
                 return {status: c.status, jaNoPatio: veiculoJaNoPatio(c),
                         chip: chipNoPatioHtml(c).includes('já no pátio')}; }""", segunda)
        ck('ela nasce "Aguardando Veículo" (o status é DA CARGA)',
           marca['status'] == 'Aguardando Veículo', str(marca))
        ck('mas a tela avisa que o VEÍCULO já está no pátio', marca['chip'], str(marca))

        print('\n=== 3. A PORTARIA CONSEGUE DAR A ENTRADA (era o travamento) ===')
        await pgP.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        await pgP.wait_for_timeout(1200)
        await pgP.fill('#portaria-placa', placa)
        await pgP.click("button:has-text('Chegou')")
        await esperar_status(segunda, 'Aguardando Embarque')

        final = sql("SELECT (SELECT status_atual FROM fact_viagens WHERE carga_id = '"
                    + primeira + "'), (SELECT status_atual FROM fact_viagens WHERE carga_id = '"
                    + segunda + "')")
        ck('a segunda carga também entrou no pátio, NO SERVIDOR',
           final and final[1] == 'Aguardando Embarque', str(final))
        ck('e a primeira não foi mexida', final and final[0] == 'Aguardando Embarque', str(final))

        semChip = await pgL.evaluate(
            """async (id) => { await SuincoSharePoint.sincronizarAgora();
                 const c = getCarga(id);
                 return {status: c.status, chip: chipNoPatioHtml(c)}; }""", segunda)
        ck('com as duas no pátio, a marca some (já não há o que avisar)',
           semChip['chip'] == '' and semChip['status'] == 'Aguardando Embarque', str(semChip))

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
