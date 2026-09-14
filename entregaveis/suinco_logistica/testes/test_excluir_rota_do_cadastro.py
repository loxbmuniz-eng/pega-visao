#!/usr/bin/env python3
"""Excluir rota: apaga a que nunca rodou, aposenta a que rodou (14/09/2026).

Pedido do dono: "quero a funcionalidade de excluir rota também na parte do
cadastro de rotas" — e, ao escolher como deveria funcionar: "apagar o que
tiver repetido, ou se aposentar uma rota e criar uma nova".

São dois verbos na mesma frase, e os dois são necessários:

  · APAGAR o repetido. A repetição existe de verdade no cadastro oficial —
    534 e 540 são as duas "Salvador", as duas LogMaster. Rota duplicada ou
    com código digitado errado nunca foi usada por ninguém: sai do banco.

  · APOSENTAR a que rodou. `rota_codigo` é chave estrangeira de quatro
    tabelas; o DELETE seria recusado pelo banco, e se passasse as cargas
    antigas ficariam com um código sem nome de praça no relatório. Regra da
    casa: o que sai da operação continua no Histórico.

QUEM DECIDE QUAL DOS DOIS É O SERVIDOR, contando o uso na hora. A tela não
decide porque trabalha com uma cópia que pode estar velha.

Exige o backend local no ar (migração 053).

    python3 testes/test_excluir_rota_do_cadastro.py
"""
import asyncio, os, sys, json, urllib.request
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
falhas = []

def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok: falhas.append(nome)

async def abrir(nav, email, rotulo):
    ctx = await nav.new_context()
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__painel_rota_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url); await pg.wait_for_timeout(1000)
    await pg.fill('#login-email', email); await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar'); await pg.wait_for_timeout(3000)
    return ctx, pg

