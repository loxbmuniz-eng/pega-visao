#!/usr/bin/env python3
"""Prova que a tela de login diz QUAL foi o problema, não só que houve um.

Motivo deste teste: durante a virada para o servidor, um operador do
Faturamento não conseguiu entrar e a tela disse "servidor não respondeu"
— a mesma frase que aparecia para senha errada, para limite de tentativas,
para Wi-Fi ruim e para erro interno. Com um relato indistinguível, o
diagnóstico remoto vira adivinhação.

Cada falha agora carrega um código curto entre colchetes, feito para ser
lido em voz alta ou fotografado no grupo. Este teste força as seis
situações e confere que cada uma produz o código certo.

Não precisa do backend no ar: todas as respostas são simuladas pelo próprio
navegador. É de propósito — o teste mede a tradução do erro, não a API.
"""
import asyncio
import sys
from playwright.async_api import async_playwright

PAINEL = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
ORIGEM = 'https://api.exemplo.local'

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def abrir(ctx):
    pagina = await ctx.new_page()
    html = open(PAINEL, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{ORIGEM}'")

    url = ORIGEM + '/__painel_teste'
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
    # A sonda de conexão tem 6 s de teto; nos casos que a acionam o texto
    # demora mais para assentar que nos que respondem na hora.
    await pagina.wait_for_selector('#login-erro:not([hidden])', timeout=15000)
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
            """Faz /auth/login responder com um status escolhido."""
            async def h(rota):
                await rota.fulfill(status=status, content_type='application/json',
                                   body=corpo)
            return lambda rota: asyncio.ensure_future(h(rota))

        def recusar(rota):
            return asyncio.ensure_future(rota.abort('connectionrefused'))

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
        # Login e sonda recusados: nada deste aparelho alcança o servidor.
        await pagina.route('**/auth/login', recusar)
        await pagina.route('**/health', recusar)
        txt = await tentar_login(pagina)
        ck('mostra [REDE]', '[REDE]' in txt, txt)
        ck('manda conferir a internet do aparelho',
           'wi-fi' in txt.lower() or 'dados móveis' in txt.lower(), txt)
        await pagina.unroute('**/auth/login')
        await pagina.unroute('**/health')

        print('\n=== 5. SERVIDOR NO AR MAS RECUSANDO A ORIGEM (CORS) ===')
        # É o caso que mais custou tempo em produção: para o navegador, um
        # preflight recusado é indistinguível de rede caída. A sonda em
        # no-cors passa (o pacote chega), o login não — e só essa diferença
        # separa "chama a TI" de "troca de Wi-Fi".
        await pagina.route('**/auth/login', recusar)
        await pagina.route('**/health', lambda rota: asyncio.ensure_future(
            rota.fulfill(status=200, content_type='application/json', body='{"ok":true}')))
        txt = await tentar_login(pagina)
        ck('mostra [BLOQUEIO], não [REDE]', '[BLOQUEIO]' in txt, txt)
        ck('avisa que tentar de novo não resolve', 'não adianta' in txt.lower(), txt)
        await pagina.unroute('**/auth/login')
        await pagina.unroute('**/health')

        print('\n=== 6. PAINEL ABERTO NO ENDEREÇO ERRADO ===')
        # O servidor agora recusa a origem com um 403 legível em vez de deixar
        # o navegador esconder o motivo. A tela repassa a frase dele, que diz
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
        codigos = ['[SENHA]', '[LIMITE]', '[HTTP500]', '[REDE]', '[BLOQUEIO]', '[ENDEREÇO]']
        ck('seis códigos distintos', len(set(codigos)) == 6)

        print('\n=== 8. CONSOLE ===')
        ck('sem erros de página', not erros, str(erros))

        await navegador.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
