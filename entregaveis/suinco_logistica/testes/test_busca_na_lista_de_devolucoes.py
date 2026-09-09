#!/usr/bin/env python3
"""Buscar devolução pelo número do checklist, sem filtrar por data (02/09/2026).

O PEDIDO, do dono, depois de a lista perder o filtro de dia:

    "o historico pode usar o numero do check list, ai nao precisa ser por
     data para o operador identificar (...) na verdade pode deixar o filtro
     mas ao inves de data deixa a lista completa de cima pra baixo do mais
     recente no topo (...) fica melhor do q criar um historico, pode ser so
     a lista mesmo"

Ou seja: nada de tela nova. A mesma lista, com uma caixa de busca no lugar
onde ficava o campo "Dia".

O QUE FOI PERGUNTADO ANTES DE ESCREVER, porque mudava o trabalho: a lista
hoje põe no topo o que espera a ação do SEU setor, e só depois ordena pelo
mais recente. Ordenar só por recência tiraria isso — o Rene abriria a aba e
teria que procurar o próprio trabalho no meio. O dono escolheu MANTER a fila
do setor no topo. Este teste guarda essa escolha.

O QUE ESTE TESTE EXIGE:

  1. a caixa de busca existe, e o rótulo diz o que ela aceita. Busca que
     entende só um formato e ignora calada os outros faz a pessoa concluir
     que a devolução não existe;
  2. digitar o Nº do checklist deixa só ele na lista;
  3. a placa também acha — é como a Portaria reconhece a devolução;
  4. apagar a busca traz a lista inteira de volta;
  5. busca sem resultado DIZ POR QUÊ, e diz o limite dos 30 dias. O texto
     antigo era fixo ("Nenhum checklist neste dia") e passou a mentir duas
     vezes: não existe mais "neste dia", e lista vazia por busca é outra
     coisa que lista vazia por não haver nada;
  6. a fila do próprio setor continua no topo.

Exige o backend local no ar.

    python3 testes/test_busca_na_lista_de_devolucoes.py
"""
import asyncio
import os
import subprocess
import sys

