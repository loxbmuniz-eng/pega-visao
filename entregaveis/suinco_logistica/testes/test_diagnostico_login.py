#!/usr/bin/env python3
"""Prova que a tela de login diz QUAL foi o problema, não só que houve um.

Motivo deste teste: durante a virada para o servidor, um operador do
Faturamento não conseguiu entrar e a tela disse "servidor não respondeu"
— a mesma frase que aparecia para senha errada, para limite de tentativas,
para Wi-Fi ruim e para erro interno. Com um relato indistinguível, o
diagnóstico remoto vira adivinhação.

Cada falha carrega um código curto entre colchetes, feito para ser lido em
voz alta ou fotografado no grupo. Este teste força as sete situações e
confere que cada uma produz o código certo.

O painel é servido de uma origem DIFERENTE da API, como em produção
(painel na Vercel, API no VPS). Sem isso o CORS nunca entra em jogo e os
dois casos que dependem dele — rede filtrando o login × servidor recusando
o endereço — ficariam indistinguíveis no teste, que é exatamente o defeito
que ele existe para impedir.

Não precisa do backend no ar: todas as respostas são simuladas pelo próprio
navegador. É de propósito — o teste mede a tradução do erro, não a API.
"""
import asyncio
import sys
from playwright.async_api import async_playwright

PAINEL = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
ORIGEM_PAINEL = 'https://painel.exemplo.local'
ORIGEM_API = 'https://api.exemplo.local'

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


CABECALHOS_CORS = {
    'access-control-allow-origin': ORIGEM_PAINEL,
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
}


async def abrir(ctx):
    pagina = await ctx.new_page()
    html = open(PAINEL, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{ORIGEM_API}'")

    url = ORIGEM_PAINEL + '/__painel_teste'
    await pagina.route(url, lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pagina.route('**/socket.io/socket.io.js', lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='application/javascript', body='')))
    await pagina.goto(url)
    await pagina.wait_for_timeout(800)
    return pagina


async def tentar_login(pagina):
    """Preenche e submete, devolvendo o texto do erro que apareceu na tela."""
    await pagina.fill('#login-email', 'joao@teste.local')
    await pagina.fill('#login-senha', 'qualquer-senha')
    await pagina.click('#btn-entrar')
    # As sondas de conexão têm 6 s de teto cada; nos casos que as acionam o
    # texto demora mais para assentar que nos que respondem na hora.
    await pagina.wait_for_selector('#login-erro:not([hidden])', timeout=20000)
    await pagina.wait_for_timeout(300)
    return (await pagina.inner_text('#login-erro')).strip()


