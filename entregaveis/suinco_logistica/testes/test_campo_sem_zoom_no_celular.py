#!/usr/bin/env python3
"""Nenhum campo de digitação faz o iPhone dar zoom — com dado de verdade (11/10/2026).

ACHADO, medido num iPhone emulado (390 px, toque): na Montagem, "Destino do
frete" e "KM" estavam com fonte de 13 px. Abaixo de 16 px o iOS dá zoom ao
tocar no campo e a tela inteira sai do lugar — quem monta carga pelo celular
toca, a tela pula, e precisa desfazer o zoom com dois dedos a cada linha.

POR QUE A AUDITORIA ANTIGA NÃO PEGOU: o `test_auditoria_mobile.py` roda sem
servidor e injeta o estado. A Montagem só desenha linha com o dia carregado
do servidor, e a aba Pagamento de Frete (e o setor dela) nem estavam na
lista de abas — campo que a varredura não vê, a varredura não mede.

O CAMINHO, como a pessoa vê, com a API de verdade, num iPhone emulado:
  1. Logística entra; a Montagem de um dia com três linhas abre;
     nenhum campo das linhas tem fonte abaixo de 16 px;
  2. o formulário aberto da linha ("Colocar placa") também não;
  3. a aba Pagamento de Frete com uma carga importada, e a janela de trocar
     a transportadora, também não;
  4. toda aba que a Logística vê, idem;
  5. o setor Pagamento de Frete, nas abas dele, idem.

REPROVA contra o publicado (Destino do frete e KM em 13 px):
    SUINCO_PAINEL_ARQUIVO=<index.html publicado> bash testes/rodar_tudo.sh campo_sem_zoom_no_celular

    bash testes/rodar_tudo.sh campo_sem_zoom_no_celular
"""
import asyncio
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
PAINEL = Path(os.environ.get('SUINCO_PAINEL_ARQUIVO', str(RAIZ / 'index.html')))
PDFS = RAIZ / 'backend' / 'testes' / 'fixtures' / 'frete'
DIA = '2026-12-02'
CONTAS = {
    'Logística': 'zoom.logistica@teste.local',
    'Pagamento de Frete': 'zoom.pgfrete@teste.local',
}
falhas = []

# O que o iOS amplia ao focar: campo de texto, lista e caixa de texto.
# Caixinha de marcar, botão de rádio e seletor de arquivo não abrem teclado.
MEDIR = """(raiz) => {
  const naoAmplia = new Set(['checkbox','radio','file','hidden','range','color','button','submit','reset','image']);
  // checkVisibility: o conteúdo de um <details> fechado ainda tem caixa no
  // Chromium (offsetParent não é nulo), mas a pessoa não o vê.
  const visivel = (c) => c.checkVisibility ? c.checkVisibility({ visibilityProperty: true })
                                           : (c.offsetParent !== null && getComputedStyle(c).visibility !== 'hidden');
  return [...document.querySelectorAll(raiz + ' input, ' + raiz + ' select, ' + raiz + ' textarea')]
    .filter(c => visivel(c) && !(c.tagName === 'INPUT' && naoAmplia.has((c.type || '').toLowerCase())))
    .map(c => ({ campo: c.getAttribute('aria-label') || c.id || c.name || c.className || c.tagName,
                 px: parseFloat(getComputedStyle(c).fontSize) }))
    .filter(c => c.px < 16);
}"""


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def psql(q):
    r = subprocess.run(['su', 'postgres', '-c', 'psql -q -tA -d embarque_suinco'], input=q, capture_output=True, text=True)
    if r.returncode != 0:
        print('    [psql]', (r.stderr or '').strip()[:160])
    return r.stdout.strip()


def http(c, token=None, metodo='GET', corpo=None):
    req = urllib.request.Request(f'{API}{c}', method=metodo)
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    d = None
    if corpo is not None:
        d = json.dumps(corpo).encode(); req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, d, timeout=25) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or 'null')
        except Exception:
            return e.code, None


