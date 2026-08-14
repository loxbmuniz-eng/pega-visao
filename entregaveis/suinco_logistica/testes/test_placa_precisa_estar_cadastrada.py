#!/usr/bin/env python3
"""Só placa cadastrada na Frota entra no sistema — inclusive na Portaria.

Pedido do gestor (14/08/2026), via dono do projeto: "cheguei na portaria,
você me deixou entrar com uma placa não cadastrada? ... só vamos aceitar
placas que estejam cadastradas, vinculadas a uma transportadora no
cadastro".

O QUE MUDA E POR QUÊ IMPORTA REGISTRAR
--------------------------------------
A trava de Frota já existia para a PROGRAMAÇÃO: placa fora da base não
vira carga programada (backend, 422 PLACA_FORA_DA_FROTA). Mas a chegada
sem programação pela Portaria era uma EXCEÇÃO DELIBERADA: o comentário em
rotas/cargas.js dizia que "a Portaria precisa registrar a presença do
caminhão mesmo que ele nunca tenha sido cadastrado, e a Logística corrige
o cadastro depois".

O gestor decidiu o contrário: a placa é o vínculo com a transportadora, e
caminhão sem cadastro não deve gerar movimento nenhum. Esta suíte fixa a
regra nova para que ninguém a desfaça sem querer mais adiante.

CONSEQUÊNCIA OPERACIONAL (foi comunicada, não é efeito colateral
escondido): com isto, um caminhão que chega sem cadastro NÃO pode ser
registrado pela Portaria. Alguém da Logística/Administração precisa
cadastrar a placa antes. A mensagem de erro precisa dizer isso — travar
sem explicar o caminho seria trocar um problema por outro.

    python3 testes/test_placa_precisa_estar_cadastrada.py
"""
import asyncio
import sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
PLACA_FANTASMA = 'ZZZ9X99'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        pg = await nav.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Porteiro')
        await pg.select_option('#login-setor', 'Portaria')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)

        print('\n=== 1. PLACA NÃO CADASTRADA NÃO ENTRA PELA PORTARIA ===')
        r = await pg.evaluate("""(placa) => {
            const antes = DB.cargas.length;
            let erro = null;
            try { registrarChegadaPortaria(placa, 'Porteiro'); }
            catch(e){ erro = e.message; }
            return {erro, criou: DB.cargas.length - antes};
        }""", PLACA_FANTASMA)
        ck('a chegada é recusada', bool(r['erro']), str(r))
        ck('NENHUMA carga foi criada', r['criou'] == 0, f"criou {r['criou']}")
        ck('o aviso cita a placa recusada',
           bool(r['erro']) and PLACA_FANTASMA in r['erro'], str(r['erro']))
        ck('o aviso ensina o caminho (cadastrar na Frota)',
           bool(r['erro']) and 'Frota' in r['erro'], str(r['erro']))

        print('\n=== 2. NADA FOI REGISTRADO NO HISTÓRICO ===')
        # Travar mas deixar rastro de movimentação seria pior que não travar:
        # geraria carga fantasma no log sem carga correspondente.
        mov = await pg.evaluate("""(placa) =>
            DB.movimentacoes.filter(m => m.placa === placa).length""", PLACA_FANTASMA)
        ck('sem movimentação no histórico', mov == 0, f'{mov} movimentações')

        print('\n=== 3. PLACA CADASTRADA CONTINUA ENTRANDO NORMALMENTE ===')
        # O risco real desta mudança é travar demais. Esta é a prova de que
        # a operação normal do porteiro segue funcionando.
        ok = await pg.evaluate("""() => {
            const placa = DB.frota[0].placa;
            const antes = DB.cargas.length;
            let erro = null;
            try { registrarChegadaPortaria(placa, 'Porteiro'); }
            catch(e){ erro = e.message; }
            const nova = DB.cargas[DB.cargas.length-1];
            return {placa, erro, criou: DB.cargas.length - antes,
                    transportadora: nova && nova.transportadora};
        }""")
        ck('placa cadastrada é aceita', not ok['erro'], str(ok['erro']))
        ck('a carga foi criada', ok['criou'] == 1, str(ok))
        ck('a transportadora veio do cadastro (o vínculo pedido pelo gestor)',
           bool(ok['transportadora']), str(ok['transportadora']))

        print('\n=== 4. PROGRAMAR CARGA COM PLACA NÃO CADASTRADA CONTINUA BLOQUEADO ===')
        r2 = await pg.evaluate("""(placa) => {
            let erro = null;
            try { criarCargaProgramada({placa, numeroCarga:'X1', peso:1000,
                    rota:'500', operador:'Ana'}); }
            catch(e){ erro = e.message; }
            return erro;
        }""", PLACA_FANTASMA)
        ck('programação segue recusando placa fora da Frota', bool(r2), str(r2))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
