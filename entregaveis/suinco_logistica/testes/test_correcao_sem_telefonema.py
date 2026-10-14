#!/usr/bin/env python3
"""Correção sem telefonema (14/10/2026) — aprovado pelo dono: "marcha fio".

O PEDIDO: quem avançou a etapa por engano (Portaria, Expedição, Faturamento)
ou a Logística PEDE pelo painel para voltar a carga, com motivo; a
Administração recebe e aprova ou recusa no painel. Aprovar é a mesma correção
de etapa de sempre, com o nome de quem pediu e de quem aprovou.

O CAMINHO, pela tela e com a API de verdade (sem tempo real: cada lado vê o
que vê quando abre a aba, como quem chega depois):
  1. a carga está em "Embarque Iniciado";
  2. o Faturamento abre a linha do tempo dela e NÃO vê o "Errou a etapa?" —
     o passo não foi dele;
  3. a Expedição, no CELULAR, abre a linha do tempo, toca em "Errou a
     etapa?", escreve o motivo e envia — a carga não muda, o pedido fica
     esperando, e a linha do tempo diz isso;
  4. a Administração abre o Histórico: a caixa "Pedidos de correção" mostra
     a carga e o motivo; ela aprova, confirma, e a carga volta para
     "Aguardando Embarque" com a trilha de quem pediu e de quem aprovou.

REPROVA contra o publicado (o botão e a caixa não existem):
    SUINCO_PAINEL_ARQUIVO=<index.html publicado> bash testes/rodar_tudo.sh correcao_sem_telefonema

    bash testes/rodar_tudo.sh correcao_sem_telefonema
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
EMAILS = {
    'Logística': 'corr.tel.log@teste.local',
    'Expedição': 'corr.tel.exp@teste.local',
    'Faturamento': 'corr.tel.fat@teste.local',
    'Administração': 'corr.tel.adm@teste.local',
}
NUMERO = 'CT067-TELA'
MOTIVO = 'iniciei a carga errada, era a da doca 2'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def psql(q):
    r = subprocess.run(['su', 'postgres', '-c', 'psql -q -tA -d embarque_suinco'], input=q, capture_output=True, text=True)
    if r.returncode != 0:
        print('    [psql]', (r.stderr or '').strip()[:160])
    return r.stdout.strip()


def http(caminho, token=None, metodo='GET', corpo=None):
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(API + caminho, data=dados, method=metodo,
                                 headers={'Content-Type': 'application/json',
                                          **({'Authorization': f'Bearer {token}'} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or 'null')
        except Exception:
            return e.code, None


def limpar():
    psql(f"""DELETE FROM pedidos_correcao WHERE carga_id IN (SELECT carga_id FROM fact_viagens WHERE numero_carga = '{NUMERO}');
