#!/usr/bin/env python3
"""Prints da apresentação institucional — uma foto por aba, com o pátio CHEIO.

Diferente dos guias (que fotografam um passo de cada vez), aqui cada aba é
fotografada no estado mais parecido com um dia de operação de verdade:
cargas em todos os status, devoluções na esteira, montagem do dia armada.
É o que a diretoria vai ver no telão — tela vazia não apresenta nada.

Roda contra o backend LOCAL descartável (porta 3010), nunca produção.

    python3 apresentacao/capturar_telas.py
"""
import asyncio
import os
import pathlib
import sys

RAIZ = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / 'tutoriais'))
import dados_demo                                    # noqa: E402
from playwright.async_api import async_playwright    # noqa: E402

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = 'guia-demo-123'
PRINTS = pathlib.Path(__file__).resolve().parent / 'prints'
PRINTS.mkdir(exist_ok=True)

# (arquivo, setor demo, aba, preparo JS opcional, rolar até seletor)
TELAS = [
    ('01_login',        None,                        None,          None, None),
    ('02_torre',        'guia.adm@suinco.demo',      'torre',       None, None),
    ('03_programacao',  'guia.logistica@suinco.demo','programacao', None, None),
    ('04_montagem',     'guia.logistica@suinco.demo','programacao', 'montagem', '#card-montagem-dia'),
    ('05_portaria',     'guia.portaria@suinco.demo', 'portaria',    None, None),
    ('06_expedicao',    'guia.expedicao@suinco.demo','expedicao',   None, None),
    ('07_faturamento',  'guia.faturamento@suinco.demo','faturamento', None, None),
    ('08_devolucoes',   'guia.logistica@suinco.demo','devolucoes',  None, None),
    ('09_indicadores',  'guia.expedicao@suinco.demo','indicadores', None, None),
    ('10_relatorios',   'guia.logistica@suinco.demo','relatorios',  None, None),
    ('11_historico',    'guia.adm@suinco.demo',      'historico',   None, None),
    ('12_cadastros',    'guia.adm@suinco.demo',      'cadastros',   None, None),
    ('13_usuarios',     'guia.adm@suinco.demo',      'usuarios',    None, None),
    ('14_comercial',    'guia.comercial@suinco.demo','torre',       None, None),
]


async def abrir(nav, rotulo):
    ctx = await nav.new_context(viewport={'width': 1600, 'height': 950},
                                device_scale_factor=2)
    # a apresentação mostra o painel como ele é por padrão: MODO ESCURO
    await ctx.add_init_script("localStorage.setItem('suinco_tema','escuro')")
    pg = await ctx.new_page()
    html = open(RAIZ / 'index.html', encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__apres_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    return ctx, pg


async def entrar(pg, email):
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)


def montar_patio_api():
    """Um dia de operação, montado DIRETO na API — que é a fonte da verdade.

    A primeira versão montava pelo painel (criarCargaProgramada +
    avancarStatusCarga na página). O avanço de status era aceito na tela e
    revertido em silêncio pela sincronização — todas as cargas paravam em
    "Aguardando Embarque" no print. Medido contra a API: o servidor ACEITA a
    mesma transição. O defeito está no caminho de eco do harness de captura,
    não no produto; para a apresentação, o que importa é o estado do
    servidor, então é nele que se escreve."""
    import json
    import urllib.request

    def api(caminho, corpo=None, token=None):
        req = urllib.request.Request(
            API + caminho,
            data=json.dumps(corpo).encode() if corpo is not None else None,
            headers={'content-type': 'application/json',
                     **({'authorization': f'Bearer {token}'} if token else {})},
            method='POST' if corpo is not None else 'GET')
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read().decode())

    tk = api('/auth/login', {'email': 'guia.logistica@suinco.demo',
                             'senha': SENHA})['token']
    frota = api('/api/frota', token=tk)
    # A leitura do pátio vive em /api/estado (não existe GET /api/cargas —
    # o painel puxa tudo de uma vez, cargas + movimentações).
    usadas = {c['placa'] for c in api('/api/estado', token=tk).get('cargas', [])}
    livres = [f['placa'] for f in frota
              if f.get('placa') and f.get('transportadora')
              and f['placa'] not in usadas][:len(CARGAS_DIA)]

    ordem = ['Aguardando Embarque', 'Embarque Iniciado',
             'Embarque Finalizado', 'Faturado', 'Seguiu Viagem']
    for i, (_, numero, cliente, destino, rota, peso, alvo) in enumerate(CARGAS_DIA):
        if i >= len(livres):
            break
        try:
            c = api('/api/cargas', {'placa': livres[i], 'numeroCarga': numero,
                                    'cliente': cliente, 'destino': destino,
                                    'rota': rota, 'peso': peso,
                                    'qtdEntregas': 2}, token=tk)
        except Exception as e:
            print(f'  (carga {numero} já existia ou falhou: {e})')
            continue
        for st in ordem:
            if alvo == 'Aguardando Veículo':
                break
            api(f"/api/cargas/{c['id']}/status", {'status': st}, token=tk)
            if st == alvo:
                break
        print(f'  · {numero} → {alvo} ({livres[i]})')


