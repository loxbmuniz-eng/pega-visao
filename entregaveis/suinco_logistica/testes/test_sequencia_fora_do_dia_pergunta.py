#!/usr/bin/env python3
"""Sequência que deixa buraco depois da maior do dia: o painel PERGUNTA (#133).

RELATO DO DONO, 09/10/2026, com o print da Montagem do dia: "cargas que foram
criadas agora estão saindo com um número nada a ver na coluna sequência" —
25, 26 e depois 16627, 16628… 16636.

A CAUSA, reproduzida no banco de teste: uma linha do dia recebeu 16626 (o
formulário aberto da linha tem "Sequência" colado em "Peso (kg)", e um peso
de 16.626 kg cabe nele), e a criação dá à linha nova a casa livre ACIMA DA
MAIOR (#43). Uma vez dentro, o número arrasta todas as cargas criadas depois.

POR QUE PERGUNTAR E NÃO RECUSAR: a decisão do dono de 17/09 — "independente-
mente do número, você vai resolver" — é que o número digitado é o que a carga
fica, mesmo acima da fila (há dias com 1, 2, 14, 20…). Então nada é negado:
o painel diz o que vai acontecer e a pessoa escolhe. É a regra da casa —
"quando a ação é arriscada, PERGUNTE explicando".

O CAMINHO, pela tela, com a API de verdade:
  1. Montagem, formulário aberto da linha: digitar 16626 em "Sequência"
     PERGUNTA; "Corrigir" não grava nada;
  2. Montagem, campo da linha: digitar 50000 PERGUNTA; "Corrigir" não grava;
  3. a carga criada depois nasce na numeração do dia (4), não em 16627;
  4. número dentro do dia (2) não pergunta e reordena como sempre;
  5. confirmar grava o número pedido (a decisão de 17/09 continua valendo);
  6. Torre: digitar 99999 numa carga da fila PERGUNTA; "Corrigir" não grava.

REPROVA contra o publicado:
    SUINCO_PAINEL_ARQUIVO=<index.html publicado> bash testes/rodar_tudo.sh sequencia_fora_do_dia_pergunta

    bash testes/rodar_tudo.sh sequencia_fora_do_dia_pergunta
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
EMAIL = 'seq131@teste.local'
DIA = '2026-12-01'
PLACAS = ['TST1311', 'TST1312', 'TST1313']
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


def limpar():
    psql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}';")
    lista = ','.join(f"'{p}'" for p in PLACAS)
    psql(f"DELETE FROM fact_statusfrota WHERE placa IN ({lista});")
    psql(f"DELETE FROM fact_viagens WHERE placa IN ({lista});")
    psql(f"DELETE FROM dim_veiculos WHERE placa IN ({lista});")
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}';")


def seq_montagem():
    return psql(f"SELECT string_agg(sequencia::text, ',' ORDER BY sequencia) FROM programacao_montagem WHERE data_prog = '{DIA}';")


async def abrir_painel(nav):
    ctx = await nav.new_context()
    pg = await ctx.new_page()
    await pg.set_viewport_size({'width': 1600, 'height': 1000})
    html = PAINEL.read_text(encoding='utf-8').replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    url = API + '/__painel_teste'
    await pg.route(url, lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.route('**/socket.io/socket.io.js', lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='application/javascript', body='')))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.fill('#login-email', EMAIL)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(2500)
    return pg


async def pergunta(pg):
    """O texto da pergunta aberta, ou '' se nenhuma abriu."""
    try:
        await pg.wait_for_selector('#pergunta-titulo', timeout=2500)
    except Exception:
        return ''
    return (await pg.inner_text('#pergunta-titulo')) + ' ' + (await pg.inner_text('#pergunta-texto'))


async def abrir_montagem(pg):
    await pg.click(".nav-tab[data-tab='programacao']")
    await pg.wait_for_timeout(800)
    await pg.fill('#mont-data', DIA)
    await pg.dispatch_event('#mont-data', 'change')
    await pg.wait_for_timeout(1800)


async def main():
    limpar()
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True).stdout.strip()
    psql(f"INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES ('{EMAIL}', 'Logística Teste 131', 'Logística', '{h}', true);")
    st, r = http('/auth/login', metodo='POST', corpo={'email': EMAIL, 'senha': SENHA})
    token = (r or {}).get('token')
    ck('login da Logística', bool(token), f'HTTP {st}')
    if not token:
        return 1
    rota = psql('SELECT codigo FROM dim_rotas ORDER BY codigo LIMIT 1;')
    ids = []
    for _ in range(3):
        st, n = http('/api/montagem', token, 'POST', {'dia': DIA, 'rotaCodigo': rota, 'qtdEntregas': 1, 'paletizada': 'Não'})
        ids.append(((n or {}).get('montagem') or {}).get('montagem_id'))
    ck('três linhas no dia, 1, 2 e 3', seq_montagem() == '1,2,3', seq_montagem())

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []
        pg = await abrir_painel(nav)
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await abrir_montagem(pg)
        linhas = await pg.locator('#mont-tbody tr.mont-linha').count()
        ck('a Montagem do dia aparece com as 3 linhas', linhas == 3, str(linhas))

        print('\n=== 1. FORMULÁRIO DA LINHA: 16626 EM "SEQUÊNCIA" (o peso no campo vizinho) ===')
        # o caminho de quem monta: "Colocar placa" abre o formulário da linha
        await pg.locator(f'#mont-tbody tr.mont-linha[data-id="{ids[2]}"] .mont-btn-placa').click()
        await pg.wait_for_timeout(700)
        campo = pg.locator('#mont-tbody tr.mont-detalhe .form-group:has(label:has-text("Sequência")) input')
        if await campo.count():
            await campo.first.fill('16626')
            await campo.first.press('Tab')
            await pg.wait_for_timeout(1200)
            txt = await pergunta(pg)
            ck('o painel PERGUNTA antes de gravar', bool(txt), '' if txt else 'nenhuma pergunta abriu')
            ck('e a pergunta diz o número, a maior do dia e o que vem depois',
               '16626' in txt and '3' in txt and '16627' in txt, txt[:260])
            if txt:
                await pg.click('#pergunta-cancelar')
                await pg.wait_for_timeout(1200)
            ck('"Corrigir" não grava nada: o dia continua 1, 2, 3', seq_montagem() == '1,2,3', seq_montagem())
        else:
            ck('(o formulário aberto tem o campo Sequência)', False)

        print('\n=== 2. CAMPO DA LINHA: 50000 ===')
        seq = pg.locator(f'#mont-tbody tr.mont-linha[data-id="{ids[0]}"] .seq-input')
        await seq.fill('50000')
        await seq.press('Tab')
        await pg.wait_for_timeout(1200)
        txt = await pergunta(pg)
        ck('o campo da linha também PERGUNTA', bool(txt) and '50000' in txt, txt[:200] or 'nenhuma pergunta abriu')
        if txt:
            await pg.click('#pergunta-cancelar')
            await pg.wait_for_timeout(1200)
        ck('"Corrigir" não grava nada', seq_montagem() == '1,2,3', seq_montagem())

        print('\n=== 3. A CARGA CRIADA DEPOIS NASCE NA NUMERAÇÃO DO DIA ===')
        st, n = http('/api/montagem', token, 'POST', {'dia': DIA, 'rotaCodigo': rota, 'qtdEntregas': 1, 'paletizada': 'Não'})
        nova = ((n or {}).get('montagem') or {}).get('sequencia')
        ck('a linha nova nasce 4 (e não 16627)', nova == 4, str(nova))
        ids.append(((n or {}).get('montagem') or {}).get('montagem_id'))
        await pg.fill('#mont-data', DIA)
        await pg.dispatch_event('#mont-data', 'change')
        await pg.wait_for_timeout(1500)

        print('\n=== 4. NÚMERO DENTRO DO DIA NÃO PERGUNTA ===')
        seq = pg.locator(f'#mont-tbody tr.mont-linha[data-id="{ids[3]}"] .seq-input')
        await seq.fill('2')
        await seq.press('Tab')
        await pg.wait_for_timeout(1500)
        txt = await pergunta(pg)
        ck('digitar 2 numa linha não pergunta nada', not txt, txt[:160])
        ck('e reordena em cascata como sempre (a 4 entra na 2)',
           psql(f"SELECT sequencia FROM programacao_montagem WHERE montagem_id = '{ids[3]}';") == '2')

        print('\n=== 5. CONFIRMAR GRAVA O NÚMERO PEDIDO (decisão de 17/09) ===')
        seq = pg.locator(f'#mont-tbody tr.mont-linha[data-id="{ids[1]}"] .seq-input')
        await seq.fill('9')
        await seq.press('Tab')
        await pg.wait_for_timeout(1200)
        txt = await pergunta(pg)
        ck('9 num dia que vai até 4 pergunta', bool(txt) and '9' in txt, txt[:160] or 'nenhuma pergunta abriu')
        if txt:
            await pg.click('#pergunta-ok')
            await pg.wait_for_timeout(1500)
        ck('confirmado, a linha fica com 9',
           psql(f"SELECT sequencia FROM programacao_montagem WHERE montagem_id = '{ids[1]}';") == '9')

        print('\n=== 6. TORRE: 99999 NUMA CARGA DA FILA ===')
        cargas = []
        for i, placa in enumerate(PLACAS, start=1):
            psql(f"INSERT INTO dim_veiculos (placa, transportadora, tipo_veiculo, origem) VALUES ('{placa}', 'Transp. Teste 131', 'Truck', 'teste');")
            st, c = http('/api/cargas', token, 'POST', {'placa': placa, 'numeroCarga': f'T131-{i}', 'rota': rota,
                                                         'sequencia': i, 'freteObservacao': 'TABELA'})
            cargas.append(((c or {}).get('carga') or c or {}).get('id') or ((c or {}).get('carga') or {}).get('carga_id'))
        ck('três cargas na fila de hoje', all(cargas), str(cargas))
        await pg.reload()
        await pg.wait_for_timeout(3000)
        await pg.click(".nav-tab[data-tab='torre']")
        await pg.wait_for_timeout(1500)
        alvo = pg.locator(f'tr[data-carga="{cargas[0]}"] .seq-input').first
        if await alvo.count():
            await alvo.fill('99999')
            await alvo.press('Tab')
            await pg.wait_for_timeout(1200)
            txt = await pergunta(pg)
            ck('a Torre também PERGUNTA', bool(txt) and '99999' in txt, txt[:200] or 'nenhuma pergunta abriu')
            if txt:
                await pg.click('#pergunta-cancelar')
                await pg.wait_for_timeout(1500)
            sq = psql(f"SELECT sequencia FROM fact_viagens WHERE placa = '{PLACAS[0]}';")
            ck('"Corrigir" não grava nada na carga', sq == '1', sq)
        else:
            ck('(a carga aparece na Torre)', False)

        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    print('\n=======================================================')
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print('   -', f)
        return 1
    print('  Tudo verde: número fora do dia só entra perguntando.')
    return 0


if __name__ == '__main__':
    # A limpeza roda mesmo se a suíte cair no meio (#130).
    try:
        sys.exit(asyncio.run(main()))
    finally:
        limpar()
