#!/usr/bin/env python3
"""Aviso de outro setor é notícia, e notícia tem prazo. (25/08/2026)

Relato do dono, com print de "+142 aviso(s) aguardando": "essa fila de
avisos tá foda com esses avisos acumulados; deixa os avisos mais focados
pro ao vivo mesmo, larga mão de ficar mostrando ele infinitamente pra quem
tá abrindo o painel agora".

A fila nunca descartava nada. Três avisos na tela por vez, cinco segundos
cada — num pátio movimentado chegam mais rápido do que isso drena, e o
resto esperava a vez para sempre. Quem abria o painel às 12h assistia, um
a um, a avisos de coisas que aconteceram às 9h. E o painel JÁ MOSTRAVA o
estado atual daquelas cargas: o aviso não informava nada, só ocupava tela.

Três regras, e o teste guarda as três — mais a exceção, que é a parte
perigosa de mexer:

  1. FILA CURTA: além do teto, o mais antigo perecível cai;
  2. PRAZO: perecível que passou da validade é descartado na hora de
     aparecer, em vez de virar reprise;
  3. JANELA DE CHEGADA: nos primeiros segundos depois de abrir o painel,
     mudança de outro setor não aparece.

  EXCEÇÃO, que NENHUMA das três pode engolir: aviso com som — troca de
  placa é segurança, o caminhão errado entra na doca por causa dele — e
  tudo que é resposta a uma ação de quem está na frente da tela (gravou,
  foi recusado, perdeu a conexão). Esses não são notícia de terceiro: são
  a conversa com quem clicou.

    python3 testes/test_fila_avisos_ao_vivo.py
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


async def entrar(pg):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(1100)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(700)
    # Limpa o que a entrada gerou, para medir só o que o teste dispara.
    await pg.evaluate("""() => {
        document.getElementById('notif').innerHTML = '';
        _notifFila.length = 0;
      }""")


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        pg = await nav.new_page(viewport={'width': 1360, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)

        print('\n=== 1. JANELA DE CHEGADA: QUEM ACABOU DE ABRIR NÃO VÊ REPRISE ===')
        d = await pg.evaluate("""() => {
              const antes = document.querySelectorAll('#notif .notif-item').length;
              for(let i = 0; i < 10; i++){
                notify('Carga 1183' + i + ' foi editada (Portaria).', 'success',
                       5000, { perecivel: true });
              }
              return { antes, depois: document.querySelectorAll('#notif .notif-item').length,
                       fila: _notifFila.length,
                       recemChegado: notifRecemChegado() };
            }""")
        ck('o painel se considera recém-aberto', d['recemChegado'], str(d))
        ck('nenhuma notícia de outro setor aparece na chegada',
           d['depois'] == d['antes'], str(d))
        ck('e nada fica esperando na fila', d['fila'] == 0, str(d))

        print('\n=== 2. MAS O QUE É RESPOSTA A QUEM CLICOU, APARECE ===')
        # O erro mais fácil de cometer aqui: silenciar tudo. Quem gravou
        # precisa saber se gravou, mesmo tendo acabado de abrir o painel.
        d = await pg.evaluate("""() => {
              notify('Não consegui gravar: sem conexão.', 'danger', 5000);
              return { itens: document.querySelectorAll('#notif .notif-item').length };
            }""")
        ck('aviso da própria ação aparece mesmo na chegada', d['itens'] >= 1, str(d))

        print('\n=== 3. PASSADA A JANELA, A NOTÍCIA VOLTA A APARECER ===')
        await pg.evaluate("""() => {
              // Envelhece o painel sem esperar de verdade: a janela é medida
              // contra _notifAbertoEm, e o teste não pode dormir 12 segundos.
              window.notifRecemChegado = () => false;
              document.getElementById('notif').innerHTML = '';
              _notifFila.length = 0;
            }""")
        d = await pg.evaluate("""() => {
              for(let i = 0; i < 12; i++){
                notify('Carga 2183' + i + ' foi editada (Portaria).', 'success',
                       60000, { perecivel: true });
              }
              return { naTela: document.querySelectorAll('#notif .notif-item').length,
                       fila: _notifFila.length };
            }""")
        ck('a notícia volta a aparecer depois da chegada', d['naTela'] >= 1, str(d))

        print('\n=== 4. FILA CURTA: 12 AVISOS NÃO VIRAM 12 NA ESPERA ===')
        ck('a fila não passa do teto',
           d['fila'] <= 4, f"{d['fila']} esperando (teto 4)")
        ck('e o contador não anuncia dezenas',
           d['fila'] < 10, f"+{d['fila']} aguardando")

        print('\n=== 5. PRAZO: NOTÍCIA VELHA NÃO VIRA REPRISE ===')
        # O caso do relato: o aviso esperou tanto que o painel já mostra o
        # resultado dele. Descartar é mais honesto que exibir.
        d = await pg.evaluate("""() => {
              document.getElementById('notif').innerHTML = '';
              _notifFila.length = 0;
              // Três na tela + dois na fila, os da fila já vencidos.
              for(let i = 0; i < 5; i++){
                notify('Carga 3183' + i + ' mudou (Portaria).', 'success',
                       60000, { perecivel: true });
              }
              _notifFila.forEach(x => { x.em = Date.now() - 120000; });
              const naFila = _notifFila.length;
              const proximo = _proximoDaFila();
              return { naFila, sobrou: _notifFila.length, veio: !!proximo };
            }""")
        ck('havia notícia vencida esperando', d['naFila'] >= 1, str(d))
        ck('a vencida é descartada em vez de exibida',
           not d['veio'] and d['sobrou'] == 0, str(d))

        print('\n=== 6. A EXCEÇÃO: TROCA DE PLACA NUNCA É ENGOLIDA ===')
        d = await pg.evaluate("""() => {
              document.getElementById('notif').innerHTML = '';
              _notifFila.length = 0;
              window.notifRecemChegado = () => true;   // de volta à chegada
              // Enche a tela com notícia comum...
              for(let i = 0; i < 6; i++){
                notify('ruído ' + i, 'success', 60000, { perecivel: true });
              }
              // ...e manda o aviso de segurança.
              const el = document.createElement('div');
              el.className = 'notif-item aviso-alteracao forte';
              el.textContent = 'PLACA TROCADA na carga 118350';
              _exibirNotif(el, 20000, { perecivel: true });
              const naTela = [...document.querySelectorAll('#notif .notif-item')]
                .map(e => e.textContent);
              const naFila = _notifFila.map(x => x.el.textContent);
              return { naTela, naFila,
                       apareceu: naTela.some(t => t.includes('PLACA TROCADA')),
                       esperando: naFila.some(t => t.includes('PLACA TROCADA')) };
            }""")
        ck('o aviso de troca de placa não é descartado',
           d['apareceu'] or d['esperando'], str(d)[:110])
        ck('e não é engolido pela janela de chegada',
           d['apareceu'] or d['esperando'], f"tela={d['apareceu']} fila={d['esperando']}")

        print('\n=== 7. SEM ERRO DE JAVASCRIPT ===')
        ck('console limpo', not erros, '; '.join(erros[:3]))

        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('  Tudo verde.')
    return 0


sys.exit(asyncio.run(main()))
