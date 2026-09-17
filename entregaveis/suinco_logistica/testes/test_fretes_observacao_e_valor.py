#!/usr/bin/env python3
"""A coluna de Observações do relatório de Fretes carrega dinheiro, não rótulo.

RELATO DO DONO (17/09/2026): "no relatorio de administracao de fretes comecou
a sair a operadora no lugar das observacoes, que deve sair ou a observacao
colocada pelo programador com o valor do frete combinado, ou o nome do destino
mais valor do frete calculado pelo painel".

As duas opções que ele deu terminam num VALOR. Esta coluna é onde quem confere
pagamento lê quanto a viagem custou e de onde veio o número — ou foi combinado
com a transportadora e está escrito por quem negociou, ou o painel calculou
pelo km, e aí quem responde é o destino.

A CAUSA, com as duas datas:

  25/08  `app.js` passou a colar o apelido da rota NA FRENTE da observação
         quando a linha da Montagem vira carga, com intenção certa: "quem lê
         a carga na Torre precisa saber que 517 é a Ômega".
  14/09  a lista de operadores do gestor foi aplicada às rotas. O apelido do
         modelo é "Destino - Operadora"; o campo, que vivia vazio, passou a
         ter conteúdo em quase toda rota.

Daí o "começou a sair": o código é de agosto, o sintoma é de setembro. O
operador já era derivável da rota (`rotaOperador()`, e `rotaApoio()` já o
desenha no impresso) — a cópia colada não só duplicava a decisão, ela APAGAVA
o campo do outro dono.

O QUE ESTE TESTE TRAVA:

  1. observação escrita pela pessoa aparece inteira, e sozinha;
  2. sem observação, sai destino + valor calculado, em reais;
  3. sem observação e sem valor, sai destino + o MOTIVO de não haver valor —
     célula vazia ao lado de um destino é lida como "o sistema não sabe" e
     manda alguém perguntar (mesma decisão de `freteMontagemHtml`);
  4. a carga que nasce da Montagem NÃO recebe mais o apelido da rota colado
     na observação (conferência de código, declarada como tal).

    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
        python3 testes/test_fretes_observacao_e_valor.py
    # contra o que está no ar (tem de REPROVAR):
    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
        python3 testes/test_fretes_observacao_e_valor.py --painel /tmp/publicado.html
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


# Três cargas com as três formas que a coluna tem de saber tratar.
SEMEAR = """() => {
  DB.cargas = []; DB.movimentacoes = [];
  const base = {placa:'ABC1D23', rota:'500', peso:12000, status:'Seguiu Viagem',
                criadoEm:new Date().toISOString(), qtdEntregas:1};
  DB.cargas.push({...base, id:'f1', numeroCarga:'9001',
    observacoes:'Combinado R$ 2.450,00 com a transportadora',
    freteDestino:'RIBEIRAO PRETO', freteValor:1800.5, freteMotivo:''});
  DB.cargas.push({...base, id:'f2', numeroCarga:'9002',
    observacoes:'', freteDestino:'MARILIA', freteValor:1234.56, freteMotivo:''});
  DB.cargas.push({...base, id:'f3', numeroCarga:'9003',
    observacoes:'', freteDestino:'BAHIA CAPITAL', freteValor:null,
    freteMotivo:'Transportadora sem tarifa cadastrada.'});
  return DB.cargas.length;
}"""

LER = """() => {
  const d = dadosAdministracaoFretes(DB.cargas);
  const por = {};
  d.forEach(l => { por[l.numeroCarga] = l.observacoes; });
  return por;
}"""


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--painel', default=str(BASE / 'index.html'))
    args = ap.parse_args()
    painel = pathlib.Path(args.painel)
    print(f'\n  medindo: {painel}')

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROMIUM)
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        await pg.goto(f'file://{painel}')
        await pg.wait_for_function('typeof dadosAdministracaoFretes === "function"',
                                   timeout=25000)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(400)
        await pg.evaluate(SEMEAR)
        col = await pg.evaluate(LER)
        await nav.close()

    print('\n=== 1. A OBSERVAÇÃO DE QUEM NEGOCIOU APARECE INTEIRA ===')
    ck('a nota do programador sai como foi escrita',
       col.get('9001') == 'Combinado R$ 2.450,00 com a transportadora',
       repr(col.get('9001')))

    print('\n=== 2. SEM OBSERVAÇÃO, SAI DESTINO + VALOR CALCULADO ===')
    v = col.get('9002') or ''
    ck('cita o destino', 'MARILIA' in v, repr(v))
    ck('cita o valor em reais, no formato do país', 'R$ 1.234,56' in v, repr(v))

    print('\n=== 3. SEM VALOR, A CÉLULA DIZ POR QUÊ ===')
    m = col.get('9003') or ''
    ck('cita o destino', 'BAHIA CAPITAL' in m, repr(m))
    ck('explica a ausência em vez de ficar vazia',
       'tarifa' in m.lower(), repr(m))

    print('\n=== 4. O APELIDO DA ROTA NÃO É MAIS COLADO NA OBSERVAÇÃO ===')
    # Conferência de CÓDIGO, e está declarada como tal: o caminho que cria a
    # carga a partir da Montagem passa pelo servidor e por uma linha de
    # modelo, e montá-lo aqui custaria mais do que prova. O que importa é
    # que a cola não exista — se ela voltar, volta o defeito inteiro.
    #
    # LÊ O PAINEL QUE ESTÁ SENDO MEDIDO, não o `app.js` do checkout. A
    # primeira versão lia o arquivo local e por isso dava OK mesmo rodando
    # contra o publicado — a mesma armadilha da ocorrência que este dia já
    # rendeu: referência que não acompanha o alvo não prova nada. O
    # `index.html` embute o `app.js`, então a busca vale para qualquer
    # painel que se aponte.
    fonte = painel.read_text(encoding='utf-8')
    colado = 'apelido_rota, m.observacoes' in fonte
    # O detalhe só sai quando REPROVA: `ck` imprime o que receber, e uma
    # explicação de falha ao lado de um OK é saída que mente.
    ck('o painel medido não junta apelido_rota com observacoes', not colado,
       'a cola de 25/08 está neste painel' if colado else '')

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()) or 0)
