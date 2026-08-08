#!/usr/bin/env python3
"""Torre de Controle mostra quantos caminhões já seguiram viagem hoje.

Pedido do usuário (08/08/2026): "na torre de controle nao aparece quantos
seguiram viagem voce esqueceu do principal?". A Torre já tinha uma caixa
por etapa aberta (Aguardando Veículo...Faturado), mas "Seguiu Viagem" fica
de fora de `cargasAbertas()` de propósito — carga que já saiu não é mais
pátio em aberto — então nunca teve caixa própria.

Contado por HOJE (instante real da saída, via primeiroTimestamp), não o
total histórico: DB.cargas guarda tudo desde sempre, e a pergunta que
importa no dia a dia é "quantos saíram hoje", não "quantos já saíram
desde que o painel existe".

    python3 testes/test_seguiu_viagem_hoje.py
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

        print('\n=== 1. CAIXA "SEGUIU VIAGEM HOJE" EXISTE NA TORRE ===')
        d = await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = [];
            const f = DB.frota;

            // 2 cargas que seguem viagem HOJE.
            for (let i = 0; i < 2; i++) {
                const c = criarCargaProgramada({ placa: f[i].placa, numeroCarga: 'HOJE'+i,
                    peso: 9000, rota: '500', operador: 'Ana' });
                ['Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado','Seguiu Viagem']
                    .forEach(st => avancarStatusCarga(c.id, st, 'Ana', 'Logística'));
            }
            // 1 carga ainda em aberto (não deve contar na nova caixa).
            criarCargaProgramada({ placa: f[2].placa, numeroCarga: 'ABERTA',
                peso: 9000, rota: '500', operador: 'Ana' });

            renderTorre();
            const el = document.querySelector('[data-contador="Seguiu Viagem hoje"]');
            return { existe: !!el, valor: el ? el.textContent.trim() : null };
        }""")
        ck('a caixa existe', d['existe'], str(d))
        ck('conta as 2 que seguiram viagem hoje', d['valor'] == '2', str(d))

        print('\n=== 2. CARGA QUE SEGUIU VIAGEM ONTEM NÃO CONTA HOJE ===')
        d2 = await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = [];
            const f = DB.frota;
            const c = criarCargaProgramada({ placa: f[0].placa, numeroCarga: 'ONTEM',
                peso: 9000, rota: '500', operador: 'Ana' });
            ['Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado','Seguiu Viagem']
                .forEach(st => avancarStatusCarga(c.id, st, 'Ana', 'Logística'));
            // Força a movimentação de "Seguiu Viagem" pra ontem.
            const ontem = new Date(Date.now() - 24*3600*1000).toISOString();
            const mov = DB.movimentacoes.find(m => m.cargaId === c.id && m.statusNovo === 'Seguiu Viagem');
            mov.timestamp = ontem;

            renderTorre();
            const el = document.querySelector('[data-contador="Seguiu Viagem hoje"]');
            return el.textContent.trim();
        }""")
        ck('carga que saiu ontem não entra na contagem de hoje', d2 == '0', d2)

        print('\n=== 3. NÃO ENTRA NA CONTAGEM DE "CARGAS EM ABERTO" ===')
        d3 = await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = [];
            const c = criarCargaProgramada({ placa: DB.frota[0].placa, numeroCarga: 'X1',
                peso: 9000, rota: '500', operador: 'Ana' });
            ['Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado','Seguiu Viagem']
                .forEach(st => avancarStatusCarga(c.id, st, 'Ana', 'Logística'));
            renderTorre();
            return document.querySelector('[data-contador="Cargas em aberto"]').textContent.trim();
        }""")
        ck('"Cargas em aberto" continua excluindo Seguiu Viagem (comportamento antigo preservado)',
           d3 == '0', d3)

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
