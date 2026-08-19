#!/usr/bin/env python3
"""Correções da Administração na ficha da carga (19/08/2026).

Pedido: "quero conseguir voltar em qualquer etapa pelo painel de
administrador, no painel histórico, que eu possa gerenciar e administrar e
editar as cargas e processos do histórico inclusive voltar etapas".

O que se prova no navegador, contra o backend local:

  1. O painel de correções aparece para a Administração e NÃO aparece para
     os outros setores — nem para a Logística.
  2. Voltar etapa exige motivo, e com motivo funciona: a carga volta de
     "Seguiu Viagem" para "Faturado" e a mudança fica registrada.
  3. A data de programação é corrigida pela ficha — a carga que caiu no dia
     errado volta para o dia certo.
  4. Quem opera continua sem voltar etapa pelos botões normais.

    python3 testes/test_admin_historico.py
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
    url = f'{API}/__admhist_{rotulo}'
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
        ctxA, pgA = await abrir(nav, 'chefe@teste.local', 'adm')

        # Uma carga do zero até Seguiu Viagem, numa placa sem histórico.
        carga = await pgA.evaluate(
            """async () => {
                 const usadas = new Set(DB.cargas.map((c) => c.placa));
                 const f = DB.frota.find((x) => x.placa && x.transportadora && !usadas.has(x.placa));
                 const c = criarCargaProgramada({placa: f.placa, numeroCarga: 'ADM-1',
                   cliente: 'CLIENTE', destino: 'DESTINO', peso: 3000, operador: 'Chefe'});
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
                 /* A carga precisa EXISTIR no servidor antes das etapas: a
                    subida é assíncrona e um status numa carga que ainda não
                    chegou lá é recusado em silêncio. */
                 for (const st of ['Aguardando Embarque', 'Embarque Iniciado',
                                   'Embarque Finalizado', 'Faturado', 'Seguiu Viagem']) {
                   let ok = false;
                   for (let i = 0; i < 5 && !ok; i++) {
                     const r = await SuincoSharePoint.mudarStatus(c.id, st);
                     ok = !!(r && r.item);
                     if (!ok) await new Promise((res) => setTimeout(res, 600));
                   }
                   if (!ok) return {id: c.id, placa: f.placa, falhou: st};
                 }
                 await SuincoSharePoint.sincronizarAgora();
                 return {id: c.id, placa: f.placa};
               }""")
        await pgA.wait_for_timeout(1200)

        print('\n=== 1. O PAINEL DE CORREÇÕES É SÓ DA ADMINISTRAÇÃO ===')
        await pgA.click(".nav-tab[data-tab='historico']")
        await pgA.evaluate("(id) => selecionarCargaTimeline(id)", carga['id'])
        await pgA.wait_for_timeout(600)
        ck('Administração vê o painel', await pgA.locator('.admin-carga').count() > 0)
        status = await pgA.evaluate("(id) => (getCarga(id) || {}).status", carga['id'])
        ck('a carga está em Seguiu Viagem', status == 'Seguiu Viagem', str(status))

        ctxL, pgL = await abrir(nav, 'ana@teste.local', 'log')
        await pgL.click(".nav-tab[data-tab='historico']")
        await pgL.evaluate("async () => { await SuincoSharePoint.sincronizarAgora(); }")
        await pgL.wait_for_timeout(1200)
        await pgL.evaluate("(id) => selecionarCargaTimeline(id)", carga['id'])
        await pgL.wait_for_timeout(500)
        ck('Logística NÃO vê o painel de correções',
           await pgL.locator('.admin-carga').count() == 0)

        print('\n=== 2. VOLTAR ETAPA EXIGE MOTIVO ===')
        await pgA.evaluate("(id) => selecionarCargaTimeline(id)", carga['id'])
        await pgA.wait_for_timeout(500)
        # Limpa os avisos de sincronização: a tela mostra poucos por vez, e
        # os dos outros setores empurram o que este passo quer ler.
        await pgA.evaluate(
            "() => document.querySelectorAll('.notif-item').forEach((e) => e.remove())")
        await pgA.select_option(f"#adm-etapa-{carga['id']}", 'Faturado')
        pgA.on('dialog', lambda d: asyncio.ensure_future(d.accept('motivo informado no teste')))
        await pgA.click(f"button[onclick*=\"corrigirEtapaCargaUI('{carga['id']}')\"]")
        await pgA.wait_for_timeout(1200)
        avisos = await pgA.evaluate(
            "() => [...document.querySelectorAll('.notif-item')].map((e) => e.innerText).join(' ')")
        ck('sem motivo, o painel pede o motivo', 'motivo' in avisos.lower(), avisos[-90:])
        depois = await pgA.evaluate("(id) => (getCarga(id) || {}).status", carga['id'])
        ck('a carga não se mexeu', depois == 'Seguiu Viagem', str(depois))

        print('\n=== 3. COM MOTIVO, A CARGA VOLTA DE ETAPA ===')
        await pgA.fill(f"#adm-etapa-motivo-{carga['id']}", 'saída registrada por engano')
        await pgA.click(f"button[onclick*=\"corrigirEtapaCargaUI('{carga['id']}')\"]")
        await pgA.wait_for_timeout(3000)
        voltou = await pgA.evaluate("(id) => (getCarga(id) || {}).status", carga['id'])
        ck('a carga voltou para Faturado', voltou == 'Faturado', str(voltou))

        print('\n=== 4. A DATA DE PROGRAMAÇÃO É CORRIGIDA PELA FICHA ===')
        await pgA.evaluate("(id) => selecionarCargaTimeline(id)", carga['id'])
        await pgA.wait_for_timeout(500)
        await pgA.fill(f"#adm-data-{carga['id']}", '2026-08-18')
        await pgA.fill(f"#adm-data-motivo-{carga['id']}", 'carga do dia anterior, relançada por engano')
        await pgA.click(f"button[onclick*=\"corrigirDataProgramacaoUI('{carga['id']}')\"]")
        await pgA.wait_for_timeout(3000)
        dia = await pgA.evaluate(
            "(id) => String((getCarga(id) || {}).programadoEm || '').slice(0, 10)", carga['id'])
        ck('a data foi para 18/08', dia == '2026-08-18', str(dia))

        print('\n=== 5. QUEM OPERA CONTINUA SEM VOLTAR ETAPA ===')
        ctxF, pgF = await abrir(nav, 'diego@teste.local', 'fat')
        recusa = await pgF.evaluate(
            """async (id) => { try { await SuincoSharePoint.corrigirEtapa(id, 'Aguardando Veículo', 'x');
                 return 'passou'; } catch (e) { return e.message; } }""", carga['id'])
        ck('o Faturamento é recusado pelo servidor', 'passou' not in recusa, recusa[:80])

        print('\n=== 6. A TELA DE CARGAS EXCLUÍDAS DEVOLVE O QUE SAIU POR ENGANO ===')
        # Uma carga nova, excluída de propósito — é o caso do dia: alguém
        # exclui a programação e precisa dela de volta.
        outra = await pgA.evaluate(
            """async () => {
                 const usadas = new Set(DB.cargas.map((c) => c.placa));
                 const f = DB.frota.find((x) => x.placa && x.transportadora && !usadas.has(x.placa));
                 const c = criarCargaProgramada({placa: f.placa, numeroCarga: 'ADM-EXC',
                   cliente: 'CLIENTE', destino: 'DESTINO', peso: 1000, operador: 'Chefe'});
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
                 await new Promise((r) => setTimeout(r, 800));
                 await SuincoSharePoint.excluir(c.id, 'excluída por engano no teste');
                 await SuincoSharePoint.sincronizarAgora();
                 return {id: c.id, placa: f.placa};
               }""")
        await pgA.wait_for_timeout(1500)
        sumiu = await pgA.evaluate("(id) => !getCarga(id)", outra['id'])
        ck('a carga excluída sai do painel', sumiu)

        await pgA.fill('#exc-placa', outra['placa'])
        await pgA.click("button:has-text('Buscar excluídas')")
        await pgA.wait_for_timeout(1500)
        naLista = await pgA.evaluate(
            "(id) => document.getElementById('exc-lista').innerHTML.includes(id)", outra['id'])
        ck('a carga aparece na lista de excluídas', naLista)

        await pgA.click(f"button[onclick*=\"devolverCargaExcluidaUI('{outra['id']}')\"]")
        await pgA.wait_for_timeout(3000)
        voltouCarga = await pgA.evaluate("(id) => !!getCarga(id)", outra['id'])
        ck('a carga voltou para o painel', voltouCarga)

        await pgA.evaluate(
            """async (id) => { try { await SuincoSharePoint.excluir(id, 'limpeza de teste'); }
                 catch (e) {} }""", outra['id'])

        # Limpeza.
        await pgA.evaluate(
            """async (id) => { try { await SuincoSharePoint.excluir(id, 'limpeza de teste'); }
                 catch (e) {} }""", carga['id'])
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