def operador(email, setor):
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True).stdout.strip()
    psql(f"DELETE FROM operadores WHERE email = '{email}';")
    psql(f"INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES ('{email}', '{setor} Zoom', '{setor}', '{h}', true);")
    st, r = http('/auth/login', metodo='POST', corpo={'email': email, 'senha': SENHA})
    return (r or {}).get('token')


def limpar():
    psql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}';")
    for t in ['pgfrete_eventos', 'pgfrete_leituras', 'pgfrete_pagamentos', 'pgfrete_pendencias', 'pgfrete_cargas']:
        psql(f"DELETE FROM {t} WHERE numero_carga = '900801';")
    lista = ','.join(f"'{e}'" for e in CONTAS.values())
    psql(f"DELETE FROM operadores WHERE email IN ({lista});")


async def celular(nav, setor):
    """Um iPhone 14: 390 px, toque — é o que faz o `(pointer:coarse)` valer."""
    ctx = await nav.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True,
                                has_touch=True, device_scale_factor=3)
    pg = await ctx.new_page()
    html = PAINEL.read_text(encoding='utf-8').replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    url = API + '/__painel_teste'
    await pg.route(url, lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.route('**/socket.io/socket.io.js', lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='application/javascript', body='')))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.fill('#login-email', CONTAS[setor])
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(2500)
    return pg


async def abrir_aba(pg, aba):
    """Pelo menu do celular, como a pessoa faz — a barra de abas vira gaveta."""
    await pg.evaluate("(aba) => abrirTab(aba)", aba)
    await pg.wait_for_timeout(900)


async def abas_visiveis(pg):
    return await pg.evaluate("() => [...document.querySelectorAll('.nav-tab')].filter(e => !e.hidden).map(e => e.dataset.tab)")