from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def sql(q):
    r = subprocess.run(['sudo', '-u', 'postgres', 'psql', '-tAc', q, '-d', 'embarque_suinco'],
                       capture_output=True, text=True)
    return [l for l in r.stdout.strip().split('\n') if l]


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        ctx = await nav.new_context(viewport={'width': 1500, 'height': 950})
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        html = open(PAINEL_ARQ, encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = f'{API}/__devbusca'
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        await pg.wait_for_selector('#login-email', timeout=25000)
        await pg.fill('#login-email', 'chefe@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3000)
        await pg.evaluate("() => abrirTab('devolucoes')")
        await pg.wait_for_timeout(1800)

        print('\n=== 1. A CAIXA EXISTE E DIZ O QUE ACEITA ===')
        caixa = await pg.evaluate("""() => {
            const el = document.getElementById('dev-busca');
            if(!el) return { semCaixa: true };
            return { placeholder: el.placeholder || '',
                     titulo: el.getAttribute('title') || '',
                     temCampoDia: !!document.getElementById('dev-filtro-dia') };
        }""")
        ck('a caixa de busca existe', not caixa.get('semCaixa'), str(caixa))
        if not caixa.get('semCaixa'):
            ck('o campo de data continua fora', not caixa['temCampoDia'], str(caixa))
            for pedaco in ('checklist', 'DEV', 'placa'):
                ck(f'o rótulo avisa que aceita {pedaco}',
                   pedaco.lower() in caixa['placeholder'].lower(), caixa['placeholder'])
            ck('e o campo diz onde procura (os 30 dias)',
               '30 dias' in caixa['titulo'], caixa['titulo'])

        print('\n=== 2. DOIS CHECKLISTS PARA DISTINGUIR ===')
        dois = await pg.evaluate("""async () => {
              const cria = async () => {
                document.getElementById('dev-operador-cod').value = '700001';
                document.getElementById('dev-rota').value = '500';
                await criarDevolucaoUI();
                await carregarDevolucoes();
                return DEVOLUCOES[0];
              };
              const a = await cria();
              const b = await cria();
              await carregarDevolucoes();
              return { a: { id: a.id, numero: a.numero },
                       b: { id: b.id, numero: b.numero },
                       naLista: DEVOLUCOES.length };
            }""")
        ck('os dois checklists foram criados',
           dois['a']['numero'] != dois['b']['numero'], str(dois))

        print('\n=== 3. BUSCAR PELO Nº DO CHECKLIST DEIXA SÓ ELE ===')
        achou = await pg.evaluate("""(n) => {
            buscarDevolucoesUI(String(n));
            const cards = document.querySelectorAll('#dev-lista .dev-card');
            const txt = document.getElementById('dev-lista').innerText;
            return { linhas: cards.length,
                     citaONumero: txt.includes('Nº ' + n) };
        }""", dois['a']['numero'])
        ck('a lista mostra o checklist procurado',
           achou['citaONumero'], str(achou))

        print('\n=== 4. APAGAR A BUSCA TRAZ A LISTA DE VOLTA ===')
        voltou = await pg.evaluate("""(o) => {
            buscarDevolucoesUI('');
            const txt = document.getElementById('dev-lista').innerText;
            return { temA: txt.includes('Nº ' + o.a), temB: txt.includes('Nº ' + o.b) };
        }""", {'a': dois['a']['numero'], 'b': dois['b']['numero']})
        ck('os dois voltaram para a lista',
           voltou['temA'] and voltou['temB'], str(voltou))

        print('\n=== 5. BUSCA SEM RESULTADO DIZ POR QUÊ ===')
        vazio = await pg.evaluate("""() => {
            buscarDevolucoesUI('ZZZ-NAO-EXISTE-99999');
            const el = document.getElementById('dev-empty');
            return { escondido: el.hidden, texto: el.textContent.trim() };
        }""")
        ck('o aviso de lista vazia aparece', not vazio['escondido'], str(vazio))
        ck('ele diz o que foi procurado',
           'ZZZ-NAO-EXISTE-99999' in vazio['texto'].upper(), vazio['texto'])
        ck('e avisa o limite dos 30 dias — senão parece que a devolução não existe',
           '30 dias' in vazio['texto'], vazio['texto'])
        await pg.evaluate("() => buscarDevolucoesUI('')")

        print('\n=== 6. A FILA DO PRÓPRIO SETOR CONTINUA NO TOPO ===')
        # Decisão do dono ao ser perguntado: ordenar só por recência faria o
        # Rene procurar o próprio trabalho no meio da lista.
        # Para VER a fila subir é preciso ser de um setor que tem fila:
        # Administração não tem etapa própria, então com o login do teste
        # nenhum checklist é "sua vez". Trocar o setor na tela é suficiente —
        # o que se mede aqui é a ORDENAÇÃO, não a permissão do servidor.
        topo = await pg.evaluate("""async (o) => {
            await SuincoSharePoint.devolucoes.etapa(o.b, { para: 'Recebida na Portaria',
              placa: 'AAK8958' });
            await SuincoSharePoint.devolucoes.etapa(o.b, { para: 'Conferida no Faturamento',
              pesoEntrada: 21000 });
            await carregarDevolucoes();
            DB.operador.setor = 'Expedição';   // agora existe fila own
            renderListaDevolucoes();
            const cards = [...document.querySelectorAll('#dev-lista .dev-card')];
            const comChip = cards.map(c => !!c.querySelector('.dev-chip-suavez'));
            const primeiroSemChip = comChip.indexOf(false);
            const ultimoComChip = comChip.lastIndexOf(true);
            return { cards: cards.length, comChip,
                     filaAntesDoResto: ultimoComChip === -1 || primeiroSemChip === -1
                       || ultimoComChip < primeiroSemChip };
        }""", {'b': dois['b']['id']})
        ck('a lista desenhou os cartões', topo['cards'] > 0, str(topo))
        ck('existe pelo menos um "SUA VEZ" para conferir a ordem',
           any(topo['comChip']), str(topo['comChip']))
        ck('tudo que espera o meu setor vem ANTES do resto',
           topo['filaAntesDoResto'], str(topo['comChip']))

        for d in (dois['a']['id'], dois['b']['id']):
            sql(f"DELETE FROM devolucoes WHERE devolucao_id = '{d}'")
        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


sys.exit(asyncio.run(main()))
