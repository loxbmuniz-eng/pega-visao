#!/usr/bin/env python3
"""A fila de avisos cresce sem fim — 67 avisos esperando numa tela é defeito, não informação.

RELATO DO DONO: print mostrando a pílula "+41" no topo da pilha de avisos,
a tela inteira tomada por avisos repetidos.

MEDIÇÃO DA FRENTE QUE INVESTIGOU: 15 cargas nunca confirmadas (incerteza de
rede, a família da #53/#54) + 13 leituras remotas = 45 avisos, 42 ainda na
fila. O print do dono mostrava "+41" — a mesma ordem de grandeza.

DUAS CAUSAS, as duas em `app.js`:

  1. `NOTIF_MAX_FILA = 4` (linha 55) é declarada e NUNCA É LIDA em lugar
     nenhum do arquivo. O comentário ao lado descreve uma regra de "fila
     curta" que o código não aplica — a fila (`_notifFila`, usada em
     `_exibirNotif`) cresce sem teto: todo aviso que chega além dos
     `NOTIF_MAX_VISIVEL` (3) visíveis é empilhado com `_notifFila.push(...)`
     sem NENHUMA checagem de tamanho.

  2. O texto do aviso de incerteza ("NÃO CONSEGUI CONFIRMAR COM O SERVIDOR",
     app.js:1021-1031) e o texto do conflito de versão ("o servidor recusou
     a gravação. Outro operador alterou esta carga...", construído a partir
     de data.js:927-928) NÃO CASAM com o regex de deduplicação
     `_MARCA_OFFLINE` (app.js:735: só pega "VOCÊ ESTÁ OFFLINE", "SESSÃO
     EXPIROU", "SISTEMA INDISPONÍVEL", "NADA FOI GRAVADO"). Por isso CADA
     carga incerta e CADA conflito de versão abre o SEU PRÓPRIO aviso,
     empilhando sem fim — a mesma dedupe que já existe para "você está
     offline" (um só na tela, sempre o mais recente) não vale para estas
     duas famílias.

O QUE ESTE TESTE TRAVA (e hoje reprova)
  1. a fila de avisos (`_notifFila`) respeita um teto — NUNCA cresce além
     de `NOTIF_MAX_FILA`, nem com a família de incerteza, nem com a de
     conflito de versão, nem com as duas juntas;
  2. N cargas aguardando confirmação produzem UM aviso agregado
     ("N cargas aguardando confirmação"), não N avisos individuais —
     perder a contagem de qual é a N-ésima carga não é o problema; perder
     a TELA debaixo de uma pilha de avisos idênticos é.

Testado em DUAS famílias SEPARADAS e depois JUNTAS de propósito: uma
correção que tampe só a fila de incerteza (a que o relato descreve primeiro)
e deixe o conflito de versão empilhando do mesmo jeito continua reprovando
aqui — o teto declarado em `NOTIF_MAX_FILA` tem que valer para qualquer
aviso que chegue em rajada, não para uma família só.

    python3 testes/test_fila_de_avisos_tem_teto.py
"""
import asyncio
import sys

from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


LIMPAR_FILA = """() => {
  document.getElementById('notif').innerHTML = '';
  _notifFila.length = 0;
}"""

CONTAR = """() => ({
  visiveis: document.querySelectorAll('#notif .notif-item').length,
  naFila: _notifFila.length,
  notifMaxFila: NOTIF_MAX_FILA,
})"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL); await pg.wait_for_timeout(900)
        await pg.evaluate("() => { sessionStorage.setItem('suinco_token', 'token-de-teste'); }")
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Gestor')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text(\"Entrar sem servidor\")')
        await pg.wait_for_timeout(400)
        await pg.evaluate(LIMPAR_FILA)

        print('\n=== 1. SÓ A FAMÍLIA DE INCERTEZA — 15 cargas nunca confirmadas ===')
        await pg.evaluate("""() => {
          for (let i = 0; i < 15; i++) {
            const carga = { id: 'inc_' + i, numeroCarga: 'INC-' + i, placa: 'AAA' + i + 'A11' };
            // offline=true, incerta=true, tentativas=1 — a PRIMEIRA tentativa de
            // cada carga, que hoje SEMPRE notifica (app.js:1019-1020: só pula a
            // partir da 2ª tentativa). É exatamente o cenário do relato: 15
            // cargas, cada uma na sua primeira tentativa.
            receberRecusaDeCarga(carga, 'não consegui confirmar', false, true, true, 1);
          }
        }""")
        r1 = await pg.evaluate(CONTAR)
        ck('a fila de espera não passa do teto declarado (NOTIF_MAX_FILA)',
           r1['naFila'] <= r1['notifMaxFila'], str(r1))
        ck('o total na tela (visíveis + na fila) não é 15 avisos individuais',
           (r1['visiveis'] + r1['naFila']) < 15, str(r1))

        print('\n=== 2. SÓ A FAMÍLIA DE CONFLITO DE VERSÃO — 13 leituras concorrentes ===')
        await pg.evaluate(LIMPAR_FILA)
        await pg.evaluate("""() => {
          const motivo = 'Outro operador alterou esta carga enquanto você editava. '
            + 'O painel recarregou a carga com o que está no servidor — confira e refaça a sua alteração.';
          for (let i = 0; i < 13; i++) {
            const carga = { id: 'conf_' + i, numeroCarga: 'CONF-' + i, placa: 'BBB' + i + 'B22' };
            // removida=false (edição, não criação), offline=false, incerta=false:
            // é o caminho de CONFLITO_DE_VERSAO puro, sem relação nenhuma com rede.
            receberRecusaDeCarga(carga, motivo, false, false, false, 0);
          }
        }""")
        r2 = await pg.evaluate(CONTAR)
        ck('a fila de espera não passa do teto MESMO SÓ com conflito de versão',
           r2['naFila'] <= r2['notifMaxFila'], str(r2))
        ck('o total na tela não é 13 avisos individuais de conflito',
           (r2['visiveis'] + r2['naFila']) < 13, str(r2))

        print('\n=== 3. AS DUAS FAMÍLIAS JUNTAS (o cenário exato do relato) ===')
        await pg.evaluate(LIMPAR_FILA)
        r3 = await pg.evaluate("""() => {
          for (let i = 0; i < 15; i++) {
            receberRecusaDeCarga({ id: 'inc2_' + i, numeroCarga: 'INC2-' + i, placa: 'CCC' + i + 'C11' },
              'não consegui confirmar', false, true, true, 1);
          }
          const motivo = 'Outro operador alterou esta carga enquanto você editava.';
          for (let i = 0; i < 13; i++) {
            receberRecusaDeCarga({ id: 'conf2_' + i, numeroCarga: 'CONF2-' + i, placa: 'DDD' + i + 'D22' },
              motivo, false, false, false, 0);
          }
          return { visiveis: document.querySelectorAll('#notif .notif-item').length, naFila: _notifFila.length };
        }""")
        ck('28 recusas (15 incertas + 13 conflitos) não produzem 28 avisos empilhados',
           (r3['visiveis'] + r3['naFila']) < 28, str(r3))
        ck('e a fila de espera continua dentro do teto declarado',
           r3['naFila'] <= 4, str(r3))

        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)


asyncio.run(main())
