#!/usr/bin/env python3
"""Pagamento de Frete: CANCELADA e OK (AVULSO) liberam; sai SUMIU DO B2B (15/10/2026).

O PEDIDO, trazido pelo dono: "incluir também OK (AVULSO) e excluir esse SUMIU
DO B2B. Colocar como regra, CANCELADA, OK, DEVOLUÇÃO, E OK (AVULSO) liberada
para pagamento. Não considerar como pagamento, somente SEM TRATATIVA". As notas
que já estavam SUMIU DO B2B voltam a "falta olhar" (resposta A do dono), e
quem marcou antes continua no histórico da nota.

O CAMINHO, com a API de verdade:
  1. a carga 900802 no controle, com uma nota marcada SUMIU DO B2B — e a
     migração 068 roda sobre ela, como vai rodar no servidor;
  2. pela tela, a nota aparece como "falta olhar", e a lista de escolha tem
     CANCELADA e OK (AVULSO) e não tem mais SUMIU DO B2B;
  3. o Histórico da carga mostra "SUMIU DO B2B → falta olhar", feito pela
     atualização do servidor (068);
  4. escolher CANCELADA na lista grava, pinta o selo de "libera" e a carga
     passa a ter essa nota liberada.

REPROVA contra o publicado (o histórico não diz de onde para onde):
    SUINCO_PAINEL_ARQUIVO=<index.html publicado> bash testes/rodar_tudo.sh frete_cancelada_ok_avulso

    bash testes/rodar_tudo.sh frete_cancelada_ok_avulso
"""
import asyncio
import base64
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
MIG_068 = RAIZ / 'backend' / 'migrations' / '068_tratativas_cancelada_avulso.sql'
EMAIL = 'frete.cancelada@teste.local'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def psql(q, uma_transacao=False):
    r = subprocess.run(['su', 'postgres', '-c', 'psql -q -tA -d embarque_suinco' + (' -1 -v ON_ERROR_STOP=1' if uma_transacao else '')],
                       input=q, capture_output=True, text=True)
    if r.returncode != 0:
        print('    [psql]', (r.stderr or '').strip()[:200])
    return r.stdout.strip()


def http(c, token=None, metodo='GET', corpo=None):
    req = urllib.request.Request(f'{API}{c}', method=metodo)
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    d = None
    if corpo is not None:
        d = json.dumps(corpo).encode()
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, d, timeout=60) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or 'null')
        except Exception:
            return e.code, None


def limpar():
    for t in ['pgfrete_eventos', 'pgfrete_leituras', 'pgfrete_pagamentos', 'pgfrete_pendencias', 'pgfrete_cargas']:
        psql(f'DELETE FROM {t};')
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}';")


def importar(token, numero):
    def subir(nome, lote=None):
        corpo = {'arquivo': base64.b64encode((PDFS / nome).read_bytes()).decode(), 'nome': nome}
        if lote:
            corpo['lote'] = lote
        return http('/api/pagamento-frete/leituras', token, 'POST', corpo)
    st, a = subir(f'b2b_{numero}.pdf')
    st2, _ = subir(f'sist_{numero}.pdf', (a or {}).get('lote'))
    st3, _ = http(f"/api/pagamento-frete/lotes/{(a or {}).get('lote')}/confirmar", token, 'POST', {})
    return st, st2, st3


def liberado_da_carga(token):
    st, g = http('/api/pagamento-frete', token)
    i = next(i for i, c in enumerate(g['colunas']) if c['chave'] == 'liberado')
    linha = next(l for l in g['linhas'] if str(l['carga']) == '900802' and l.get('primeira'))
    return linha['v'][i]


