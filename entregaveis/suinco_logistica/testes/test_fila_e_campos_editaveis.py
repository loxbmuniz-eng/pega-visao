#!/usr/bin/env python3
"""Fila de Programados só do dia + campos editáveis + data da programação.

Pedidos do usuário (11/08/2026):
  - "no campo fila de programados na programacao manter somente os
     programados NO DIA"
  - "DEIXAR TODOS OS CAMPOS DE PLACA PROGRAMADA EDITAVEIS, PESO, ROTA,
     PALETIZADA, ENTREGAS"
  - "LIBERAR CAMPO EDIÇÃO MOTORISTA, ROTA, PESO NA PROGRAMACAO, TORRE DE
     CONTROLE"
  - "NA TORRE DE CONTROLE MOSTRAR A DATA DA PROGRAMACAO DAS CARGAS QUE
     NAO TIVEREM FINALIZADO E SAIDO AINDA"

O ponto mais importante aqui NÃO é o filtro funcionar — é a carga de
outro dia continuar EXISTINDO (Torre/Histórico) depois de sair da fila.
Filtro que esconde carga de verdade é perda de dado com outro nome.

    python3 testes/test_fila_e_campos_editaveis.py
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
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)

        # Uma carga de hoje e uma "programada" há 3 dias.
        await pg.evaluate("""() => {
            const p1 = DB.frota[0].placa, p2 = DB.frota[1].placa;
            const a = criarCargaProgramada({placa:p1, numeroCarga:'HOJE1', peso:9000,
                rota:'500', operador:'Ana'});
            const b = criarCargaProgramada({placa:p2, numeroCarga:'VELHA1', peso:8000,
                rota:'500', operador:'Ana'});
            const tresDias = new Date(Date.now() - 3*86400000).toISOString();
            b.criadoEm = tresDias; b.atualizadoEm = tresDias;
            SuincoStore.save();
            renderAll();
        }""")
        await pg.wait_for_timeout(500)

        print('\n=== 1. FILA MOSTRA SÓ OS DO DIA ===')
        await pg.evaluate("() => abrirTab('programacao')")
        await pg.wait_for_timeout(400)
        # Nº da carga é um <input> editável: inner_text NÃO lê valor de
        # campo, só texto. Ler os values é o que reflete a tela de verdade.
        fila = await pg.eval_on_selector_all(
            '#prog-fila-tbody .numero-carga-input', 'els => els.map(e=>e.value)')
        ck('carga de hoje aparece na fila', 'HOJE1' in fila, str(fila))
        ck('carga de outro dia NÃO aparece na fila', 'VELHA1' not in fila, str(fila))
        ck('avisa que existem cargas de outros dias',
           await pg.is_visible('#prog-fila-outros-dias'))

        print('\n=== 2. A CARGA DE OUTRO DIA NÃO SUMIU DO SISTEMA ===')
        ainda_existe = await pg.evaluate(
            "() => DB.cargas.some(c=>c.numeroCarga==='VELHA1' && c.status==='Aguardando Veículo')")
        ck('carga antiga continua existindo nos dados', ainda_existe)

        await pg.evaluate("() => abrirTab('torre')")
        await pg.wait_for_timeout(400)
        torre_nums = await pg.eval_on_selector_all(
            '#torre-tbody .numero-carga-input', 'els => els.map(e=>e.value)')
        torre = await pg.inner_text('#torre-tbody')
        ck('carga antiga aparece na Torre de Controle', 'VELHA1' in torre_nums, str(torre_nums))
        ck('carga de hoje também aparece na Torre', 'HOJE1' in torre_nums, str(torre_nums))

        print('\n=== 3. DATA DA PROGRAMAÇÃO NA TORRE ===')
        # A coluna virou "Datas" em 11/08/2026: a Torre tinha 15 colunas e
        # 1870px numa área de 1162px, obrigando a rolar pro lado pra ver
        # Status e os botões. "Programada em" e "Atualizado em" descrevem a
        # mesma coisa (quando), então passaram a dividir uma célula
        # empilhada. Nada foi removido — o dado continua na tela.
        ck('coluna de datas existe na Torre',
           'Datas' in (await pg.inner_text('#torre-thead')))
        ck('a data da programação continua visível',
           await pg.is_visible('#torre-tbody .dt-prog'))
        ck('a última atualização continua visível',
           await pg.is_visible('#torre-tbody .dt-atu'))
        ck('carga de 3 dias atrás é marcada como atrasada',
           await pg.is_visible('.prog-atrasada'))
        ck('mostra há quantos dias', 'há 3 dias' in torre)

        print('\n=== 4. CAMPOS EDITÁVEIS NA TORRE ===')
        for campo, seletor in [('rota', '.rota-inline'), ('peso', '.peso-input'),
                               ('paletizada', '.palet-inline'), ('motorista', '.motorista-input')]:
            ck(f'{campo} é editável na Torre', await pg.is_visible(seletor))

        # Edita de verdade e confirma que grava.
        await pg.evaluate("""() => {
            const c = DB.cargas.find(x=>x.numeroCarga==='HOJE1');
            atualizarPesoUI(c.id, '12345');
            atualizarPaletizadaUI(c.id, 'Sim');
            atualizarMotoristaUI(c.id, 'Motorista Teste');
            atualizarEntregasUI(c.id, '7');
        }""")
        await pg.wait_for_timeout(400)
        dados = await pg.evaluate("""() => {
            const c = DB.cargas.find(x=>x.numeroCarga==='HOJE1');
            return {peso:c.peso, palet:c.paletizada, mot:c.motorista, ent:c.qtdEntregas};
        }""")
        ck('peso gravado', dados['peso'] == 12345, str(dados))
        ck('paletizada gravada', dados['palet'] == 'Sim', str(dados))
        ck('motorista gravado', dados['mot'] == 'Motorista Teste', str(dados))
        ck('entregas gravadas', dados['ent'] == 7, str(dados))

        print('\n=== 5. EDITAR MOTORISTA DA CARGA NÃO MEXE NO CADASTRO DA FROTA ===')
        # Regra: motorista da CARGA (quem dirigiu) ≠ motorista da FROTA (habitual).
        frota_intacta = await pg.evaluate("""() => {
            const c = DB.cargas.find(x=>x.numeroCarga==='HOJE1');
            const f = DB.frota.find(f=>f.placa===c.placa);
            return (f.motorista || '') !== 'Motorista Teste';
        }""")
        ck('cadastro da Frota não foi sobrescrito', frota_intacta)

        print('\n=== 6. CAMPOS EDITÁVEIS NA FILA DE PROGRAMADOS ===')
        await pg.evaluate("() => abrirTab('programacao')")
        await pg.wait_for_timeout(400)
        for campo, seletor in [('rota', '#prog-fila-tbody .rota-inline'),
                               ('peso', '#prog-fila-tbody .peso-input'),
                               ('paletizada', '#prog-fila-tbody .palet-inline'),
                               ('entregas', '#prog-fila-tbody .entregas-input')]:
            ck(f'{campo} é editável na Fila', await pg.is_visible(seletor))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
