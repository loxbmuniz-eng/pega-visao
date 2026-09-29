#!/usr/bin/env python3
"""Destino novo cadastrado na Tabela de Frete funciona em todo lugar (29/09/2026).

RELATO DO DONO: "cadastrar destino precisa ser possível no cadastro e o
destino precisa funcionar, pois precisamos às vezes colocar destinos novos e
fazer o cálculo, e isso está nos impedindo" — e, perguntado onde travava,
"resolve em tudo".

REPRODUZIDO (servidor de teste E réplica do servidor de produção 956442a):
o cadastro grava. Onde o destino novo NÃO chegava, ou chegava errado:

  1. Montagem do Dia, "Adicionar carga": a lista de destino vinha só do
     modelo da semana e do cadastro da ROTA. O destino que a Logística acabou
     de cadastrar na Tabela de Frete não aparecia, e a linha nascia sem
     destino de frete, sem KM e sem valor.
  2. Programação e Completar: o destino digitado à mão ia para o servidor
     como foi digitado ("goiania"). O servidor procura o KM pelo nome exato
     (`WHERE destino = $1`) e a tabela guarda em maiúscula — sem KM na carga.
     A tela mostrava o KM (ela compara em maiúscula) e o servidor não: a tela
     e o registro discordavam.
  3. Tabela de Frete: a mensagem de "salvo" repetia o KM digitado, não o que
     o servidor gravou. Com o servidor ainda sem a migração 056, "123,45" é
     gravado 123 — e a tela dizia 123,45.

Não precisa do servidor: troca as chamadas de rede por dublês e lê o que
iria para lá. Dados inventados e marcados (DESTINO NOVO TESTE).

    python3 testes/test_destino_novo_em_todo_lugar.py
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
PAINEL = 'file://' + os.path.join(os.path.dirname(AQUI), 'index.html')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


PREPARAR = """() => {
  DB.operador = {nome:'Teste', setor:'Logística'};
  document.getElementById('modal-operador')?.classList.remove('open');
  receberTabelaDeFrete({
    tarifas: [{tipoVeiculo:'Truck', valorPorKm:7.75, operador:'TESTE'}],
    destinos: [
      {destino:'GOIANIA', km:583, operador:'TESTE'},
      {destino:'DESTINO NOVO TESTE', km:321, operador:'TESTE'},
    ],
  });
  preencherSelectsDestinoFrete();
  renderAll();
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(PREPARAR)

        print('\n=== 1. MONTAGEM DO DIA — "ADICIONAR CARGA" ===')
        m = await pg.evaluate("""async () => {
          const selRota = document.getElementById('mont-rota-extra');
          if(!selRota.options.length){
            selRota.innerHTML = rotasParaEscolher().map(r =>
              `<option value="${esc(r.codigo)}">${esc(rotaLabel(r.codigo))}</option>`).join('');
          }
          selRota.value = selRota.options[0].value;
          popularDestinoExtraUI();
          const sel = document.getElementById('mont-destino-extra');
          const opcoes = [...sel.options].map(o => o.value);
          let enviado = null;
          _montagemDia = { dia: '2026-09-29', montagens: [] };
          SuincoSharePoint.montagem.criar = async (corpo) => { enviado = corpo; return {}; };
          window.carregarMontagemUI = async () => {};
          sel.value = 'DESTINO NOVO TESTE';
          await adicionarCargaForaDoModeloUI();
          return { opcoes, escolhido: sel.value, enviado };
        }""")
        print('  ', {k: (v if k != 'opcoes' else len(v)) for k, v in m.items()})
        ck('a lista de destino traz o destino da Tabela de Frete', 'DESTINO NOVO TESTE' in m['opcoes'],
           str([o for o in m['opcoes'] if 'TESTE' in o or 'GOIANIA' in o]))
        ck('escolhê-lo manda o destino de frete para a linha nova',
           (m['enviado'] or {}).get('freteDestino') == 'DESTINO NOVO TESTE', str(m['enviado']))
        ck('e o nome da cidade da linha continua preenchido',
           (m['enviado'] or {}).get('apelidoRota') == 'DESTINO NOVO TESTE', str(m['enviado']))

        print('\n=== 2. PROGRAMAÇÃO E COMPLETAR — O DESTINO VAI EM MAIÚSCULA ===')
        prog = await pg.evaluate("""() => {
          let corpo = null;
          const orig = window.criarCargaProgramada;
          window.criarCargaProgramada = (c) => { corpo = c; return { id: 'x' }; };
          const v = (id, val) => { const e = document.getElementById(id); if(e) e.value = val; };
          v('prog-placa', ''); v('prog-numero-carga', '900777'); v('prog-peso', '1000');
          v('prog-frete-destino', '  destino novo teste '); v('prog-km-deslocamento', '321');
          try { criarCargaProgramadaUI(); } catch(e) {}
          window.criarCargaProgramada = orig;
          return corpo && corpo.freteDestino;
        }""")
        ck('Programação: "  destino novo teste " vai como "DESTINO NOVO TESTE"', prog == 'DESTINO NOVO TESTE', repr(prog))
        comp = await pg.evaluate("""() => {
          let corpo = null;
          const orig = window.completarCargaAguardando;
          window.completarCargaAguardando = (id, c) => { corpo = c; };
          document.getElementById('completar-id').value = 'x';
          document.getElementById('completar-frete-destino').value = 'goiania';
          try { salvarCompletarCarga(); } catch(e) {}
          window.completarCargaAguardando = orig;
          return corpo && corpo.freteDestino;
        }""")
        ck('Completar: "goiania" vai como "GOIANIA"', comp == 'GOIANIA', repr(comp))

        print('\n=== 3. TABELA DE FRETE — A MENSAGEM DIZ O KM QUE O SERVIDOR GRAVOU ===')
        msg = await pg.evaluate("""async () => {
          const avisos = [];
          const n1 = window.notify, n2 = window.notifyGravacao;
          window.notify = (t) => avisos.push(String(t));
          window.notifyGravacao = (t) => avisos.push(String(t));
          // o servidor sem a migração 056 corta as casas decimais
          SuincoSharePoint.gravarDestinoFrete = async (c) =>
            ({ enfileirado: false, item: { destino: c.destino, km: Math.trunc(c.km) } });
          SuincoSharePoint.tabelaDeFrete = async () => null;
          document.getElementById('frete-destino-nome').value = 'destino km quebrado teste';
          document.getElementById('frete-destino-km').value = '123,45';
          await addDestinoFreteUI();
          window.notify = n1; window.notifyGravacao = n2;
          return avisos.join(' | ');
        }""")
        print('  ', msg)
        ck('a mensagem diz o KM gravado (123), não o digitado (123,45)', '123 km' in msg and '123,45 km' not in msg.split('digitou')[0], msg)
        ck('e avisa que as casas decimais foram cortadas pelo servidor', 'decimais' in msg, msg)

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
