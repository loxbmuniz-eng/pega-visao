#!/usr/bin/env python3
"""Carga criada na Montagem de OUTRO dia nasce com o dia da Montagem (#114, 06/10/2026).

Relato do dono, em produção: "foi criada uma carga para amanhã dia 7 no
adicionar linha da montagem do dia (...) ela aparece na montagem do dia 7
porém quando clico na fila de programados e coloco o dia 7 ela ainda não
aparece".

A causa: ao criar a carga, a Montagem não passava o DIA dela, e a carga
nascia carimbada com o instante do clique — hoje. A Fila de programados (e
todo relatório por dia de programação) lê esse carimbo, então a carga de
amanhã aparecia na fila de HOJE e sumia da de amanhã.

O caminho é o do dono, pela tela: Montagem no dia de AMANHÃ → Adicionar
linha → número e placa → Criar carga → Fila de programados de amanhã e de
hoje → Torre. E a prova do outro lado: Montagem de HOJE continua nascendo
hoje. As datas são relativas (amanhã/hoje) — data fixa vence sozinha (#110).

    bash testes/rodar_tudo.sh montagem_de_outro_dia_vai_para_o_dia_certo
"""
import asyncio
import os
import subprocess
import sys
from playwright.async_api import async_playwright
from _frete_resposta import responder_frete

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
RAIZ = '/home/user/pega-visao/entregaveis/suinco_logistica'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAIL = 'montagem.outro.dia@teste.local'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def psql(q):
    return subprocess.run(['su', 'postgres', '-c', 'psql -q -tA -d embarque_suinco'], input=q,
                          capture_output=True, text=True).stdout.strip()


def limpar(numeros):
    lista = ','.join(f"'{n}'" for n in numeros)
    psql(f"DELETE FROM programacao_montagem WHERE numero_carga IN ({lista});"
         f"DELETE FROM fact_statusfrota WHERE carga_id IN (SELECT carga_id FROM fact_viagens WHERE numero_carga IN ({lista}));"
         f"DELETE FROM log_eventos WHERE carga_id IN (SELECT carga_id FROM fact_viagens WHERE numero_carga IN ({lista}));"
         f"DELETE FROM fact_viagens WHERE numero_carga IN ({lista});")


async def valores(pg, corpo):
    """O que a pessoa lê na tabela: o texto e o que está escrito nos campos."""
    texto = await pg.inner_text(corpo)
    campos = await pg.eval_on_selector_all(f'{corpo} input', 'els => els.map(e => e.value)')
    return texto + ' ' + ' '.join(campos)


async def criar_pela_montagem(pg, dia, numero, placa, rota):
    await pg.click('.nav-tab[data-tab="programacao"]')
    await pg.wait_for_timeout(600)
    await pg.fill('#mont-data', dia)
    await pg.dispatch_event('#mont-data', 'change')
    await pg.wait_for_timeout(1500)
    await pg.select_option('#mont-rota-extra', rota)
    await pg.wait_for_timeout(300)
    if await pg.is_visible('#mont-destino-extra'):
        ops = await pg.eval_on_selector_all('#mont-destino-extra option', 'els => els.map(e => e.value).filter(Boolean)')
        if ops:
            await pg.select_option('#mont-destino-extra', ops[0])
    await pg.click('button:has-text("Adicionar linha")')
    await pg.wait_for_timeout(1500)
    linha = pg.locator('#mont-tbody tr').filter(has=pg.locator('input.placa-input[value=""]')).last
    await linha.locator('input.numero-carga-input').fill(numero)
    await linha.locator('input.numero-carga-input').dispatch_event('change')
    await pg.wait_for_timeout(1000)
    linha = pg.locator('#mont-tbody tr').filter(has=pg.locator(f'input.numero-carga-input[value="{numero}"]')).last
    await linha.locator('input.placa-input').fill(placa)
    await linha.locator('input.placa-input').dispatch_event('change')
    await pg.wait_for_timeout(1500)
    await pg.locator('#mont-tbody .mont-btn-criar').last.click()
    await responder_frete(pg)   # linha sem frete: Criar carga pergunta (#115)
    await pg.wait_for_timeout(3000)


