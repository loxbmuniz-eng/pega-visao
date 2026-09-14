#!/usr/bin/env python3
"""O campo de KM da Montagem do Dia precisa caber o número (14/09/2026).

RELATO DO DONO: "na parte da montagem do dia eu preciso que voce aumente o
tamanho dos campos editaveis na coluna KM, pois esta muito pequeno e fica
confuso e trazendo dificuldade pra entender o que esta escrito la (...) ta so
um quadradinho minusculo e nao da pra funcionar desse jeito, entao pra poder
puxar certo a kilometragem precisa dessa alteracao".

MEDIDO ANTES DE MEXER, a 1440px: o campo tinha 37px. Desses, 14px de margem
interna e ~18px das setinhas do campo numérico — espaço para ZERO dígitos
legíveis. A coluna é uma de dezesseis e, sem largura mínima, era espremida
pelas vizinhas.

E UM RISCO QUE SÓ APARECEU AO MEDIR: em `type=number` com foco, a RODA DO
MOUSE altera o valor. A Montagem é tabela larga, rolada com a roda — passar
por cima do KM já escolhido mudava a quilometragem sem ninguém digitar. E o
frete é KM × tarifa: o número errado vira dinheiro errado.

O QUE ESTE TESTE TRAVA:
  1. o campo cabe um KM de 5 dígitos, no desktop;
  2. as setinhas não ocupam espaço;
  3. a roda do mouse não escreve no campo.
"""
import asyncio, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
MIN_LARGURA = 70   # 5 dígitos + margem interna, sem as setinhas
falhas = []
def ck(nome, ok, extra=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {extra}" if extra else ''))
    if not ok: falhas.append(nome)

LINHA = """
  <td>1</td><td>12345</td><td>ABC1D23</td><td>Motorista</td><td>500</td>
  <td>12.000</td><td>Não</td><td>ENTREGA DIRETA</td><td>0</td><td>3</td>
  <td>—</td><td>—</td><td class="c-destino">PATOS DE MINAS</td>
  <td class="c-kmdesl"><input type="number" inputmode="numeric" class="km-input"
      min="1" step="1" value="10000" onwheel="this.blur()"></td>
  <td class="c-frete cel-num">R$ 4.375,00</td><td class="no-print">—</td>
"""

async def main():
    print('\n=== O CAMPO DE KM CABE O NÚMERO (DESKTOP) ===')
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL); await pg.wait_for_timeout(1200)
        r = await pg.evaluate("""(linha) => {
            document.body.classList.remove('pre-login');
            const m = document.getElementById('main'); if (m) m.style.display = 'block';
            // O modal de login cobre a tela inteira e intercepta o mouse —
            // sem fechá-lo, a roda nunca chega no campo e o teste mede nada.
            const modal = document.getElementById('modal-operador');
            if (modal) { modal.classList.remove('open'); modal.style.display = 'none'; }
            const tb = document.getElementById('mont-tbody');
            const pag = tb.closest('.tab-page');
            document.querySelectorAll('.tab-page').forEach(e => e.classList.remove('active'));
            if (pag) pag.classList.add('active');
            const tr = document.createElement('tr'); tr.innerHTML = linha; tb.appendChild(tr);
            const inp = tb.querySelector('.km-input');
            const cs = getComputedStyle(inp);
            /* MEDE A REGRA, NÃO O MECANISMO. A primeira versão perguntava ao
               navegador se a setinha estava escondida, lendo um pseudo-elemento
               — e `getComputedStyle` não reporta isso de forma confiável. O que
               importa não é a setinha: é o NÚMERO CABER. `scrollWidth` maior
               que `clientWidth` quer dizer que o conteúdo está sendo cortado,
               que é exatamente o que o dono via. */
            return {
              largura: Math.round(inp.getBoundingClientRect().width),
              cortado: inp.scrollWidth > inp.clientWidth + 1,
              sobra: inp.clientWidth - inp.scrollWidth,
              temOnwheel: !!inp.getAttribute('onwheel'),
              alinhamento: cs.textAlign,
            };
        }""", LINHA)
        ck(f'o campo tem pelo menos {MIN_LARGURA}px — antes de 14/09 tinha 37px',
           r['largura'] >= MIN_LARGURA, f"{r['largura']}px")
        ck('um KM de 5 dígitos aparece INTEIRO, sem cortar',
           not r['cortado'], str(r))

        # A roda não pode escrever: com foco, `type=number` incrementa sozinho.
        antes = await pg.evaluate("() => document.querySelector('.km-input').value")
        await pg.focus('.km-input')
        await pg.hover('.km-input')
        await pg.mouse.wheel(0, -240)
        await pg.wait_for_timeout(250)
        depois = await pg.evaluate("() => document.querySelector('.km-input').value")
        ck('a roda do mouse NÃO alterou a quilometragem', antes == depois,
           f'antes={antes} depois={depois}')
        ck('nenhum erro de JavaScript', not erros, str(erros[:1]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)

asyncio.run(main())