async def main():
    limpar()
    tokens = {s: operador(e, s) for s, e in CONTAS.items()}
    ck('operadores de teste criados', all(tokens.values()), str([s for s, t in tokens.items() if not t]))
    if not all(tokens.values()):
        return 1
    rota = psql('SELECT codigo FROM dim_rotas ORDER BY codigo LIMIT 1;')
    for _ in range(3):
        http('/api/montagem', tokens['Logística'], 'POST', {'dia': DIA, 'rotaCodigo': rota, 'qtdEntregas': 1, 'paletizada': 'Não'})
    ck('três linhas na Montagem do dia', psql(f"SELECT count(*) FROM programacao_montagem WHERE data_prog = '{DIA}';") == '3')

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []
        pg = await celular(nav, 'Logística')
        pg.on('pageerror', lambda e: erros.append(str(e)))
        ck('o aparelho é de toque (a regra do celular vale)', await pg.evaluate("() => matchMedia('(pointer:coarse)').matches"))

        print('\n=== 1. MONTAGEM COM LINHAS ===')
        await abrir_aba(pg, 'programacao')
        await pg.fill('#mont-data', DIA)
        await pg.dispatch_event('#mont-data', 'change')
        await pg.wait_for_timeout(1800)
        linhas = await pg.locator('#mont-tbody tr.mont-linha').count()
        ck('a Montagem do dia aparece com as 3 linhas', linhas == 3, str(linhas))
        nomes = await pg.evaluate("() => [...document.querySelectorAll('#mont-tbody tr.mont-linha:first-child [aria-label]')].map(e => e.getAttribute('aria-label'))")
        ck('a linha tem os campos "Destino do frete" e "KM"', 'Destino do frete' in nomes and 'KM' in nomes, str(nomes))
        pequenos = await pg.evaluate(MEDIR, '#mont-tbody')
        ck('nenhum campo das linhas abaixo de 16 px', not pequenos, str(pequenos[:6]))

        print('\n=== 2. FORMULÁRIO ABERTO DA LINHA ===')
        btn = pg.locator('#mont-tbody tr.mont-linha .mont-btn-placa').first
        if await btn.count():
            await btn.click()
            await pg.wait_for_timeout(800)
            pequenos = await pg.evaluate(MEDIR, '#mont-tbody tr.mont-detalhe')
            ck('nenhum campo do formulário abaixo de 16 px', not pequenos, str(pequenos[:6]))
        else:
            ck('(a linha tem o botão "Colocar placa")', False)

        print('\n=== 3. PAGAMENTO DE FRETE COM UMA CARGA ===')
        await abrir_aba(pg, 'frete')
        await pg.wait_for_timeout(800)
        await pg.click('#frete-btn-importar')
        await pg.wait_for_selector('#frete-arquivos', state='attached')
        await pg.set_input_files('#frete-arquivos', [str(PDFS / 'b2b_900801.pdf'), str(PDFS / 'sist_900801.pdf')])
        try:
            await pg.wait_for_selector('#modal-frete .frete-prev-ok', timeout=60000)
        except Exception:
            print('   modal:', (await pg.inner_text('#modal-frete'))[:300])
        pequenos = await pg.evaluate(MEDIR, '#modal-frete')
        ck('a prévia da importação: nenhum campo abaixo de 16 px', not pequenos, str(pequenos[:6]))
        await pg.click('#frete-btn-gravar')
        await pg.wait_for_timeout(2500)
        ck('a carga 900801 entrou no controle', psql("SELECT count(*) FROM pgfrete_cargas WHERE numero_carga='900801';") == '1')
        pequenos = await pg.evaluate(MEDIR, '#tab-frete')
        ck('a aba (busca e linhas): nenhum campo abaixo de 16 px', not pequenos, str(pequenos[:6]))
        await pg.click('#frete-mais > summary')
        await pg.wait_for_timeout(400)
        ck('"Mais filtros" abre com o toque', await pg.evaluate("() => document.getElementById('frete-mais').open"))
        pequenos = await pg.evaluate(MEDIR, '#frete-mais')
        ck('"Mais filtros" (transportadora, pendências, datas): nenhum campo abaixo de 16 px', not pequenos, str(pequenos[:6]))
        transp = pg.locator('#frete-tbody tr.frete-carga-linha[data-carga="900801"] button.frete-transp').first
        if await transp.count():
            await transp.click()
            await pg.wait_for_timeout(600)
            pequenos = await pg.evaluate(MEDIR, '#modal-frete')
            ck('a janela de trocar a transportadora: nenhum campo abaixo de 16 px', not pequenos, str(pequenos[:6]))
            await pg.keyboard.press('Escape')
            await pg.wait_for_timeout(400)
        else:
            ck('(a linha da carga tem o botão da transportadora)', False)

        print('\n=== 4. TODA ABA DA LOGÍSTICA ===')
        abas = await abas_visiveis(pg)
        ck('a Logística vê a aba Pagamento de Frete entre as dela', 'frete' in abas, str(abas))
        for aba in abas:
            await abrir_aba(pg, aba)
            pequenos = await pg.evaluate(MEDIR, '#main')
            ck(f'{aba}: nenhum campo abaixo de 16 px', not pequenos, str(pequenos[:4]))
        await pg.context.close()

        print('\n=== 5. O SETOR PAGAMENTO DE FRETE ===')
        pg = await celular(nav, 'Pagamento de Frete')
        pg.on('pageerror', lambda e: erros.append(str(e)))
        abas = await abas_visiveis(pg)
        ck('o setor vê a aba dele', 'frete' in abas, str(abas))
        for aba in abas:
            await abrir_aba(pg, aba)
            pequenos = await pg.evaluate(MEDIR, '#main')
            ck(f'{aba}: nenhum campo abaixo de 16 px', not pequenos, str(pequenos[:4]))
        await pg.context.close()

        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    print('\n=======================================================')
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print('   -', f)
        return 1
    print('  Tudo verde: nenhum campo faz o iPhone dar zoom.')
    return 0


if __name__ == '__main__':
    # A limpeza roda MESMO se a suíte cair no meio (#130).
    try:
        sys.exit(asyncio.run(main()))
    finally:
        limpar()
