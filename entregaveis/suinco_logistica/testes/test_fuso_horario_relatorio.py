#!/usr/bin/env python3
"""O dia do relatório é o dia de Patos de Minas, não o do servidor.

RELATO (15/08/2026): "estamos em Patos de Minas, Minas Gerais, o fuso
horário do relatório precisa ser fiel ao fuso horário. Está faltando 64
toneladas de 3 carros."

O PONTO
O servidor e o banco trabalham em UTC. Patos de Minas é UTC−3. Entre 21h e
meia-noite locais, o servidor JÁ ESTÁ NO DIA SEGUINTE — as 22:27 de 14/08 no
pátio são 01:27 de 15/08 para o banco.

Toda carga lançada nesse intervalo (que é justamente o fim do turno, quando
a programação do dia seguinte é montada) corre o risco de ser carimbada com
o dia seguinte e sumir do relatório do dia em que foi lançada.

O que este teste fixa: o recorte "de 14/08 até 14/08" tem que significar o
DIA 14 EM PATOS DE MINAS — das 00:00 às 23:59 locais — e não o dia 14 em
UTC. O navegador roda com o fuso de lá (America/Sao_Paulo), que é a
condição real da operação.

Os três casos que importam, todos em volta da virada:
  - 22:27 do dia 14 local (01:27 UTC do 15) ENTRA no relatório do dia 14.
  - 23:59 do dia 14 local ENTRA.
  - 23:00 do dia 13 local (02:00 UTC do 14) NÃO entra — é do dia anterior,
    mesmo o servidor já estando no 14.

    python3 testes/test_fuso_horario_relatorio.py
"""
import asyncio
import sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
FUSO = 'America/Sao_Paulo'          # o mesmo de Patos de Minas (UTC−3)
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        ctx = await nav.new_context(timezone_id=FUSO)
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Alysson')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)

        confere = await pg.evaluate(
            "() => Intl.DateTimeFormat().resolvedOptions().timeZone")
        ck('navegador está no fuso de Patos de Minas', confere == FUSO, str(confere))

        print('\n=== CARGAS EM VOLTA DA VIRADA DO DIA ===')
        r = await pg.evaluate("""() => {
            const nova = (n, i, isoUTC) => {
                const c = criarCargaProgramada({placa: DB.frota[i].placa,
                    numeroCarga:n, peso:9000, rota:'500', operador:'Alysson'});
                c.programadoEm = isoUTC;
                c.criadoEm = isoUTC;
                return c;
            };
            // 22:27 do dia 14 EM PATOS DE MINAS = 01:27 UTC do dia 15.
            const noite14  = nova('NOITE-14', 20, '2026-08-15T01:27:00.000Z');
            // 23:59 do dia 14 local = 02:59 UTC do dia 15.
            const fim14    = nova('FIM-14',   21, '2026-08-15T02:59:00.000Z');
            // 23:00 do dia 13 local = 02:00 UTC do dia 14 — é do dia ANTERIOR.
            const noite13  = nova('NOITE-13', 22, '2026-08-14T02:00:00.000Z');
            // 08:00 do dia 14 local, caso trivial de controle.
            const manha14  = nova('MANHA-14', 23, '2026-08-14T11:00:00.000Z');
            SuincoStore.save();

            const dia14 = filtrarPorDataProgramacao(DB.cargas, '2026-08-14', '2026-08-14');
            const tem = n => dia14.some(c => c.numeroCarga === n);
            return {
                noite14: tem('NOITE-14'), fim14: tem('FIM-14'),
                noite13: tem('NOITE-13'), manha14: tem('MANHA-14'),
            };
        }""")

        ck('carga das 22:27 do dia 14 (01:27 UTC do 15) ENTRA no dia 14',
           r['noite14'], str(r))
        ck('carga das 23:59 do dia 14 ENTRA no dia 14', r['fim14'], str(r))
        ck('carga da manhã do dia 14 ENTRA no dia 14', r['manha14'], str(r))
        ck('carga das 23:00 do dia 13 NÃO entra no dia 14', not r['noite13'], str(r))

        print('\n=== O NOME DO ARQUIVO USA O DIA LOCAL ===')
        # Se o carimbo do arquivo virar antes da meia-noite do pátio, dois
        # relatórios do mesmo turno saem com nomes de dias diferentes.
        nome = await pg.evaluate("""() => {
            document.getElementById('rel-data-de').value = '2026-08-14';
            document.getElementById('rel-data-ate').value = '2026-08-14';
            return carimboDoPeriodo();
        }""")
        ck('o carimbo do período é o dia filtrado', nome == '2026-08-14', str(nome))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