# Um pátio realista: sete cargas, uma em cada situação.
CARGAS_DIA = [
    ('RRP5F95', '2484', 'SUPERMERCADO CENTRO OESTE', 'BELO HORIZONTE - MG', '500', 12500, 'Aguardando Veículo'),
    ('QMV8B12', '2485', 'REDE AREAL',            'PATOS DE MINAS - MG', '501',  9800, 'Aguardando Embarque'),
    ('PWA4C30', '2486', 'DISTRIBUIDORA JAPÃO',   'UBERLÂNDIA - MG',     '502', 14200, 'Embarque Iniciado'),
    ('AAK8958', '2487', 'REDE MINEIRÃO',         'VARGINHA - MG',       '512', 11400, 'Embarque Finalizado'),
    ('AFZ8792', '2488', 'ATACADO TRIÂNGULO',     'PASSOS - MG',         '513', 13800, 'Faturado'),
    ('AHG5900', '2489', 'CD SUINCO',             'PATOS DE MINAS - MG', '500',  8900, 'Seguiu Viagem'),
]


def espalhar_eventos_no_dia():
    """Backdata os eventos das cargas de demonstração para horários realistas.

    Regra simples: a chegada foi há N horas e cada etapa seguinte consome um
    pedaço plausível (45–75 min). SÓ para as cargas 24xx do banco LOCAL —
    produção nunca passa por aqui."""
    import subprocess
    sql = r"""
    WITH ev AS (
      SELECT movimentacao_id, carga_id, status_novo,
             row_number() OVER (PARTITION BY carga_id ORDER BY data_evento) AS n
        FROM fact_statusfrota
       WHERE carga_id IN (SELECT carga_id FROM fact_viagens
                           WHERE numero_carga IN ('2484','2485','2486','2487','2488','2489'))
    )
    UPDATE fact_statusfrota f
       SET data_evento = now() - interval '6 hours' + (ev.n * interval '68 minutes')
      FROM ev WHERE f.movimentacao_id = ev.movimentacao_id;
    UPDATE fact_viagens
       SET criado_em = now() - interval '7 hours'
     WHERE numero_carga IN ('2484','2485','2486','2487','2488','2489');
    """
    r = subprocess.run(['su', 'postgres', '-c',
                        'psql -d embarque_suinco -q -v ON_ERROR_STOP=1'],
                       input=sql, capture_output=True, text=True)
    if r.returncode != 0:
        print('  (backdate falhou: ' + r.stderr.strip()[:200] + ')')
    else:
        print('  · eventos espalhados pelas últimas 6 horas')


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(
            executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_PATH',
                                           '/opt/pw-browsers/chromium'),
            headless=True)

        # O pátio é montado uma vez, DIRETO na API, e vale para todos.
        montar_patio_api()
        # Os eventos são reespalhados pelo dia: as cargas de demonstração
        # atravessam o fluxo em segundos e TODO indicador de tempo sai
        # "0 min" — no telão isso parece sistema quebrado, não pátio rápido.
        # Só toca nas cargas 24xx desta demonstração, e só no banco LOCAL.
        espalhar_eventos_no_dia()

        for arquivo, email, aba, preparo, rolar in TELAS:
            ctx, pg = await abrir(nav, arquivo)
            if email is None:
                # Tela de login, sem entrar.
                await pg.wait_for_selector('#login-email', timeout=25000)
                await pg.wait_for_timeout(800)
            else:
                await entrar(pg, email)
                if aba:
                    await pg.evaluate("(t) => { try { irParaTab(t); } catch(e) {} }", aba)
                    await pg.wait_for_timeout(1200)
                if rolar:
                    await pg.evaluate(
                        "(s) => { const e=document.querySelector(s); if (e) e.scrollIntoView({block:'start'}); }",
                        rolar)
                    await pg.wait_for_timeout(500)
            # O toast de boas-vindas fica em cima do conteúdo no print.
            # A classe de verdade é .notif-item (função notify em app.js);
            # a primeira tentativa chutou nomes e o toast continuou no print.
            await pg.evaluate(
                "() => document.querySelectorAll('.notif-item,#notifs,.notif-wrap')"
                "  .forEach((e) => e.remove())")
            await pg.wait_for_timeout(300)
            await pg.screenshot(path=str(PRINTS / f'{arquivo}.png'))
            print(f'  ✓ {arquivo}.png')
            await ctx.close()

        await nav.close()
    print(f'\\n{len(TELAS)} telas em {PRINTS}')


if __name__ == '__main__':
    asyncio.run(main())
