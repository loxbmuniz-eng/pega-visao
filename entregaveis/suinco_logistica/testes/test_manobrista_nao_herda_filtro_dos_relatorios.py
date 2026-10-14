#!/usr/bin/env python3
"""O papel do manobrista não herda o filtro da aba Relatórios (14/10/2026, #138).

O RELATO DO DONO: "a placa programada e na fila já com placa contratada e não
saía de jeito nenhum no papel dos manobristas". Respostas dele: a LINHA não
aparecia (não era a placa em branco), e a carga estava em Aguardando Embarque.

A CAUSA, reproduzida com a API de verdade: o botão do manobrista (Torre e
Programação) montava a lista com `cargasDoRelatorio()` — a lista dos
RELATÓRIOS, que obedece ao período escondido na aba Relatórios (De/Até). Bastava
alguém ter clicado em "Hoje" lá para tirar o relatório do dia: dali em diante a
carga programada ONTEM, que chegou HOJE e está esperando a doca, sumia do papel.
Se fosse a única da fila, o papel nem saía ("não há o que passar ao
manobrista"). Quem tira o papel está em outra aba e não vê filtro nenhum.

A REGRA: o papel do manobrista é a fila DE AGORA — o que ainda vai carregar no
momento da emissão, venha de que dia vier a programação. O filtro da aba
Relatórios continua valendo para os relatórios DE LÁ.

O CAMINHO, pela tela e com a API de verdade:
  1. a Logística lança a carga na Montagem de ONTEM, com a placa contratada;
  2. a Portaria registra a chegada HOJE → Aguardando Embarque;
  3. alguém clica em "Hoje" na aba Relatórios;
  4. o papel tirado na Torre e na Programação traz a placa;
  5. o resumo da aba Relatórios continua mostrando o período escolhido.

REPROVA contra o publicado (o papel some depois do "Hoje"):
    SUINCO_PAINEL_ARQUIVO=<index.html publicado> bash testes/rodar_tudo.sh manobrista_nao_herda

    bash testes/rodar_tudo.sh manobrista_nao_herda
"""
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from playwright.async_api import async_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _frete_resposta import responder_frete  # noqa: E402

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
PAINEL = Path(os.environ.get('SUINCO_PAINEL_ARQUIVO', str(RAIZ / 'index.html')))
EMAIL_L = 'manob.filtro.log@teste.local'
EMAIL_P = 'manob.filtro.port@teste.local'
NUMERO = 'MB138-ONTEM'
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


def limpar():
    psql(f"""DELETE FROM programacao_montagem WHERE numero_carga = '{NUMERO}';
DELETE FROM fact_statusfrota WHERE carga_id IN (SELECT carga_id FROM fact_viagens WHERE numero_carga = '{NUMERO}');
DELETE FROM log_eventos WHERE carga_id IN (SELECT carga_id FROM fact_viagens WHERE numero_carga = '{NUMERO}');
DELETE FROM fact_viagens WHERE numero_carga = '{NUMERO}';
DELETE FROM operadores WHERE email IN ('{EMAIL_L}', '{EMAIL_P}');""")


async def entrar(nav, html, email, rota):
    ctx = await nav.new_context()
    pg = await ctx.new_page()
    await pg.set_viewport_size({'width': 1400, 'height': 1000})
    url = f'{API}/__{rota}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    # Sem tempo real: cada lado atualiza quando a pessoa atualiza.
    await pg.route('**/socket.io/socket.io.js', lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='application/javascript', body='')))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email')
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_function("() => typeof DB !== 'undefined' && DB.operador && DB.operador.setor", timeout=15000)
    await pg.wait_for_timeout(1500)
    return pg


async def lancar_na_montagem(pg, dia, placa):
    await pg.click('.nav-tab[data-tab="programacao"]')
    await pg.wait_for_timeout(600)
    await pg.fill('#mont-data', dia)
    await pg.dispatch_event('#mont-data', 'change')
    await pg.wait_for_timeout(1500)
    rotas = await pg.eval_on_selector_all('#mont-rota-extra option', 'els => els.map(e => e.value).filter(Boolean)')
    await pg.select_option('#mont-rota-extra', rotas[0])
    await pg.wait_for_timeout(300)
    if await pg.is_visible('#mont-destino-extra'):
        destinos = await pg.eval_on_selector_all('#mont-destino-extra option', 'els => els.map(e => e.value).filter(Boolean)')
        if destinos:
            await pg.select_option('#mont-destino-extra', destinos[0])
    await pg.click('button:has-text("Adicionar linha")')
    await pg.wait_for_timeout(1500)
    linha = pg.locator('#mont-tbody tr').filter(has=pg.locator('input.placa-input[value=""]')).last
    await linha.locator('input.numero-carga-input').fill(NUMERO)
    await linha.locator('input.numero-carga-input').dispatch_event('change')
    await pg.wait_for_timeout(1000)
    linha = pg.locator('#mont-tbody tr').filter(has=pg.locator(f'input.numero-carga-input[value="{NUMERO}"]')).last
    await linha.locator('input.placa-input').fill(placa)
    await linha.locator('input.placa-input').dispatch_event('change')
    await responder_frete(pg, espera=1200)
    await pg.wait_for_timeout(1200)
    await linha.locator('.mont-btn-criar').click()
    await responder_frete(pg)
    await pg.wait_for_timeout(3000)


