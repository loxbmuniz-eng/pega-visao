#!/usr/bin/env python3
"""Placa nova, na Programação: cadastrar sem sair da tela.

Pedido direto (07/08/2026), na sequência do bug do cadastro de Frota que
nunca sincronizava: "quando a programação for feita e a placa não existir
no banco de dados, aparecer a opção de cadastrar o novo veículo... não
podemos perder tempo com esse processo". Antes, o único caminho era ir em
Cadastros → Frota, perder o que já estava digitado em Programação,
cadastrar lá, voltar e preencher tudo de novo.

    python3 testes/test_cadastro_inline_frota_programacao.py
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

        await pg.evaluate("() => { sessionStorage.setItem('suinco_token', 'token-de-teste'); }")
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Gestor')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(400)

        await pg.evaluate("""() => {
            const chamadas = [];
            window.fetch = async (url, opts) => {
                if (/\\/api\\/frota$/.test(String(url)) && (opts?.method||'GET').toUpperCase() === 'POST') {
                    chamadas.push(1);
                }
                return new Response(JSON.stringify({ placa: 'NEW1234' }), { status: 201,
                    headers: {'content-type':'application/json'} });
            };
            window.__chamadasFrota = chamadas;
        }""")

        await pg.click('.nav-tab[data-tab="programacao"]')
        await pg.wait_for_timeout(200)

        print('\n=== PLACA NOVA — BOTÃO DE CADASTRO INLINE APARECE ===')
        await pg.fill('#prog-placa', 'NEW1234')
        await pg.wait_for_timeout(150)
        botao = pg.locator('button:has-text("Cadastrar esta placa na Frota agora")')
        ck('botão de cadastro inline apareceu', await botao.count() > 0)
        bloqueado = await pg.evaluate("""() => {
            try { criarCargaProgramada({placa:'NEW1234', numeroCarga:'1', peso:1, rota:'', operador:'x'}); return false; }
            catch(e) { return true; }
        }""")
        ck('criar carga continua bloqueado antes de cadastrar', bloqueado)

        print('\n=== SEM TRANSPORTADORA/TIPO — AVISA EM VEZ DE CADASTRAR VAZIO ===')
        aviso_vazio = await pg.evaluate("() => { document.getElementById('notif').innerHTML=''; cadastrarPlacaInlineUI(); return document.getElementById('notif').textContent; }")
        ck('avisou para preencher os campos', 'Transportadora' in aviso_vazio, aviso_vazio)
        ainda_fora = await pg.evaluate("() => !buscarFrota('NEW1234')")
        ck('a placa NÃO entrou na frota sem os campos', ainda_fora)

        print('\n=== PREENCHE E CADASTRA INLINE ===')
        await pg.fill('#prog-transportadora', 'Transportadora Nova Ltda')
        await pg.fill('#prog-tipoveiculo', 'Carreta')
        await pg.click('button:has-text("Cadastrar esta placa na Frota agora")')
        await pg.wait_for_timeout(300)

        d = await pg.evaluate("""() => ({
            naFrota: !!buscarFrota('NEW1234'),
            chamouServidor: window.__chamadasFrota.length > 0,
            hintAgora: document.getElementById('prog-frota-hint').textContent
        })""")
        ck('a placa entrou na frota local', d['naFrota'])
        ck('o cadastro chamou o servidor (POST /api/frota) — tem que ser de verdade, não só local',
           d['chamouServidor'])
        ck('o aviso mudou para "placa encontrada"', 'encontrada' in d['hintAgora'], d['hintAgora'])

        print('\n=== AGORA A CARGA CRIA NORMALMENTE, SEM PERDER O QUE JÁ ESTAVA DIGITADO ===')
        criada = await pg.evaluate("""() => {
            try {
                const c = criarCargaProgramada({placa:'NEW1234', numeroCarga:'99999', peso:5000, rota:'', operador:'Gestor'});
                return { ok:true, transportadora: c.transportadora, tipoVeiculo: c.tipoVeiculo };
            } catch(e) { return { ok:false, erro: e.message }; }
        }""")
        ck('a carga foi criada', criada.get('ok'), str(criada))
        ck('usou a transportadora cadastrada agora mesmo',
           criada.get('transportadora') == 'Transportadora Nova Ltda', str(criada))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
