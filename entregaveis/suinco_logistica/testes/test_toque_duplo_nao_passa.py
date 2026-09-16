#!/usr/bin/env python3
"""O segundo toque no mesmo botão não vira segunda gravação.

MEDIDO ANTES DE ESCREVER: o painel inteiro tinha TRÊS botões que se
desabilitam enquanto a ação corre, e os três eram do modal de avisos. Os da
operação — "Seguiu Viagem", "Criar carga", "Cancelar" — aceitavam o segundo
toque de braços abertos.

A própria folha de estilo já registrava a causa, em 2026: "no celular não
existe hover, e sem resposta visual o operador aperta duas vezes achando que
não pegou". A resposta ao toque entrou hoje e resolve a PERCEPÇÃO; ela não
resolve o que acontece quando o segundo toque chega ao servidor — duas
chamadas na mesma carga, dois checklists, duas cargas criadas.

O QUE ESTE TESTE TRAVA:

  1. Dois toques rápidos no mesmo botão disparam UMA ação, não duas.
  2. O botão AVISA que barrou — recusa silenciosa é o que fez a pessoa
     apertar de novo em primeiro lugar.
  3. Depois da janela, o botão volta a aceitar. Guarda que trava para
     sempre não é guarda, é defeito.
  4. Botões marcados como repetíveis continuam repetindo, e o teclado
     também — quem navega por teclado aperta uma vez, e travar ali seria
     resolver um problema de dedo criando um de acessibilidade.
"""
import asyncio, os, sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
falhas = []

# A janela do guarda, em app.js. Se ela mudar lá, muda aqui — e o teste
# reprova em vez de passar por acaso.
JANELA = 400


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


# Um botão de verdade do painel, com um contador no lugar da ação. Contar
# quantas vezes o `onclick` ROLOU é a única medida que importa: é ele que
# chama o servidor.
MONTAR = """() => {
  window.__contagem = 0;
  window.__conta = () => { window.__contagem++; };
  const faz = (id, extra) => {
    const b = document.createElement('button');
    b.id = id; b.className = 'btn btn-primary';
    b.setAttribute('onclick', '__conta()');
    if (extra) b.setAttribute(extra, '');
    b.textContent = id;
    b.style.cssText = 'position:fixed;left:20px;top:' + (id === 'pv-normal' ? 20 : 80)
      + 'px;z-index:2147483647;display:inline-flex;width:150px;height:44px';
    document.body.appendChild(b);
  };
  faz('pv-normal');
  faz('pv-repetivel', 'data-repetivel');
  return true;
}"""


async def toques(pg, sel, n, intervalo_ms):
    el = await pg.query_selector(sel)
    box = await el.bounding_box()
    x, y = box['x'] + box['width'] / 2, box['y'] + box['height'] / 2
    for i in range(n):
        await pg.mouse.click(x, y)
        if intervalo_ms:
            await pg.wait_for_timeout(intervalo_ms)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        html = open(PAINEL_ARQ, encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = f'{API}/__toque_duplo'
        ctx = await nav.new_context(viewport={'width': 1280, 'height': 900})
        pg = await ctx.new_page()
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        await pg.wait_for_selector('#login-email', timeout=25000)
        await pg.fill('#login-email', 'ana@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3000)
        await pg.evaluate(MONTAR)
        await pg.wait_for_timeout(300)

        print('\n=== 1. DOIS TOQUES RÁPIDOS VIRAM UMA AÇÃO ===')
        await pg.evaluate("()=>{window.__contagem=0}")
        await toques(pg, '#pv-normal', 3, 40)
        await pg.wait_for_timeout(200)
        n = await pg.evaluate("()=>window.__contagem")
        ck('três toques em rajada dispararam a ação UMA vez', n == 1, f'{n} disparo(s)')

        print('\n=== 2. O BOTÃO AVISA QUE BARROU ===')
        marcou = await pg.evaluate(
            "()=>document.getElementById('pv-normal').classList.contains('toque-recusado')")
        ck('o botão barrado fica marcado para piscar', marcou, str(marcou))

        print('\n=== 3. DEPOIS DA JANELA, VOLTA A ACEITAR ===')
        # Guarda que trava para sempre não é guarda, é defeito.
        #
        # A ESPERA ABAIXO NÃO É ENFEITE, e a primeira versão deste teste não
        # a tinha — reprovou, e o vermelho era do TESTE, não do código. A
        # rajada do bloco 1 termina num toque BARRADO, e toque barrado não
        # atualiza o relógio, de propósito: se atualizasse, quem martelasse
        # o botão renovaria a trava para sempre. Sem esperar a janela
        # passar, o bloco 3 começava dentro da trava que ele mesmo criou.
        await pg.wait_for_timeout(JANELA + 150)
        await pg.evaluate("()=>{window.__contagem=0}")
        await toques(pg, '#pv-normal', 1, 0)
        await pg.wait_for_timeout(600)
        await toques(pg, '#pv-normal', 1, 0)
        await pg.wait_for_timeout(200)
        n = await pg.evaluate("()=>window.__contagem")
        ck('dois toques separados por 600ms disparam DUAS vezes', n == 2, f'{n} disparo(s)')

        print('\n=== 4. QUEM PODE REPETIR, REPETE ===')
        await pg.evaluate("()=>{window.__contagem=0}")
        await toques(pg, '#pv-repetivel', 3, 40)
        await pg.wait_for_timeout(200)
        n = await pg.evaluate("()=>window.__contagem")
        ck('botão marcado como repetível não é barrado', n == 3, f'{n} disparo(s)')

        # Quem navega por teclado aperta uma vez — travar ali seria resolver
        # um problema de dedo criando um de acessibilidade.
        await pg.evaluate("()=>{window.__contagem=0}")
        for _ in range(3):
            await pg.evaluate("()=>document.getElementById('pv-normal').click()")
        await pg.wait_for_timeout(200)
        n = await pg.evaluate("()=>window.__contagem")
        ck('acionamento por teclado/programa não é barrado', n == 3, f'{n} disparo(s)')

        await nav.close()
    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