async def main():
    limpar()
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True).stdout.strip()
    psql(f"""INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES
('{EMAIL_L}', 'Logística Manobrista', 'Logística', '{h}', true),
('{EMAIL_P}', 'Portaria Manobrista', 'Portaria', '{h}', true);""")
    # Uma placa da Frota que tem transportadora e não está em carga aberta.
    placa = psql("""SELECT v.placa FROM dim_veiculos v
  LEFT JOIN fact_viagens f ON f.placa = v.placa AND f.excluida_em IS NULL AND f.status_atual <> 'Seguiu Viagem'
 WHERE v.transportadora <> '' AND f.carga_id IS NULL ORDER BY v.placa LIMIT 1""")
    ck('há uma placa livre na Frota para o teste', bool(placa), placa)
    if not placa:
        return 1

    html = PAINEL.read_text(encoding='utf-8').replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        log = await entrar(nav, html, EMAIL_L, 'logistica')
        erros = []
        log.on('pageerror', lambda e: erros.append(str(e)))
        papeis = []

        def pedido(r):
            if '/api/relatorios/pdf' in r.url:
                try:
                    papeis.append(json.loads(r.post_data or '{}').get('html', ''))
                except Exception:
                    papeis.append(r.post_data or '')
        log.on('request', pedido)

        ontem = await log.evaluate("() => { const d = new Date(); d.setDate(d.getDate() - 1); return isoDiaLocal(d); }")

        print('\n=== 1. A CARGA NA MONTAGEM DE ONTEM, COM A PLACA CONTRATADA ===')
        await lancar_na_montagem(log, ontem, placa)
        linha = psql(f"SELECT status_atual FROM fact_viagens WHERE numero_carga = '{NUMERO}' AND excluida_em IS NULL")
        ck('a carga existe no servidor, esperando o veículo', linha == 'Aguardando Veículo', linha)

        print('\n=== 2. A PORTARIA REGISTRA A CHEGADA HOJE ===')
        port = await entrar(nav, html, EMAIL_P, 'portaria')
        await port.click(".nav-tab[data-tab='portaria']")
        await port.wait_for_timeout(500)
        await port.fill('#portaria-placa', placa)
        await port.click("button:has-text('Chegou')")
        await port.wait_for_timeout(2500)
        linha = psql(f"""SELECT status_atual || '|' || aguardando_carga || '|' ||
       to_char(programado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')
  FROM fact_viagens WHERE numero_carga = '{NUMERO}' AND excluida_em IS NULL""")
        ck('a carga está em Aguardando Embarque, programada ONTEM', linha == f'Aguardando Embarque|false|{ontem}', linha)

        # A Logística atualiza a tela, como faz quem chega para tirar o papel.
        await log.reload()
        await log.wait_for_function("() => typeof DB !== 'undefined' && DB.operador && DB.cargas.some(c => c.numeroCarga === '%s' && c.status === 'Aguardando Embarque')" % NUMERO,
                                    timeout=15000)

        async def tirar_papel(aba):
            await log.click(f'.nav-tab[data-tab="{aba}"]')
            await log.wait_for_timeout(800)
            antes = len(papeis)
            await log.locator(f'#tab-{aba} [data-botao="manobrista"]').first.click()
            for _ in range(40):
                if len(papeis) > antes:
                    break
                await log.wait_for_timeout(250)
            return papeis[-1] if len(papeis) > antes else ''

        print('\n=== 3. SEM FILTRO NOS RELATÓRIOS: A PLACA ESTÁ NO PAPEL ===')
        papel = await tirar_papel('torre')
        ck('Torre: o papel sai com a placa', placa in papel, 'papel não saiu' if not papel else '')

        print('\n=== 4. ALGUÉM CLICA EM "HOJE" NA ABA RELATÓRIOS ===')
        await log.click('.nav-tab[data-tab="relatorios"]')
        await log.wait_for_timeout(700)
        await log.click('#tab-relatorios button:has-text("Hoje")')
        await log.wait_for_timeout(500)
        resumo = (await log.inner_text('#rel-resumo-filtro')).strip()
        ck('a aba Relatórios mostra o período de hoje', resumo.startswith('Programadas de'), resumo[:80])

        print('\n=== 5. O PAPEL DO MANOBRISTA CONTINUA COM A FILA DE AGORA ===')
        for aba, nome in (('torre', 'Torre'), ('programacao', 'Programação')):
            papel = await tirar_papel(aba)
            ck(f'{nome}: o papel sai', bool(papel))
            ck(f'{nome}: a placa {placa} (programada ontem, esperando a doca) está no papel', placa in papel)

        print('\n=== 6. O FILTRO DOS RELATÓRIOS CONTINUA VALENDO LÁ ===')
        await log.click('.nav-tab[data-tab="relatorios"]')
        await log.wait_for_timeout(500)
        resumo2 = (await log.inner_text('#rel-resumo-filtro')).strip()
        ck('o período escolhido continua na aba Relatórios', resumo2 == resumo, resumo2[:80])
        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    print('\n=======================================================')
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print('   -', f)
        return 1
    print('  Tudo verde: o papel do manobrista é a fila de agora, com ou sem filtro nos Relatórios.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(asyncio.run(main()))
    finally:
        limpar()
