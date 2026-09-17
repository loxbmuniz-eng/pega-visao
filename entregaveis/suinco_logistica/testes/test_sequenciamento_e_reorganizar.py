#!/usr/bin/env python3
"""O sequenciamento na tela: o botão não pode mentir, o arrasto não pode calar.

RELATO DO DONO (17/09/2026): "não conseguimos reorganizar nem aplicar o
sequenciamento corretamente. Por exemplo, ao inserir o número 7, ele não
funciona. (...) É necessário um botão de 'reorganizar por sequência' em todas
essas áreas, QUE FUNCIONE CORRETAMENTE. O filtro de arrastar para o local
desejado deve operar sem falhas."

A CAUSA DO "7 NÃO FUNCIONA" É DO SERVIDOR e está travada em api.test.js
(bloco 44). Este arquivo guarda as DUAS metades que vivem na tela:

  1. O BOTÃO QUE AVISAVA SUCESSO SEM FAZER NADA. `reordenarPorSequenciaUI()`
     era, inteiro:

         renderProgFila();
         notify('Fila reordenada por Sequência.', 'success');

     Ele redesenhava a tela — que JÁ desenhava ordenada por sequência — e
     anunciava sucesso. Quem clicava via 1, 2, 14 continuar 1, 2, 14 com um
     "pronto!" verde em cima. Botão que afirma ter feito e não fez gasta a
     confiança de quem opera em tudo o mais que o painel diz.

  2. O ARRASTO QUE NÃO DIZIA POR QUE NÃO FUNCIONOU. Soltar em cima de uma
     linha sem número era um `return` mudo: a pessoa arrastava, soltava, não
     acontecia nada, e a conclusão razoável era "o arrasto está quebrado".

MEDE O PAINEL, NÃO O `app.js` DO CHECKOUT — o `index.html` embute o app.js,
então apontar `--painel` para o publicado mede o publicado de verdade. Ler o
arquivo local daria OK mesmo rodando contra o que está no ar; é a armadilha
da referência que não acompanha o alvo, e ela já custou um dia aqui.

    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
        python3 testes/test_sequenciamento_e_reorganizar.py
    # contra o que está no ar (tem de REPROVAR):
    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
        python3 testes/test_sequenciamento_e_reorganizar.py --painel /tmp/publicado.html
"""
import argparse
import asyncio
import os
import pathlib
import sys

from playwright.async_api import async_playwright

BASE = pathlib.Path(__file__).parent.parent
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH', '/opt/pw-browsers/chromium')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


# Espiona o `notify` sem trocá-lo: guarda o que passou por ele. O que importa
# não e' o texto, e' a COR — 'success' depois de nada ter acontecido e' a
# mentira que este teste existe para travar.
ESPIAO = """() => {
  window.__avisos = [];
  const original = window.notify;
  window.notify = function(msg, tipo, ms){
    window.__avisos.push({ msg: String(msg), tipo: String(tipo || '') });
    return original ? original.apply(this, arguments) : undefined;
  };
  /* confirm() automatico: a pergunta de confirmacao e' decisao de projeto
     (a acao mexe na fila inteira) e nao e' o assunto medido aqui. */
  window.confirm = () => true;
  return true;
}"""

