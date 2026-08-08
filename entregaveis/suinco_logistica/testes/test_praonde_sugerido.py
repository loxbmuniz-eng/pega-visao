#!/usr/bin/env python3
"""Chegada sem programação sugere o Tipo de Operação certo, não sempre FROTA PRÓPRIA.

Achado do gestor em produção (08/08/2026), a partir do relatório do dia
anterior: "vários carros constando como frota própria e não são". A causa
— registrarChegadaPortaria() (Portaria clica "Chegou" numa placa sem
programação prévia) gravava praOnde:'FROTA PROPRIA' sempre, mesmo já
sabendo pela Frota que a transportadora era terceirizada (AC Transportes,
AJB Transportes, Denia Transportes...). O formulário "Completar dados"
que a Logística usa depois vinha com o mesmo valor errado pré-marcado,
fácil de não notar.

Corrigido com praOndeSugerido(transportadora): "Suinco" continua sendo
FROTA PRÓPRIA; qualquer outra transportadora CONHECIDA vira DEDICADA — a
categoria que a própria Logística já usa pra terceirizada em toda carga
programada manualmente. Transportadora desconhecida (placa fora da Frota)
mantém o padrão de sempre.

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

        print('\n=== 1. FUNÇÃO praOndeSugerido() ISOLADA ===')
        casos = await pg.evaluate("""() => ({
            suinco: praOndeSugerido('Suinco'),
            suincoMinusculo: praOndeSugerido('suinco'),
            suincoComEspaco: praOndeSugerido('  Suinco  '),
            terceirizada: praOndeSugerido('AC Transportes'),
            vazia: praOndeSugerido(''),
            nula: praOndeSugerido(null),
        })""")
        ck('Suinco → FROTA PROPRIA', casos['suinco'] == 'FROTA PROPRIA', casos['suinco'])
        ck('suinco minúsculo → FROTA PROPRIA (case-insensitive)',
           casos['suincoMinusculo'] == 'FROTA PROPRIA', casos['suincoMinusculo'])
        ck('"  Suinco  " com espaços → FROTA PROPRIA (trim)',
           casos['suincoComEspaco'] == 'FROTA PROPRIA', casos['suincoComEspaco'])
        ck('transportadora terceirizada conhecida → DEDICADA',
           casos['terceirizada'] == 'DEDICADA', casos['terceirizada'])
        ck('transportadora vazia (desconhecida) → padrão de sempre',
           casos['vazia'] == 'FROTA PROPRIA', casos['vazia'])
        ck('transportadora nula → padrão de sempre', casos['nula'] == 'FROTA PROPRIA', casos['nula'])

        print('\n=== 2. CHEGADA SEM PROGRAMAÇÃO: PLACA COM TRANSPORTADORA TERCEIRIZADA ===')
        d = await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = [];
            const alvo = DB.frota.find(f => (f.transportadora||'').trim().toLowerCase() !== 'suinco');
            registrarChegadaPortaria(alvo.placa, 'Bruno');
            const c = DB.cargas.find(c => c.placa === alvo.placa);
            return { transportadora: alvo.transportadora, praOnde: c.praOnde };
        }""")
        ck('carga criada NÃO fica marcada como FROTA PRÓPRIA',
           d['praOnde'] != 'FROTA PROPRIA', str(d))
        ck('vira DEDICADA (a transportadora era terceirizada, não Suinco)',
           d['praOnde'] == 'DEDICADA', str(d))

        print('\n=== 3. CHEGADA SEM PROGRAMAÇÃO: PLACA DA FROTA PRÓPRIA (Suinco) ===')
        d2 = await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = [];
            const alvo = DB.frota.find(f => (f.transportadora||'').trim().toLowerCase() === 'suinco');
            if (!alvo) return { semExemplo: true };
            registrarChegadaPortaria(alvo.placa, 'Bruno');
            const c = DB.cargas.find(c => c.placa === alvo.placa);
            return { transportadora: alvo.transportadora, praOnde: c.praOnde };
        }""")
        if d2.get('semExemplo'):
            print('  (pulado: nenhuma placa da Frota tem transportadora "Suinco" nesta base de teste)')
        else:
            ck('placa de frota própria de verdade continua FROTA PRÓPRIA',
               d2['praOnde'] == 'FROTA PROPRIA', str(d2))

        print('\n=== 4. FORMULÁRIO "COMPLETAR DADOS" JÁ ABRE COM A SUGESTÃO CERTA ===')
        d3 = await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = [];
            const alvo = DB.frota.find(f => (f.transportadora||'').trim().toLowerCase() !== 'suinco');
            registrarChegadaPortaria(alvo.placa, 'Bruno');
            const c = DB.cargas.find(c => c.placa === alvo.placa);
            abrirCompletar(c.id);
            return document.getElementById('completar-praonde').value;
        }""")
        ck('modal de completar dados já sugere DEDICADA, não FROTA PRÓPRIA',
           d3 == 'DEDICADA', d3)

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
