#!/usr/bin/env python3
"""A segunda assinatura tem onde ser pedida e onde ser dada (23/08/2026).

Relato do Alysson, administrador, pelo painel dele: clicou em "Restaurar
esta versão" e recebeu "Esta ação precisa do aval de outro administrador",
sem nenhum lugar para PEDIR esse aval. A trava tinha sido implementada no
servidor sem o par na tela — o botão virou um beco sem saída.

Este teste prova o caminho inteiro, com dois administradores de verdade em
duas sessões separadas:

  1. Alysson clica em Restaurar sem aprovação nenhuma → o painel abre o
     pedido (pergunta o motivo) em vez de só reclamar.
  2. O pedido aparece na aba Usuários do OUTRO administrador.
  3. Quem pediu NÃO vê botão de aprovar no próprio pedido — vê o aviso de
     que precisa de outra pessoa.
  4. O outro aprova; o pedido passa a constar como aprovado.
  5. Alysson clica em Restaurar de novo e AGORA a restauração acontece.

    python3 testes/test_segunda_assinatura_ui.py
"""
import asyncio
import os
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


async def abrir(nav, email, rotulo):
    ctx = await nav.new_context()
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__2assin_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    return ctx, pg


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        # admin1 faz o papel do Alysson; admin2, o do outro administrador.
        ctxA, pgA = await abrir(nav, 'admin1@teste.local', 'a')
        ctxB, pgB = await abrir(nav, 'admin2@teste.local', 'b')

        print('\n=== PREPARO: uma carga com duas versões ===')
        # A revisão nasce de uma EDIÇÃO de verdade pela tela — é o mesmo
        # caminho do relato (alguém mexeu no peso e quer voltar atrás).
        num = await pgA.evaluate("""()=>{
          const n = '2S' + Date.now().toString().slice(-6);
          const f = DB.frota.find(x=>x.placa && x.transportadora);
          criarCargaProgramada({numeroCarga:n, placa:f.placa, cliente:'CLIENTE ORIGINAL',
            destino:'DESTINO ORIGINAL', peso:21500, rota:'500', operador:'Admin Um',
            qtdEntregas:2});
          SuincoStore.save();
          return n;
        }""")
        await pgA.wait_for_timeout(5000)
        await pgA.evaluate("""(n)=>{
          const c = DB.cargas.find(x=>x.numeroCarga===n);
          atualizarPesoUI(c.id, '100');
        }""", num)
        await pgA.wait_for_timeout(5000)
        carga = await pgA.evaluate("""(n)=>{
          const c = DB.cargas.find(x=>x.numeroCarga===n); return {id:c.id};
        }""", num)
        revisoes = await pgA.evaluate("""async (id)=>{
          const r = await SuincoSharePoint.listarRevisoes(id);
          return (r||[]).map(x=>({id:x.revisao_id||x.revisaoId, quando:x.gravada_em}));
        }""", carga['id'])
        ck('a carga tem revisão para restaurar', len(revisoes) >= 1,
           f"{len(revisoes)} revisão(ões)")
        if not revisoes:
            print('\n=== RESULTADO ===\n  FALHAS: sem revisão, nada a testar')
            sys.exit(1)
        revisao = revisoes[-1]['id']

        print('\n=== 1. RESTAURAR SEM APROVAÇÃO ABRE O PEDIDO ===')
        # O motivo chega pelo prompt(); o teste responde por ele. Vai com o
        # número da carga dentro para que este pedido seja distinguível dos
        # que ficaram de execuções anteriores no banco de teste.
        motivo = f'Peso trocado por engano na carga {num}'
        await pgA.evaluate("""(m)=>{ window.prompt = ()=> m; }""", motivo)
        await pgA.evaluate("""async (d)=>{ await restaurarRevisaoUI(d.id, d.rev); }""",
                           {'id': carga['id'], 'rev': revisao})
        await pgA.wait_for_timeout(1500)
        pedidos = await pgA.evaluate("""async ()=>await SuincoSharePoint.acoesCriticas.listar()""")
        meu = [x for x in pedidos if x['tipo'] == 'restaurar' and x['carga_id'] == carga['id']]
        ck('o clique abriu um pedido de aprovação', len(meu) == 1,
           f"{len(meu)} pedido(s)")
        ck('o motivo digitado foi gravado',
           bool(meu) and meu[0]['motivo'] == motivo,
           meu[0]['motivo'] if meu else '(sem pedido)')
        ck('o pedido ainda não está aprovado', bool(meu) and not meu[0]['aprovada_em'])

        print('\n=== 2. QUEM PEDIU NÃO APROVA O PRÓPRIO PEDIDO ===')
        await pgA.evaluate("()=>abrirTab('usuarios')")
        await pgA.wait_for_timeout(2000)
        painelA = await pgA.evaluate("""(m)=>{
          const card=document.getElementById('card-aprovacoes');
          const item=[...document.querySelectorAll('#aprovacoes-painel .aprov-item')]
            .find(d=>d.textContent.includes(m));
          return {escondido: card ? card.hidden : true, achou: !!item,
                  texto: item ? item.textContent : '',
                  botoes: item ? item.querySelectorAll('button').length : -1};
        }""", motivo)
        ck('o card de aprovações aparece para quem pediu', not painelA['escondido'])
        ck('o pedido dele está listado', painelA['achou'])
        ck('não há botão de aprovar no próprio pedido', painelA['botoes'] == 0,
           f"{painelA['botoes']} botão(ões)")
        ck('a tela explica por quê', 'quem pede não aprova' in painelA['texto'],
           painelA['texto'].strip()[:80])

        print('\n=== 3. O OUTRO ADMINISTRADOR VÊ E APROVA ===')
        await pgB.evaluate("()=>abrirTab('usuarios')")
        await pgB.wait_for_timeout(2000)
        painelB = await pgB.evaluate("""(m)=>{
          const item=[...document.querySelectorAll('#aprovacoes-painel .aprov-item')]
            .find(d=>d.textContent.includes(m));
          return {achou: !!item, botoes: item?item.querySelectorAll('button').length:-1};
        }""", motivo)
        ck('o pedido aparece para o outro administrador', painelB['achou'])
        ck('e para ele há botão de aprovar (Aprovar e Recusar)', painelB['botoes'] == 2,
           f"{painelB['botoes']} botão(ões)")

        await pgB.evaluate("()=>{ window.confirm = ()=>true; }")
        await pgB.evaluate("""async (id)=>{ await aprovarAcaoUI(id); }""", meu[0]['acao_id'])
        await pgB.wait_for_timeout(1500)
        depois = await pgB.evaluate("""async ()=>await SuincoSharePoint.acoesCriticas.listar()""")
        aprovado = [x for x in depois if x['acao_id'] == meu[0]['acao_id']]
        ck('o pedido ficou aprovado', bool(aprovado) and bool(aprovado[0]['aprovada_em']))
        ck('com o nome de quem aprovou',
           bool(aprovado) and aprovado[0]['aprovada_por'] not in (None, '', aprovado[0]['pedida_por']),
           aprovado[0]['aprovada_por'] if aprovado else '')

        print('\n=== 4. AGORA A RESTAURAÇÃO ACONTECE ===')
        await pgA.evaluate("()=>{ window.confirm = ()=>true; }")
        await pgA.evaluate("""async (d)=>{ await restaurarRevisaoUI(d.id, d.rev); }""",
                           {'id': carga['id'], 'rev': revisao})
        await pgA.wait_for_timeout(2500)
        final = await pgA.evaluate("""async (id)=>{
          await SuincoSharePoint.sincronizarAgora();
          const c = DB.cargas.find(x=>x.id===id);
          return c ? Number(c.peso) : null;
        }""", carga['id'])
        ck('a carga voltou para a versão anterior (peso 21500)', final == 21500,
           f"peso = {final!r}")
        usadas = await pgA.evaluate("""async ()=>await SuincoSharePoint.acoesCriticas.listar()""")
        gasta = [x for x in usadas if x['acao_id'] == meu[0]['acao_id']]
        ck('a aprovação foi consumida (não serve para uma segunda restauração)',
           bool(gasta) and bool(gasta[0]['executada_em']))

        print('\n=== CONSOLE ===')
        await ctxA.close()
        await ctxB.close()
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
