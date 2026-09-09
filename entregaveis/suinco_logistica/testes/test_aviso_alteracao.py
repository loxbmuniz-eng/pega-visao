#!/usr/bin/env python3
"""Alteração em carga já programada vira aviso na tela de todo mundo.

Duas coisas são provadas aqui, e a primeira é a que estava quebrada:

1. A EDIÇÃO CHEGA AO SERVIDOR. O POST de carga usa ON CONFLICT DO NOTHING —
   correto para a fila offline reenviar sem duplicar, mas significava que
   trocar a placa de uma carga existente não gravava nada. A mudança
   aparecia no navegador de quem editou e em lugar nenhum mais: sumia ao
   recarregar e o Power BI nunca via.

2. O AVISO CHEGA AOS OUTROS. Quem está no pátio precisa saber que a placa
   da carga mudou, com o valor antigo e o novo, sem procurar. Com som,
   porque placa trocada é o que faz o caminhão errado entrar na doca.

O segundo navegador roda em viewport de celular: é de lá que a maior parte
do pátio olha o painel, e um aviso que não cabe na tela não é aviso.

Exige o backend no ar (backend/.env) e os operadores de teste criados.
"""
import asyncio
import os
import sys
import uuid
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
RODADA = uuid.uuid4().hex[:6]

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def abrir_painel(ctx):
    """Serve o painel da MESMA origem da API.

    O socket.io é servido pelo próprio backend em /socket.io/socket.io.js, e
    aqui ele NÃO é substituído por um stub: o tempo real é justamente o que
    este teste mede.
    """
    pagina = await ctx.new_page()
    html = open(PAINEL, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    # O <script> do socket.io aponta para o domínio de produção. Sem trocar
    # também aqui, `io` não existe e o painel cai na consulta de 15 s — o
    # teste mediria o plano B em vez do tempo real.
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')

    url = API + '/__painel_aviso'
    await pagina.route(url, lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pagina.goto(url)
    await pagina.wait_for_timeout(1000)
    return pagina


async def entrar(pagina, email):
    await pagina.fill('#login-email', email)
    await pagina.fill('#login-senha', SENHA)
    await pagina.click('#btn-entrar')
    await pagina.wait_for_timeout(2500)
    return await pagina.evaluate("() => DB.operador && DB.operador.setor")


async def main():
    async with async_playwright() as p:
        navegador = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                            headless=True)
        erros = []

        # Quem edita: Logística, num terminal comum.
        ctx_log = await navegador.new_context()
        p_log = await abrir_painel(ctx_log)
        p_log.on('pageerror', lambda e: erros.append('logistica: ' + str(e)))

        # Quem recebe o aviso: Faturamento, num celular.
        ctx_fat = await navegador.new_context(viewport={'width': 390, 'height': 844},
                                              is_mobile=True, has_touch=True)
        p_fat = await abrir_painel(ctx_fat)
        p_fat.on('pageerror', lambda e: erros.append('faturamento: ' + str(e)))

        print('\n=== 1. DOIS OPERADORES LOGADOS AO MESMO TEMPO ===')
        ck('Logística entrou', await entrar(p_log, 'ana@teste.local') == 'Logística')
        ck('Faturamento entrou no celular',
           await entrar(p_fat, 'diego@teste.local') == 'Faturamento')

        # O aviso vem por socket. Sem ele conectado, o teste mediria a
        # consulta periódica de 15 s, que é outra coisa.
        await p_fat.wait_for_timeout(1500)

        print('\n=== 2. A LOGÍSTICA PROGRAMA UMA CARGA ===')
        numero = f'A{RODADA}'
        placa_a, placa_b = await p_log.evaluate(
            "() => [DB.frota[10].placa, DB.frota[11].placa]")
        await p_log.evaluate("() => abrirTab('programacao')")
        await p_log.wait_for_timeout(400)
        await p_log.fill('#prog-placa', placa_a)
        await p_log.fill('#prog-numero-carga', numero)
        await p_log.fill('#prog-peso', '11000')
        await p_log.click("button:has-text('Criar Carga')")
        await p_log.wait_for_timeout(2500)
        ck('carga criada', await p_log.evaluate(
            "n => DB.cargas.some(c=>c.numeroCarga===n)", numero), numero)

        # Limpa o que apareceu até aqui, para o próximo aviso ser só o da
        # troca de placa.
        await p_fat.evaluate("() => { document.getElementById('notif').innerHTML=''; }")
        # Marca se o alerta sonoro foi disparado. Não dá para ouvir o som num
        # navegador sem áudio; o que importa provar é que ele foi acionado.
        await p_fat.evaluate("""() => {
            window.__tocou = 0;
            window.tocarAlertaAlteracao = () => { window.__tocou++; };
        }""")

        print('\n=== 3. TROCA DE PLACA NA CARGA JÁ PROGRAMADA ===')
        carga_id = await p_log.evaluate(
            "n => (DB.cargas.find(c=>c.numeroCarga===n)||{}).id", numero)
        await p_log.evaluate("([id,pl]) => atualizarPlacaUI(id, pl)", [carga_id, placa_b])
        await p_log.wait_for_timeout(3000)

        # A prova que faltava: reler do SERVIDOR, não do navegador que editou.
        no_servidor = await p_log.evaluate("""async ([id]) => {
            const d = await SuincoSharePoint.pullTudo();
            const c = (d.cargas || []).find(x => x.Carga_ID === id);
            return c ? c.Placa : null;
        }""", [carga_id])
        ck('a placa nova está no SERVIDOR', no_servidor == placa_b,
           f'servidor diz {no_servidor}, esperado {placa_b}')

        print('\n=== 4. O AVISO CHEGA NO CELULAR DO FATURAMENTO ===')
        try:
            await p_fat.wait_for_selector('.aviso-alteracao', timeout=8000)
            achou = True
        except Exception:
            achou = False
        ck('aviso apareceu sem recarregar a página', achou)

        if achou:
            txt = await p_fat.inner_text('.aviso-alteracao')
            ck('diz o número da carga', numero in txt, txt.replace('\n', ' · '))
            ck('mostra a placa antiga', placa_a in txt, txt.replace('\n', ' · '))
            ck('mostra a placa nova', placa_b in txt, txt.replace('\n', ' · '))
            ck('diz quem alterou', 'Ana' in txt, txt.replace('\n', ' · '))

            forte = await p_fat.evaluate(
                "() => document.querySelector('.aviso-alteracao').classList.contains('forte')")
            ck('troca de placa recebe destaque forte', forte)
            ck('o alerta sonoro tocou',
               await p_fat.evaluate("() => window.__tocou") >= 1)

            # Aviso que não cabe na tela do celular não é aviso.
            largura = await p_fat.evaluate("""() => {
                const el = document.querySelector('.aviso-alteracao');
                const r = el.getBoundingClientRect();
                return { dentro: r.left >= 0 && r.right <= window.innerWidth,
                         altura: r.height };
            }""")
            ck('cabe na largura do celular', largura['dentro'], str(largura))
            ck('tem altura para o texto', largura['altura'] > 40, str(largura))

        print('\n=== 5. QUEM EDITOU NÃO É AVISADO DA PRÓPRIA AÇÃO ===')
        # Ele já viu a confirmação. Repetir treina a operação a ignorar avisos.
        proprio = await p_log.evaluate(
            "() => document.querySelectorAll('.aviso-alteracao').length")
        ck('a tela de quem editou não mostra o aviso', proprio == 0, str(proprio))

        print('\n=== 6. EDIÇÃO SEM IMPORTÂNCIA NÃO TOCA ALARME ===')
        await p_fat.evaluate("() => { document.getElementById('notif').innerHTML=''; window.__tocou=0; }")
        await p_log.evaluate("([id]) => atualizarGanchosUI(id, 42)", [carga_id])
        await p_log.wait_for_timeout(3000)
        tocou = await p_fat.evaluate("() => window.__tocou")
        ck('mudar ganchos avisa em silêncio', tocou == 0,
           'só a placa toca — alarme para tudo vira ruído e ninguém escuta')

        print('\n=== 7. EXCLUSÃO SOME DA TELA DE TODO MUNDO ===')
        # Antes, excluir apagava a linha só no navegador de quem clicou. O
        # servidor não sabia, e a sincronia seguinte trazia a carga de volta:
        # o operador excluía e via reaparecer.
        await p_fat.evaluate("() => { document.getElementById('notif').innerHTML=''; window.__tocou=0; }")
        visivel_antes = await p_fat.evaluate(
            "id => DB.cargas.some(c=>c.id===id)", carga_id)
        ck('o Faturamento estava enxergando a carga', visivel_antes)

        await p_log.evaluate("""([id]) => {
            // confirm() bloqueia o navegador de teste; a decisão do operador
            // já está coberta pelo fluxo real, o que importa aqui é o efeito.
            window.confirm = () => true;
            return excluirCargaUI(id);
        }""", [carga_id])
        await p_log.wait_for_timeout(3000)

        sumiu_local = await p_log.evaluate("id => !DB.cargas.some(c=>c.id===id)", carga_id)
        ck('sumiu da tela de quem excluiu', sumiu_local)

        no_servidor = await p_log.evaluate("""async ([id]) => {
            const d = await SuincoSharePoint.pullTudo();
            return (d.cargas || []).some(c => c.Carga_ID === id);
        }""", [carga_id])
        ck('e sumiu do SERVIDOR', not no_servidor,
           'sem isto a carga voltaria na próxima sincronia')

        try:
            await p_fat.wait_for_selector('.aviso-alteracao', timeout=8000)
            avisou = True
        except Exception:
            avisou = False
        ck('o Faturamento foi avisado', avisou)
        if avisou:
            txt = await p_fat.inner_text('.aviso-alteracao')
            ck('o aviso diz EXCLUÍDA', 'EXCLU' in txt.upper(), txt.replace('\n', ' · '))
            ck('diz quem excluiu', 'Ana' in txt, txt.replace('\n', ' · '))
            ck('exclusão também toca', await p_fat.evaluate("() => window.__tocou") >= 1)

        sumiu_remoto = await p_fat.evaluate("id => !DB.cargas.some(c=>c.id===id)", carga_id)
        ck('a carga saiu da tela do Faturamento sem recarregar', sumiu_remoto,
           'aviso sem sumir da lista deixaria o pátio operando uma carga que não existe')

        print('\n=== 8. CONSOLE ===')
        ck('sem erros de página', not erros, str(erros))

        await navegador.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