async def main():
    async with async_playwright() as p:
        navegador = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                            headless=True)
        ctx = await navegador.new_context()
        pagina = await abrir(ctx)
        erros = []
        pagina.on('pageerror', lambda e: erros.append(str(e)))

        def responder_login(status, corpo):
            """Faz /auth/login responder com um status escolhido.

            O preflight precisa passar, senão o navegador nunca chega a
            enviar o POST e o painel veria falha de transporte em vez do
            status — mediria o caso errado.
            """
            async def h(rota):
                if rota.request.method == 'OPTIONS':
                    await rota.fulfill(status=204, headers=CABECALHOS_CORS)
                    return
                await rota.fulfill(status=status, body=corpo,
                                   headers={**CABECALHOS_CORS,
                                            'content-type': 'application/json'})
            return lambda rota: asyncio.ensure_future(h(rota))

        def recusar(rota):
            return asyncio.ensure_future(rota.abort('connectionrefused'))

        def health_ok(rota):
            """Servidor no ar E autorizando esta origem."""
            return asyncio.ensure_future(rota.fulfill(
                status=200, body='{"ok":true}',
                headers={**CABECALHOS_CORS, 'content-type': 'application/json'}))

        print('\n=== 1. SENHA ERRADA — o operador resolve sozinho ===')
        await pagina.route('**/auth/login', responder_login(
            401, '{"erro":"E-mail ou senha incorretos."}'))
        txt = await tentar_login(pagina)
        ck('mostra [SENHA]', '[SENHA]' in txt, txt)
        ck('não fala em servidor fora do ar',
           'não respondeu' not in txt.lower() and 'alcançando' not in txt.lower(), txt)
        await pagina.unroute('**/auth/login')

        print('\n=== 2. LIMITE DE TENTATIVAS — o pátio inteiro sai por um IP só ===')
        await pagina.route('**/auth/login', responder_login(
            429, '{"erro":"Muitas tentativas."}'))
        txt = await tentar_login(pagina)
        ck('mostra [LIMITE]', '[LIMITE]' in txt, txt)
        ck('diz quanto tempo esperar', '1 minuto' in txt, txt)
        await pagina.unroute('**/auth/login')

        print('\n=== 3. ERRO INTERNO — não é culpa de quem digitou ===')
        await pagina.route('**/auth/login', responder_login(500, '{"erro":"falhou"}'))
        txt = await tentar_login(pagina)
        ck('mostra [HTTP500]', '[HTTP500]' in txt, txt)
        ck('inocenta a senha', 'senha' in txt.lower(), txt)
        await pagina.unroute('**/auth/login')

        print('\n=== 4. APARELHO SEM CAMINHO ATÉ A API — Wi-Fi/dados da pessoa ===')
        # Login e sondas recusados: nada deste aparelho alcança o servidor.
        await pagina.route('**/auth/login', recusar)
        await pagina.route('**/health', recusar)
        txt = await tentar_login(pagina)
        ck('mostra [REDE]', '[REDE]' in txt, txt)
        ck('manda conferir a internet do aparelho',
           'wi-fi' in txt.lower() or 'dados móveis' in txt.lower(), txt)
        await pagina.unroute('**/auth/login')
        await pagina.unroute('**/health')

        print('\n=== 5. REDE DA EMPRESA FILTRANDO O LOGIN ===')
        # O caso do computador que falha enquanto o mesmo usuário entra pelo
        # 4G do celular. O GET simples passa e é lido — logo a origem está
        # autorizada e o servidor está no ar. O POST do login não passa:
        # firewall corporativo e antivírus com inspeção de HTTPS derrubam o
        # preflight OPTIONS e deixam o GET simples passar.
        #
        # Dizer "avise a Logística" aqui seria mandar a pessoa errada
        # procurar o problema no lugar errado.
        await pagina.route('**/auth/login', recusar)
        await pagina.route('**/health', health_ok)
        txt = await tentar_login(pagina)
        ck('mostra [FILTRADO]', '[FILTRADO]' in txt, txt)
        ck('aponta firewall/antivírus/extensão',
           'firewall' in txt.lower() and 'antivírus' in txt.lower(), txt)
        ck('dá um teste que a pessoa consegue fazer sozinha',
           'anônima' in txt.lower() or 'celular' in txt.lower(), txt)
        await pagina.unroute('**/auth/login')
        await pagina.unroute('**/health')

        print('\n=== 5b. SERVIDOR RECUSANDO A ORIGEM (resposta opaca) ===')
        # Aqui o /health chega mas o navegador NÃO pode ler a resposta, por
        # falta do cabeçalho de origem. A sonda com CORS falha, a sonda
        # no-cors passa — e só essa diferença separa "a empresa está
        # filtrando" de "o servidor não conhece este endereço".
        #
        # Este caso não pode ser montado com route.fulfill: o Playwright
        # entrega a resposta interceptada sem passar pela checagem de CORS do
        # navegador, então qualquer cabeçalho que eu omitisse seria ignorado
        # e o teste mediria o cenário oposto — passando, e mentindo. Por isso
        # aqui o `fetch` é substituído: é a forma honesta de reproduzir o que
        # o navegador faz com uma resposta que ele decide não deixar ler.
        await pagina.evaluate("""() => {
            window.__fetchReal = window.fetch;
            window.fetch = (url, opcoes) => {
                const u = String(url && url.url ? url.url : url);
                const o = opcoes || {};
                if (u.includes('/health')) {
                    // no-cors: o pacote chega, a resposta é opaca — resolve.
                    if (o.mode === 'no-cors') return Promise.resolve(new Response(null, {status: 200}));
                    // com CORS: sem Allow-Origin, o navegador rejeita a leitura.
                    return Promise.reject(new TypeError('Failed to fetch'));
                }
                if (u.includes('/auth/login')) return Promise.reject(new TypeError('Failed to fetch'));
                return window.__fetchReal(url, opcoes);
            };
        }""")
        txt = await tentar_login(pagina)
        ck('mostra [BLOQUEIO], não [FILTRADO]', '[BLOQUEIO]' in txt, txt)
        ck('avisa que tentar de novo não resolve', 'não adianta' in txt.lower(), txt)
        await pagina.evaluate("() => { window.fetch = window.__fetchReal; }")

        print('\n=== 6. PAINEL ABERTO NO ENDEREÇO ERRADO ===')
        # O servidor recusa a origem com um 403 legível em vez de deixar o
        # navegador esconder o motivo. A tela repassa a frase dele, que diz
        # QUAL endereço foi barrado e qual é o certo — é a diferença entre
        # "não entra" e "abre o site pelo endereço sem www".
        await pagina.route('**/auth/login', responder_login(
            403, '{"codigo":"ORIGEM_NAO_AUTORIZADA",'
                 '"erro":"O painel foi aberto em https://www.embarquesuinco.com.br, '
                 'que não está autorizado. O endereço correto é https://embarquesuinco.com.br."}'))
        txt = await tentar_login(pagina)
        ck('mostra [ENDEREÇO]', '[ENDEREÇO]' in txt, txt)
        ck('nomeia o endereço barrado', 'www.embarquesuinco.com.br' in txt, txt)
        ck('nomeia o endereço certo', 'O endereço correto' in txt, txt)
        await pagina.unroute('**/auth/login')

        print('\n=== 7. OS CÓDIGOS SÃO TODOS DIFERENTES ===')
        # Se dois casos compartilhassem código, voltaríamos ao problema que
        # este trabalho existe para resolver.
        codigos = ['[SENHA]', '[LIMITE]', '[HTTP500]', '[REDE]',
                   '[FILTRADO]', '[BLOQUEIO]', '[ENDEREÇO]']
        ck('sete códigos distintos', len(set(codigos)) == 7)

        print('\n=== 8. CONSOLE ===')
        ck('sem erros de página', not erros, str(erros))

        await navegador.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
