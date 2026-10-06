#!/usr/bin/env python3
"""Pagamento de Frete: Excluir, Editar e os campos de CADA nota (06/10/2026).

Pedidos do dono, no mesmo dia:
  · "eu preciso conseguir excluir carga do pagamento de fretes, esqueci de
    colocar o botão ali no final" — "excluir e editar";
  · "tem que ter a data de pagamento para cada uma das pendências (...) pode
    ser que a primeira eu pague hoje, a outra no próximo pagamento" e "ter os
    campos editáveis pra toda pendência da carga".
Decisões dele: excluir SAI DA LISTA E FICA NO HISTÓRICO (motivo obrigatório,
pergunta se há pagamento, Restaurar desfaz); editar é UM formulário; pagar uma
nota SOMA UMA NOTA no % pago; nada aqui é valor em R$.

Tudo pela tela, como a Daniela faz, com o banco conferido do outro lado:
  1. importar a 900802 (8 notas, 4 pendentes) e abrir a carga;
  2. CADA nota tem CT-E, transportadora e "Pagar nota" — não só a primeira;
  3. o CT-E de uma nota muda só ela; as outras continuam com o da carga;
  4. nota com status OK: Pagar nota → data → paga; a linha mostra "paga" e a
     data; o % pago da carga sobe uma nota (12,5%);
  5. nota sem status: Pagar nota PERGUNTA antes; "Pagar mesmo assim" paga;
  6. Editar (fim da linha): um formulário com transportadora, CT-E,
     observação e canhoto; grava tudo de uma vez;
  7. Excluir: sem motivo não vai; com pagamento, pergunta; confirmado, a
     carga some da lista e aparece em "Excluídas" com o motivo; Restaurar
     traz de volta.

    bash testes/rodar_tudo.sh pagamento_frete_editar_excluir_por_nota
"""
import asyncio
import json
import re
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
PAINEL = RAIZ / 'index.html'
PDFS = RAIZ / 'backend' / 'testes' / 'fixtures' / 'frete'
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
    psql(f"INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES ('{email}', '{setor} Teste', '{setor}', '{h}', true);")
    st, r = http('/auth/login', metodo='POST', corpo={'email': email, 'senha': SENHA})
    return (r or {}).get('token')


def limpar_frete():
    for t in ['pgfrete_eventos', 'pgfrete_leituras', 'pgfrete_pagamentos', 'pgfrete_pendencias', 'pgfrete_cargas']:
        psql(f'DELETE FROM {t};')


async def abrir_painel(ctx, viewport=None):
    pagina = await ctx.new_page()
    await pagina.set_viewport_size(viewport or {'width': 1400, 'height': 1000})
    html = PAINEL.read_text(encoding='utf-8').replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    url = API + '/__painel_teste'
    await pagina.route(url, lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pagina.route('**/socket.io/socket.io.js', lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='application/javascript', body='')))
    await pagina.goto(url)
    await pagina.wait_for_timeout(1000)
    return pagina


async def entrar(pg, email):
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(1500)



