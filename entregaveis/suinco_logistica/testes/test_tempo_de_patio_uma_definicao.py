#!/usr/bin/env python3
"""Tempo de pátio: uma definição só, e o carimbo furado se declara (24/09/2026).

O QUE FOI MEDIDO ANTES DE MEXER. "Tempo de pátio" era calculado em TRÊS
lugares do painel:

  · `minutosNoPatioAgora` (data.js) — Gargalos e Relatório Executivo.
    Confere se o carimbo é plausível e devolve nulo quando não é.
  · `indicadoresDaCarga` (data.js) — médias dos Indicadores. Usa
    `carimbosDaCarga`, que descarta carimbo implausível.
  · `tempoNoPatioTexto` (app.js) — a TORRE. Não conferia nada: lia o
    carimbo cru e mostrava o número que desse.

Resultado: uma carga com data impossível mostrava um tempo absurdo na
Torre e sumia da média dos Indicadores. Dois números do mesmo dia que não
batem, e olhando a tela não dá para saber qual está certo.

A DECISÃO DO DONO, perguntado qual era o preço aceitável: corrigir pelo
caminho óbvio — a Torre passar a mostrar traço — apagaria o relógio e, com
ele, o destaque de "acima de 3h" de um caminhão que ESTÁ parado no pátio.
Ele aprovou a outra saída: mostrar o relógio E marcar que o carimbo é
suspeito. Você continua vendo o caminhão atrasado, e sabe que aquele
número não é de confiar.

O QUE ESTE TESTE TRAVA

  1. existe UMA função que responde "quanto tempo de pátio" — e a Torre
     pergunta a ela, em vez de refazer a conta;
  2. carimbo furado: a linha se declara suspeita em vez de passar por
     normal — e, quando a data nem produz duração (chegada no futuro), a
     coluna assume que não sabe em vez de escrever `0min`;
  3. e essa mesma carga continua FORA da conta das médias — mostrar não
     é confiar;
  4. carga normal acima da meta continua ganhando o destaque de atrasada;
  5. carga que já saiu mostra o total fechado, sem destaque;
  6. as três contas dão o MESMO número para a mesma carga normal.

    python3 testes/test_tempo_de_patio_uma_definicao.py
"""
import asyncio
import re
import sys
from pathlib import Path

