#!/usr/bin/env python3
"""Digitou 1, a carga entra na frente e as outras descem (08/09/2026).

PEDIDO DO WEMERSON, trazido pelo dono: "se ele digitar 1 numa carga e já
tiver uma como 1, ela vai automaticamente pra dois, e a que ele colocou 1
entra no início da fila. Ou uma forma de arrastar cada carga pro lugar do
sequenciamento desejado".

ANTES DISTO a sequência era um número solto: duas cargas podiam ser 1 ao
mesmo tempo, e o campo dizia "digite o número que quiser, a qualquer
momento".

ESCOLHA DO DONO, perguntado: renumera só as cargas que AINDA VÃO CARREGAR.

O QUE ESTE TESTE EXIGE:
  1. a alça de arrastar existe e a linha é arrastável;
  2. digitar uma posição chama o servidor — e não grava número solto;
  3. arrastar e digitar terminam na MESMA função (uma conta só);
  4. sem servidor, a tela diz que não deu em vez de fingir que deu.

Roda sem servidor.

    python3 testes/test_fila_reordena_em_cascata.py
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


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(1400)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(900)
        await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = [];
            for (let i = 1; i <= 4; i++) {
              criarCargaProgramada({ placa: DB.frota[i].placa, numeroCarga: '90' + i,
                transportadora: 'T', tipoVeiculo: 'Truck', peso: 9000, rota: '500',
                sequencia: i, praOnde: 'ENTREGA DIRETA', paletizada: 'Não',
                qtdGanchos: 0, qtdEntregas: 1, motorista: 'M', observacoes: '',
                operador: DB.operador });
            }
            SuincoStore.save(); abrirTab('programacao'); renderAll();
        }""")
        await pg.wait_for_timeout(900)

        print('\n=== 1. A FILA PODE SER ARRASTADA ===')
        arrasto = await pg.evaluate("""() => {
            const tr = document.querySelector('#prog-fila-tbody tr[data-carga]');
            if (!tr) return null;
            return { arrastavel: tr.getAttribute('draggable') === 'true',
                     temAlca: !!tr.querySelector('.alca-arrastar'),
                     temDragStart: !!tr.getAttribute('ondragstart'),
                     temDrop: !!tr.getAttribute('ondrop'),
                     temId: !!tr.dataset.carga };
        }""")
        ck('a linha da fila é arrastável', arrasto and arrasto['arrastavel'], str(arrasto))
        ck('tem alça visível (arrastar sem sinal ninguém descobre)',
           arrasto and arrasto['temAlca'])
        ck('tem início e solta de arrasto',
           arrasto and arrasto['temDragStart'] and arrasto['temDrop'])
        ck('a linha carrega o id da carga, para saber a posição de destino',
           arrasto and arrasto['temId'])

        print('\n=== 2. UMA CONTA SÓ: ARRASTAR E DIGITAR VÃO PARA O MESMO LUGAR ===')
        # Duas contas de posição divergem no primeiro caso de borda — e o caso
        # de borda aqui é a fila do dia de embarque.
        uma_so = await pg.evaluate("""() => {
            const f = (fn) => (typeof window[fn] === 'function') ? window[fn].toString() : '';
            const app = document.documentElement.innerHTML;
            return { soltaChamaMover: /moverNaFilaUI/.test(f('filaArrastarSolta')),
                     digitarChamaMover: /moverNaFilaUI/.test(f('definirPosicaoNaFilaUI')),
                     moverExiste: typeof window.moverNaFilaUI === 'function',
                     torreNaoEntraNaFila: !/moverNaFilaUI/.test(f('atualizarSequenciaUI')),
                     torreCarimba: /atualizadoEm/.test(f('atualizarSequenciaUI')) };
        }""")
        ck('existe uma função só de mover na fila', uma_so and uma_so['moverExiste'])
        ck('arrastar chama ela', uma_so and uma_so['soltaChamaMover'], str(uma_so))
        ck('digitar na Fila chama ela', uma_so and uma_so['digitarChamaMover'], str(uma_so))

        # A GUARDA DESTA REGRESSÃO (08/09/2026).
        #
        # A Torre de Controle e a Fila escrevem no MESMO campo querendo coisas
        # diferentes: na Torre a sequência é livre (vale 7 numa lista de 2), na
        # Fila é posição, e o servidor renumera de 1 a N. Mandei as duas para
        # moverNaFilaUI achando que era a mesma decisão. Não era — a Torre
        # parou de guardar o número digitado e o defeito de 14/08 voltou:
        # "alterei três vezes e ela não se mantém na torre de controle".
        #
        # Estas duas linhas travam os dois lados: a Torre não pode cair na
        # fila, e não pode perder o carimbo que faz a edição subir.
        ck('a Torre NÃO passa pela fila — sequência livre continua livre',
           uma_so and uma_so['torreNaoEntraNaFila'], str(uma_so))
        ck('a Torre continua carimbando a carga como alterada',
           uma_so and uma_so['torreCarimba'], str(uma_so))

        print('\n=== 3. SEM SERVIDOR, A TELA DIZ QUE NÃO DEU ===')
        # A ordem depende de ler a fila inteira no momento da decisão. Guardada
        # para subir depois, seria aplicada sobre uma fila que já mudou — e o
        # resultado seria uma ordem que ninguém pediu.
        avisos = await pg.evaluate("""async () => {
            const vistos = [];
            const orig = window.notify;
            window.notify = (msg, tipo) => { vistos.push(String(msg)); };
            const id = DB.cargas[3].id;
            const seqAntes = DB.cargas.map(c => c.sequencia).join(',');
            await window.moverNaFilaUI(id, 1);
            window.notify = orig;
            return { vistos, seqAntes, seqDepois: DB.cargas.map(c => c.sequencia).join(',') };
        }""")
        ck('avisa que sem servidor a ordem não muda',
           any('servidor' in v.lower() for v in avisos['vistos']), str(avisos['vistos'])[:120])
        ck('e NÃO mexe na sequência local por conta própria',
           avisos['seqAntes'] == avisos['seqDepois'],
           f"antes {avisos['seqAntes']} · depois {avisos['seqDepois']}")

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


sys.exit(asyncio.run(main()))
