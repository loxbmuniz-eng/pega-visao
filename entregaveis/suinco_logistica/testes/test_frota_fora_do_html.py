#!/usr/bin/env python3
"""A base de frota sai do HTML público — e a operação continua igual.

RELATO DO DONO, 10/09/2026, depois de inspecionar embarquesuinco.com.br sem
estar logado: "apareceu isso mesmo sem o login ter sido feito, entao nao esta
seguro na pagina de login".

O QUE ELE VIU e o que de fato havia:
  - o `sw.js` que apareceu no inspetor NÃO é brecha. Todo código que o
    navegador executa é legível; esconder não é o que protege. O que protege
    é o servidor recusar, e recusa: sete rotas de dado chamadas sem token
    responderam 401 com zero conteúdo.
  - MAS, uma linha ao lado, havia brecha de verdade: o `index.html` — servido
    sem login — carregava `window.FROTA_SEED_CSV` com a base inteira:
    749 placas, 134 transportadoras nomeadas e 5 delas com NOME COMPLETO E
    CPF de pessoa física (transportador autônomo registrado como MEI).
    Qualquer um baixava o HTML e tinha a frota da Suinco.

A CORREÇÃO: o build para de embutir o CSV. A frota passa a vir de
`GET /cadastros/frota`, que já existia e já exige login.

POR QUE ISSO NÃO ATRAPALHA A OPERAÇÃO — e é o que o bloco 2 prova:
`suinco-api.js` já busca `/api/frota` em TODA sincronia completa. O comentário
do próprio arquivo diz "todo mundo que recebeu a frota do servidor (ou seja,
todo mundo, todo dia)". O CSV embutido era um atalho de partida ANTES do
login; depois do login ele já era sobrescrito pelo dado do servidor.

    python3 testes/test_frota_fora_do_html.py
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
PAINEL = 'file://' + str(RAIZ / 'index.html')
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAIL = 'frota-html@teste.local'

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def cpf_valido(c):
    """Dígito verificador. Sem isso, qualquer sequência de 11 dígitos viraria
    'CPF' e o teste acusaria vazamento onde não há."""
    if len(c) != 11 or len(set(c)) == 1:
        return False
    for corte in (9, 10):
        soma = sum(int(c[i]) * ((corte + 1) - i) for i in range(corte))
        d = (soma * 10) % 11
        if d == 10:
            d = 0
        if d != int(c[corte]):
            return False
    return True


def psql(q):
    """SQL por STDIN. Duas armadilhas já custaram tempo aqui:

    1. `su postgres -c 'psql -c "<sql>"'` deixa o SHELL ver o SQL, e o hash
       do bcrypt começa com `$2a$04$` — o shell expande `$2`, `$0` e `$04`
       e grava "abash4." como senha. O login responde 401 sem dizer por quê.
    2. `psql -f <arquivo>` no diretório de trabalho desta sessão falha com
       "Permission denied": o usuário postgres não atravessa esse caminho.

    Stdin não passa pelo shell nem depende de permissão de arquivo."""
    r = subprocess.run(['su', 'postgres', '-c', 'psql -q -d embarque_suinco'],
                       input=q, capture_output=True, text=True)
    if r.returncode != 0:
        print('    [psql]', (r.stderr or '').strip()[:160])
    return r


def http(caminho, token=None, metodo='GET', corpo=None):
    req = urllib.request.Request(f'{API}{caminho}', method=metodo)
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


async def main():
    html = (RAIZ / 'index.html').read_text(errors='ignore')

    print('\n=== 1. O HTML PÚBLICO NÃO CARREGA MAIS A BASE DE FROTA ===')
    # A GUARDA É CONTRA O CADASTRO, NÃO CONTRA A PALAVRA.
    # `data.js` continua CITANDO window.FROTA_SEED_CSV no código que lê a
    # origem — isso é código, e código o navegador sempre vê. O que não pode
    # existir é a ATRIBUIÇÃO com o dado dentro.
    ck('o HTML não recebe mais a base de frota',
       'window.FROTA_SEED_CSV = "' not in html,
       'a atribuição com o CSV ainda está lá' if 'window.FROTA_SEED_CSV = "' in html else '')
    ck('o cabeçalho do cadastro de frota não está no HTML',
       'Placa,Transportadora,TipoVeiculo' not in html)

    cpfs = {re.sub(r'\D', '', a) for a in
            re.findall(r'(?<!\d)(\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?!\d)', html)}
    cpfs = {c for c in cpfs if cpf_valido(c)}
    ck('nenhum CPF válido no HTML público', not cpfs,
       f'{len(cpfs)} CPF(s) — dado pessoal servido sem login' if cpfs else '')

    # NÃO É "ZERO PLACAS", E ISSO É DECISÃO, NÃO FROUXIDÃO.
    # Os comentários do código citam placas REAIS de incidentes já ocorridos
    # ("o relato do FTZ2138", "a Portaria deu saída na PUX2971 às 06:38").
    # Elas são a memória de por que cada regra existe — apagá-las para o
    # teste passar trocaria uma proteção de dado por uma perda de
    # documentação, e o dado exposto de verdade era o CADASTRO.
    # Um cadastro tem centenas de linhas; comentário de incidente tem uma
    # dezena. O teto separa os dois casos sem ambiguidade.
    # DOIS FORMATOS, e o antigo é a maioria da frota (AAK8958).
    # A primeira versão só casava Mercosul (ABC1D23) e contava 10 tanto
    # no HTML corrigido quanto no publicado COM as 749 placas dentro —
    # a guarda passaria com o cadastro inteiro exposto.
    # NADA DE \b AQUI. No HTML o CSV vinha escapado como "...\nAAK8958,..." —
    # o `n` da sequência `\n` cola na placa e ANULA a fronteira de palavra.
    # Com `\b`, o publicado (com as 749 placas dentro) contava 10 e a guarda
    # passava com o cadastro inteiro exposto. O delimitador certo é ausência
    # de letra MAIÚSCULA ou dígito nas bordas, que tolera o escape.
    BORDA = r'(?<![A-Z0-9])%s(?![A-Z0-9])'
    placas = set(re.findall(BORDA % r'[A-Z]{3}\d[A-Z0-9]\d{2}', html))
    placas |= set(re.findall(BORDA % r'[A-Z]{3}\d{4}', html))
    ck('o HTML não carrega um CADASTRO de placas', len(placas) < 25,
       f'{len(placas)} placa(s) distintas — cadastro tem centenas')

    print('\n=== 2. E A OPERAÇÃO CONTINUA IGUAL: A FROTA VEM DO SERVIDOR ===')
    print('    (é a pergunta do dono: "tirar a frota do index vai atrapalhar?")')

    h = subprocess.run(['node', '-e',
                        f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True)
    if h.returncode != 0:
        ck('preparar operador de teste', False, h.stderr[:120])
        return
    hash_senha = h.stdout.strip()
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}';")
    psql("INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES "
         f"('{EMAIL}', 'Teste Frota', 'Logística', '{hash_senha}', true);")
    # Conferir que gravou o hash INTEIRO: gravar pela metade dá 401 no login,
    # e 401 aqui pareceria defeito da correção em vez de defeito do preparo.
    conf = psql(f"SELECT senha_hash FROM operadores WHERE email = '{EMAIL}';")
    ck('operador de teste criado com o hash íntegro',
       hash_senha[:20] in (conf.stdout or ''), (conf.stdout or '').strip()[:60])

    st, r = http('/auth/login', metodo='POST',
                 corpo={'email': EMAIL, 'senha': SENHA})
    token = (r or {}).get('token') if st == 200 else None
    ck('login no servidor local funciona', bool(token), f'HTTP {st}')

    if token:
        st, frota = http('/api/frota', token=token)
        n = len(frota or [])
        ck('a rota autenticada devolve a frota completa', st == 200 and n >= 700,
           f'HTTP {st}, {n} placa(s)')
        st_sem, _ = http('/api/frota')
        ck('e a MESMA rota recusa quem não está logado', st_sem == 401,
           f'HTTP {st_sem}')

    print('\n=== 3. O PAINEL, COM O DADO DO SERVIDOR, MONTA A FROTA ===')
    # POR QUE ESTE BLOCO NÃO FAZ LOGIN PELO NAVEGADOR.
    # O painel RECUSA login a partir de file:// de propósito ("aberto de um
    # arquivo salvo no aparelho, e não do endereço oficial") — e servir por
    # HTTP exigiria uma porta que a lista de origens da API não conhece.
    # Forçar esse arranjo tornaria o teste dependente do .env local.
    #
    # As duas metades são provadas onde cada uma vive:
    #   bloco 2 — o SERVIDOR entrega as 749 placas a quem tem token, e
    #             recusa quem não tem (HTTP real, sem imitação);
    #   bloco 3 — o PAINEL, recebendo esse mesmo dado, popula DB.frota.
    # Juntas respondem "tirar do HTML atrapalha a operação?" sem depender
    # de configuração de máquina.
    frota_real = []
    if token:
        _, bruta = http('/api/frota', token=token)
        # A forma é o contrato que suinco-api.js monta a partir da rota.
        frota_real = [{
            'Placa': v.get('placa'), 'Transportadora': v.get('transportadora'),
            'Tipo_Veiculo': v.get('tipoVeiculo'), 'Motorista': v.get('motorista'),
            'Capacidade_Kg': v.get('capacidadeKg'), 'UF': v.get('uf'),
            'Precisa_Revisao': v.get('precisaRevisao'),
        } for v in (bruta or [])]

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        # Contexto novo = localStorage vazio: o terminal que nunca abriu o
        # painel, que é o pior caso para quem dependia do CSV embutido.
        ctx = await nav.new_context()
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(1200)

        vazio = await pg.evaluate("() => (DB.frota || []).length")
        ck('ao abrir, o painel não traz cadastro de frota nenhum', vazio == 0,
           f'{vazio} placa(s) antes de qualquer sincronia')

        depois = await pg.evaluate(
            "(frota) => { fundirEstadoRemoto({ frota }); return (DB.frota || []).length; }",
            frota_real)
        ck('recebendo a frota do servidor, o painel monta as placas',
           depois >= 700, f'{depois} placa(s) de {len(frota_real)} enviadas')

        # Uma placa conferida por dentro: contagem certa com conteúdo errado
        # seria verde falso.
        if frota_real:
            amostra = await pg.evaluate(
                "(p) => { const v = (DB.frota||[]).find(x => x.placa === p);"
                " return v ? { placa: v.placa, transp: !!v.transportadora } : null; }",
                frota_real[0]['Placa'])
            ck('e com os campos preenchidos, não só a contagem',
               bool(amostra and amostra.get('transp')), str(amostra))

        ck('nenhum erro de JavaScript', not erros, str(erros[:1]))
        await ctx.close()
        await nav.close()

    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}'")

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)


asyncio.run(main())
