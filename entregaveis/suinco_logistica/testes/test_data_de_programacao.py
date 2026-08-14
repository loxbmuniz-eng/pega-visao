#!/usr/bin/env python3
"""O relatório filtra pela data em que a CARGA foi lançada, não pela chegada.

RELATO DO GESTOR (14/08/2026)
"Se a portaria dá entrada no veículo ontem — chegou uma carreta ontem, tá
no pátio dia 13 — e a gente lança a carga dela hoje, porque a carga é de
hoje, o relatório considera a data de entrada dela e não a data que ela foi
programada. Quando eu filtro só as cargas de hoje, puxa somente as que
chegaram hoje. Tem que considerar sempre a data de programação. E aí a
gente não perde o histórico da hora e do dia que o carro realmente chegou."

CAUSA
Só existia `criadoEm`, que para um caminhão sem programação prévia é a hora
em que a PORTARIA registrou a entrada. O filtro do relatório usava esse
campo, então a carga lançada hoje num caminhão de ontem ficava fora do
relatório de hoje — e aparecia no de ontem, onde ninguém a procurava.

CORREÇÃO
Passa a existir `programadoEm`, gravado quando a carga é de fato lançada
(criarCargaProgramada e completarCargaAguardando). O filtro usa
`programadoEm`, com `criadoEm` de reserva para as cargas anteriores a esta
mudança. `criadoEm` NÃO é tocado: continua sendo o histórico da chegada,
como o gestor pediu explicitamente.

    python3 testes/test_data_de_programacao.py
"""
import asyncio
import sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        pg = await nav.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Alysson')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)

        print('\n=== CENÁRIO: CARRETA CHEGOU ONTEM, CARGA LANÇADA HOJE ===')
        r = await pg.evaluate("""() => {
            const placa = DB.frota[2].placa;
            // Portaria registrou a chegada ONTEM.
            registrarChegadaPortaria(placa, 'Porteiro');
            const c = DB.cargas.find(x => x.placa === placa && x.aguardandoCarga);
            const ontem = new Date(Date.now() - 86400000).toISOString();
            c.criadoEm = ontem;
            SuincoStore.save();

            // Hoje a Logística lança a carga dela.
            completarCargaAguardando(c.id, {
                numeroCarga:'118191', peso:25600, rota:'500', qtdEntregas:1,
                paletizada:'Sim', operador:'Alysson',
            });
            const hoje = new Date().toISOString().slice(0,10);
            const ontemISO = ontem.slice(0,10);
            return {
                id: c.id, placa, hoje, ontemISO,
                criadoEm: c.criadoEm, programadoEm: c.programadoEm,
                noRelatorioDeHoje: filtrarPorDataProgramacao(DB.cargas, hoje, hoje)
                    .some(x => x.id === c.id),
                noRelatorioDeOntem: filtrarPorDataProgramacao(DB.cargas, ontemISO, ontemISO)
                    .some(x => x.id === c.id),
            };
        }""")

        ck('a carga aparece no relatório de HOJE (dia em que foi programada)',
           r['noRelatorioDeHoje'], str(r['programadoEm']))
        ck('NÃO aparece no relatório de ontem (dia em que o caminhão chegou)',
           not r['noRelatorioDeOntem'])

        print('\n=== O HISTÓRICO DA CHEGADA NÃO PODE SE PERDER ===')
        # O gestor foi explícito: "a gente não perde o histórico da hora e do
        # dia que o carro realmente chegou".
        ck('criadoEm continua sendo a data da CHEGADA (ontem)',
           r['criadoEm'][:10] == r['ontemISO'], f"{r['criadoEm']} vs {r['ontemISO']}")
        ck('programadoEm é hoje', r['programadoEm'][:10] == r['hoje'],
           f"{r['programadoEm']} vs {r['hoje']}")
        ck('as duas datas são diferentes (são dois fatos diferentes)',
           r['criadoEm'][:10] != r['programadoEm'][:10])

        print('\n=== CARGA PROGRAMADA NORMAL: AS DUAS DATAS COINCIDEM ===')
        r2 = await pg.evaluate("""() => {
            const c = criarCargaProgramada({placa: DB.frota[4].placa,
                numeroCarga:'N1', peso:9000, rota:'500', operador:'Alysson'});
            const hoje = new Date().toISOString().slice(0,10);
            return {mesmoDia: (c.programadoEm||'').slice(0,10) === (c.criadoEm||'').slice(0,10),
                    noRelatorioDeHoje: filtrarPorDataProgramacao(DB.cargas, hoje, hoje)
                        .some(x => x.id === c.id)};
        }""")
        ck('programada hoje tem as duas datas iguais', r2['mesmoDia'])
        ck('e aparece no relatório de hoje', r2['noRelatorioDeHoje'])

        print('\n=== CARGA ANTIGA (sem o campo novo) NÃO PODE SUMIR ===')
        # Regressão: tudo que já existe no banco não tem programadoEm.
        r3 = await pg.evaluate("""() => {
            const c = criarCargaProgramada({placa: DB.frota[6].placa,
                numeroCarga:'V1', peso:9000, rota:'500', operador:'Alysson'});
            delete c.programadoEm;           // como as cargas anteriores
            SuincoStore.save();
            const hoje = new Date().toISOString().slice(0,10);
            return filtrarPorDataProgramacao(DB.cargas, hoje, hoje).some(x=>x.id===c.id);
        }""")
        ck('carga sem programadoEm ainda entra pelo criadoEm', r3)

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
