#!/usr/bin/env python3
"""Frete obrigatório para contratar (06/10/2026).

Relato do dono: "os programadores não estão colocando o valor combinado do
frete na observação, e essa informação (...) está vindo pro relatório de
administração de fretes incompleta". Decisão dele: "o valor do frete não pode
ser alterável, somente o KM pode ser editável (...) o que seguir o valor da
tabela vai ser colocado no observações como tabela, e o que não seguir a
tabela vai ser colocado o valor combinado" — "sempre, sem exceções".

O caminho é o do usuário, pela tela, com o banco conferido do outro lado:

  1. Programação com placa → a pergunta abre; Cancelar não cria; confirmar
     sem escolher explica; COMBINADO 14.000,00 cria e grava.
  2. Programação sem placa → não pergunta (ainda não é contratar).
  3. Fila de programados: a placa entrando pergunta; TABELA grava.
  4. Torre: trocar para placa de OUTRA transportadora pergunta de novo;
     Cancelar devolve a placa; confirmar troca e grava o frete novo.
  5. Carga antiga (contratada antes da regra) mostra o selo "frete a
     definir" na Torre; clicar pergunta e grava.
  6. Montagem: o combinado escolhido na coluna Frete da LINHA chega à carga
     (até aqui ele se perdia ao virar carga); linha sem frete pergunta ao
     criar; o lote pula a linha sem frete e diz qual e por quê.
  7. Relatório da Administração de Fretes: a coluna "Obs. do frete" traz
     TABELA e COMBINADO com o valor e a diferença para a tabela.

    bash testes/rodar_tudo.sh frete_obrigatorio_para_contratar
"""
import asyncio
import json
import time
import urllib.error
import urllib.request
import os
import subprocess
import sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
RAIZ = '/home/user/pega-visao/entregaveis/suinco_logistica'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAIL = 'frete.obrigatorio@teste.local'
NUMEROS = ['FO-PROG', 'FO-SEMPLACA', 'FO-CHEGADA', 'FO-ANTIGA', 'FO-MONT-COMB', 'FO-MONT-PERG', 'FO-LOTE-OK', 'FO-LOTE-SEM']
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def psql(q):
    return subprocess.run(['su', 'postgres', '-c', 'psql -q -tA -d embarque_suinco'], input=q,
                          capture_output=True, text=True).stdout.strip()


def limpar():
    lista = ','.join(f"'{n}'" for n in NUMEROS)
    psql(f"DELETE FROM programacao_montagem WHERE numero_carga IN ({lista});"
         f"DELETE FROM fact_statusfrota WHERE carga_id IN (SELECT carga_id FROM fact_viagens WHERE numero_carga IN ({lista}));"
         f"DELETE FROM log_eventos WHERE carga_id IN (SELECT carga_id FROM fact_viagens WHERE numero_carga IN ({lista}));"
         f"DELETE FROM fact_viagens WHERE numero_carga IN ({lista});")


def http_json(caminho, metodo='GET', corpo=None, token=None):
    req = urllib.request.Request(API + caminho, method=metodo)
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    dados = None
    if corpo is not None:
        dados = json.dumps(corpo).encode()
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, dados, timeout=20) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or 'null')
        except Exception:
            return e.code, None


def frete_no_banco(numero):
    r = psql(f"SELECT coalesce(placa,'') || '|' || coalesce(frete_observacao,'') || '|' || coalesce(frete_valor_manual::text,'') "
             f"FROM fact_viagens WHERE numero_carga = '{numero}' AND excluida_em IS NULL")
    return r.split('|') if r else None


async def pergunta_aberta(pg):
    return await pg.evaluate("() => document.getElementById('modal-frete-contratar').classList.contains('open')")


async def responder(pg, obs, valor=None):
    """Responde como a pessoa: marca a opção, digita o valor e confirma."""
    await pg.check('#frete-c-tabela' if obs == 'TABELA' else '#frete-c-combinado')
    if valor is not None:
        await pg.fill('#frete-c-valor', valor)
    await pg.click('#frete-c-confirmar')
    await pg.wait_for_timeout(2500)


async def ir(pg, aba):
    await pg.click(f'.nav-tab[data-tab="{aba}"]')
    await pg.wait_for_timeout(700)


