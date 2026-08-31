#!/usr/bin/env python3
"""Cadastrar rota não pode dizer "pronto" quando a rota não subiu.

INCIDENTE (14/08/2026) — relatado pelo gestor: "a rota 537 já foi
cadastrada. Ela aparece para mim, mas o Wemerson saiu da sessão; ao fazer
login novamente, a rota não aparece para ele, embora eu a veja."

O que a investigação mostrou:

1. O caminho de sincronização FUNCIONA. Reproduzido com dois navegadores
   contra o servidor: quem cadastra grava em dim_rotas, e quem loga do zero
   recebe a rota na carga inicial e a vê no seletor. Não havia bug no
   mecanismo — e é isso que torna o problema mais perigoso, não menos.

2. O que faltava era HONESTIDADE quando o caminho não acontece:

   a) `addRotaUI` avisava em VERDE "Rota 537 cadastrada. Já aparece no
      seletor de Rota." ANTES de saber se o servidor aceitou. Cadastrando
      sem conexão, a rota ia só para o localStorage — o painel de quem
      cadastrou mostra a rota (verdade local) e mais ninguém a vê. É o
      mesmo padrão do incidente das cargas, já corrigido lá com
      `notifyGravacao` e que ficou de fora aqui.

   b) A recusa do SERVIDOR chegava a `receberRecusaDeRota`, mas a rota
      recusada continuava na tela de quem cadastrou como se existisse.

Juntos, os dois produzem exatamente o relato: quem cadastra vê a rota e
tem certeza de que deu certo; ninguém mais recebe; e não existe sinal
nenhum de que algo falhou.

Exige o backend local no ar e o operador de teste
(chefe@teste.local / Administração).

    python3 testes/test_cadastro_rota_honesto.py
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAIL = os.environ.get('SUINCO_EMAIL', 'chefe@teste.local')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def painel(nav, modo, rotulo):
    """Painel logado de verdade, com o POST de rota sabotado.

    `modo`: 'rede' derruba a conexão (o painel enfileira) e 'recusa'
    devolve 403 (o servidor disse não). O GET segue real, para a carga
    inicial funcionar.

    Servido a partir da origem da API de propósito: em file://
    `location.origin` vale "null" e TODA gravação falharia como se fosse
    queda de rede — o teste mediria outra coisa.
    """
    ctx = await nav.new_context()
    pg = await ctx.new_page()

    async def tratar(rota):
        if rota.request.method != 'POST':
            await rota.continue_()
        elif modo == 'rede':
            await rota.abort('connectionfailed')
        else:
            await rota.fulfill(
                status=403, content_type='application/json',
                body='{"erro":"Esta ação é do setor Logística.",'
                     '"codigo":"SETOR_SEM_PERMISSAO"}')

    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__painel_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.route('**/api/rotas', tratar)

    await pg.goto(url)
    await pg.wait_for_timeout(1000)

    # Grava TODA mensagem que o painel mostra, em vez de ler a caixa de
    # avisos no fim. A caixa é rotativa: uma sincronização que traga várias
    # cargas ("atualizado por outro setor") empurra o aviso da rota para
    # fora, e o teste falharia por causa do estado do banco, não do código
    # — foi o que aconteceu ao rodar a suíte inteira em sequência.
    await pg.evaluate("""() => {
        window.__avisos = [];
        const orig = window.notify;
        window.notify = function(msg, tipo, ms){
            window.__avisos.push(String(msg));
            return orig.apply(this, arguments);
        };
    }""")

    await pg.fill('#login-email', EMAIL)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    setor = await pg.evaluate("() => DB.operador && DB.operador.setor")
    return ctx, pg, setor


async def avisos(pg):
    return ' | '.join(await pg.evaluate("() => window.__avisos || []"))


async def cadastrar(pg, codigo):
    await pg.evaluate("() => abrirTab('cadastros')")
    await pg.wait_for_timeout(500)
    await pg.fill('#rota-codigo', codigo)
    await pg.fill('#rota-nome', 'Rota ' + codigo)
    await pg.click('button[onclick="addRotaUI()"]')
    await pg.wait_for_timeout(3000)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)

        print('\n=== 1. SEM CONEXÃO: NÃO PODE DIZER QUE ESTÁ CADASTRADA ===')
        ctx, pg, setor = await painel(nav, 'rede', 'semrede')
        ck('logado no servidor', bool(setor), str(setor))
        await cadastrar(pg, '9537')
        txt = await avisos(pg)
        # A REGRA MUDOU DE PROPÓSITO (31/08/2026) e esta asserção media a
        # antiga. Ela procurava "SEM CONEXÃO ... está na fila" — a promessa de
        # que a rota subiria sozinha depois. O dono aboliu a gravação offline:
        # "Off Line não tem conversa não". Não há mais fila, e a rota nem fica
        # guardada neste aparelho.
        #
        # O que a guarda existe para impedir NÃO mudou, e ficou mais forte: a
        # tela não pode deixar a pessoa acreditar que cadastrou. Antes ela
        # dizia "Rota 9537 cadastrada" no clique e "NÃO foi cadastrada" logo
        # depois — duas frases contrárias, e a pessoa lê a primeira. Agora o
        # aviso espera a resposta do servidor e fala uma vez só.
        ck('diz que NÃO foi cadastrada',
           'NÃO FOI CADASTRADA' in txt.upper() or 'NADA FOI GRAVADO' in txt.upper(),
           txt[-240:])
        ck('e manda conectar para refazer',
           'CONECTE' in txt.upper(), txt[-240:])
        ck('NÃO existe a frase que diz que cadastrou',
           'cadastrada.' not in txt.replace('NÃO foi cadastrada.', ''), txt[-240:])
        ck('NÃO afirma que já aparece para os outros',
           'Já aparece no seletor' not in txt, txt[-240:])
        await ctx.close()

        print('\n=== 2. SERVIDOR RECUSA: O OPERADOR PRECISA SABER ===')
        ctx2, pg2, _ = await painel(nav, 'recusa', 'recusa')
        await cadastrar(pg2, '9538')
        txt2 = await avisos(pg2)
        ck('avisa que o servidor recusou a rota', 'recus' in txt2.lower(), txt2[-240:])
        ck('o aviso identifica a rota', '9538' in txt2, txt2[-240:])
        ck('o aviso diz que ficou só neste aparelho',
           'só neste aparelho' in txt2.lower() or 'so neste aparelho' in txt2.lower(),
           txt2[-240:])
        await ctx2.close()

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
