#!/usr/bin/env python3
"""Sem filtro, o relatório espelha o painel — nada de resquício antigo.

Bug relatado pelo usuário (12/08/2026): limpou a programação, deixou no
pátio só os caminhões do dia, e o Executivo ainda trouxe uma placa que
seguiu viagem ANTEONTEM. "ainda temos resquicios da programacao passadas
e do reboot que dei no sistema... tudo precisa ser referente ao momento
exato que clica em exportar relatorios, independente de qual relatorio ele
precisa ser fiel ao que esta no painel".

RAIZ: o painel mostra cargasAbertas(); o relatório sem filtro varria
DB.cargas INTEIRO — toda carga que já existiu naquele navegador. Duas
telas lendo bases diferentes.

    python3 testes/test_relatorio_fiel_ao_painel.py
"""
import asyncio
import re
import sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


# Reproduz o cenário exato: uma carga encerrada ANTEONTEM (resquício), uma
# encerrada HOJE (legítima, saiu de manhã) e duas ainda no pátio.
PREPARAR = """() => {
    const anda = (c, ate) => {
        for(const p of ['Aguardando Embarque','Embarque Iniciado',
                        'Embarque Finalizado','Faturado','Seguiu Viagem']){
            avancarStatusCarga(c.id, p, 'Ana', 'Logística');
            if(p === ate) break;
        }
    };
    const nova = (num, i) => criarCargaProgramada({placa: DB.frota[i].placa,
        numeroCarga: num, peso: 9000, rota: '500', operador: 'Ana'});

    const antiga = nova('QXY-ANTEONTEM', 0);
    anda(antiga, 'Seguiu Viagem');
    /* Empurra a saída (e a criação) para anteontem.

       `programadoEm` entrou junto em 14/08/2026: o relatório passou a
       filtrar pela data em que a CARGA foi lançada, não pela data em que o
       registro nasceu — porque caminhão que chega sem programação num dia e
       tem a carga lançada no outro estava saindo no relatório do dia
       errado. Aqui a carga foi PROGRAMADA anteontem, então as duas datas
       andam juntas; deixar só `criadoEm` no passado descreveria outra
       situação (a que a correção justamente separou). */
    const doisDias = new Date(Date.now() - 2*86400000).toISOString();
    antiga.criadoEm = doisDias; antiga.atualizadoEm = doisDias;
    antiga.programadoEm = doisDias;
    DB.movimentacoes.filter(m => m.cargaId === antiga.id)
        .forEach(m => { m.timestamp = doisDias; });

    const saiuHoje = nova('SAIU-HOJE', 1);
    anda(saiuHoje, 'Seguiu Viagem');

    nova('NO-PATIO-1', 2);
    const p2 = nova('NO-PATIO-2', 3);
    anda(p2, 'Embarque Iniciado');

    SuincoStore.save(); renderAll();
}"""


async def html_do_relatorio(pg, fn, cont):
    await pg.evaluate(f"""async () => {{
        SuincoSharePoint.estaConfigurado = () => true;
        SuincoSharePoint.gerarRelatorioPdf = async () => new Blob(['x']);
        HTMLAnchorElement.prototype.click = function(){{}};
        await {fn}();
    }}""")
    await pg.wait_for_timeout(500)
    return await pg.evaluate(
        f"() => {{ const e=document.getElementById('{cont}'); e.style.display='block'; return e.innerText; }}")


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1400, 'height': 1000})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(600)
        await pg.evaluate(PREPARAR)
        await pg.wait_for_timeout(800)

        print('\n=== 1. O PAINEL NÃO MOSTRA A CARGA DE ANTEONTEM ===')
        await pg.evaluate("() => irParaTab('torre')")
        await pg.wait_for_timeout(500)
        nums = await pg.eval_on_selector_all(
            '#torre-tbody .numero-carga-input', 'els => els.map(e=>e.value)')
        ck('Torre não lista a carga encerrada anteontem',
           'QXY-ANTEONTEM' not in nums, str(nums))
        ck('Torre lista as que estão no pátio',
           'NO-PATIO-1' in nums and 'NO-PATIO-2' in nums, str(nums))

        print('\n=== 2. SEM FILTRO, O RELATÓRIO ESPELHA O PAINEL ===')
        await pg.evaluate("() => irParaTab('relatorios')")
        await pg.wait_for_timeout(400)
        await pg.fill('#rel-data-de', '')
        await pg.fill('#rel-data-ate', '')

        for fn, cont, rot in [('exportarPdfOperacional','print-operacional','Operacional'),
                              ('exportarPdfExecutivo','print-executivo','Executivo'),
                              ('exportarPdfFretes','print-fretes','Fretes')]:
            txt = await html_do_relatorio(pg, fn, cont)
            ck(f'{rot}: NÃO traz a carga de anteontem',
               'QXY-ANTEONTEM' not in txt)
            ck(f'{rot}: traz as cargas que estão no pátio',
               'NO-PATIO-1' in txt)

        print('\n=== 3. O QUE SAIU HOJE CONTINUA APARECENDO ===')
        # O Operacional acompanha o dia inteiro: o caminhão que saiu de
        # manhã ainda precisa constar.
        txt = await html_do_relatorio(pg, 'exportarPdfOperacional', 'print-operacional')
        ck('carga concluída HOJE segue no relatório', 'SAIU-HOJE' in txt)

        print('\n=== 4. COM FILTRO, O PERÍODO PASSADO CONTINUA CONSULTÁVEL ===')
        # Resquício não pode virar cegueira: quem PEDIR anteontem, vê.
        anteontem = await pg.evaluate(
            "() => new Date(Date.now()-2*86400000).toISOString().slice(0,10)")
        await pg.fill('#rel-data-de', anteontem)
        await pg.fill('#rel-data-ate', anteontem)
        txt = await html_do_relatorio(pg, 'exportarPdfOperacional', 'print-operacional')
        ck('filtrando anteontem, a carga daquele dia aparece',
           'QXY-ANTEONTEM' in txt, txt[:150])

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