async def montagem_linha(pg, dia, numero, placa, rota):
    """Adicionar linha → número e placa, como na tela."""
    await ir(pg, 'programacao')
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
    return pg.locator('#mont-tbody tr').filter(has=pg.locator(f'input.numero-carga-input[value="{numero}"]')).last


async def main():
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=RAIZ + '/backend', capture_output=True, text=True).stdout.strip()
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}';"
         f"INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES ('{EMAIL}', 'Logística Frete', 'Logística', '{h}', true);")
    limpar()
    # Placas livres de transportadoras que PAGAM frete (SUINCO e FOB são isentas),
    # e duas delas de transportadoras DIFERENTES para a troca.
    livres = psql("SELECT string_agg(placa || ':' || transportadora, '|') FROM (SELECT DISTINCT ON (v.transportadora) v.placa, v.transportadora "
                  "FROM dim_veiculos v LEFT JOIN fact_viagens f ON f.placa = v.placa AND f.excluida_em IS NULL "
                  "WHERE v.transportadora <> '' AND upper(v.transportadora) NOT LIKE '%SUINCO%' AND upper(v.transportadora) NOT LIKE '%FOB%' "
                  "AND f.carga_id IS NULL ORDER BY v.transportadora, v.placa LIMIT 9) t").split('|')
    P = [x.split(':')[0] for x in livres if x]
    T = [x.split(':', 1)[1] for x in livres if x]
    rota = psql("SELECT codigo FROM dim_rotas ORDER BY codigo LIMIT 1")
    ck('nove placas livres de transportadoras diferentes e uma rota', len(P) == 9 and bool(rota), f'{P} {rota}')

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 1000})
        erros, dialogos, pdfs = [], [], []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        async def dialogo(d):
            dialogos.append(d.message)
            await d.accept()
        pg.on('dialog', lambda d: asyncio.ensure_future(dialogo(d)))
        html = open(RAIZ + '/index.html', encoding='utf-8').read().replace(
            "api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        await pg.route(API + '/__frete', lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.route('**/socket.io/socket.io.js', lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='application/javascript', body='')))

        async def pdf(r):
            try:
                pdfs.append(json.loads(r.request.post_data or '{}'))
            except Exception:
                pdfs.append({})
            await r.fulfill(status=200, content_type='application/pdf', body=b'%PDF-1.4\n%%EOF')
        await pg.route(API + '/api/relatorios/pdf', lambda r: asyncio.ensure_future(pdf(r)))
        await pg.goto(API + '/__frete')
        await pg.wait_for_selector('#login-email')
        await pg.fill('#login-email', EMAIL)
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(2500)
        hoje = await pg.evaluate("() => isoDiaLocal(new Date())")

        print('\n=== 1. PROGRAMAÇÃO COM PLACA: A PERGUNTA ANTES DE CRIAR ===')
        await ir(pg, 'programacao')
        await pg.fill('#prog-placa', P[0])
        await pg.dispatch_event('#prog-placa', 'input')
        await pg.fill('#prog-numero-carga', 'FO-PROG')
        await pg.click('button:has-text("Criar Carga (Aguardando Veículo)")')
        await pg.wait_for_timeout(800)
        ck('clicar em Criar Carga com placa abre a pergunta do frete', await pergunta_aberta(pg))
        ck('a pergunta mostra a placa e a transportadora da Frota',
           P[0] in await pg.inner_text('#frete-c-resumo') and T[0].upper() in (await pg.inner_text('#frete-c-resumo')).upper())
        await pg.click('#frete-c-cancelar')
        await pg.wait_for_timeout(2000)
        ck('Cancelar fecha a pergunta', not await pergunta_aberta(pg))
        ck('e a carga NÃO foi criada (nem na tela nem no banco)',
           frete_no_banco('FO-PROG') is None and 'FO-PROG' not in await pg.inner_text('#prog-fila-tbody'))
        await pg.click('button:has-text("Criar Carga (Aguardando Veículo)")')
        await pg.wait_for_timeout(800)
        await pg.click('#frete-c-confirmar')
        await pg.wait_for_timeout(300)
        ck('confirmar sem escolher explica o que falta',
           await pg.is_visible('#frete-c-erro') and 'TABELA ou COMBINADO' in await pg.inner_text('#frete-c-erro'))
        await pg.check('#frete-c-combinado')
        await pg.click('#frete-c-confirmar')
        await pg.wait_for_timeout(300)
        ck('COMBINADO sem valor também explica', 'valor combinado' in (await pg.inner_text('#frete-c-erro')).lower())
        await pg.fill('#frete-c-valor', '14.000,00')
        await pg.click('#frete-c-confirmar')
        await pg.wait_for_timeout(3000)
        b = frete_no_banco('FO-PROG')
        ck('COMBINADO 14.000,00 cria a carga com o frete gravado no banco',
           b is not None and b[1] == 'COMBINADO' and b[2] and float(b[2]) == 14000.0, str(b))

        print('\n=== 2. PROGRAMAÇÃO SEM PLACA: AINDA NÃO É CONTRATAR ===')
        await pg.fill('#prog-placa', '')
        await pg.fill('#prog-numero-carga', 'FO-SEMPLACA')
        await pg.click('button:has-text("Criar Carga (Aguardando Veículo)")')
        await pg.wait_for_timeout(2500)
        ck('sem placa não pergunta', not await pergunta_aberta(pg))
        b = frete_no_banco('FO-SEMPLACA')
        ck('e a carga nasce aguardando veículo, sem frete', b is not None and b[0] == '' and b[1] == '', str(b))

        print('\n=== 2b. CHEGADA DA PORTARIA: COMPLETAR PERGUNTA, POR CIMA DA JANELA ===')
        # Achado da bateria antes de publicar: a pergunta abria ATRÁS da janela
        # de completar (mesmo z-index, e o Completar vem depois no HTML) — sem
        # clique possível. A prova é o que está por cima no ponto do botão.
        await pg.evaluate(f"() => {{ registrarChegadaPortaria('{P[8]}', 'Portaria Teste'); renderAll(); }}")
        await pg.wait_for_timeout(2500)
        await ir(pg, 'programacao')
        linha = pg.locator('#prog-aguardando-tbody tr').filter(has_text=P[8])
        ck('a chegada sem programação aparece para completar', await linha.count() >= 1)
        if await linha.count():
            await linha.first.locator('button:has-text("Criar carga")').click()
            await pg.wait_for_timeout(500)
            await pg.fill('#completar-numero-carga', 'FO-CHEGADA')
            await pg.click('#modal-completar .btn-primary')
            await pg.wait_for_timeout(800)
            ck('completar a chegada pergunta o frete', await pergunta_aberta(pg))
            por_cima = await pg.evaluate("""() => {
                const b = document.getElementById('frete-c-confirmar').getBoundingClientRect();
                const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
                return !!el && !!el.closest('#modal-frete-contratar');
            }""")
            ck('e a pergunta está POR CIMA da janela de completar (dá para clicar)', por_cima)
            await responder(pg, 'TABELA')
            b = frete_no_banco('FO-CHEGADA')
            ck('TABELA: a chegada vira carga com o frete gravado', b is not None and b[0] == P[8] and b[1] == 'TABELA', str(b))

        print('\n=== 3. FILA DE PROGRAMADOS: A PLACA ENTRANDO PERGUNTA ===')
        await pg.fill('#prog-fila-dia', hoje)
        await pg.dispatch_event('#prog-fila-dia', 'change')
        await pg.wait_for_timeout(800)
        linha = pg.locator('#prog-fila-tbody tr').filter(has=pg.locator('input.numero-carga-input[value="FO-SEMPLACA"]'))
        await linha.locator('input.placa-input').fill(P[1])
        await linha.locator('input.placa-input').dispatch_event('change')
        await pg.wait_for_timeout(800)
        ck('digitar a placa na Fila abre a pergunta', await pergunta_aberta(pg))
        await responder(pg, 'TABELA')
        b = frete_no_banco('FO-SEMPLACA')
        ck('TABELA: a placa entra e o frete fica gravado', b is not None and b[0] == P[1] and b[1] == 'TABELA' and b[2] == '', str(b))

        print('\n=== 4. TORRE: TROCAR DE TRANSPORTADORA PEDE O FRETE DE NOVO ===')
        await ir(pg, 'torre')
        linha = pg.locator('#torre-tbody tr').filter(has=pg.locator('input.numero-carga-input[value="FO-SEMPLACA"]'))
        await linha.locator('input.placa-input').fill(P[2])
        await linha.locator('input.placa-input').dispatch_event('change')
        await pg.wait_for_timeout(800)
        ck(f'trocar para placa de outra transportadora ({T[2]}) pergunta de novo', await pergunta_aberta(pg))
        ck('e a pergunta diz que a transportadora mudou', 'transportadora mudou' in (await pg.inner_text('#frete-c-contexto')).lower())
        await pg.click('#frete-c-cancelar')
        await pg.wait_for_timeout(2000)
        b = frete_no_banco('FO-SEMPLACA')
        ck('Cancelar mantém a placa anterior no banco', b is not None and b[0] == P[1], str(b))
        ck('e na tela', await pg.locator('#torre-tbody tr').filter(
            has=pg.locator('input.numero-carga-input[value="FO-SEMPLACA"]')).locator('input.placa-input').input_value() == P[1])
        linha = pg.locator('#torre-tbody tr').filter(has=pg.locator('input.numero-carga-input[value="FO-SEMPLACA"]'))
        await linha.locator('input.placa-input').fill(P[2])
        await linha.locator('input.placa-input').dispatch_event('change')
        await pg.wait_for_timeout(800)
        await responder(pg, 'COMBINADO', '9.800,50')
        b = frete_no_banco('FO-SEMPLACA')
        ck('confirmar troca a placa e grava o frete da nova transportadora',
           b is not None and b[0] == P[2] and b[1] == 'COMBINADO' and b[2] and float(b[2]) == 9800.5, str(b))

        print('\n=== 5. CARGA ANTIGA: O SELO "FRETE A DEFINIR" ===')
        # O estado de antes da regra: contratada, sem observação. Nasce direto
        # no servidor (como as cargas que já existem em produção), sem passar
        # por este navegador — se passasse, a cópia dele com TABELA voltaria
        # ao servidor na sincronia, coisa que carga antiga real não tem.
        st, tk = http_json('/auth/login', 'POST', {'email': EMAIL, 'senha': SENHA})
        st, _ = http_json('/api/cargas', 'POST', {'id': 'fo-antiga-' + str(int(time.time())), 'numeroCarga': 'FO-ANTIGA',
                                                  'aguardandoCarga': False}, (tk or {}).get('token'))
        psql(f"UPDATE fact_viagens SET placa = '{P[3]}', transportadora = '{T[3]}', frete_observacao = NULL WHERE numero_carga = 'FO-ANTIGA'")
        ck('a carga antiga está no banco com placa e sem a observação (o estado de antes da regra)',
           (frete_no_banco('FO-ANTIGA') or ['', 'x', ''])[:2] == [P[3], ''], f'{st} {frete_no_banco("FO-ANTIGA")}')
        await pg.reload()
        await pg.wait_for_timeout(3000)
        await ir(pg, 'torre')
        linha = pg.locator('#torre-tbody tr').filter(has=pg.locator('input.numero-carga-input[value="FO-ANTIGA"]'))
        selo = linha.locator('.selo-frete-definir')
        ck('a Torre mostra "frete a definir" na carga antiga', await selo.count() == 1 and await selo.first.is_visible())
        if await selo.count():
            await selo.first.click()
            await pg.wait_for_timeout(600)
            ck('clicar no selo abre a pergunta', await pergunta_aberta(pg))
            await responder(pg, 'TABELA')
        b = frete_no_banco('FO-ANTIGA')
        ck('e a resposta grava no banco', b is not None and b[1] == 'TABELA', str(b))
        linha = pg.locator('#torre-tbody tr').filter(has=pg.locator('input.numero-carga-input[value="FO-ANTIGA"]'))
        ck('e o selo some (não há mais nada a fazer)', await linha.locator('.selo-frete').count() == 0)

        print('\n=== 6. MONTAGEM: O COMBINADO DA LINHA CHEGA À CARGA ===')
        linha = await montagem_linha(pg, hoje, 'FO-MONT-COMB', P[4], rota)
        await linha.locator('.frete-mont-btn').click()
        await pg.wait_for_timeout(600)
        ck('o botão Frete da linha abre a pergunta', await pergunta_aberta(pg))
        await responder(pg, 'COMBINADO', '12.345,00')
        linha = pg.locator('#mont-tbody tr').filter(has=pg.locator('input.numero-carga-input[value="FO-MONT-COMB"]')).last
        ck('a linha passa a mostrar "comb. 12.345,00"', 'comb. 12.345,00' in await linha.locator('.frete-mont-btn').inner_text())
        await linha.locator('.mont-btn-criar').click()
        await pg.wait_for_timeout(3000)
        ck('com o frete na linha, Criar carga não pergunta de novo', not await pergunta_aberta(pg))
        b = frete_no_banco('FO-MONT-COMB')
        ck('e a carga nasce com o combinado da linha (antes ele se perdia)',
           b is not None and b[1] == 'COMBINADO' and b[2] and float(b[2]) == 12345.0, str(b))

        linha = await montagem_linha(pg, hoje, 'FO-MONT-PERG', P[5], rota)
        await linha.locator('.mont-btn-criar').click()
        await pg.wait_for_timeout(800)
        ck('linha sem frete: Criar carga pergunta', await pergunta_aberta(pg))
        await responder(pg, 'TABELA')
        b = frete_no_banco('FO-MONT-PERG')
        ck('TABELA cria a carga com o frete', b is not None and b[1] == 'TABELA', str(b))
        obs_linha = psql("SELECT coalesce(frete_observacao,'') FROM programacao_montagem WHERE numero_carga = 'FO-MONT-PERG'")
        ck('e a resposta fica gravada na linha da Montagem também', obs_linha == 'TABELA', obs_linha)

        print('\n=== 6b. MONTAGEM EM LOTE: A LINHA SEM FRETE É PULADA E DITA ===')
        linha = await montagem_linha(pg, hoje, 'FO-LOTE-OK', P[6], rota)
        await linha.locator('.frete-mont-btn').click()
        await pg.wait_for_timeout(600)
        await responder(pg, 'TABELA')
        await montagem_linha(pg, hoje, 'FO-LOTE-SEM', P[7], rota)
        avisos_antes = await pg.evaluate("() => document.body.innerText.length")
        await pg.click('#mont-btn-lote')
        await pg.wait_for_timeout(5000)
        ck('o lote pergunta uma vez antes de mandar', any('Criar' in d for d in dialogos), str(dialogos[-1:]))
        ck('a linha com frete virou carga', (frete_no_banco('FO-LOTE-OK') or [''] * 3)[1] == 'TABELA')
        ck('a linha sem frete NÃO virou carga', frete_no_banco('FO-LOTE-SEM') is None)
        corpo = await pg.inner_text('body')
        ck('e o aviso diz qual linha ficou e por quê', 'observação do frete' in corpo and 'não foi' in corpo)
        ck('nada de pergunta aberta no meio do lote', not await pergunta_aberta(pg))
        _ = avisos_antes

        print('\n=== 7. RELATÓRIO DA ADMINISTRAÇÃO DE FRETES ===')
        await ir(pg, 'relatorios')
        await pg.click('button[onclick="exportarPdfFretes()"]')
        await pg.wait_for_timeout(4000)
        doc = pdfs[-1] if pdfs else {}
        corpo_pdf = json.dumps(doc, ensure_ascii=False)
        html_pdf = next((v for v in doc.values() if isinstance(v, str) and '<table' in v), '') if isinstance(doc, dict) else ''
        ck('o PDF foi pedido ao servidor', bool(pdfs))
        ck('com a coluna "Obs. do frete"', 'Obs. do frete' in corpo_pdf)
        ck('a carga combinada sai como COMBINADO R$ 14.000,00', 'COMBINADO R$ 14.000,00' in corpo_pdf)
        ck('a carga da Montagem sai como COMBINADO R$ 12.345,00', 'COMBINADO R$ 12.345,00' in corpo_pdf)
        ck('e as de tabela saem como TABELA, na coluna da observação', 'class="col-obsfrete">TABELA<' in html_pdf)
        for n in ('FO-PROG', 'FO-MONT-COMB'):
            i = corpo_pdf.find(n)
            if i < 0 or 'COMBINADO R$' not in corpo_pdf[i:i + 1500]:
                print('     linha de', n, '→', corpo_pdf[i:i + 1500] if i >= 0 else '(ausente do PDF)')
        ck('em folha deitada', 'paisagem' in corpo_pdf or 'landscape' in corpo_pdf)

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    limpar()
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}';")
    print('\n' + ('FALHAS: ' + '; '.join(falhas) if falhas else 'TUDO OK'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
