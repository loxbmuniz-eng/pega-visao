#!/usr/bin/env python3
"""Botão de relatório que o setor não gera não aparece (23/09/2026).

O PEDIDO DO DONO, em duas mensagens:

    "vamos la todas as filiais precisam ter acesso a gerar relatorio para o
     operador, filiales filialbsb filialba"
    "somente relacao para o operador"

E, perguntado o que fazer com o OUTRO botão do mesmo cartão — o "Relatório
do dia", que a filial continua sem poder gerar — ele escolheu a opção "a":
esconder o botão da filial.

A FAMÍLIA QUE ISTO FECHA. Três vezes o mesmo formato de defeito:

  · 11/09 — a Qualidade nasceu, viu o botão do checklist, e o servidor
    respondia 403 "seu setor não gera este documento";
  · 23/09 — as filiais viam os DOIS botões do cartão, e levavam 403 nos dois.

A causa é sempre a mesma: `documentosDoSetor()` existe no servidor desde
22/08 com o comentário "a lista que o PAINEL usa para decidir quais botões
mostrar" — e o painel nunca a recebeu. O botão prometia, o servidor negava.

O QUE ESTE TESTE TRAVA

  1. a lista de documentos chega ao painel nas TRÊS portas de sessão
     (login, /auth/eu e renovação) — se uma esquecer, quem restaura a
     sessão de manhã perde ou ganha botão errado;
  2. a filial NÃO vê o "Relatório do dia";
  3. a Logística CONTINUA vendo — esconder demais tira da operação um
     relatório que ela sempre teve;
  4. lista AUSENTE não esconde nada. Quem entrou por "Entrar só neste
     aparelho", ou está num painel ligado a servidor ainda não atualizado,
     continua vendo o botão exatamente como antes. Esconder por falta de
     informação é pior que não esconder: quem decide é o servidor;
  5. a decisão não está copiada no painel. Se alguém escrever "Filial 105
     BSB" dentro da função do painel, esta prova reprova — seria a segunda
     cópia da regra, que é exatamente como esta família de defeitos nasce.

Exige o backend local no ar.

    python3 testes/test_botao_de_relatorio_por_setor.py
"""
import asyncio
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = str(RAIZ / 'index.html')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAIL_FILIAL = 'filial105@teste.local'
SETOR_FILIAL = 'Filial 105 BSB'

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def psql(q):
    return subprocess.run(['sudo', '-u', 'postgres', 'psql', '-q', '-d', 'embarque_suinco',
                           '-c', q], capture_output=True, text=True)


def http(caminho, token=None, metodo='GET', corpo=None):
    req = urllib.request.Request(f'{API}{caminho}', method=metodo)
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    dados = None
    if corpo is not None:
        dados = json.dumps(corpo).encode()
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, dados, timeout=15) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or 'null')
        except Exception:
            return e.code, None


def criar_operador_da_filial():
    h = subprocess.run(['node', '-e',
                        f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True)
    if h.returncode != 0:
        return False, (h.stderr or '')[:200]
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL_FILIAL}'")
    r = psql("INSERT INTO operadores (email,nome,setor,senha_hash) VALUES "
             f"('{EMAIL_FILIAL}','Operador da Filial 105','{SETOR_FILIAL}','{h.stdout.strip()}')")
    return r.returncode == 0, (r.stderr or '')[:200]


async def esconde_o_botao(pg, email):
    """Entra com este e-mail e devolve o que a tela mostra do cartão."""
    await pg.evaluate("() => { try{ localStorage.clear(); }catch(e){} }")
    await pg.reload()
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    return await pg.evaluate("""() => {
        const el = document.querySelector('[data-documento="devolucoes-do-dia"]');
        return {
          achou: !!el,
          escondido: el ? el.hidden : null,
          setor: (DB.operador || {}).setor || '',
          documentos: (DB.operador || {}).documentos || null,
        };
    }""")