DELETE FROM fact_statusfrota WHERE carga_id IN (SELECT carga_id FROM fact_viagens WHERE numero_carga = '{NUMERO}');
DELETE FROM log_eventos WHERE carga_id IN (SELECT carga_id FROM fact_viagens WHERE numero_carga = '{NUMERO}');
DELETE FROM fact_viagens WHERE numero_carga = '{NUMERO}';
DELETE FROM operadores WHERE email IN ({", ".join(f"'{e}'" for e in EMAILS.values())});""")


async def entrar(nav, html, setor, largura=1400, altura=1000):
    ctx = await nav.new_context(viewport={'width': largura, 'height': altura})
    pg = await ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    url = f'{API}/__corr_{len(setor)}_{largura}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.route('**/socket.io/socket.io.js', lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='application/javascript', body='')))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email')
    await pg.fill('#login-email', EMAILS[setor])
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_function("() => typeof DB !== 'undefined' && DB.operador && DB.operador.setor", timeout=15000)
    await pg.wait_for_function("(n) => DB.cargas.some(c => c.numeroCarga === n)", arg=NUMERO, timeout=15000)
    await pg.wait_for_timeout(800)
    return pg, erros


async def abrir_aba(pg, aba):
    # No celular as abas ficam atrás do botão de menu — como a pessoa vê.
    if await pg.locator('#btn-menu').is_visible():
        await pg.click('#btn-menu')
        await pg.wait_for_timeout(400)
    await pg.click(f'.nav-tab[data-tab="{aba}"]')


async def abrir_linha_do_tempo(pg):
    await abrir_aba(pg, 'historico')
    await pg.wait_for_timeout(600)
    await pg.fill('#hist-busca-carga', NUMERO)
    await pg.wait_for_timeout(1200)


async def main():
    limpar()
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True).stdout.strip()
    psql('INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES '
         + ', '.join(f"('{e}', '{s} Correção', '{s}', '{h}', true)" for s, e in EMAILS.items()) + ';')
    placa = psql("""SELECT v.placa FROM dim_veiculos v
  LEFT JOIN fact_viagens f ON f.placa = v.placa AND f.excluida_em IS NULL AND f.status_atual <> 'Seguiu Viagem'
 WHERE v.transportadora <> '' AND f.carga_id IS NULL ORDER BY v.placa LIMIT 1""")
    ck('há uma placa livre na Frota para o teste', bool(placa), placa)
    if not placa:
        return 1

    print('\n=== 1. A CARGA ESTÁ EM "EMBARQUE INICIADO" ===')
    _, login = http('/auth/login', metodo='POST', corpo={'email': EMAILS['Logística'], 'senha': SENHA})
    tok = (login or {}).get('token')
    st, c = http('/api/cargas', tok, 'POST', {'placa': placa, 'numeroCarga': NUMERO, 'cliente': 'C', 'destino': 'D',
                                               'peso': 1000, 'freteObservacao': 'TABELA'})
    ck('a Logística criou a carga', st == 201, f'HTTP {st} {c}')
    cid = (c or {}).get('id')
    for status in ('Aguardando Embarque', 'Embarque Iniciado'):
        st, r = http(f'/api/cargas/{cid}/status', tok, 'POST', {'status': status})
        ck(f'a carga andou para {status}', st == 200, f'HTTP {st} {r}')

    html = PAINEL.read_text(encoding='utf-8').replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)

        print('\n=== 2. O FATURAMENTO NÃO VÊ O "ERROU A ETAPA?" — O PASSO NÃO FOI DELE ===')
        fat, erros_f = await entrar(nav, html, 'Faturamento')
        await abrir_linha_do_tempo(fat)
        aberta = await fat.evaluate("() => !!document.querySelector('#hist-timeline-wrap .timeline-card')")
        ck('o Faturamento abre a linha do tempo da carga', aberta)
        ck('e não vê o pedido de correção', await fat.locator('#hist-timeline-wrap .pedir-correcao').count() == 0)

        print('\n=== 3. A EXPEDIÇÃO, NO CELULAR, PEDE A CORREÇÃO ===')
        exp, erros_e = await entrar(nav, html, 'Expedição', 390, 844)
        await abrir_linha_do_tempo(exp)
        pedir = exp.locator('#hist-timeline-wrap details.pedir-correcao')
        ck('a Expedição vê "Errou a etapa?" na linha do tempo', await pedir.count() == 1)
        if await pedir.count():
            resumo = pedir.locator('summary')
            caixa = await resumo.bounding_box()
            ck('o toque tem 44 px de altura no celular', bool(caixa) and caixa['height'] >= 44, str(caixa))
            await resumo.click()
            await exp.wait_for_timeout(300)
            texto = ' '.join((await pedir.inner_text()).split())
            ck('diz para onde a carga volta se aprovarem', 'para “Aguardando Embarque”' in texto, texto[:160])
            await pedir.locator('input[type="text"]').fill(MOTIVO)
            await pedir.locator('button:has-text("Enviar pedido")').click()
            await exp.wait_for_timeout(2000)
        linha = psql(f"""SELECT p.de_status || '|' || p.para_status || '|' || p.pedido_setor || '|' || p.motivo || '|' || coalesce(p.decisao, 'aberto')
  FROM pedidos_correcao p JOIN fact_viagens f ON f.carga_id = p.carga_id WHERE f.numero_carga = '{NUMERO}'""")
        ck('o pedido chegou ao servidor, aberto, com o motivo',
           linha == f'Embarque Iniciado|Aguardando Embarque|Expedição|{MOTIVO}|aberto', linha)
        st_atual = psql(f"SELECT status_atual FROM fact_viagens WHERE numero_carga = '{NUMERO}'")
        ck('a carga NÃO mudou — quem decide é a Administração', st_atual == 'Embarque Iniciado', st_atual)
        enviado = ' '.join((await exp.locator('#hist-timeline-wrap').inner_text()).split())
        ck('a linha do tempo diz que o pedido está esperando a Administração',
           'Pedido de correção enviado' in enviado and 'Esperando a Administração' in enviado, enviado[-200:])
        largura = await exp.evaluate("() => document.scrollingElement.scrollWidth <= window.innerWidth + 1")
        ck('nada passa da largura do celular', largura)

        print('\n=== 4. A ADMINISTRAÇÃO VÊ O PEDIDO NO HISTÓRICO E APROVA ===')
        adm, erros_a = await entrar(nav, html, 'Administração')
        await abrir_aba(adm, 'historico')
        await adm.wait_for_timeout(1500)
        card = adm.locator('#card-pedidos-correcao')
        visivel = await card.is_visible()
        ck('a caixa "Pedidos de correção" aparece no topo do Histórico', visivel)
        texto = ' '.join((await card.inner_text()).split()) if visivel else ''
        ck('com a carga, as etapas, quem pediu e o motivo',
           NUMERO in texto and 'Embarque Iniciado → Aguardando Embarque' in texto and 'Expedição' in texto and MOTIVO in texto,
           texto[:220])
        if visivel:
            await card.locator('button:has-text("Aprovar e voltar")').first.click()
            await adm.wait_for_selector('#pergunta-ok', timeout=5000)
            pergunta = ' '.join((await adm.inner_text('#pergunta-texto')).split())
            ck('a confirmação mostra de onde para onde e o motivo',
               'Embarque Iniciado' in pergunta and 'Aguardando Embarque' in pergunta and MOTIVO in pergunta, pergunta[:200])
            await adm.click('#pergunta-ok')
            await adm.wait_for_timeout(2500)
        st_atual = psql(f"SELECT status_atual FROM fact_viagens WHERE numero_carga = '{NUMERO}'")
        ck('a carga voltou para Aguardando Embarque', st_atual == 'Aguardando Embarque', st_atual)
        dec = psql(f"""SELECT p.decisao || '|' || p.decidido_por FROM pedidos_correcao p
  JOIN fact_viagens f ON f.carga_id = p.carga_id WHERE f.numero_carga = '{NUMERO}'""")
        ck('o pedido ficou aprovado, com o nome de quem aprovou', dec == 'aprovado|Administração Correção', dec)
        trilha = psql(f"""SELECT acao FROM log_eventos WHERE carga_id = '{cid}' AND acao LIKE 'Etapa REVERTIDA%'
  ORDER BY data_evento DESC LIMIT 1""")
        ck('a trilha diz quem pediu, o motivo e quem aprovou',
           'Pedido de Expedição Correção (Expedição)' in trilha and MOTIVO in trilha and 'Aprovado por Administração Correção' in trilha,
           trilha[:220])
        ck('decidido, o pedido sai da caixa', not await card.is_visible())

        ck('nenhum erro de JavaScript', not (erros_f or erros_e or erros_a), str((erros_f + erros_e + erros_a)[:2]))
        await nav.close()

    print('\n=======================================================')
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print('   -', f)
        return 1
    print('  Tudo verde: quem errou pede pelo painel, a Administração decide no Histórico, sem telefonema.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(asyncio.run(main()))
    finally:
        limpar()