SEMEAR = """() => {
  DB.cargas = []; DB.movimentacoes = [];
  const base = {placa:'ABC1D23', rota:'500', peso:1000, status:'Aguardando Veículo',
                criadoEm:new Date().toISOString(), programadoEm:new Date().toISOString(),
                qtdEntregas:1};
  DB.cargas.push({...base, id:'s1', numeroCarga:'7001', sequencia:1});
  DB.cargas.push({...base, id:'s2', numeroCarga:'7002', sequencia:2});
  DB.cargas.push({...base, id:'s3', numeroCarga:'7003', sequencia:14});
  DB.cargas.push({...base, id:'s4', numeroCarga:'7004', sequencia:null});
  return DB.cargas.length;
}"""


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--painel', default=str(BASE / 'index.html'))
    args = ap.parse_args()
    painel = pathlib.Path(args.painel)
    print(f'\n  medindo: {painel}')

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROMIUM)
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(f'file://{painel}')
        await pg.wait_for_function('typeof renderAll === "function"', timeout=25000)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)
        await pg.evaluate(ESPIAO)
        await pg.evaluate(SEMEAR)
        await pg.evaluate("() => renderAll()")
        await pg.wait_for_timeout(300)

        print('\n=== 1. O BOTÃO EXISTE NAS TRÊS ÁREAS ===')
        botoes = await pg.evaluate("""() => {
          const achados = [];
          document.querySelectorAll('button').forEach(b => {
            const on = b.getAttribute('onclick') || '';
            if(/reorganizar|reordenarPorSequencia/i.test(on))
              achados.push({ onclick: on.trim(), texto: (b.textContent||'').trim() });
          });
          return achados;
        }""")
        for area, marca in [('Programação do Dia', 'reordenarPorSequenciaUI'),
                            ('Torre de Controle', 'reorganizarSequenciaTorreUI'),
                            ('Montagem do Dia', 'reorganizarMontagemUI')]:
            tem = any(marca in b['onclick'] for b in botoes)
            ck(f'{area}: botão presente', tem,
               '' if tem else f"nenhum botão chama {marca}()")

        print('\n=== 2. E A FUNÇÃO QUE ELE CHAMA EXISTE DE VERDADE ===')
        for fn in ['reordenarPorSequenciaUI', 'reorganizarSequenciaTorreUI',
                   'reorganizarMontagemUI', 'reorganizarFilaDoDiaUI']:
            existe = await pg.evaluate(f"() => typeof window.{fn} === 'function'")
            ck(f'{fn}() existe', existe, '' if existe else 'botão aponta para o nada')

        print('\n=== 3. SEM SERVIDOR, O BOTÃO NÃO PODE AVISAR SUCESSO ===')
        # Esta e' a metade que REPROVA contra o publicado: la' o botao chama
        # renderProgFila() e notifica 'success' sem ter mexido em nada.
        await pg.evaluate("() => { window.__avisos = []; }")
        try:
            await pg.evaluate("async () => { await reordenarPorSequenciaUI(); }")
        except Exception as e:
            ck('o clique não estoura exceção', False, str(e)[:120])
        await pg.wait_for_timeout(400)
        avisos = await pg.evaluate("() => window.__avisos || []")
        sucessos = [a for a in avisos if a['tipo'] == 'success']
        ck('não anuncia sucesso quando nada foi reorganizado',
           not sucessos, f"avisou sucesso: {[a['msg'] for a in sucessos]}")
        ck('e diz que sem servidor não dá',
           any(a['tipo'] in ('warn', 'error') for a in avisos),
           f'avisos: {avisos}')
        seqs = await pg.evaluate("() => DB.cargas.map(c => c.sequencia)")
        ck('e não inventou renumeração na cópia local', seqs == [1, 2, 14, None], str(seqs))

        print('\n=== 4. ARRASTAR EM LINHA SEM NÚMERO FALA, NÃO CALA ===')
        await pg.evaluate("() => { window.__avisos = []; }")
        await pg.evaluate("""() => {
          const ev = { dataTransfer: { effectAllowed:'', dropEffect:'',
                                       setData(){} },
                       currentTarget: document.createElement('tr'),
                       preventDefault(){}, stopPropagation(){} };
          filaArrastarInicio(ev, 's1');
          filaArrastarSolta(ev, 's4');   // s4 e' a carga SEM numero
        }""")
        await pg.wait_for_timeout(300)
        avisos2 = await pg.evaluate("() => window.__avisos || []")
        # O detalhe só sai quando REPROVA: uma explicação de falha ao lado de
        # um OK é saída que mente, e já custou uma leitura errada aqui.
        ck('soltar numa linha sem número avisa por quê', len(avisos2) > 0,
           '' if avisos2 else 'o painel ficou mudo — a pessoa conclui que o arrasto está quebrado')
        ck('e o aviso ensina o caminho (fala em digitar o número)',
           any('igit' in a['msg'] for a in avisos2), str(avisos2)[:160])

        print('\n=== 5. NENHUM ERRO DE JAVASCRIPT NO CAMINHO ===')
        ck('sem erro no console', not erros, str(erros)[:200])

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()) or 0)
