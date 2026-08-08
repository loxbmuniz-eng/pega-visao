#!/usr/bin/env python3
"""Fechar a programação atual — só Logística/Administração, só pátio limpo.

Pedido do usuário (08/08/2026): "permitir que faça fechamento da
programação e começar nova programação somente pela logística ou
administração, resetando os painéis de todos os setores mantendo somente
o histórico, para melhor controle de tudo". Confirmado antes de
implementar: se houver carga em andamento, a ação BLOQUEIA (nunca esconde
um caminhão real das telas operacionais).

Exige o backend rodando local (mesmo padrão de test_login_api.py).

    python3 testes/test_fechar_programacao.py
"""
import asyncio
import os
import subprocess
import sys
import uuid
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')


def limpar_patio_local():
    """Base local descartável acumula cargas de rodadas anteriores de
    teste (mesmo banco usado por api.test.js e por scripts avulsos desta
    sessão) — sem isto, 'fecha quando o pátio está limpo' encontraria
    cargas de OUTRO teste e seria bloqueado, sem nenhum bug real por trás.
    Mesmo princípio do before() adicionado em api.test.js suíte 12."""
    subprocess.run(
        ['psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'embarque_suinco', '-c',
         "UPDATE fact_viagens SET status_atual = 'Seguiu Viagem' WHERE status_atual <> 'Seguiu Viagem'"],
        env={**os.environ, 'PGPASSWORD': 'teste-local-sem-valor'},
        capture_output=True, check=False,
    )
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
PAINEL = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
RODADA = uuid.uuid4().hex[:6]
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def abrir_painel(ctx, api):
    pagina = await ctx.new_page()
    html = open(PAINEL, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{api}'")
    url = api + '/__painel_teste'
    await pagina.route(url, lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pagina.route('**/socket.io/socket.io.js', lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='application/javascript', body='')))
    await pagina.goto(url)
    await pagina.wait_for_timeout(1200)
    return pagina


async def logar(pagina, email, senha=SENHA):
    await pagina.fill('#login-email', email)
    await pagina.fill('#login-senha', senha)
    await pagina.click('#btn-entrar')
    await pagina.wait_for_timeout(2000)


async def main():
    async with async_playwright() as p:
        navegador = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []

        limpar_patio_local()

        print('\n=== 1. BOTÃO SÓ APARECE PRA LOGÍSTICA/ADMINISTRAÇÃO ===')
        ctx1 = await navegador.new_context()
        pg_expedicao = await abrir_painel(ctx1, API)
        pg_expedicao.on('pageerror', lambda e: erros.append('expedicao: ' + str(e)))
        await logar(pg_expedicao, 'carla@teste.local')
        await pg_expedicao.wait_for_timeout(300)
        visivel = await pg_expedicao.is_hidden('#btn-fechar-programacao-wrap')
        ck('Expedição NÃO vê o botão de fechar programação', visivel)

        ctx2 = await navegador.new_context()
        pg_log = await abrir_painel(ctx2, API)
        pg_log.on('pageerror', lambda e: erros.append('logistica: ' + str(e)))
        await logar(pg_log, 'ana@teste.local')
        await pg_log.wait_for_timeout(300)
        await pg_log.evaluate("() => abrirTab('torre')")
        await pg_log.wait_for_timeout(300)
        ck('Logística VÊ o botão de fechar programação',
           await pg_log.is_visible('#btn-fechar-programacao-wrap'))

        print('\n=== 2. BLOQUEIA SE HOUVER CARGA EM ANDAMENTO ===')
        # Precisa de placa cadastrada de verdade (modo servidor valida
        # contra a Frota) — pega a primeira da base sincronizada.
        placa = await pg_log.evaluate("() => DB.frota[0].placa")
        await pg_log.evaluate("""(placa) => {
            criarCargaProgramada({placa, numeroCarga:'FECH-1', peso:9000, rota:'500', operador:'Ana'});
        }""", placa)
        await pg_log.wait_for_timeout(600)  # sobe pro servidor

        avisos = []
        pg_log.on('dialog', lambda d: (avisos.append(d.message), asyncio.ensure_future(d.accept())))
        await pg_log.evaluate("""() => {
            window.confirm = () => true;   // pula a confirmação, testa só o bloqueio real
        }""")
        await pg_log.click('#btn-fechar-programacao-wrap button')
        await pg_log.wait_for_timeout(800)
        ck('avisa quais cargas travam o fechamento',
           any('FECH-1' in a or placa in a for a in avisos), str(avisos))

        print('\n=== 3. FECHA QUANDO O PÁTIO ESTÁ LIMPO ===')
        # Anda a carga até o fim pra liberar o fechamento.
        await pg_log.evaluate("""() => {
            // Placa pode já ter carga antiga de outra rodada de teste
            // nesta mesma base local — mira pelo NÚMERO desta carga
            // específica, não só pela placa (que pode repetir).
            const c = DB.cargas.find(x => x.numeroCarga === 'FECH-1' && x.status !== 'Seguiu Viagem');
            ['Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado','Seguiu Viagem']
              .forEach(st => avancarStatusCarga(c.id, st, 'Ana', 'Logística'));
        }""")
        await pg_log.wait_for_timeout(900)

        avisos.clear()
        await pg_log.click('#btn-fechar-programacao-wrap button')
        await pg_log.wait_for_timeout(1500)
        ck('sem mais cargas em andamento, o fechamento não é bloqueado de novo',
           not any('em andamento' in a for a in avisos), str(avisos))

        # O aviso "ao vivo" pra quem mais está conectado (evento socket.io
        # 'programacao:fechada', ver suinco-api.js/app.js) NÃO é testável
        # neste harness: abrir_painel() devolve socket.io.js VAZIO de
        # propósito (mesmo padrão de test_login_api.py, evitando carregar
        # do CDN de produção sem rede) — sem cliente socket.io real,
        # nenhuma aba de teste jamais conecta ao canal 'patio', então o
        # emit() do servidor não tem quem escute aqui. O código do lado do
        # servidor (POST /api/programacao/fechar chama emitir()) tem
        # cobertura própria no backend (api.test.js, suíte 12); o listener
        # do lado do painel (aoFecharPrograma) é simples o bastante (um
        # notify() + renderAll()) pra não justificar reconstruir o
        # transporte socket.io só pra este teste.

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await navegador.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