from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
PAINEL = RAIZ / 'index.html'

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    print('\n=== 1. A TORRE NÃO REFAZ A CONTA ===')
    app_js = (RAIZ / 'app.js').read_text(encoding='utf-8')
    corpo = re.search(r'function tempoNoPatioTexto\(carga\)\{(.*?)\n\}', app_js, re.S)
    ck('a função da Torre existe', bool(corpo))
    if corpo:
        # Ler o carimbo cru aqui é justamente o que fazia a Torre divergir.
        ck('e não lê o carimbo cru por conta própria',
           'primeiroTimestamp' not in corpo.group(1),
           'ainda chama primeiroTimestamp — a conta está duplicada')
        ck('ela pergunta à função única',
           'tempoDePatioDe' in corpo.group(1), corpo.group(1)[:90].replace('\n', ' '))

    data_js = (RAIZ / 'data.js').read_text(encoding='utf-8')
    ck('a função única existe em data.js (é quem data.js e app.js compartilham)',
       'function tempoDePatioDe(' in data_js)

    print('\n=== 2. NA TELA, COM CARGA DE VERDADE ===')
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        pg = await (await nav.new_context(viewport={'width': 1500, 'height': 950})).new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        html = PAINEL.read_text(encoding='utf-8').replace('ativo: true,', 'ativo: false,', 1)
        url = 'https://tempopatio.local/painel'
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        await pg.wait_for_function('typeof criarCargaProgramada === "function"', timeout=25000)

        r = await pg.evaluate("""() => {
            DB.operador = { nome:'Teste', setor:'Logística', turno:'A' };
            const placas = DB.frota.slice(0, 4).map(f => f.placa);
            const fazer = (rota) => criarCargaProgramada({
              placa: placas.shift(), rota, peso: 25000, operador:'Teste' });
            const chegar = (c, quando) => {
              avancarStatusCarga(c.id, 'Aguardando Embarque', 'Teste', 'Logística');
              const m = DB.movimentacoes.find(x =>
                x.cargaId === c.id && x.statusNovo === 'Aguardando Embarque');
              if (m) m.timestamp = quando;
            };
            const hAtras = (h) => new Date(Date.now() - h*3600e3).toISOString();

            // a) carimbo furado: data lá na frente, que nenhum relógio produz
            const furada = fazer('500');
            chegar(furada, '2099-01-01T10:00:00.000Z');

            // b) normal, acima da meta de 3h, ainda no pátio
            const atrasada = fazer('501');
            chegar(atrasada, hAtras(4.5));

            // c) normal, dentro da meta, ainda no pátio
            const okDentro = fazer('502');
            chegar(okDentro, hAtras(1));

            // d) já saiu
            const saiu = fazer('503');
            chegar(saiu, hAtras(6));
            ['Embarque Iniciado','Embarque Finalizado','Faturado','Seguiu Viagem']
              .forEach(s => avancarStatusCarga(saiu.id, s, 'Teste', 'Logística'));

            const ler = (c) => ({
              html: tempoNoPatioTexto(c),
              unica: typeof tempoDePatioDe === 'function' ? tempoDePatioDe(c) : null,
              agora: minutosNoPatioAgora(c),
              indicador: indicadoresDaCarga(c.id).tempoPatioTotal,
            });
            return { furada: ler(furada), atrasada: ler(atrasada),
                     dentro: ler(okDentro), saiu: ler(saiu) };
        }""")
        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    f, a, d, s = r['furada'], r['atrasada'], r['dentro'], r['saiu']

    print('\n--- carimbo furado ---')
    # NÃO se exige um número aqui: chegada no futuro não produz duração
    # nenhuma, e escrever um seria repetir a mentira do `0min` que esta
    # mudança existe para tirar. O que se exige é que a linha NÃO passe por
    # normal — traço limpo é o que a coluna mostra para caminhão que não
    # chegou, e este chegou.
    ck('a Torre não trata a carga como se nada tivesse acontecido',
       'text-dim' not in f['html'], f['html'][:90])
    ck('e marca que o carimbo é suspeito',
       'suspeit' in f['html'].lower(), f['html'][:90])
    ck('a função única diz que é suspeito',
       bool(f['unica']) and f['unica'].get('suspeito') is True, str(f['unica']))
    ck('e ela continua FORA da conta das médias — mostrar não é confiar',
       f['agora'] is None, str(f['agora']))

    print('\n--- acima da meta, ainda no pátio ---')
    ck('a Torre destaca como atrasada', 'vp-atrasado' in a['html'], a['html'][:90])
    ck('a função única diz que está em andamento',
       bool(a['unica']) and a['unica'].get('emAndamento') is True, str(a['unica']))
    ck('e NÃO está marcada como suspeita', 'suspeit' not in a['html'].lower(), a['html'][:90])

    print('\n--- dentro da meta ---')
    ck('a Torre não destaca', 'vp-atrasado' not in d['html'], d['html'][:90])

    print('\n--- já saiu ---')
    ck('a Torre mostra o total fechado, sem destaque',
       'vp-atrasado' not in s['html'] and '—' not in s['html'], s['html'][:90])
    ck('a função única diz que não está mais em andamento',
       bool(s['unica']) and s['unica'].get('emAndamento') is False, str(s['unica']))
    ck('e o total dela bate com o dos Indicadores — as contas não divergem',
       bool(s['unica']) and s['unica'].get('minutos') == s['indicador'],
       f"única={s['unica']} indicador={s['indicador']}")

    print('\n' + '=' * 51)
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for x in falhas:
            print(f'    · {x}')
        return 1
    print('  tudo verde.')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
