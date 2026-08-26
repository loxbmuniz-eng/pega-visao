#!/usr/bin/env python3
"""Trocar a placa reencontra o caminhão que já está no pátio (26/08/2026).

RELATO DO ALYSSON, palavras dele: "a carga do GPA já tinha entrado nesse
caminhão aqui, o FTZ. A portaria tinha registrado nele também. Aí eu alterei
a carga do GPA ali na torre... alterou tudo, só que o status do veículo,
informando que a carga já estava aqui, não mudou. Tive que registrar na
portaria novamente... depois apareceu duas informações."

E o relato do dono, no mesmo dia: "o caminhão tava com duas rotas na mesma
placa, então quando o Alysson abriu o relatório depois só tava aparecendo
uma das rotas".

    python3 testes/test_troca_placa_patio.py
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
    url = f'{API}/__troca_{rotulo}'
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

        placas = await pgL.evaluate(
            "() => { const usadas = new Set(DB.cargas.map((c) => c.placa));"
            "  return DB.frota.filter((x) => x.placa && x.transportadora && !usadas.has(x.placa))"
            "           .slice(0, 3).map((x) => x.placa); }")
        ck('três placas livres na Frota', len(placas) == 3, str(placas))
        if len(placas) < 3:
            await nav.close()
            return 1
        pA, pB, pC = placas

        print('\n=== 1. A PLACA NOVA JÁ ESTÁ NO PÁTIO ===')
        # O caminhão B chega sem programação. A carga é programada na placa A.
        await pgL.evaluate(
            """async ([pA, pB]) => {
                 registrarChegadaPortaria(pB, 'Porteiro');
                 criarCargaProgramada({numeroCarga: 'TROCA-1', placa: pA, cliente: 'C',
                   destino: 'D', peso: 11000, rota: '500', operador: 'Ana'});
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
               }""", [pA, pB])
        await pgL.wait_for_timeout(1500)

        antes = await pgL.evaluate(
            "(pA) => (DB.cargas.find((c) => c.placa === pA && !c.aguardandoCarga) || {}).status", pA)
        ck('a carga nasce Aguardando Veículo', antes == 'Aguardando Veículo', str(antes))

        await pgL.evaluate(
            """([pA, pB]) => {
                 const c = DB.cargas.find((x) => x.placa === pA && !x.aguardandoCarga);
                 atualizarPlacaUI(c.id, pB);
               }""", [pA, pB])
        await pgL.wait_for_timeout(1500)

        depois = await pgL.evaluate(
            "(n) => { const c = DB.cargas.find((x) => x.numeroCarga === n);"
            "  return c ? {status: c.status, placa: c.placa} : null; }", 'TROCA-1')
        ck('a carga passou para Aguardando Embarque', depois and depois['status'] == 'Aguardando Embarque',
           str(depois))

        orfa = await pgL.evaluate(
            "(pB) => DB.cargas.filter((c) => c.placa === pB && c.aguardandoCarga && !c.excluida).length", pB)
        ck('o registro de chegada sem carga foi absorvido', orfa == 0, f'sobraram {orfa}')

        # O relógio de pátio: a entrada herdada, não a hora da edição.
        herdou = await pgL.evaluate(
            """(n) => { const c = DB.cargas.find((x) => x.numeroCarga === n);
                 const e = entradaNoPatioDe(c);
                 return e ? (Date.now() - Date.parse(e)) : null; }""", 'TROCA-1')
        ck('a carga herdou uma entrada de pátio', herdou is not None, str(herdou))

        print('\n=== 2. A PLACA ANTIGA NÃO SOME DO PÁTIO ===')
        # Carga na placa A, caminhão A chegou, e a carga é movida para C.
        await pgL.evaluate(
            """async ([pA, pC]) => {
                 const c = criarCargaProgramada({numeroCarga: 'TROCA-2', placa: pA, cliente: 'C',
                   destino: 'D', peso: 9000, rota: '500', operador: 'Ana'});
                 avancarStatusCarga(c.id, 'Aguardando Embarque', 'Porteiro', 'Portaria');
                 SuincoStore.save();
                 atualizarPlacaUI(c.id, pC);
               }""", [pA, pC])
        await pgL.wait_for_timeout(1200)

        sobrou = await pgL.evaluate(
            "(pA) => DB.cargas.filter((c) => c.placa === pA && c.aguardandoCarga && !c.excluida).length", pA)
        ck('o caminhão que ficou sem carga continua no pátio', sobrou == 1, f'{sobrou} registro(s)')

        print('\n=== 3. DUAS CARGAS NA MESMA PLACA APARECEM NO RELATÓRIO ===')
        html = await pgL.evaluate(
            """async ([pC]) => {
                 // Duas cargas no MESMO caminhão, rotas diferentes — o caso do relato.
                 criarCargaProgramada({numeroCarga: 'REP-1', placa: pC, cliente: 'C',
                   destino: 'D', peso: 8000, rota: '500', operador: 'Ana'});
                 criarCargaProgramada({numeroCarga: 'REP-2', placa: pC, cliente: 'C',
                   destino: 'D', peso: 7000, rota: '600', operador: 'Ana'});
                 SuincoStore.save();
                 const el = await montarRelatorioOperacional();
                 return el.innerHTML;
               }""", [pC])

        temMarca = '1 de 2' in html or '(1 de' in html
        # Detalhe SÓ quando falha: "nenhuma marca encontrada" impresso ao lado
        # de um [OK ] é a linha que faz alguém perder dez minutos depois.
        ck('o relatório marca "1 de" na placa repetida', temMarca,
           '' if temMarca else 'nenhuma marca encontrada no HTML do relatório')
        ck('o relatório diz que as rotas são diferentes', 'rotas diferentes' in html)
        ck('o rodapé lista o caminhão com mais de uma carga',
           'mais de uma carga nesta programação' in html)

        print('\n=== LIMPEZA ===')
        await pgL.evaluate(
            """async (placas) => {
                 for (const c of DB.cargas.filter((x) => placas.includes(x.placa))) {
                   try { await SuincoSharePoint.excluir(c.id, 'limpeza de teste'); } catch (e) {}
                 }
               }""", placas)
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
