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
                 /* A CARGA JÁ NASCE EM "AGUARDANDO EMBARQUE" (27/08/2026).
                    O caminhão da placa A ficou sozinho no pátio no fim da
                    seção 1, e desde esta data criar carga para uma placa
                    que já está no pátio ABSORVE aquela entrada. Antes era
                    preciso avançar o status na mão aqui; fazer isso agora
                    estoura com "não é possível ir de Aguardando Embarque
                    para Aguardando Embarque". O avanço manual continua,
                    porém condicionado — assim este teste segue valendo se
                    um dia a absorção não acontecer. */
                 if(c.status === 'Aguardando Veículo'){
                   avancarStatusCarga(c.id, 'Aguardando Embarque', 'Porteiro', 'Portaria');
                 }
                 SuincoStore.save();
                 atualizarPlacaUI(c.id, pC);
               }""", [pA, pC])
        await pgL.wait_for_timeout(1200)

        sobrou = await pgL.evaluate(
            "(pA) => DB.cargas.filter((c) => c.placa === pA && c.aguardandoCarga && !c.excluida).length", pA)
        ck('o caminhão que ficou sem carga continua no pátio', sobrou == 1, f'{sobrou} registro(s)')

        print('\n=== 3. DUAS CARGAS NA MESMA PLACA APARECEM NO RELATÓRIO ===')
        # A MARCA NA CÉLULA SAIU — decisão do dono em 26/08/2026, depois de a
        # primeira versão dela quebrar o layout do relatório em produção:
        # "NAO PRECISA DESSA INFORMACAO 1 DE 2 2 DE 2, MANTEM A PLACA E QUE
        # SEJA NORMAL MARCAR 2 CARGAS NUMA PLACA SO".
        #
        # Ele está certo: duas cargas no mesmo caminhão é rotina do pátio, e
        # rotina não merece marca na linha. O que precisa continuar aparecendo
        # — e é o pedido original, de que duas rotas na mesma placa saiam com
        # clareza — mora no rodapé, onde sobra largura para dizer QUAIS são as
        # rotas. É isso que este bloco guarda agora.
        # 512 e 513 são códigos que EXISTEM no cadastro. A primeira versão
        # deste bloco usou 500 e 600; a 600 não existe, criarCargaProgramada
        # guarda vazio para código desconhecido, e o rodapé — corretamente —
        # não tinha duas rotas para citar. O teste acusou o produto por um
        # defeito que era dele mesmo.
        r = await pgL.evaluate(
            """async ([pC]) => {
                 criarCargaProgramada({numeroCarga: 'REP-1', placa: pC, cliente: 'C',
                   destino: 'D', peso: 8000, rota: '512', operador: 'Ana'});
                 criarCargaProgramada({numeroCarga: 'REP-2', placa: pC, cliente: 'C',
                   destino: 'D', peso: 7000, rota: '513', operador: 'Ana'});
                 SuincoStore.save();
                 const el = await montarRelatorioOperacional();
                 const aviso = [...el.querySelectorAll('.doc-aviso-numeracao')]
                   .map(x => x.innerText).join(' | ');
                 return {
                   placas: [...el.querySelectorAll('td.c-placa')].map(x => x.innerText.trim()),
                   aviso,
                 };
               }""", [pC])

        # ESCOPO NA CÉLULA, não no documento inteiro. A primeira versão
        # procurava "1/2" no HTML da folha toda e acusava marca onde não
        # havia — a folha tem datas, estilos e referências com barra.
        sujas = [x for x in r['placas'] if any(c.isdigit() and '/' in x for c in x)
                 or ' de ' in x]
        ck('a coluna Placa traz só a placa, sem marca de ordem',
           not sujas, f'células com marca: {sujas}')
        ck('o rodapé nomeia o caminhão com mais de uma carga',
           'Caminhão com mais de uma carga' in r['aviso'], r['aviso'][:120])
        ck('o rodapé diz QUAIS são as rotas',
           '512' in r['aviso'] and '513' in r['aviso'], r['aviso'][:120])

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
