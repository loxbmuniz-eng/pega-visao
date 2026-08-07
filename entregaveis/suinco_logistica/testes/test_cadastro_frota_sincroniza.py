#!/usr/bin/env python3
"""Cadastrar placa nova em Cadastros → Frota precisa chegar ao SERVIDOR.

Bug relatado em produção (07/08/2026): um gestor cadastrou uma placa nova
pela tela de Frota, viu "Placa cadastrada na Frota." (sucesso), programou
uma carga com ela — a carga apareceu na tela DELE (Torre de Controle) mas
em nenhum outro terminal. O aviso real, que só apareceu depois, foi
"servidor recusou a placa": a Programação usa a cópia LOCAL da frota
(`buscarFrota()`), que já tinha a placa nova; o servidor nunca teve.

Causa raiz, confirmada lendo o código: `upsertFrota()` (data.js) grava só
em `DB.frota` + `localStorage` e retorna — nenhuma chamada a
`SuincoStore.sincronizarVeiculo()` nunca acontecia a partir de
`addFrotaUI()` nem de `importarFrotaLoteUI()`. O único lugar que chamava
`sincronizarVeiculo()` era o carregamento único da base semente
(749 placas), no primeiro acesso. Cadastro manual — o caminho do dia a
dia — nunca subia ao banco. O aviso "Placa cadastrada na Frota." era
mostrado sem NENHUMA chamada de rede: sucesso garantido mesmo se o
servidor estivesse fora do ar.

    python3 testes/test_cadastro_frota_sincroniza.py
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


async def entrar(pg, setor):
    await pg.evaluate("() => { sessionStorage.setItem('suinco_token', 'token-de-teste'); }")
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Gestor')
    await pg.select_option('#login-setor', setor)
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(400)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await entrar(pg, 'Logística')

        print('\n=== CADASTRAR PLACA NOVA PRECISA CHAMAR POST /api/frota ===')
        d = await pg.evaluate("""async () => {
            const chamadas = [];
            window.fetch = async (url, opts) => {
                const u = String(url);
                if (/\\/api\\/frota$/.test(u) && (opts?.method||'GET').toUpperCase() !== 'GET') {
                    chamadas.push({ url: u, corpo: opts.body });
                    return new Response(JSON.stringify({ placa: 'ZZZ9001' }), { status: 201,
                        headers: {'content-type':'application/json'} });
                }
                return new Response(JSON.stringify({}), { status: 200,
                    headers: {'content-type':'application/json'} });
            };

            document.getElementById('frota-placa').value = 'ZZZ9001';
            document.getElementById('frota-transportadora').value = 'Transportadora Teste';
            document.getElementById('frota-tipoveiculo').value = 'Carreta';
            addFrotaUI();
            await new Promise(r => setTimeout(r, 500));

            return {
                naFrotaLocal: !!buscarFrota('ZZZ9001'),
                chamadasAoServidor: chamadas.length
            };
        }""")
        ck('a placa entrou na frota local', d['naFrotaLocal'])
        ck('uma chamada POST /api/frota foi feita — sem isso a placa nunca chega ao banco',
           d['chamadasAoServidor'] > 0,
           f"{d['chamadasAoServidor']} chamada(s) — 0 é o bug relatado em produção")

        print('\n=== SE O SERVIDOR RECUSAR, O OPERADOR PRECISA SABER ===')
        d2 = await pg.evaluate("""async () => {
            window.fetch = async (url, opts) => {
                const u = String(url);
                if (/\\/api\\/frota$/.test(u) && (opts?.method||'GET').toUpperCase() !== 'GET') {
                    return new Response(JSON.stringify({
                        erro: 'Esta ação é do setor Logística.', codigo: 'SETOR_SEM_PERMISSAO'
                    }), { status: 403, headers: {'content-type':'application/json'} });
                }
                return new Response(JSON.stringify({}), { status: 200,
                    headers: {'content-type':'application/json'} });
            };
            document.getElementById('notif').innerHTML = '';

            document.getElementById('frota-placa').value = 'ZZZ9002';
            document.getElementById('frota-transportadora').value = 'Outra Transportadora';
            document.getElementById('frota-tipoveiculo').value = 'Truck';
            addFrotaUI();
            await new Promise(r => setTimeout(r, 500));

            const avisos = [...document.getElementById('notif').children].map(el => el.textContent);
            return { avisos };
        }""")
        avisoRecusa = [a for a in d2['avisos'] if 'recus' in a.lower() or 'ZZZ9002' in a]
        ck('a recusa do servidor vira aviso na tela — não pode ficar só na tela de sucesso',
           len(avisoRecusa) > 0, str(d2['avisos']))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
