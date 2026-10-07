#!/usr/bin/env python3
"""Caixa "Pontos de atenção" — só a Administração (07/10/2026, #50).

PEDIDO DO DONO: "gostei dessa análise e dados inteligentes processando os
dados que são introduzidos no sistema — isso gera um ecossistema de dados que
gera indicadores e pontos de atenção"; aprovado com "a caixa de atenção deixa
só pra administração".

O QUE ESTE TESTE TRAVA, pela tela, no servidor de teste:
  1. a Administração vê no topo o ícone "Atenção" com o NÚMERO de pontos;
     a Logística não vê o ícone;
  2. abrir mostra cada ponto com a gravidade ESCRITA (não só a cor), o que é,
     desde quando e onde resolver — do mais grave ao mais leve;
  3. "Resolver em" leva para a aba certa;
  4. resolvido o cadastro, o ponto some sozinho ao abrir de novo;
  5. no celular (390 px) o ícone e o número continuam à vista e a caixa cabe;
  6. nenhuma letra abaixo de 12 px dentro da caixa.
Dados plantados e marcados (cargas 9056xx, placa TSA56xx).

    bash testes/rodar_tudo.sh test_pontos_de_atencao
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
PLACA = 'TSA5601'

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


def plantar():
    psql(f"""
      DELETE FROM fact_viagens WHERE carga_id LIKE 'atencao-tela-%';
      DELETE FROM dim_veiculos WHERE placa = '{PLACA}';
      DELETE FROM pgfrete_cargas WHERE numero_carga = '905603';
      INSERT INTO dim_veiculos (placa, transportadora, tipo_veiculo, origem) VALUES ('{PLACA}', '', 'Truck', 'teste');
      INSERT INTO fact_viagens (carga_id, numero_carga, placa, status_atual, transportadora, criado_em)
           VALUES ('atencao-tela-1', '905601', '{PLACA}', 'Aguardando Embarque', '', now() - interval '2 days');
      INSERT INTO pgfrete_cargas (numero_carga, data_consulta, primeira_consulta, transportadora, criado_em)
           VALUES ('905603', current_date, current_date, 'Transp. Teste', now() - interval '3 days');
      INSERT INTO vigia_registros (verificacao, ok, detalhe, conferido_em, problema_desde)
           VALUES ('disco', false, 'teste: 95% ocupado', now(), now() - interval '5 hours')
      ON CONFLICT (verificacao) DO UPDATE SET ok = false, detalhe = EXCLUDED.detalhe, problema_desde = EXCLUDED.problema_desde;
    """)


def limpar():
    psql(f"""
      DELETE FROM fact_viagens WHERE carga_id LIKE 'atencao-tela-%';
      DELETE FROM dim_veiculos WHERE placa = '{PLACA}';
      DELETE FROM pgfrete_cargas WHERE numero_carga = '905603';
      DELETE FROM vigia_registros WHERE verificacao = 'disco';
    """)


async def abrir(nav, email, viewport):
    ctx = await nav.new_context(viewport=viewport)
    pg = await ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    html = PAINEL.read_text(encoding='utf-8').replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    url = API + '/__atencao'
    await pg.route(url, lambda rota: asyncio.ensure_future(rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.route('**/socket.io/socket.io.js', lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='application/javascript', body='')))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    return ctx, pg, erros


LER = r"""() => {
  const pts = [...document.querySelectorAll('#atencao-lista .atencao-ponto')];
  const pequenos = [...document.querySelectorAll('#modal-atencao *')].filter(e => e.getBoundingClientRect().width > 0
      && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 12)
    .map(e => e.className + ':' + getComputedStyle(e).fontSize);
  const box = document.querySelector('#modal-atencao .modal-box').getBoundingClientRect();
  return { pontos: pts.map(p => ({ codigo: p.dataset.codigo, grav: (p.querySelector('.atencao-grav') || {}).textContent || '',
             desde: (p.querySelector('.atencao-desde') || {}).textContent || '', onde: !!p.querySelector('.atencao-ir') })),
           pequenos, cabeNaLargura: box.right <= innerWidth + .5 && box.left >= -.5 };
}"""


async def main():
    limpar()
    ok = operador('atencao.adm@teste.local', 'Administração') and operador('atencao.log@teste.local', 'Logística')
    ck('operadores Administração e Logística criados', bool(ok))
    plantar()
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        todos_erros = []

        print('\n=== 1. SÓ A ADMINISTRAÇÃO VÊ O ÍCONE ===')
        ctx, pg, erros = await abrir(nav, 'atencao.log@teste.local', {'width': 1366, 'height': 900})
        todos_erros += erros
        ck('a Logística NÃO vê o ícone "Atenção"', not await pg.is_visible('#btn-atencao'))
        await ctx.close()

        ctx, pg, erros = await abrir(nav, 'atencao.adm@teste.local', {'width': 1366, 'height': 900})
        todos_erros += erros
        ck('a Administração vê o ícone "Atenção"', await pg.is_visible('#btn-atencao'))
        n = (await pg.inner_text('#atencao-contador')).strip() if await pg.is_visible('#atencao-contador') else ''
        ck('o ícone mostra o número de pontos (pelo menos 3: disco, placa, frete)', n.isdigit() and int(n) >= 3, repr(n))

        print('\n=== 2. ABRIR: GRAVIDADE ESCRITA, DESDE QUANDO, ONDE RESOLVER ===')
        await pg.click('#btn-atencao')
        await pg.wait_for_timeout(1500)
        r = await pg.evaluate(LER)
        cod = {x['codigo']: x for x in r['pontos']}
        ck('o vigia com problema aparece como GRAVE', 'vigia_disco' in cod and cod['vigia_disco']['grav'].strip().lower() == 'grave', str(cod.get('vigia_disco')))
        ck('placa sem transportadora aparece como LEVE', 'placa_sem_transportadora' in cod and cod['placa_sem_transportadora']['grav'].strip().lower() == 'leve')
        ck('frete sem carga no painel aparece como LEVE', 'frete_sem_carga_no_painel' in cod)
        ordem = {'grave': 0, 'média': 1, 'leve': 2}
        g = [ordem.get(x['grav'].strip().lower(), 9) for x in r['pontos']]
        ck('do mais grave ao mais leve', g == sorted(g), str(g))
        ck('todo ponto diz desde quando', all(x['desde'].startswith('Desde') for x in r['pontos']), str([x['desde'] for x in r['pontos']][:3]))
        ck('todo ponto diz onde resolver', all(x['onde'] for x in r['pontos']))
        ck('nenhuma letra abaixo de 12 px na caixa', not r['pequenos'], str(r['pequenos'][:4]))

        print('\n=== 3. "RESOLVER EM" LEVA À ABA CERTA ===')
        await pg.click('#atencao-lista .atencao-ponto[data-codigo="placa_sem_transportadora"] .atencao-ir')
        await pg.wait_for_timeout(800)
        ck('a caixa fecha e a aba Cadastros abre', not await pg.is_visible('#modal-atencao .modal-box')
           and await pg.evaluate("() => document.getElementById('tab-cadastros').classList.contains('active')"))

        print('\n=== 4. RESOLVIDO, SOME SOZINHO ===')
        psql(f"UPDATE dim_veiculos SET transportadora = 'Transp. Resolvida' WHERE placa = '{PLACA}';")
        psql("UPDATE vigia_registros SET ok = true, problema_desde = NULL WHERE verificacao = 'disco';")
        await pg.click('#btn-atencao')
        await pg.wait_for_timeout(1500)
        r2 = await pg.evaluate(LER)
        c2 = {x['codigo'] for x in r2['pontos']}
        ck('a placa resolvida e o vigia de volta ao normal saíram da caixa', 'placa_sem_transportadora' not in c2 and 'vigia_disco' not in c2, str(c2))
        await ctx.close()

        print('\n=== 5. NO CELULAR ===')
        psql(f"UPDATE dim_veiculos SET transportadora = '' WHERE placa = '{PLACA}';")
        ctx, pg, erros = await abrir(nav, 'atencao.adm@teste.local', {'width': 390, 'height': 844})
        todos_erros += erros
        ck('no celular o ícone e o número estão à vista', await pg.is_visible('#btn-atencao') and await pg.is_visible('#atencao-contador'))
        await pg.click('#btn-atencao')
        await pg.wait_for_timeout(1500)
        r3 = await pg.evaluate(LER)
        ck('a caixa cabe na largura do celular', r3['cabeNaLargura'], str(r3))
        await ctx.close()

        ck('nenhum erro de JavaScript', not todos_erros, '; '.join(todos_erros[:2]))
        await nav.close()
    limpar()
    print('\nRESULTADO:', 'OK' if not falhas else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
