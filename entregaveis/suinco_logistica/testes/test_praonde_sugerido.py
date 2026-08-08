#!/usr/bin/env python3
"""Tipo de Operação: 3 categorias, FROTA PRÓPRIA não existe mais.

Histórico em duas partes:

1. (07/08/2026) Achado do gestor em produção: "vários carros constando
   como frota própria e não são". A causa — registrarChegadaPortaria()
   (Portaria clica "Chegou" numa placa sem programação prévia) gravava
   praOnde:'FROTA PROPRIA' sempre, mesmo já sabendo pela Frota que a
   transportadora era terceirizada. Corrigido com praOndeSugerido(),
   derivando o valor da transportadora conhecida.

2. (08/08/2026) Pedido direto do gestor (Alysson, via WhatsApp): "Exclua
   esse frota propria. E altere o dedicada para entrega direta. E deixe
   somente esses tres: Cross / Entrega Direta / Ret Frigo." FROTA PRÓPRIA
   e DEDICADA colapsam numa categoria só (ENTREGA DIRETA) — caminhão da
   própria Suinco fazendo entrega direta é operacionalmente a mesma coisa
   que terceiro dedicado fazendo entrega direta. praOndeSugerido() não
   tem mais distinção nenhuma pra fazer (as duas antigas viram a mesma),
   então sempre devolve o padrão agora — mantida como função, não inline,
   pra quem chama não precisar saber dessa mudança de regra.

   Migração do dado já gravado: backend/migrations/003_tipo_operacao.sql.

    python3 testes/test_praonde_sugerido.py
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
        await pg.select_option('#login-setor', 'Portaria')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(400)

        print('\n=== 1. SÓ 3 OPÇÕES, EM TODA PARTE ===')
        opcoes = await pg.evaluate("() => PRA_ONDE_OPCOES")
        ck('exatamente 3 categorias', len(opcoes) == 3, opcoes)
        ck('FROTA PROPRIA não existe mais', 'FROTA PROPRIA' not in opcoes, opcoes)
        ck('DEDICADA não existe mais (virou ENTREGA DIRETA)', 'DEDICADA' not in opcoes, opcoes)
        ck('as 3 são Cross-Docking/Entrega Direta/Ret Frigo',
           set(opcoes) == {'CROSS-DOCKING', 'ENTREGA DIRETA', 'RET FRIGO'}, opcoes)

        await pg.evaluate("() => abrirTab('programacao')")
        await pg.wait_for_timeout(200)
        select_prog = await pg.evaluate(
            "() => [...document.getElementById('prog-praonde').options].map(o => o.value)")
        ck('<select> da Programação também só tem as 3',
           set(select_prog) == {'CROSS-DOCKING', 'ENTREGA DIRETA', 'RET FRIGO'}, select_prog)

        print('\n=== 2. praOndeSugerido() SEMPRE DEVOLVE O PADRÃO AGORA ===')
        casos = await pg.evaluate("""() => ({
            suinco: praOndeSugerido('Suinco'),
            terceirizada: praOndeSugerido('AC Transportes'),
            vazia: praOndeSugerido(''),
            nula: praOndeSugerido(null),
        })""")
        for chave, valor in casos.items():
            ck(f'{chave} → ENTREGA DIRETA (padrão único agora)', valor == 'ENTREGA DIRETA', valor)

        print('\n=== 3. CHEGADA SEM PROGRAMAÇÃO NUNCA MAIS CRIA FROTA PRÓPRIA ===')
        d = await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = [];
            const alvo = DB.frota.find(f => (f.transportadora||'').trim().toLowerCase() !== 'suinco');
            registrarChegadaPortaria(alvo.placa, 'Bruno');
            const c = DB.cargas.find(c => c.placa === alvo.placa);
            return { transportadora: alvo.transportadora, praOnde: c.praOnde };
        }""")
        ck('carga criada vem como ENTREGA DIRETA', d['praOnde'] == 'ENTREGA DIRETA', str(d))

        print('\n=== 4. FORMULÁRIO "COMPLETAR DADOS" TAMBÉM SÓ OFERECE AS 3 ===')
        d3 = await pg.evaluate("""() => {
            const c = DB.cargas[0];
            abrirCompletar(c.id);
            return {
                valorAtual: document.getElementById('completar-praonde').value,
                opcoes: [...document.getElementById('completar-praonde').options].map(o => o.value),
            };
        }""")
        ck('sugestão pré-marcada é ENTREGA DIRETA', d3['valorAtual'] == 'ENTREGA DIRETA', d3)
        ck('<select> de completar dados só tem as 3 categorias',
           set(d3['opcoes']) == {'CROSS-DOCKING', 'ENTREGA DIRETA', 'RET FRIGO'}, d3)

        print('\n=== 5. DADO ANTIGO (localStorage com valor extinto) É AUTOCORRIGIDO NO LOAD ===')
        d4 = await pg.evaluate("""() => {
            DB.cargas = [{
                id: 'carga_teste_antigo', placa: 'ABC1D23', numeroCarga: 'X1',
                status: 'Aguardando Veículo', praOnde: 'FROTA PROPRIA',
                criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString(),
            }];
            const n = migrarPraOnde();
            return { praOndeDepois: DB.cargas[0].praOnde, quantasMigradas: n };
        }""")
        ck('valor extinto FROTA PROPRIA vira ENTREGA DIRETA sozinho ao carregar',
           d4['praOndeDepois'] == 'ENTREGA DIRETA', str(d4))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