async def fila_do_dia(pg, dia):
    await pg.click('.nav-tab[data-tab="programacao"]')
    await pg.wait_for_timeout(400)
    await pg.fill('#prog-fila-dia', dia)
    await pg.dispatch_event('#prog-fila-dia', 'change')
    await pg.wait_for_timeout(800)
    return await valores(pg, '#prog-fila-tbody')


async def main():
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=RAIZ + '/backend', capture_output=True, text=True).stdout.strip()
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}';"
         f"INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES ('{EMAIL}', 'Logística Outro Dia', 'Logística', '{h}', true);")
    placas = psql("SELECT string_agg(placa, '|') FROM (SELECT v.placa FROM dim_veiculos v LEFT JOIN fact_viagens f "
                  "ON f.placa = v.placa AND f.excluida_em IS NULL WHERE v.transportadora <> '' AND f.carga_id IS NULL "
                  "ORDER BY v.placa LIMIT 2) t").split('|')
    rota = psql("SELECT codigo FROM dim_rotas ORDER BY codigo LIMIT 1")
    ck('duas placas livres e uma rota para o teste', len(placas) == 2 and bool(rota), f'{placas} {rota}')
    AMANHA_N, HOJE_N = 'OD-AMANHA', 'OD-HOJE'
    limpar([AMANHA_N, HOJE_N])

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 1000})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        html = open(RAIZ + '/index.html', encoding='utf-8').read().replace(
            "api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        await pg.route(API + '/__outro_dia', lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.route('**/socket.io/socket.io.js', lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='application/javascript', body='')))
        await pg.goto(API + '/__outro_dia')
        await pg.wait_for_selector('#login-email')
        await pg.fill('#login-email', EMAIL)
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(2500)
        hoje = await pg.evaluate("() => isoDiaLocal(new Date())")
        amanha = await pg.evaluate("() => { const d = new Date(); d.setDate(d.getDate() + 1); return isoDiaLocal(d); }")
        br = lambda d: '/'.join(reversed(d.split('-')))

        print(f'\n=== 1. MONTAGEM DE AMANHÃ ({br(amanha)}) → CRIAR CARGA ===')
        await criar_pela_montagem(pg, amanha, AMANHA_N, placas[0], rota)
        no_banco = psql(f"SELECT to_char(programado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') FROM fact_viagens WHERE numero_carga = '{AMANHA_N}'")
        ck('a carga foi criada no banco', bool(no_banco), no_banco)
        ck(f'e nasceu com o dia da Montagem ({br(amanha)}), não com o do clique', no_banco == amanha, f'gravado: {no_banco}')
        ck(f'a Fila de programados de {br(amanha)} mostra a carga', AMANHA_N in await fila_do_dia(pg, amanha))
        ck(f'a Fila de HOJE ({br(hoje)}) não mostra a carga de amanhã', AMANHA_N not in await fila_do_dia(pg, hoje))
        await pg.click('.nav-tab[data-tab="torre"]')
        await pg.wait_for_timeout(1000)
        ck('a Torre continua mostrando a carga (tem placa)', AMANHA_N in await valores(pg, '#torre-tbody'))

        print(f'\n=== 2. MONTAGEM DE HOJE ({br(hoje)}) CONTINUA NASCENDO HOJE ===')
        await criar_pela_montagem(pg, hoje, HOJE_N, placas[1], rota)
        no_banco = psql(f"SELECT to_char(programado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') FROM fact_viagens WHERE numero_carga = '{HOJE_N}'")
        ck(f'a carga de hoje nasce com {br(hoje)}', no_banco == hoje, f'gravado: {no_banco}')
        ck('e está na Fila de hoje', HOJE_N in await fila_do_dia(pg, hoje))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    limpar([AMANHA_N, HOJE_N])
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}';")
    print('\n' + ('FALHAS: ' + '; '.join(falhas) if falhas else 'TUDO OK'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
