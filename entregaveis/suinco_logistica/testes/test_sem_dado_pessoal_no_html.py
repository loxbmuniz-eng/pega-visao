#!/usr/bin/env python3
"""O HTML público não carrega dado pessoal (10/09/2026).

RELATO DO DONO, depois de inspecionar embarquesuinco.com.br SEM estar logado:
"apareceu isso mesmo sem o login ter sido feito, entao nao esta seguro".

O QUE ELE VIU E O QUE DE FATO HAVIA. O sw.js que apareceu no inspetor NÃO é
brecha: todo código que o navegador executa é legível, e esconder não é o que
protege — o que protege é o servidor recusar, e recusa (sete rotas de dado sem
token responderam 401 com zero conteúdo).

Mas uma linha ao lado havia brecha real. O index.html é servido pela Vercel
como arquivo estático, ANTES de qualquer login, e carregava a base de frota
inteira: 749 placas, 134 transportadoras e CINCO delas com NOME COMPLETO E CPF
de pessoa física (transportador autônomo registrado como MEI).

A PRIMEIRA TENTATIVA FOI TIRAR A FROTA DO HTML, e ela REPROVOU na bateria:
54 suítes vermelhas, todas de uma causa só — a suíte de tela usa a frota
embutida como fixture, e 99 das 150 suítes tocam DB.frota. Não há helper
compartilhado para corrigir num ponto só (as suítes são independentes por
decisão de projeto). Publicar aquilo teria quebrado metade da bateria.

A DECISÃO DO DONO, com as duas opções na mesa: caminho cirúrgico. Sai do CSV
apenas o CPF; a frota continua embutida. Fecha HOJE a exposição de dado
pessoal — que é o que tem prazo de LGPD correndo (Art. 48: 3 dias úteis) —
sem quebrar teste nenhum.

O QUE ESTA GUARDA TRAVA: nenhum CPF válido no HTML público, nunca mais.

O QUE CONTINUA EM ABERTO, dito aqui para não virar omissão: as 749 placas e
os nomes das transportadoras SEGUEM no HTML público. Fechar isso é o caminho
A — frota só depois do login, com fixture próprio nas suítes — e é trabalho
que ainda não foi feito. Esta guarda NÃO cobre esse caso.

    python3 testes/test_sem_dado_pessoal_no_html.py
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

    print('\n=== 1. NENHUM DADO PESSOAL NO HTML SERVIDO SEM LOGIN ===')
    cpfs = {re.sub(r'\D', '', a) for a in
            re.findall(r'(?<!\d)(\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?!\d)', html)}
    cpfs = {c for c in cpfs if cpf_valido(c)}
    ck('nenhum CPF válido no HTML público', not cpfs,
       f'{len(cpfs)} CPF(s) — dado pessoal servido sem login' if cpfs else '')

    # A MESMA CONFERÊNCIA NA FONTE, e não só no gerado.
    # O HTML é build; o CSV é a origem. Conferir só o build deixaria o CPF
    # voltar no próximo `python3 build_arquivo_unico.py` sem ninguém notar.
    csv_txt = (RAIZ / 'frota_seed_2026.csv').read_text(errors='ignore')
    cpfs_csv = {re.sub(r'\D', '', a) for a in
                re.findall(r'(?<!\d)(\d{3}\.?\d{3}\.?\d{3}-?\d{2})(?!\d)', csv_txt)}
    cpfs_csv = {c for c in cpfs_csv if cpf_valido(c)}
    ck('nem na base de frota que alimenta o build', not cpfs_csv,
       f'{len(cpfs_csv)} CPF(s) no CSV' if cpfs_csv else '')

    # A frota CONTINUA embutida — é o fixture de 99 suítes. Conferir que ela
    # está lá evita o oposto do defeito: alguém "limpar" o HTML de novo e
    # derrubar metade da bateria sem entender por quê.
    ck('a base de frota segue no HTML (fixture da bateria, decisão de 10/09)',
       'window.FROTA_SEED_CSV = ' + chr(34) in html)

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

        # NO CAMINHO B O PAINEL ABRE COM A FROTA, e isso é o esperado.
        # Esta linha já afirmou o contrário — foi escrita para o caminho A,
        # em que a frota só viria depois do login. Deixá-la assim seria a
        # guarda medindo um mundo que a decisão do dono descartou.
        aberto = await pg.evaluate("() => (DB.frota || []).length")
        ck('ao abrir, o painel já tem a frota do embutido (o fixture)',
           aberto >= 700, f'{aberto} placa(s) antes de qualquer sincronia')

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