async def main():
    limpar()
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True).stdout.strip()
    psql(f"INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES ('{EMAIL}', 'Frete Cancelada', 'Pagamento de Frete', '{h}', true);")
    _, login = http('/auth/login', metodo='POST', corpo={'email': EMAIL, 'senha': SENHA})
    tok = (login or {}).get('token')

    print('\n=== 1. UMA NOTA SUMIU DO B2B, E A MIGRAÇÃO 068 RODA SOBRE ELA ===')
    ck('a carga 900802 entrou no controle', importar(tok, '900802') == (200, 200, 200))
    nota = psql("SELECT nota FROM pgfrete_pendencias WHERE numero_carga = '900802' AND categoria = 'aguardando' ORDER BY nota LIMIT 1")
    ck('há uma nota Aguardando na carga', bool(nota), nota)
    antes = liberado_da_carga(tok)
    # O banco como está no servidor hoje (a trava da 060, a nota SUMIU DO B2B
    # marcada por alguém) e, na MESMA transação, o arquivo da 068 — o mesmo
    # que o atualizar_tudo.sh vai aplicar.
    psql(f"""ALTER TABLE pgfrete_pendencias DROP CONSTRAINT IF EXISTS pgfrete_pendencias_tratativa_check;
UPDATE pgfrete_pendencias SET tratativa = 'SUMIU DO B2B', tratativa_em = '2026-10-02', tratativa_por = 'Daniela'
 WHERE numero_carga = '900802' AND nota = '{nota}';
""" + MIG_068.read_text(encoding='utf-8'), uma_transacao=True)
    linha = psql(f"SELECT tratativa || '|' || coalesce(tratativa_em::text, '') || '|' || tratativa_por FROM pgfrete_pendencias WHERE numero_carga = '900802' AND nota = '{nota}'")
    ck('a nota voltou a falta olhar (sem status, sem data, sem nome)', linha == '||', repr(linha))
    ck('nada foi liberado pela migração', liberado_da_carga(tok) == antes, f'{antes} → {liberado_da_carga(tok)}')

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctx = await nav.new_context(viewport={'width': 1600, 'height': 1000})
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        html = PAINEL.read_text(encoding='utf-8').replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        url = API + '/__frete_cancelada'
        await pg.route(url, lambda r: asyncio.ensure_future(r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.route('**/socket.io/socket.io.js', lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='application/javascript', body='')))
        await pg.goto(url)
        await pg.wait_for_selector('#login-email')
        await pg.fill('#login-email', EMAIL)
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_selector('#frete-tbody tr.frete-primeira', timeout=20000)
        await pg.wait_for_timeout(800)

        print('\n=== 2. PELA TELA: FALTA OLHAR, E A LISTA NOVA ===')
        await pg.click('#frete-tbody tr.frete-primeira[data-carga="900802"] .frete-toggle')
        await pg.wait_for_timeout(600)
        da_nota = pg.locator(f'#frete-tbody tr.frete-nota[data-carga="900802"][data-nota="{nota}"]')
        selo = (await da_nota.locator('.frete-selo-t').inner_text()).strip()
        ck('a nota aparece como "falta olhar"', selo == 'falta olhar', selo)
        opcoes = await da_nota.locator('select.frete-sel option').evaluate_all('os => os.map(o => o.value).filter(Boolean)')
        ck('a lista tem CANCELADA e OK (AVULSO)', 'CANCELADA' in opcoes and 'OK (AVULSO)' in opcoes, str(opcoes))
        ck('e não tem mais SUMIU DO B2B', 'SUMIU DO B2B' not in opcoes, str(opcoes))

        print('\n=== 3. O HISTÓRICO DIZ DE ONDE PARA ONDE ===')
        await pg.click('#frete-tbody tr.frete-primeira[data-carga="900802"] .frete-btn-hist')
        await pg.wait_for_selector('#frete-modal-corpo .frete-eventos', timeout=10000)
        hist = ' '.join((await pg.inner_text('#frete-modal-corpo')).split())
        ck('"SUMIU DO B2B → falta olhar" está no histórico da carga', 'SUMIU DO B2B → falta olhar' in hist, hist[-300:])
        ck('feito pela atualização do servidor (068)', 'Atualização do servidor (068)' in hist)
        await pg.keyboard.press('Escape')
        await pg.wait_for_timeout(400)

        print('\n=== 4. ESCOLHER CANCELADA LIBERA A NOTA ===')
        await da_nota.locator('select.frete-sel').select_option('CANCELADA')
        await pg.wait_for_timeout(2500)
        gravada = psql(f"SELECT tratativa FROM pgfrete_pendencias WHERE numero_carga = '900802' AND nota = '{nota}'")
        ck('gravou CANCELADA no servidor', gravada == 'CANCELADA', gravada)
        da_nota = pg.locator(f'#frete-tbody tr.frete-nota[data-carga="900802"][data-nota="{nota}"]')
        cls = await da_nota.locator('.frete-selo-t').get_attribute('class') if await da_nota.count() else ''
        ck('o selo da nota é o de "libera"', 'frete-selo-t-ok' in (cls or ''), str(cls))
        depois = liberado_da_carga(tok)
        ck('a carga ganhou essa nota como liberada', depois > antes, f'{antes} → {depois}')
        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    print('\n=======================================================')
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print('   -', f)
        return 1
    print('  Tudo verde: CANCELADA e OK (AVULSO) liberam; SUMIU DO B2B virou falta olhar, com o registro no histórico.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(asyncio.run(main()))
    finally:
        limpar()