async def main():
    print('\n=== 0. O OPERADOR DA FILIAL EXISTE ===')
    ok, detalhe = criar_operador_da_filial()
    ck(f'o banco aceita o setor "{SETOR_FILIAL}"', ok, detalhe)
    if not ok:
        return 1

    print('\n=== 1. AS TRÊS PORTAS DE SESSÃO ENTREGAM A MESMA LISTA ===')
    st, entrada = http('/auth/login', metodo='POST',
                       corpo={'email': EMAIL_FILIAL, 'senha': SENHA})
    ck('a filial entra', st == 200, f'HTTP {st}')
    if st != 200:
        return 1
    token = entrada['token']
    doc_login = (entrada.get('operador') or {}).get('documentos')
    ck('o login manda a lista de documentos', isinstance(doc_login, list), str(doc_login))
    ck('e a Relação para o Operador está nela — é o pedido do dono',
       'devolucao-operador' in (doc_login or []), str(doc_login))
    ck('e o Relatório do dia NÃO está — "somente relacao para o operador"',
       'devolucoes-do-dia' not in (doc_login or []), str(doc_login))

    _, eu = http('/auth/eu', token)
    ck('/auth/eu diz a mesma coisa (é por onde a sessão é restaurada)',
       (eu.get('operador') or {}).get('documentos') == doc_login,
       str((eu.get('operador') or {}).get('documentos')))
    _, renovado = http('/auth/renovar', token, 'POST')
    ck('a renovação diz a mesma coisa (é por onde o dia inteiro passa)',
       (renovado.get('operador') or {}).get('documentos') == doc_login,
       str((renovado.get('operador') or {}).get('documentos')))

    print('\n=== 2. A REGRA NÃO ESTÁ COPIADA NO PAINEL ===')
    app_js = (RAIZ / 'app.js').read_text(encoding='utf-8')
    corpo = re.search(r'function podeGerarDocumentoUI\(tipo\)\{(.*?)\n\}', app_js, re.S)
    ck('a função que decide o botão existe', bool(corpo))
    if corpo:
        # O nome de setor aqui seria a SEGUNDA cópia da tabela do servidor.
        nomes = re.findall(r"Filial \d+|'(?:Logística|Qualidade|Controles Internos|"
                           r"Central de Notas|Portaria|Expedição|Faturamento)'", corpo.group(1))
        ck('e não repete nenhum nome de setor — a fonte é o servidor',
           not nomes, str(nomes))

    html = (RAIZ / 'index_suinco.html').read_text(encoding='utf-8')
    ck('o botão do Relatório do dia está marcado com o tipo do documento',
       'data-documento="devolucoes-do-dia"' in html)

    print('\n=== 3. NA TELA: A FILIAL NÃO VÊ, A LOGÍSTICA VÊ ===')
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        ctx = await nav.new_context(viewport={'width': 1500, 'height': 950})
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        painel = open(PAINEL_ARQ, encoding='utf-8').read()
        painel = painel.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        painel = painel.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                                f'{API}/socket.io/socket.io.js')
        url = f'{API}/__botaorelatorio'
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=painel)))
        await pg.goto(url)

        filial = await esconde_o_botao(pg, EMAIL_FILIAL)
        ck('o botão existe na tela da filial (é escondido, não removido)',
           filial['achou'], str(filial))
        ck('a filial entrou no setor certo', filial['setor'] == SETOR_FILIAL, str(filial))
        ck('e o Relatório do dia está ESCONDIDO dela', filial['escondido'] is True,
           str(filial))

        # A LOGÍSTICA, que é dona do relatório desde sempre. Esconder demais
        # é tão defeito quanto esconder de menos — e mais caro, porque tira da
        # operação um papel que ela usa todo dia.
        logistica = await esconde_o_botao(pg, 'ana@teste.local')
        ck('a Logística entrou', logistica['setor'] == 'Logística', str(logistica))
        ck('e continua vendo o Relatório do dia',
           logistica['escondido'] is False, str(logistica))

        print('\n=== 4. LISTA AUSENTE NÃO ESCONDE NADA ===')
        # Modo local, ou painel ligado a servidor ainda não atualizado: sem a
        # lista, o botão continua como sempre esteve. Quem decide é o servidor.
        sem_lista = await pg.evaluate("""() => {
            if(typeof aplicarDonosDeDocumentoUI !== 'function')
              return { semFuncao: true, escondido: null };
            delete DB.operador.documentos;
            aplicarDonosDeDocumentoUI();
            const el = document.querySelector('[data-documento="devolucoes-do-dia"]');
            return { escondido: el ? el.hidden : null };
        }""")
        ck('sem a lista, o botão continua visível', sem_lista['escondido'] is False,
           str(sem_lista))

        ck('nenhum erro de JavaScript na página', not erros, str(erros[:2]))
        await nav.close()

    print('\n' + '=' * 51)
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print(f'    · {f}')
        return 1
    print('  tudo verde.')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