async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctx, pg = await abrir(nav, 'chefe@teste.local', 'admin')
        setor = await pg.evaluate("() => DB.operador && DB.operador.setor")
        if setor != 'Administração':
            ck('admin logado', False, str(setor)); await nav.close(); return 1

        async def criar_rota(codigo, nome):
            """Pelo MESMO caminho da tela (addRotaUI): grava no servidor e
            entra na cópia local. `recarregarRotas` tem trava de 60 s — puxar
            por lá mediria a trava, não o cadastro."""
            return await pg.evaluate("""async ([c, n]) => {
              upsertRota(c, n, '', '');
              await SuincoSharePoint.upsert('rotas','Codigo',
                {Codigo:c, Nome:n, Detalhe:'', Operador:''});
              return true;
            }""", [codigo, nome])

        async def excluir_pela_tela(codigo):
            """O botão, com o confirm respondido — é o que a pessoa faz."""
            return await pg.evaluate("""async (c) => {
              let avisos = [];
              const oc = window.confirm, on = window.notifyGravacao, ond = window.notify;
              window.confirm = () => true;
              window.notifyGravacao = (m) => avisos.push(m);
              window.notify = (m) => avisos.push(m);
              try { await excluirRotaUI(c); }
              finally { window.confirm = oc; window.notifyGravacao = on; window.notify = ond; }
              return avisos.join(' | ');
            }""", codigo)

        print('\n=== 1. ROTA QUE NUNCA RODOU É APAGADA DE VEZ ===')
        await criar_rota('ZQ1', 'Rota duplicada de teste')
        await pg.wait_for_timeout(700)
        aviso1 = await excluir_pela_tela('ZQ1')
        ck('a tela diz que APAGOU', 'apagada' in aviso1.lower(), aviso1[:110])
        ck('e diz por quê', 'nunca foi usada' in aviso1, aviso1[:110])
        sumiu = await pg.evaluate("() => !(ROTAS||[]).some(r => r.codigo === 'ZQ1')")
        ck('sumiu do painel na hora', sumiu is True, str(sumiu))
        no_banco = await pg.evaluate("""async () => {
          try { await SuincoSharePoint.excluirRota('ZQ1'); return 'AINDA EXISTE'; }
          catch(e){ return 'não existe mais: ' + (e.message||'').slice(0,50); }
        }""")
        ck('e sumiu do servidor também', 'não existe mais' in str(no_banco), str(no_banco))

        print('\n=== 2. ROTA QUE JÁ RODOU É APOSENTADA, NÃO APAGADA ===')
        await criar_rota('ZQ2', 'Rota usada de teste')
        await pg.wait_for_timeout(700)
        # põe a rota em uso: uma devolução aponta para ela
        usou = await pg.evaluate("""async () => {
          const hoje = new Date().toISOString().slice(0,10);
          try {
            await SuincoSharePoint.devolucoes.criar({
              dataDev: hoje, regiao:'TESTE', rotas:['ZQ2'],
              notaTransferencia:'ZQ2'+Date.now(), itens: [] });
            return true;
          } catch(e){ return 'ERRO: ' + e.message; }
        }""")
        ck('a rota entrou em uso', usou is True, str(usou))
        aviso2 = await excluir_pela_tela('ZQ2')
        ck('a tela diz que APOSENTOU', 'aposentada' in aviso2.lower(), aviso2[:130])
        ck('e diz ONDE ela é usada', 'devolu' in aviso2.lower(), aviso2[:130])

        print('\n=== 3. A APOSENTADA SAI DOS SELETORES ===')
        est = await pg.evaluate("""() => {
          const r = ROTAS.find(x => x.codigo === 'ZQ2');
          return { existe: !!r, ativa: r && r.ativa,
                   ofertada: rotasParaEscolher().some(x => x.codigo === 'ZQ2'),
                   nome: rotaCurta('ZQ2') };
        }""")
        ck('continua no cadastro', est['existe'] is True, str(est))
        ck('marcada como inativa', est['ativa'] is False, str(est['ativa']))
        ck('NÃO é mais oferecida para escolher', est['ofertada'] is False, str(est['ofertada']))
        ck('mas continua NOMEANDO a praça nos registros antigos',
           'Rota usada de teste' in (est['nome'] or ''), str(est['nome']))

        print('\n=== 4. A LISTA DO CADASTRO MOSTRA A APOSENTADA, MARCADA ===')
        await pg.evaluate("() => abrirTab('cadastros')"); await pg.wait_for_timeout(500)
        await pg.evaluate("() => renderRotasCadastro()")
        linha = await pg.evaluate("""() => {
          const tr = [...document.querySelectorAll('#rotas-tbody tr')]
            .find(x => x.cells[0].textContent.trim() === 'ZQ2');
          return tr ? { classe: tr.className, texto: tr.innerText, botoes: tr.querySelectorAll('button').length } : null;
        }""")
        ck('a aposentada aparece na lista', linha is not None, str(linha)[:90])
        if linha:
            ck('marcada como aposentada', 'aposentada' in linha['texto'].lower(), linha['texto'][:70])
            ck('sem botão de excluir de novo', linha['botoes'] == 0, str(linha['botoes']))

        print('\n=== 5. PRAÇA REPETIDA FICA VISÍVEL PARA QUEM VAI LIMPAR ===')
        rep = await pg.evaluate("""() => {
          const linhas = [...document.querySelectorAll('#rotas-tbody tr')];
          return linhas.filter(tr => tr.innerText.toLowerCase().includes('praça repetida'))
                       .map(tr => tr.cells[0].textContent.trim());
        }""")
        reais = [c for c in rep if not c.startswith(('ZT', 'ZQ', 'DEVT'))]
        ck('534 e 540 (as duas "Salvador") aparecem marcadas',
           '534' in rep and '540' in rep, 'reais marcadas: ' + ', '.join(reais))

        print('\n=== 6. QUEM NÃO É LOGÍSTICA NEM ADMINISTRAÇÃO NÃO EXCLUI ===')
        await ctx.close()
        ctxP, pgP = await abrir(nav, 'bruno@teste.local', 'portaria')
        pode = await pgP.evaluate("() => podeExcluirRotaUI()")
        ck('Portaria não exclui rota', pode is False, str(pode))
        negado = await pgP.evaluate("""async () => {
          try { await SuincoSharePoint.excluirRota('510'); return 'PASSOU'; }
          catch(e){ return 'recusado: ' + (e.message||'').slice(0,60); }
        }""")
        ck('e o servidor recusa também, não só a tela',
           str(negado).startswith('recusado'), str(negado))
        await ctxP.close()
        await nav.close()

    print('\n' + ('TODOS OS TESTES PASSARAM' if not falhas
                  else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas)))
    return 1 if falhas else 0

sys.exit(asyncio.run(main()))
