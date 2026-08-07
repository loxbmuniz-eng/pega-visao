#!/usr/bin/env python3
"""Cancelar/Excluir passa a existir também na busca do Histórico.

Pedido do usuário (07/08/2026): "nao tem cancelar na linha hsitorico po,
voce nao adicionou essa opcao, coloque pra poder procurar no histgorico e
cancelar". Antes, o botão Cancelar/Excluir só existia na Torre de
Controle — quem buscava uma carga pela timeline do Histórico não tinha
como agir sobre ela ali, precisava trocar de aba.

Reaproveita botaoCancelarHtml(c), a mesma função que já decide Torre de
Controle: "Excluir" (Aguardando Veículo, sem motivo), "Cancelar" (já
andou, pede motivo) ou nada (Seguiu Viagem — trava proposital, ver
excluirCargaUI em app.js: nota fiscal/fechamento do mês dependem da carga
concluída, cancelamento aqui apagaria histórico real do pátio).

    python3 testes/test_cancelar_no_historico.py
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
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(400)

        d0 = await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = [];
            const aguardando = criarCargaProgramada({ placa: DB.frota[0].placa, numeroCarga: 'R1',
              peso: 9000, rota: '500', operador: 'Ana' });
            const jaAndou = criarCargaProgramada({ placa: DB.frota[1].placa, numeroCarga: 'R2',
              peso: 9000, rota: '500', operador: 'Ana' });
            avancarStatusCarga(jaAndou.id, 'Aguardando Embarque', 'Ana', 'Logística');
            const concluida = criarCargaProgramada({ placa: DB.frota[2].placa, numeroCarga: 'R3',
              peso: 9000, rota: '500', operador: 'Ana' });
            ['Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado','Seguiu Viagem']
              .forEach(st => avancarStatusCarga(concluida.id, st, 'Ana', 'Logística'));
            return { aguardando: DB.frota[0].placa, jaAndou: DB.frota[1].placa, concluida: DB.frota[2].placa };
        }""")
        await pg.evaluate("() => abrirTab('historico')")
        await pg.wait_for_timeout(200)

        print('\n=== 1. AGUARDANDO VEÍCULO: BOTÃO "EXCLUIR" ===')
        await pg.fill('#hist-busca-carga', d0['aguardando'])
        await pg.wait_for_timeout(150)
        r1 = await pg.evaluate("""() => {
            const el = document.querySelector('#hist-timeline-wrap button');
            return el ? el.textContent.trim() : null;
        }""")
        ck('mostra botão "Excluir"', r1 == 'Excluir', r1)

        print('\n=== 2. CARGA JÁ ANDOU: BOTÃO "CANCELAR" ===')
        await pg.fill('#hist-busca-carga', d0['jaAndou'])
        await pg.wait_for_timeout(150)
        r2 = await pg.evaluate("""() => {
            const el = document.querySelector('#hist-timeline-wrap button');
            return el ? el.textContent.trim() : null;
        }""")
        ck('mostra botão "Cancelar"', r2 == 'Cancelar', r2)

        print('\n=== 3. SEGUIU VIAGEM: SEM BOTÃO, COM EXPLICAÇÃO ===')
        await pg.fill('#hist-busca-carga', d0['concluida'])
        await pg.wait_for_timeout(150)
        r3 = await pg.evaluate("""() => ({
            temBotao: !!document.querySelector('#hist-timeline-wrap button'),
            texto: document.querySelector('#hist-timeline-wrap .timeline-head').textContent,
        })""")
        ck('sem botão de cancelar/excluir para carga concluída', not r3['temBotao'], str(r3))
        ck('explica por que não dá', 'não é possível cancelar' in r3['texto'].lower(), r3['texto'])

        print('\n=== 4. CANCELAR PELA TIMELINE REALMENTE REMOVE A CARGA ===')
        await pg.fill('#hist-busca-carga', d0['jaAndou'])
        await pg.wait_for_timeout(150)
        cargaId = await pg.evaluate(
            "(placa) => DB.cargas.find(c=>c.placa===placa).id", d0['jaAndou'])
        await pg.evaluate("""(id) => {
            window.prompt = () => 'motivo de teste';
            excluirCargaUI(id);
        }""", cargaId)
        await pg.wait_for_timeout(200)
        r4 = await pg.evaluate("(id) => ({ existe: !!getCarga(id), wrapVazio: !document.getElementById('hist-timeline-wrap').innerHTML.trim() })", cargaId)
        ck('carga foi removida de DB.cargas', not r4['existe'], str(r4))
        ck('a timeline não fica mostrando uma carga que não existe mais', r4['wrapVazio'], str(r4))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
