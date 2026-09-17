#!/usr/bin/env python3
"""A sobra não conseguia ser finalizada por ninguém na tela (16/09/2026).

O RELATO, do dono, com print junto:

    "E NA PARTE DEVOLUÇÃO DE SOBRA, DEPOIS QUE PESA TEM QUE COLOCAR A
     OPÇÃO DE FINALIZAR A ETAPA"

O print: sobra SIY0G41 / LEONARDO, carimbos PORTARIA e BALANÇA (ENTRADA)
dados, EXPEDIÇÃO pendente, o texto "Próximo passo: Descarga Conferida —
feito por Expedição ou Logística" e NENHUM botão. Ele estava logado como
`Joao Pedro Pernambuco · Faturamento`.

SÃO DOIS DEFEITOS, e os dois têm a mesma família — a mesma decisão escrita
em dois lugares (ocorrência #14, e a #26 com cinco lugares).

DEFEITO 1 — o botão que a tela desenha não é o que o clique manda.
`blocoAvancoDev` pergunta a `etapaDeDev(d)`, que CONHECE o atalho da sobra
(de "Conferida no Faturamento" ela vai direto para "Descarga Conferida",
sem a balança final). `avancarEtapaDevolucaoUI` não perguntava: fazia
`DEV_ETAPAS.find(...)` por conta própria, e DEV_ETAPAS só conhece o caminho
da devolução NORMAL. Resultado: a Expedição via o botão "Descarga
conferida", clicava, e o painel mandava `para: 'Peso Final Registrado'` —
que o servidor recusa com 409 ETAPA_NAO_EXISTE_PARA_SOBRA. A sobra não era
finalizável por NINGUÉM pela tela: nem Expedição, nem Logística, nem
Administração.

DEFEITO 2 — quem pesou não podia encerrar. Para a sobra, o OK da Expedição
é o ÚLTIMO passo, e ele estava liberado só para Expedição e Logística. O
Faturamento acabava de pesar, a esteira dele dizia "SUA VEZ" (porque
"Conferida no Faturamento" é o status da segunda etapa dele na devolução
normal) e a devolução ficava parada esperando outro setor aparecer. Decisão
do dono: quem pesou finaliza a sobra.

O QUE ESTE TESTE TRAVA, na TELA (o servidor tem a suíte 19):

  1. o Faturamento vê o botão de FINALIZAR a sobra depois de pesar;
  2. o clique finaliza de verdade — a sobra vai para "Descarga Conferida";
  3. a Expedição continua finalizando a sobra (nada foi tirado dela);
  4. a devolução NORMAL não ganhou atalho: no mesmo status, o Faturamento
     continua indo para a balança final, não para o fim;
  5. a allowlist do atalho da sobra na tela é EXATAMENTE a do servidor —
     lida do próprio arquivo de domínio, não copiada à mão aqui;
  6. recusa do servidor não é silenciosa: quem não pode agir lê o motivo.

Exige o backend local no ar e os operadores de teste.

    python3 testes/test_sobra_finaliza_quem_pesou.py
"""
import asyncio
import io
import os
import re
import sys

from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
# Caminho tirado do próprio arquivo do teste: a bateria roda tanto no
# checkout principal quanto num worktree, e caminho absoluto fixo faria a
# suíte medir o index.html de OUTRA branch — vermelho (ou verde) que não
# diz nada sobre o código que está sendo entregue.
AQUI = os.path.dirname(os.path.abspath(__file__))
PAINEL_ARQ = os.path.join(AQUI, '..', 'index.html')
DOMINIO = os.path.join(AQUI, '..', 'backend', 'src', 'dominio', 'devolucoes.js')
PAINEL_JS = os.path.join(AQUI, '..', 'devolucoes.js')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def esteira_do_servidor():
    """TRANSICOES_DEV lida de dominio/devolucoes.js, sem subir API nem banco.

    Devolve {(de, para, soSobra): (carimbo, [setores])}. É comparação de
    FONTE porque é na fonte que as duas listas divergem: o painel é build de
    arquivo único e não consegue importar do servidor, então a cópia é
    inevitável — o que não pode é ela envelhecer calada. Mesma solução da
    lista de SETORES (test_setor_novo_aparece_nas_telas.py, ocorrência #26).
    """
    fonte = io.open(DOMINIO, encoding='utf-8').read()
    i = fonte.index('const TRANSICOES_DEV = [')
    bloco = fonte[i:fonte.index('\n];', i)]
    bloco = re.sub(r'/\*.*?\*/', '', bloco, flags=re.S)
    esteira = {}
    for linha in bloco.splitlines():
        m = re.search(r"de:\s*'([^']+)'.*?para:\s*'([^']+)'.*?setores:\s*\[(.*?)\]"
                      r".*?carimbo:\s*'([^']+)'", linha)
        if not m:
            continue
        setores = [s.strip().strip("'\"") for s in m.group(3).split(',')]
        esteira[(m.group(1), m.group(2), 'soSobra: true' in linha)] = (m.group(4), setores)
    return esteira


