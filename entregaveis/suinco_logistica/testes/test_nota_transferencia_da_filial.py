#!/usr/bin/env python3
"""A nota de transferência é da filial, e só dela (16/09/2026).

PEDIDO DO DONO: *"quero um campo chamado checklist devolução das filiais
que registre a nota de transferência e o número... só as filiais vão
precisar preencher isso, 106 105 107"*, e depois, sobre onde: *"na parte
NOVO CHECKLIST DE DEVOLUÇÃO na aba DEVOLUÇÕES, e só as filiais precisarão
preencher esse campo quando criarem checklist"*.

POR QUE SÓ PARA ELAS — e por que o campo já tinha SAÍDO deste formulário.
Em 19/08/2026 a nota de transferência foi retirada daqui, com esta razão
escrita no código: *"quem preenche é a PORTARIA, no recebimento, e na hora
do lançamento o caminhão nem chegou"*. Está certo para devolução comum.

Para FILIAL não vale: a mercadoria sai de lá com nota de transferência
emitida NA HORA, e quem cria o checklist tem o número em mãos. O motivo que
tirou o campo não existe no caso delas — por isso ele volta, mas só para
elas.

O QUE ESTE TESTE TRAVA:
  1. filial VÊ o campo ao criar checklist;
  2. quem não é filial NÃO vê — some, não fica cinza. Campo desabilitado
     numa tela que não é sua é ruído que faz a pessoa se perguntar o que
     fez de errado;
  3. filial com o campo vazio é RECUSADA, e a recusa DIZ o que falta;
  4. o valor digitado chega ao servidor com o nome que ele espera;
  5. quem não é filial não manda o campo — mandar vazio sobrescreveria o
     que a Portaria grava no recebimento.

A guarda do servidor é outra e está em backend/testes/devolucoes.test.js:
a tela avisa, o servidor garante.
"""
import asyncio, json, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
FILIAIS = ['Filial 105 BSB', 'Filial 106 BAHIA', 'Filial 107 ES']
OUTROS = ['Logística', 'Portaria', 'Expedição', 'Faturamento']

falhas = []
def ck(nome, ok, extra=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {extra}" if extra else ''))
    if not ok: falhas.append(nome)

PREPARO = """(setor) => {
  window.__enviado = [];
  localStorage.setItem('suinco_token', 'token-de-teste');
  SuincoSharePoint.SP_CONFIG.ativo = true;
  SuincoSharePoint.SP_CONFIG.api = 'https://api.embarquesuinco.com.br';
  DB.operador = { nome: 'Teste', setor, email: 't@t' };
  // A criação é interceptada: o que interessa é O QUE o painel manda.
  SuincoSharePoint.devolucoes.criar = async (corpo) => {
    window.__enviado.push(corpo);
    return { id: 'dev_x', numero: 1, rotas: corpo.rotas, regiao: 'X', itens: [] };
  };
  document.body.classList.remove('pre-login');
  irParaTab('devolucoes');
  if (typeof renderDevolucoes === 'function') renderDevolucoes();
}"""

async def abrir(nav, setor):
    pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
    await pg.goto(PAINEL)
    await pg.wait_for_function('typeof renderDevolucoes === "function"')
    await pg.evaluate(PREPARO, setor)
    await pg.wait_for_timeout(300)
    return pg

async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')

        print('\n=== 1. A FILIAL VÊ O CAMPO ===')
        for setor in FILIAIS:
            pg = await abrir(nav, setor)
            v = await pg.evaluate("""() => { const c = document.getElementById('dev-nota-transf-campo');
              const i = document.getElementById('dev-nota-transf');
              return {existe: !!c, escondido: c ? c.hidden : null,
                      temInput: !!i, desabilitado: i ? i.disabled : null}; }""")
            ck(f'{setor}: o campo aparece', v['existe'] and v['escondido'] is False and v['temInput'], json.dumps(v))
            await pg.close()

        print('\n=== 2. QUEM NÃO É FILIAL NEM VÊ ===')
        for setor in OUTROS:
            pg = await abrir(nav, setor)
            v = await pg.evaluate("""() => { const c = document.getElementById('dev-nota-transf-campo');
              return c ? {escondido: c.hidden, alturaVisivel: c.getBoundingClientRect().height} : null; }""")
            ck(f'{setor}: o campo some (não fica cinza)',
               v and v['escondido'] is True and v['alturaVisivel'] == 0, json.dumps(v))
            await pg.close()

        print('\n=== 3. FILIAL SEM A NOTA É RECUSADA, E O AVISO DIZ O QUE FALTA ===')
        pg = await abrir(nav, 'Filial 106 BAHIA')
        r = await pg.evaluate("""async () => {
          window.__avisos = [];
          const orig = window.notify; window.notify = (m) => { window.__avisos.push(String(m)); };
          const sel = document.getElementById('dev-rota');
          if (sel && sel.options.length > 1) sel.value = sel.options[1].value;
          document.getElementById('dev-nota-transf').value = '';
          await criarDevolucaoUI();
          window.notify = orig;
          return {enviados: window.__enviado.length, avisos: window.__avisos}; }""")
        ck('não chamou o servidor', r['enviados'] == 0, f"{r['enviados']} chamada(s)")
        ck('o aviso cita a nota de transferência',
           any('nota de transfer' in a.lower() for a in r['avisos']), json.dumps(r['avisos'])[:120])
        await pg.close()

        print('\n=== 4. COM A NOTA, ELA VAI PARA O SERVIDOR ===')
        pg = await abrir(nav, 'Filial 106 BAHIA')
        r = await pg.evaluate("""async () => {
          const sel = document.getElementById('dev-rota');
          if (sel && sel.options.length > 1) sel.value = sel.options[1].value;
          document.getElementById('dev-nota-transf').value = '  77123  ';
          await criarDevolucaoUI();
          return window.__enviado; }""")
        ck('o painel chamou o servidor', len(r) == 1, f'{len(r)} chamada(s)')
        if r:
            ck('mandou notaTransferencia', 'notaTransferencia' in r[0], json.dumps(list(r[0].keys())))
            ck('sem espaço em volta', r[0].get('notaTransferencia') == '77123',
               repr(r[0].get('notaTransferencia')))
        await pg.close()

        print('\n=== 5. QUEM NÃO É FILIAL NÃO MANDA O CAMPO ===')
        pg = await abrir(nav, 'Logística')
        r = await pg.evaluate("""async () => {
          const sel = document.getElementById('dev-rota');
          if (sel && sel.options.length > 1) sel.value = sel.options[1].value;
          await criarDevolucaoUI();
          return window.__enviado; }""")
        ck('a Logística cria sem travar', len(r) == 1, f'{len(r)} chamada(s)')
        if r:
            ck('e NÃO manda notaTransferencia', 'notaTransferencia' not in r[0],
               'mandar vazio sobrescreveria o que a Portaria grava no recebimento')
        await pg.close()
        await nav.close()

    print()
    if falhas:
        print(f"RESULTADO: {len(falhas)} FALHA(S) — " + '; '.join(falhas)); sys.exit(1)
    print("RESULTADO: tudo verde")

asyncio.run(main())
