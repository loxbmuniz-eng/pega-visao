#!/usr/bin/env python3
"""Fechamento de programação com senha mestre (substitui o bloqueio).

MUDANÇA DE DECISÃO, registrada de propósito: em 08/08/2026 o usuário
escolheu BLOQUEAR o fechamento havendo carga em andamento. Em 11/08/2026
ele reverteu: "COLOCAR UMA SENHA AO INVES DE BLOQUEAR"; "da pra fechar
programacao mesmo com carga em aberto mas essa carga fica em aberto na
torre de controle e vai pro historico de programacoes... precisamos ter
esse controle e tomada de decisao em nossas maos".

O que estes testes protegem NÃO é mais "não deixar fechar" — é a garantia
que substituiu o bloqueio: fechar nunca apaga nem esconde carga. A carga
em aberto continua na Torre, com a data em que foi programada.

Exige o backend rodando local.

    python3 testes/test_fechar_com_senha.py
"""
import asyncio
import os
import subprocess
import sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
SENHA_FECHAR = os.environ.get('SUINCO_SENHA_FECHAR', 'senha-teste-fechar')
PAINEL = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def limpar_patio():
    subprocess.run(
        ['psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'embarque_suinco', '-c',
         "UPDATE fact_viagens SET status_atual='Seguiu Viagem' WHERE status_atual <> 'Seguiu Viagem'"],
        env={**os.environ, 'PGPASSWORD': 'teste-local-sem-valor'},
        capture_output=True, check=False)


async def abrir(ctx):
    pg = await ctx.new_page()
    html = open(PAINEL, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    url = API + '/__painel_teste'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.route('**/socket.io/socket.io.js', lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='application/javascript', body='')))
    await pg.goto(url)
    await pg.wait_for_timeout(1200)
    await pg.fill('#login-email', 'ana@teste.local')
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(2200)
    return pg


async def main():
    limpar_patio()
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctx = await nav.new_context()
        pg = await abrir(ctx)
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        print('\n=== 1. PÁTIO LIMPO: FECHA SEM PEDIR SENHA ===')
        await pg.evaluate("() => { window.confirm = () => true; }")
        pedidos = []
        pg.on('dialog', lambda d: (pedidos.append(d.message), asyncio.ensure_future(d.accept())))
        await pg.evaluate("() => fecharProgramacaoUI()")
        await pg.wait_for_timeout(2000)
        ck('não pediu senha com o pátio limpo',
           not any('senha' in m.lower() for m in pedidos), str(pedidos))

        print('\n=== 2. COM CARGA EM ABERTO: PEDE A SENHA ===')
        placa = await pg.evaluate("() => DB.frota[0].placa")
        await pg.evaluate("""(placa) => {
            criarCargaProgramada({placa, numeroCarga:'SENHA-1', peso:9000,
                rota:'500', operador:'Ana'});
        }""", placa)
        await pg.wait_for_timeout(1500)

        pedidos.clear()
        # Recusa a senha (dismiss) — o fechamento tem que ser abortado.
        await pg.evaluate("() => { window.prompt = () => null; }")
        await pg.evaluate("() => fecharProgramacaoUI()")
        await pg.wait_for_timeout(1800)
        ainda_aberta = await pg.evaluate(
            "() => DB.cargas.some(c=>c.numeroCarga==='SENHA-1' && c.status!=='Seguiu Viagem')")
        ck('carga continua em aberto depois de desistir da senha', ainda_aberta)

        print('\n=== 3. SENHA ERRADA NÃO FECHA ===')
        await pg.evaluate("() => { window.prompt = () => 'senha-errada-mesmo'; }")
        await pg.evaluate("() => fecharProgramacaoUI()")
        await pg.wait_for_timeout(2000)
        avisos = await pg.evaluate(
            "() => Array.from(document.querySelectorAll('.notif-item')).map(n=>n.textContent).join(' | ')")
        ck('avisa que a senha está incorreta', 'incorreta' in avisos.lower(), avisos[:200])

        print('\n=== 4. SENHA CERTA FECHA — E A CARGA NÃO SOME ===')
        await pg.evaluate("(s) => { window.prompt = () => s; }", SENHA_FECHAR)
        await pg.evaluate("() => fecharProgramacaoUI()")
        await pg.wait_for_timeout(2500)

        estado = await pg.evaluate("""() => {
            const c = DB.cargas.find(x=>x.numeroCarga==='SENHA-1');
            return {existe: !!c, status: c && c.status};
        }""")
        ck('a carga NÃO foi apagada', estado['existe'], str(estado))
        ck('a carga continua EM ABERTO', estado['status'] != 'Seguiu Viagem', str(estado))

        await pg.evaluate("() => irParaTab('torre')")
        await pg.wait_for_timeout(800)
        nums = await pg.eval_on_selector_all(
            '#torre-tbody .numero-carga-input', 'els => els.map(e=>e.value)')
        ck('a carga continua VISÍVEL na Torre de Controle', 'SENHA-1' in nums, str(nums))
        ck('a Torre mostra a data em que foi programada',
           'Programada em' in (await pg.inner_text('#torre-thead')))

        print('\n=== 5. O CICLO FECHADO ENTROU NO HISTÓRICO DE PROGRAMAÇÕES ===')
        progs = await pg.evaluate("async () => await SuincoSharePoint.listarProgramacoes()")
        forcados = [p for p in progs if p.get('forcado')]
        ck('existe ciclo marcado como forçado', len(forcados) > 0, str(len(progs)))
        ck('existe um ciclo aberto agora', any(p.get('aberta') for p in progs))
        if forcados:
            ck('o ciclo forçado registra quantas ficaram em aberto',
               forcados[0].get('cargasEmAberto', 0) > 0, str(forcados[0]))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