async def abrir(nav, email, rotulo):
    ctx = await nav.new_context()
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__painel_sobra_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_timeout(1000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    return ctx, pg


async def ver_devolucoes(pg):
    await pg.evaluate("() => abrirTab('devolucoes')")
    await pg.wait_for_timeout(400)
    await pg.evaluate("async () => { await carregarDevolucoes(); }")
    await pg.wait_for_timeout(900)


async def status_de(pg, ident):
    await pg.evaluate("async () => { await carregarDevolucoes(); }")
    await pg.wait_for_timeout(600)
    return await pg.evaluate("(id) => (getDevolucao(id) || {}).status || '(sumiu da lista)'",
                             ident)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        ctxA, pgA = await abrir(nav, 'chefe@teste.local', 'adm')
        setor = await pgA.evaluate("() => DB.operador && DB.operador.setor")
        if setor != 'Administração':
            ck('admin logado', False, str(setor))
            await nav.close()
            return 1

        async def nova(passos, tipo='SOBRA'):
            """Cria e leva a devolução até onde o teste precisa, pela API.

            A 510 é rota do cadastro oficial (seed.js) — a sobra não usa
            rota nenhuma, e a devolução normal precisa de uma que EXISTA.
            """
            return await pgA.evaluate("""async ([passos, tipo]) => {
              const hoje = new Date().toISOString().slice(0,10);
              const d = await SuincoSharePoint.devolucoes.criar({
                dataDev: hoje, tipo,
                regiao: tipo === 'SOBRA' ? '' : 'SOBRATESTE',
                rotas: tipo === 'SOBRA' ? [] : ['510'],
                placa: 'SIY0G41', motorista: 'LEONARDO', transportadora: 'Suinco',
                notaTransferencia: 'SOBR' + Date.now(),
                itens: [],
              });
              for (const para of passos) {
                await SuincoSharePoint.devolucoes.etapa(d.id, { para });
              }
              return d.id;
            }""", [passos, tipo])

        print('\n=== 1. DEPOIS DE PESAR, O FATURAMENTO TEM COMO FINALIZAR A SOBRA ===')
        id1 = await nova(['Recebida na Portaria', 'Conferida no Faturamento'])
        ctxF, pgF = await abrir(nav, 'diego@teste.local', 'fat')
        setorF = await pgF.evaluate("() => DB.operador && DB.operador.setor")
        ck('Faturamento logado', setorF == 'Faturamento', str(setorF))
        await ver_devolucoes(pgF)

        # A esteira JÁ chamava o Faturamento para esta sobra ("SUA VEZ"):
        # "Conferida no Faturamento" é o status da segunda etapa dele na
        # devolução normal. Chamar e não dar botão é o defeito relatado.
        chamado = await pgF.evaluate("(id) => ehMinhaVezDev(getDevolucao(id))", id1)
        ck('a esteira chama o Faturamento para esta sobra', chamado is True, str(chamado))

        bloco = await pgF.evaluate("""(id) => {
          const d = getDevolucao(id);
          return d ? blocoAvancoDev(d) : '(devolução não chegou ao painel)';
        }""", id1)
        ck('o Faturamento vê um BOTÃO, não só o texto do próximo passo',
           '<button' in bloco, bloco[:160])
        ck('o botão fala em FINALIZAR a sobra',
           'inaliz' in bloco.lower(), bloco[:160])

        print('\n=== 2. O CLIQUE FINALIZA DE VERDADE ===')
        await pgF.evaluate("(id) => avancarEtapaDevolucaoUI(id)", id1)
        await pgF.wait_for_timeout(1800)
        st = await status_de(pgF, id1)
        ck('a sobra foi para "Descarga Conferida"', st == 'Descarga Conferida', st)
        fim = await pgF.evaluate("(id) => blocoAvancoDev(getDevolucao(id))", id1)
        ck('e a tela diz que a sobra está concluída', 'concluída' in fim, fim[:140])

        print('\n=== 3. A EXPEDIÇÃO CONTINUA FINALIZANDO A SOBRA ===')
        id2 = await nova(['Recebida na Portaria', 'Conferida no Faturamento'])
        ctxE, pgE = await abrir(nav, 'carla@teste.local', 'exp')
        setorE = await pgE.evaluate("() => DB.operador && DB.operador.setor")
        ck('Expedição logada', setorE == 'Expedição', str(setorE))
        await ver_devolucoes(pgE)
        blocoE = await pgE.evaluate("(id) => blocoAvancoDev(getDevolucao(id))", id2)
        ck('a Expedição vê o botão', '<button' in blocoE, blocoE[:160])
        await pgE.evaluate("(id) => avancarEtapaDevolucaoUI(id)", id2)
        await pgE.wait_for_timeout(1800)
        st2 = await status_de(pgE, id2)
        ck('e o clique dela também finaliza (era 409 antes)',
           st2 == 'Descarga Conferida', st2)

        print('\n=== 4. A DEVOLUÇÃO NORMAL NÃO GANHOU ATALHO ===')
        id3 = await nova(['Recebida na Portaria', 'Conferida no Faturamento'],
                         tipo='DEVOLUCAO')
        await ver_devolucoes(pgF)
        etapa = await pgF.evaluate("(id) => etapaDeDev(getDevolucao(id)).proxima", id3)
        ck('no mesmo status, a devolução normal vai para a BALANÇA FINAL',
           etapa == 'Peso Final Registrado', str(etapa))
        await pgF.evaluate("(id) => avancarEtapaDevolucaoUI(id)", id3)
        await pgF.wait_for_timeout(1800)
        st3 = await status_de(pgF, id3)
        ck('e o clique do Faturamento registra o peso final, não o fim do ciclo',
           st3 == 'Peso Final Registrado', st3)

        print('\n=== 5. UMA DECISÃO, UM LUGAR: A TELA ESPELHA O SERVIDOR ===')
        servidor = esteira_do_servidor()
        ck('li a esteira do domínio do servidor', len(servidor) == 7,
           f'{len(servidor)} transições')

        tela_bruta = await pgF.evaluate("""() => [
          ...DEV_ETAPAS.map((e) => [e.status, e.proxima, false, e.pede, e.setores]),
          [DEV_ATALHO_SOBRA.status, DEV_ATALHO_SOBRA.proxima, true,
           DEV_ATALHO_SOBRA.pede, DEV_ATALHO_SOBRA.setores],
        ]""")
        tela = {(de, para, so): (carimbo, setores)
                for de, para, so, carimbo, setores in tela_bruta}

        so_no_servidor = sorted(set(servidor) - set(tela))
        so_na_tela = sorted(set(tela) - set(servidor))
        ck('a tela conhece exatamente as transições do servidor',
           not so_no_servidor and not so_na_tela,
           f'só no servidor={so_no_servidor} só na tela={so_na_tela}')

        divergentes = [f'{k}: servidor={servidor[k]} tela={tela[k]}'
                       for k in sorted(set(servidor) & set(tela)) if servidor[k] != tela[k]]
        ck('e, em cada uma, o carimbo e a allowlist são os MESMOS nos dois lados',
           not divergentes, ' ;; '.join(divergentes)[:300])

        chave_atalho = ('Conferida no Faturamento', 'Descarga Conferida', True)
        atalho_srv = servidor.get(chave_atalho)
        atalho_tela = tela.get(chave_atalho)
        ck('o Faturamento finaliza a sobra nos dois lados',
           atalho_srv is not None and atalho_tela is not None
           and 'Faturamento' in atalho_srv[1] and 'Faturamento' in atalho_tela[1],
           f'servidor={atalho_srv} tela={atalho_tela}')

        # E o atalho continua sendo SÓ da sobra: na devolução normal, o passo
        # que sai de "Peso Final Registrado" não ganhou o Faturamento.
        normal = servidor.get(('Peso Final Registrado', 'Descarga Conferida', False))
        ck('a devolução normal NÃO ganhou o Faturamento neste passo',
           normal is not None and 'Faturamento' not in normal[1], str(normal))

        print('\n=== 6. QUEM NÃO PODE AGIR LÊ O MOTIVO, NÃO UM ERRO SECO ===')
        id4 = await nova(['Recebida na Portaria', 'Conferida no Faturamento'])
        ctxN, pgN = await abrir(nav, 'dev.notas@devteste.local', 'notas')
        await ver_devolucoes(pgN)
        blocoN = await pgN.evaluate("(id) => blocoAvancoDev(getDevolucao(id))", id4)
        ck('a Central de Notas não vê botão, e lê quem faz o passo',
           '<button' not in blocoN and 'Próximo passo' in blocoN, blocoN[:160])
        recado = await pgN.evaluate("""async (id) => {
          const ditos = [];
          const orig = window.notify;
          window.notify = (m) => { ditos.push(String(m)); };
          try {
            await acaoDev(SuincoSharePoint.devolucoes.etapa(id, { para: 'Descarga Conferida' }));
          } finally { window.notify = orig; }
          return ditos.join(' | ');
        }""", id4)
        ck('e, se ela forçar, a recusa do servidor aparece na tela com o porquê',
           'não registra' in recado and 'Quem faz esse passo' in recado, recado[:200])
        await ctxN.close()

        await ctxE.close()
        await ctxF.close()
        await ctxA.close()
        await nav.close()

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + '; '.join(falhas))
        return 1
    print('Tudo certo: a sobra é finalizável por quem pesou, e só ela.')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
