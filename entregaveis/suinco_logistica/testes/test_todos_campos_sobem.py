#!/usr/bin/env python3
"""NENHUM campo digitado pode se perder no caminho até os outros setores.

POR QUE ESTA SUÍTE EXISTE (14/08/2026)
O gestor pediu, depois do sumiço das observações: "preciso que essa
atualização funcione e colha as informações de todos os inputs feitos a
partir de agora".

O campo `observacoes` se perdia porque precisava estar declarado em TRÊS
lugares independentes e faltava nos três:

  1. data.js  · SuincoStore.sincronizarCarga  (pacote que sobe)
  2. suinco-api.js · daApiParaLinha           (tradução da volta)
  3. data.js  · cargaDeLinhaRemota            (vira carga do painel)

Faltando em qualquer um, o campo some SEM ERRO NENHUM: a tela de quem
digitou continua mostrando o valor (está no localStorage), e todos os
outros veem vazio. Foi assim que o relatório Administração de Fretes ficou
em branco para todo mundo, ontem e hoje.

O mesmo já tinha acontecido com a Frota (capacidade e UF zeradas por um
pacote incompleto). É um padrão, não um acidente — por isso este teste não
olha um campo, olha TODOS de uma vez.

COMO FUNCIONA
Um terminal cria uma carga com todos os campos preenchidos com valores
distinguíveis. Outro terminal, em navegador separado e sem nada guardado,
loga do zero e recebe a carga do servidor. Cada campo é comparado.

Qualquer campo novo que alguém adicionar e esquecer de declarar nos três
pontos cai aqui.

Exige o backend local no ar e o operador de teste.

    python3 testes/test_todos_campos_sobem.py
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAIL = os.environ.get('SUINCO_EMAIL', 'chefe@teste.local')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def abrir(nav, rotulo):
    ctx = await nav.new_context()
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__painel_campos_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_timeout(1000)
    await pg.fill('#login-email', EMAIL)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    return ctx, pg, await pg.evaluate("() => DB.operador && DB.operador.setor")


# Campos que o operador digita/escolhe e que precisam chegar aos outros
# setores. Valor combinado é escolhido para ser inconfundível.
ESPERADO = {
    'numeroCarga': None,           # gerado no teste (único por execução)
    'motorista': 'Joao da Silva Teste',
    'cliente': 'Cliente Teste SA',
    'destino': 'Sao Paulo - SP',
    'peso': 12345,
    'doca': 'D7',
    'rota': '500',
    'sequencia': 9,
    'observacoes': 'Frete R$ 2.480 + pedagio — negociado com a transportadora',
    'paletizada': 'Sim',
    'qtdGanchos': 17,
    'qtdEntregas': 23,
}


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)

        print('\n=== 1. TERMINAL A PREENCHE TUDO ===')
        ctxA, pgA, setorA = await abrir(nav, 'a')
        ck('terminal A logado', bool(setorA), str(setorA))

        dados = await pgA.evaluate("""(esp) => {
            const n = 'TC' + Date.now().toString().slice(-6);
            const placa = DB.frota[7].placa;
            const c = criarCargaProgramada({
                placa, numeroCarga: n,
                cliente: esp.cliente, destino: esp.destino, peso: esp.peso,
                doca: esp.doca, rota: esp.rota, sequencia: esp.sequencia,
                observacoes: esp.observacoes, motorista: esp.motorista,
                paletizada: esp.paletizada, qtdGanchos: esp.qtdGanchos,
                qtdEntregas: esp.qtdEntregas, operador: 'Alysson',
            });
            SuincoStore.save();
            return {numeroCarga: n, placa, praOnde: c.praOnde,
                    transportadora: c.transportadora, tipoVeiculo: c.tipoVeiculo};
        }""", ESPERADO)
        await pgA.wait_for_timeout(6000)

        esperado = dict(ESPERADO)
        esperado['numeroCarga'] = dados['numeroCarga']
        # Estes três não são digitados: vêm do cadastro da Frota. Mas
        # precisam atravessar igual, senão a carga chega sem transportadora.
        esperado['placa'] = dados['placa']
        esperado['transportadora'] = dados['transportadora']
        esperado['tipoVeiculo'] = dados['tipoVeiculo']
        esperado['praOnde'] = dados['praOnde']

        print('\n=== 2. TERMINAL B RECEBE — CAMPO A CAMPO ===')
        ctxB, pgB, setorB = await abrir(nav, 'b')
        ck('terminal B logado', bool(setorB), str(setorB))
        await pgB.wait_for_timeout(3000)

        recebido = await pgB.evaluate("""(n) => {
            const c = DB.cargas.find(x => x.numeroCarga === n);
            if(!c) return null;
            return {
                numeroCarga: c.numeroCarga, placa: c.placa,
                transportadora: c.transportadora, tipoVeiculo: c.tipoVeiculo,
                motorista: c.motorista, cliente: c.cliente, destino: c.destino,
                peso: c.peso, doca: c.doca, rota: c.rota, sequencia: c.sequencia,
                observacoes: c.observacoes, praOnde: c.praOnde,
                paletizada: c.paletizada, qtdGanchos: c.qtdGanchos,
                qtdEntregas: c.qtdEntregas,
            };
        }""", esperado['numeroCarga'])

        ck('a carga chegou ao terminal B', recebido is not None)
        if recebido:
            for campo, valor in esperado.items():
                ck(f'{campo}', recebido.get(campo) == valor,
                   f'esperado {valor!r}, recebido {recebido.get(campo)!r}')

        await ctxA.close()
        await ctxB.close()
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    if falhas:
        print('\n  Cada campo acima que falhou precisa ser declarado em TRÊS')
        print('  lugares: sincronizarCarga (data.js), daApiParaLinha')
        print('  (suinco-api.js) e cargaDeLinhaRemota (data.js).')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
