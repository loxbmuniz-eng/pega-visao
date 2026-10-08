#!/usr/bin/env python3
"""O erro da tela chega sozinho ao servidor (08/10/2026, decisão 27, #45).

PEDIDO DO DONO ("Use Sentry for this"): até aqui erro de tela só era
conhecido quando alguém mandava foto. Agora o painel avisa o servidor
(POST /api/erros), e o servidor limpa e repassa ao Sentry — o que sai de lá
é provado na bateria da API (bloco 58), contra um Sentry falso.

POR QUE O ERRO É PROVOCADO: não existe caminho de tela que cause um erro de
JavaScript — se existisse, seria um defeito a corrigir. O que se prova aqui
é o GANCHO: um erro que escapa de verdade (lançado num setTimeout, sem
ninguém tratar) passa pelo mesmo window.onerror que pegaria um defeito real.

O QUE ESTE TESTE TRAVA, no navegador, contra a API de teste:
  1. o erro que escapa vira UM pedido a /api/erros, e o servidor aceita (202);
  2. o pedido leva tipo, mensagem, pilha, a ABA aberta e a versão — e NÃO
     leva setor (quem diz o setor é o crachá, no servidor) nem nada além;
  3. a promessa recusada sem tratamento também avisa;
  4. NÃO avisa o que não é defeito do painel: recusa do servidor (com
     status), queda de rede, "Script error." e o laço do ResizeObserver;
  5. o mesmo erro 5 vezes avisa uma; 15 erros diferentes avisam no máximo 10;
  6. a tela continua funcionando depois do erro (troca de aba normal) e o
     rodapé não mostra fila pendente por causa do aviso.

    bash testes/rodar_tudo.sh test_erro_da_tela_vai_ao_servidor
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

RAIZ = Path(__file__).resolve().parent.parent
PAINEL = RAIZ / 'index.html'
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAIL = 'erro.tela@teste.local'

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def psql(q):
    r = subprocess.run(['su', 'postgres', '-c', 'psql -q -tA -d embarque_suinco'], input=q, capture_output=True, text=True)
    return r.stdout.strip()


def http(c, metodo='GET', corpo=None):
    req = urllib.request.Request(f'{API}{c}', method=metodo)
    d = None
    if corpo is not None:
        d = json.dumps(corpo).encode()
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, d, timeout=25) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        return e.code, None


def operador(email, setor):
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True).stdout.strip()
    psql(f"DELETE FROM operadores WHERE email = '{email}';")
    psql(f"INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES ('{email}', '{setor} Teste', '{setor}', '{h}', true);")
    st, r = http('/auth/login', metodo='POST', corpo={'email': email, 'senha': SENHA})
    return (r or {}).get('token')


async def main():
    ck('operador da Portaria criado', bool(operador(EMAIL, 'Portaria')))
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await (await nav.new_context(viewport={'width': 1366, 'height': 900})).new_page()
        avisos, respostas = [], []
        pg.on('request', lambda r: avisos.append(r.post_data) if r.url.endswith('/api/erros') and r.method == 'POST' else None)
        pg.on('response', lambda r: respostas.append(r.status) if r.url.endswith('/api/erros') else None)
        html = PAINEL.read_text(encoding='utf-8').replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        url = API + '/__erro_tela'
        await pg.route(url, lambda rota: asyncio.ensure_future(rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.route('**/socket.io/socket.io.js', lambda rota: asyncio.ensure_future(
            rota.fulfill(status=200, content_type='application/javascript', body='')))
        await pg.goto(url)
        await pg.wait_for_selector('#login-email', timeout=25000)
        await pg.fill('#login-email', EMAIL)
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3500)
        ck('entrou', not await pg.is_visible('#login-email'))
        aba = await pg.evaluate('() => TAB_ATUAL')
        avisos.clear()
        respostas.clear()

        print('\n=== 1-2. O ERRO QUE ESCAPA VIRA UM AVISO, SÓ COM O QUE PODE ===')
        await pg.evaluate("() => { setTimeout(() => { throw new TypeError('defeito de teste: leitura de nulo'); }, 0); }")
        await pg.wait_for_timeout(1500)
        ck('um aviso saiu para /api/erros', len(avisos) == 1, str(len(avisos)))
        ck('o servidor aceitou (202)', respostas[:1] == [202], str(respostas))
        corpo = json.loads(avisos[0]) if avisos else {}
        ck('levou só tipo, mensagem, pilha, tela e versão', sorted(corpo) == ['mensagem', 'pilha', 'tela', 'tipo', 'versao'], str(sorted(corpo)))
        ck('o tipo e a mensagem do erro', corpo.get('tipo') == 'TypeError' and 'leitura de nulo' in corpo.get('mensagem', ''), str(corpo)[:200])
        ck('a aba aberta', corpo.get('tela') == aba, f"{corpo.get('tela')} x {aba}")
        ck('a versão do painel', bool(corpo.get('versao')), str(corpo.get('versao')))
        ck('a pilha diz onde quebrou', 'at ' in corpo.get('pilha', ''), corpo.get('pilha', '')[:120])

        print('\n=== 3. PROMESSA RECUSADA SEM TRATAMENTO ===')
        avisos.clear()
        await pg.evaluate("() => { Promise.reject(new RangeError('promessa de teste sem catch')); }")
        await pg.wait_for_timeout(1200)
        ck('avisou', len(avisos) == 1 and 'promessa de teste' in (avisos[0] or ''), str(avisos)[:200])

        print('\n=== 4. O QUE NÃO É DEFEITO DO PAINEL NÃO AVISA ===')
        avisos.clear()
        await pg.evaluate("""() => {
          Promise.reject(Object.assign(new Error('Transição não permitida'), { status: 409 }));
          Promise.reject(Object.assign(new Error('Não foi possível alcançar o servidor.'), { motivo: 'transporte' }));
          Promise.reject(new TypeError('Failed to fetch'));
          Promise.reject(new DOMException('cancelado', 'AbortError'));
          window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
          window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' }));
        }""")
        await pg.wait_for_timeout(1200)
        ck('nenhum aviso para recusa do servidor, rede, cancelamento, Script error e ResizeObserver', not avisos, str(avisos)[:300])

        print('\n=== 5. NÃO VIRA BARULHO ===')
        avisos.clear()
        await pg.evaluate("() => { for (let i = 0; i < 5; i++) setTimeout(() => { throw new Error('o mesmo erro em laço'); }, 0); }")
        await pg.wait_for_timeout(1200)
        ck('o mesmo erro 5 vezes avisa uma', len(avisos) == 1, str(len(avisos)))
        avisos.clear()
        await pg.evaluate("() => { for (let i = 0; i < 15; i++) setTimeout(() => { throw new Error('erro diferente ' + String.fromCharCode(97 + i)); }, 0); }")
        await pg.wait_for_timeout(1500)
        # 3 avisos já saíram nesta página (passos 1, 3 e 5a): sobram 7 dos 10.
        ck('no máximo 10 avisos por página aberta', len(avisos) == 7, str(len(avisos)))

        print('\n=== 6. A TELA CONTINUA TRABALHANDO ===')
        destino = await pg.evaluate("(atual) => ([...document.querySelectorAll('.nav-tab[data-tab]')]"
                                    "  .find(t => t.offsetParent && t.dataset.tab !== atual) || {dataset:{}}).dataset.tab || ''", aba)
        ck('há outra aba para abrir', bool(destino), destino)
        if destino:
            await pg.click(f'.nav-tab[data-tab="{destino}"]')
            await pg.wait_for_timeout(800)
            ck('troca de aba normal depois dos erros', await pg.evaluate('() => TAB_ATUAL') == destino, destino)
        pend = await pg.evaluate("() => SuincoSharePoint.pendentes()")
        ck('o aviso não entra na fila de gravação (rodapé sem pendente)', pend == 0, str(pend))
        await nav.close()
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}';")
    print('\nRESULTADO:', 'OK' if not falhas else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