async def main():
    limpar_frete()
    psql("DELETE FROM dim_veiculos WHERE placa = 'TST9A01';")
    psql("INSERT INTO dim_veiculos (placa, transportadora, tipo_veiculo, origem) VALUES ('TST9A01', 'Transp. Teste Tela', 'Truck', 'teste');")
    tok = operador('frete.nota@teste.local', 'Pagamento de Frete')
    ck('operador do setor Pagamento de Frete criado', bool(tok))

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []
        ctx = await nav.new_context()
        pg = await abrir_painel(ctx, {'width': 1600, 'height': 1000})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg, 'frete.nota@teste.local')

        print('\n=== 1. IMPORTAR E ABRIR A CARGA ===')
        await pg.click('#frete-btn-importar')
        await pg.wait_for_selector('#frete-arquivos', state='attached')
        await pg.set_input_files('#frete-arquivos', [str(PDFS / 'b2b_900802.pdf'), str(PDFS / 'sist_900802.pdf')])
        await pg.wait_for_selector('#modal-frete .frete-prev-ok', timeout=60000)
        await pg.click('#frete-btn-gravar')
        await pg.wait_for_timeout(2500)
        ck('a carga 900802 entrou no controle', psql("SELECT count(*) FROM pgfrete_cargas WHERE numero_carga='900802';") == '1')
        await pg.click('#frete-tbody tr.frete-primeira .frete-toggle')
        await pg.wait_for_timeout(500)
        linhas = pg.locator('#frete-tbody tr[data-carga="900802"]')
        ck('aberta, a carga tem 4 linhas (uma por nota pendente)', await linhas.count() == 4, str(await linhas.count()))

        print('\n=== 2. CADA NOTA COM OS SEUS CAMPOS ===')
        n_cte = await pg.locator('#frete-tbody tr[data-carga="900802"] td[data-col="cte"] button').count()
        n_tr = await pg.locator('#frete-tbody tr[data-carga="900802"] td[data-col="transportadora"] button').count()
        n_pg = await pg.locator('#frete-tbody tr[data-carga="900802"] td[data-col="dataPagamento"] button').count()
        ck('as 4 notas têm CT-E editável (não só a primeira linha)', n_cte == 4, str(n_cte))
        ck('as 4 notas têm transportadora editável', n_tr == 4, str(n_tr))
        ck('e as 4 têm o seu botão de pagamento/data', n_pg == 4, str(n_pg))
        notas = psql("SELECT string_agg(nota, ',' ORDER BY nota::bigint) FROM pgfrete_pendencias WHERE numero_carga='900802' AND resolvida_em IS NULL AND categoria <> 'so_b2b'").split(',')
        ck('há pelo menos duas notas do sistema pendentes', len(notas) >= 2, str(notas))

        def linha_da(nota):
            return pg.locator('#frete-tbody tr[data-carga="900802"]').filter(has=pg.locator(f'td[data-col="resumo"]:has-text("{nota}")'))

        print('\n=== 3. O CT-E DE UMA NOTA ===')
        await linha_da(notas[1]).locator('td[data-col="cte"] button').click()
        await pg.wait_for_timeout(400)
        ck('clicar no CT-E da nota abre a janela DA NOTA', f'nota {notas[1]}' in await pg.inner_text('#frete-modal-titulo'))
        await pg.fill('#frete-campo-valor', '55001')
        await pg.click('#modal-frete button:has-text("Salvar")')
        await pg.wait_for_timeout(2000)
        ck('gravou no banco, na nota', psql(f"SELECT cte FROM pgfrete_pendencias WHERE numero_carga='900802' AND nota='{notas[1]}'") == '55001')
        ck('a linha da nota mostra 55001', '55001' in await linha_da(notas[1]).locator('td[data-col="cte"]').inner_text())
        ck('a outra nota não mudou', '55001' not in await linha_da(notas[0]).locator('td[data-col="cte"]').inner_text())

        print('\n=== 4. PAGAR UMA NOTA LIBERADA ===')
        await linha_da(notas[0]).locator('select.frete-sel').select_option('OK')
        await pg.wait_for_timeout(2000)
        await linha_da(notas[0]).locator('td[data-col="dataPagamento"] button').click()
        await pg.wait_for_timeout(400)
        ck('Pagar nota abre a janela com a data', await pg.is_visible('#frete-pn-data'))
        ck('e diz que soma 1 nota de 8', '1 nota' in await pg.inner_text('#frete-modal-corpo') and 'de 8' in await pg.inner_text('#frete-modal-corpo'))
        await pg.fill('#frete-pn-data', '2026-10-06')
        await pg.click('#frete-btn-pagar-nota')
        await pg.wait_for_timeout(2500)
        pago = psql(f"SELECT pct || '|' || to_char(data_pagamento,'YYYY-MM-DD') FROM pgfrete_pagamentos WHERE numero_carga='900802' AND nota='{notas[0]}' AND anulado_em IS NULL")
        ck('o pagamento da nota foi gravado com a data (12,5% = 1 de 8)', pago == '12.50|2026-10-06', pago)
        cel = await linha_da(notas[0]).locator('td[data-col="dataPagamento"]').inner_text()
        ck('a linha da nota mostra "paga" e 06/10/2026', 'paga' in cel and '06/10/2026' in cel, cel)
        pago_carga = await pg.locator('#frete-tbody tr.frete-primeira[data-carga="900802"] td[data-col="pago"]').inner_text()
        ck('o % pago da carga subiu uma nota (12,5%)', pago_carga.strip() == '12,5%', pago_carga)

        print('\n=== 5. PAGAR NOTA SEM STATUS: PERGUNTA ===')
        await linha_da(notas[1]).locator('td[data-col="dataPagamento"] button').click()
        await pg.wait_for_timeout(400)
        ck('a janela avisa que a nota não está liberada', 'não está liberada' in await pg.inner_text('#frete-modal-corpo'))
        await pg.fill('#frete-pn-data', '2026-10-20')
        await pg.click('#frete-btn-pagar-nota')
        await pg.wait_for_timeout(1500)
        ck('o servidor pergunta antes', await pg.is_visible('#frete-pergunta') and 'mesmo assim' in await pg.inner_text('#frete-pergunta'))
        await pg.click('#frete-pergunta button:has-text("Pagar mesmo assim")')
        await pg.wait_for_timeout(2500)
        ck('confirmado, a segunda nota fica paga em outra data (20/10)',
           psql(f"SELECT to_char(data_pagamento,'YYYY-MM-DD') FROM pgfrete_pagamentos WHERE numero_carga='900802' AND nota='{notas[1]}' AND anulado_em IS NULL") == '2026-10-20')

        print('\n=== 6. EDITAR (FIM DA LINHA) ===')
        await pg.locator('#frete-tbody tr.frete-primeira[data-carga="900802"] .frete-btn-editar').click()
        await pg.wait_for_timeout(500)
        ck('Editar abre um formulário com transportadora, CT-E, observação e canhoto',
           all([await pg.is_visible('#frete-ed-transp'), await pg.is_visible('#frete-ed-cte'), await pg.is_visible('#frete-ed-obs'), await pg.is_visible('#frete-ed-canhoto')]))
        await pg.select_option('#frete-ed-transp', 'Transp. Teste Tela')
        await pg.fill('#frete-ed-cte', '99001')
        await pg.fill('#frete-ed-obs', 'conferido no financeiro')
        await pg.check('#frete-ed-canhoto')
        await pg.click('#frete-ed-salvar')
        await pg.wait_for_timeout(2500)
        c = psql("SELECT transportadora || '|' || cte || '|' || obs || '|' || canhoto_original FROM pgfrete_cargas WHERE numero_carga='900802'")
        ck('gravou tudo de uma vez na carga', c == 'Transp. Teste Tela|99001|conferido no financeiro|true', c)
        ck('a nota com CT-E próprio continua com o dela', '55001' in await linha_da(notas[1]).locator('td[data-col="cte"]').inner_text())

        print('\n=== 7. EXCLUIR E RESTAURAR ===')
        await pg.locator('#frete-tbody tr.frete-primeira[data-carga="900802"] .frete-btn-excluir').click()
        await pg.wait_for_timeout(500)
        ck('Excluir abre a janela que avisa do pagamento registrado', 'pago registrado' in await pg.inner_text('#frete-modal-corpo'))
        await pg.click('#frete-excluir-confirmar')
        await pg.wait_for_timeout(800)
        ck('sem motivo, não exclui', psql("SELECT excluida_em IS NULL FROM pgfrete_cargas WHERE numero_carga='900802'") == 't')
        await pg.fill('#frete-excluir-motivo', 'importada por engano')
        await pg.click('#frete-excluir-confirmar')
        await pg.wait_for_timeout(2500)
        ck('com motivo, a carga sai da lista', await pg.locator('#frete-tbody tr[data-carga="900802"]').count() == 0)
        ck('no banco ela continua, marcada como excluída, com o motivo',
           psql("SELECT excluida_motivo FROM pgfrete_cargas WHERE numero_carga='900802' AND excluida_em IS NOT NULL") == 'importada por engano')
        ck('os pagamentos não foram apagados', psql("SELECT count(*) FROM pgfrete_pagamentos WHERE numero_carga='900802' AND anulado_em IS NULL") == '2')
        await pg.click('#frete-btn-excluidas')
        await pg.wait_for_timeout(1500)
        lista = await pg.inner_text('#frete-modal-corpo')
        ck('"Excluídas" mostra a carga, quem excluiu e o motivo', '900802' in lista and 'importada por engano' in lista and 'Pagamento de Frete Teste' in lista, lista[:300])
        await pg.click('#frete-excluidas tr[data-carga="900802"] button:has-text("Restaurar")')
        await pg.wait_for_timeout(2500)
        await pg.click('#modal-frete button:has-text("Fechar")')
        await pg.wait_for_timeout(500)
        ck('Restaurar traz de volta para a lista', await pg.locator('#frete-tbody tr[data-carga="900802"]').count() >= 1)

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    limpar_frete()
    psql("DELETE FROM operadores WHERE email = 'frete.nota@teste.local'; DELETE FROM dim_veiculos WHERE placa = 'TST9A01';")
    print('\n' + ('FALHAS: ' + '; '.join(falhas) if falhas else 'TUDO OK'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
