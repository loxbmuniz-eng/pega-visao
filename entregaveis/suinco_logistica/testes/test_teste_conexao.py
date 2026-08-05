#!/usr/bin/env python3
"""A tela "Testar conexão" aponta a etapa exata em que a requisição morre.

Motivo: dois computadores Windows da mesma empresa não conseguiam entrar,
enquanto celulares no 4G entravam normalmente. Janela privada não resolveu,
o que descartou extensão de navegador. A essa altura o diagnóstico à
distância já era adivinhação — e adivinhação custa turno de pátio.

A tela roda quatro sondas no navegador de quem está travado. Cada uma
remove uma camada, e a conclusão diz de quem é o problema: da rede daquele
aparelho, do servidor, ou do firewall da empresa. É feita para ser
fotografada e mandada no grupo.

Não precisa do backend no ar: as respostas são simuladas pelo navegador.
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


async def rodar_teste(pagina, cenario):
    """Instala um fetch controlado e roda a tela de diagnóstico.

    O fetch é substituído em vez de usar route.fulfill porque o Playwright
    entrega respostas interceptadas sem passar pela checagem de CORS do
    navegador — com rotas, o cenário de origem recusada passaria calado e o
    teste mediria o contrário do que promete.
    """
    await pagina.evaluate("""(cenario) => {
        window.fetch = (url, opcoes) => {
            const u = String(url && url.url ? url.url : url);
            const o = opcoes || {};
            const tipo = (o.headers && (o.headers['content-type'] || o.headers['Content-Type'])) || '';
            const json = (corpo, status) => Promise.resolve(new Response(
                JSON.stringify(corpo), {status: status || 200,
                                        headers: {'content-type': 'application/json'}}));

            if (u.includes('/health')) {
                if (cenario === 'sem_rede') return Promise.reject(new TypeError('Failed to fetch'));
                if (o.mode === 'no-cors') return Promise.resolve(new Response(null, {status: 200}));
                if (cenario === 'origem_recusada') return Promise.reject(new TypeError('Failed to fetch'));
                return json({ok: true, banco: 'conectado'});
            }
            if (u.includes('/auth/login')) {
                if (cenario === 'sem_rede' || cenario === 'origem_recusada')
                    return Promise.reject(new TypeError('Failed to fetch'));
                // Proxy da empresa descartando OPTIONS: o POST em JSON exige
                // preflight e morre; o mesmo POST em text/plain passa.
                if (cenario === 'preflight_bloqueado')
                    return tipo.includes('application/json')
                        ? Promise.reject(new TypeError('Failed to fetch'))
                        : json({erro: 'Informe e-mail e senha.'}, 400);
                if (cenario === 'tudo_bloqueado')
                    return Promise.reject(new TypeError('Failed to fetch'));
                return json({erro: 'Informe e-mail e senha.'}, 400);
            }
            return Promise.reject(new TypeError('Failed to fetch'));
        };
    }""", cenario)
    await pagina.evaluate("() => rodarTesteDeConexao()")
    await pagina.wait_for_selector('.teste-conclusao', timeout=15000)
    return await pagina.inner_text('#teste-conexao')


async def main():
    async with async_playwright() as p:
        navegador = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                            headless=True)
        pagina = await abrir(await navegador.new_context())
        erros = []
        pagina.on('pageerror', lambda e: erros.append(str(e)))

        print('\n=== 1. O LINK EXISTE NO MODAL DE LOGIN ===')
        # Quem está travado precisa achar isto sem instrução por telefone.
        ck('link "Testar conexão" visível',
           await pagina.is_visible("text=Testar conexão"))

        print('\n=== 2. APARELHO SEM CAMINHO ATÉ O SERVIDOR ===')
        txt = await rodar_teste(pagina, 'sem_rede')
        ck('aponta a internet do aparelho', 'não alcança o servidor' in txt, txt[:160])
        ck('não culpa o servidor', 'configuração do servidor' not in txt)

        print('\n=== 3. SERVIDOR RECUSANDO O ENDEREÇO ===')
        txt = await rodar_teste(pagina, 'origem_recusada')
        ck('alcance passa, leitura falha', '✓' in txt and '✕' in txt, txt[:160])
        ck('aponta configuração do servidor', 'recusa este endereço' in txt, txt[:200])

        print('\n=== 4. REDE DA EMPRESA DESCARTANDO O OPTIONS ===')
        # O caso das duas máquinas Windows. A quarta sonda passando enquanto
        # a terceira falha é a prova de que existe contorno.
        txt = await rodar_teste(pagina, 'preflight_bloqueado')
        ck('nomeia o OPTIONS', 'OPTIONS' in txt, txt[:220])
        ck('diz que o envio simples passou', 'envio simples passou' in txt.lower(), txt[:260])
        ck('avisa que dá para contornar', 'contornar' in txt.lower(), txt[:260])

        print('\n=== 5. FIREWALL BLOQUEANDO O LOGIN INTEIRO ===')
        txt = await rodar_teste(pagina, 'tudo_bloqueado')
        ck('aponta firewall/antivírus', 'firewall' in txt.lower(), txt[:220])
        ck('diz o que a TI precisa liberar', 'porta 443' in txt, txt[:260])

        print('\n=== 6. TUDO CERTO ===')
        txt = await rodar_teste(pagina, 'ok')
        ck('conclui que a conexão está boa', 'Todas as etapas passaram' in txt, txt[:200])
        ck('aponta para e-mail ou senha', 'senha' in txt.lower(), txt[:200])

        print('\n=== 7. A TELA SERVE PARA SER FOTOGRAFADA ===')
        # Sem o endereço da API e a origem do painel, a foto não identifica
        # de qual aparelho e de qual endereço o teste saiu.
        ck('mostra o endereço da API', ORIGEM_API in txt, txt[-160:])
        ck('mostra a origem do painel', ORIGEM_PAINEL in txt, txt[-160:])
        ck('mostra data e hora', '/' in txt.split('·')[-1], txt[-80:])

        largura = await pagina.evaluate("""() => {
            const r = document.getElementById('teste-conexao').getBoundingClientRect();
            return r.left >= 0 && r.right <= window.innerWidth;
        }""")
        ck('cabe na tela', largura)

        print('\n=== 8. CONSOLE ===')
        ck('sem erros de página', not erros, str(erros))

        await navegador.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
