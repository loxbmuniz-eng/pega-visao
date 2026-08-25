#!/usr/bin/env python3
"""Administração reescreve o passado SOZINHA, mas nunca em silêncio (25/08/2026).

Este arquivo substitui test_segunda_assinatura_ui.py, que provava a regra
anterior. A regra mudou de propósito, por decisão do dono: "quem for da
administração não precisa da autorização de nada".

De 22 a 25/08 restaurar, desfazer exclusão e corrigir etapa exigiam pedido
de um administrador e aprovação de OUTRO. Como as três ações já eram
exclusivas da Administração, dispensar a Administração dispensou a trava
inteira.

O que este teste protege é o que ficou no lugar dela — e é o que impede a
mudança de virar um buraco:

  1. Um administrador sozinho restaura, sem pedir aval a ninguém.
  2. Sem MOTIVO, nada acontece: o histórico não pode ficar mudo.
  3. O motivo digitado chega ao histórico da carga, com nome e hora.
  4. O card "Pedidos de aprovação" não aparece mais para ninguém.

    python3 testes/test_restaurar_sem_aprovacao.py
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


def sql(consulta):
    saida = subprocess.run(
        ['sudo', '-u', 'postgres', 'psql', '-tAF', '|', '-P', 'pager=off',
         '-d', 'embarque_suinco', '-c', consulta],
        capture_output=True, text=True)
    linhas = [l for l in saida.stdout.strip().splitlines() if l]
    return linhas[0].split('|') if linhas else None


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def abrir(nav, email, rotulo):
    ctx = await nav.new_context(timezone_id='America/Sao_Paulo')
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__semaprov_{rotulo}'
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
        ctxA, pgA = await abrir(nav, 'admin1@teste.local', 'a')

        print('\n=== PREPARO: uma carga com duas versões ===')
        num = await pgA.evaluate("""()=>{
          const n = 'SA' + Date.now().toString().slice(-6);
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
          return (r||[]).map(x=>({id:x.revisao_id||x.revisaoId}));
        }""", carga['id'])
        ck('a carga tem revisão para restaurar', len(revisoes) >= 1,
           f"{len(revisoes)} revisão(ões)")
        if not revisoes:
            print('\n=== RESULTADO ===\n  FALHAS: sem revisão, nada a testar')
            sys.exit(1)
        revisao = revisoes[-1]['id']

        print('\n=== 1. SEM MOTIVO, NADA ACONTECE ===')
        # O histórico é a única coisa que sobrou no lugar da segunda
        # assinatura. Deixar restaurar sem motivo seria ficar sem as duas.
        await pgA.evaluate("()=>{ window.prompt = ()=> ''; }")
        await pgA.evaluate("""async (d)=>{ await restaurarRevisaoUI(d.id, d.rev); }""",
                           {'id': carga['id'], 'rev': revisao})
        await pgA.wait_for_timeout(1500)
        peso = await pgA.evaluate("""(id)=>{
          const c = DB.cargas.find(x=>x.id===id); return c ? c.peso : null;
        }""", carga['id'])
        ck('cancelar o motivo não restaura nada', peso == 100, f'peso={peso}')

        print('\n=== 2. UM ADMINISTRADOR SOZINHO RESTAURA ===')
        motivo = f'Peso lançado errado na carga {num}'
        await pgA.evaluate("(m)=>{ window.prompt = ()=> m; }", motivo)
        await pgA.evaluate("""async (d)=>{ await restaurarRevisaoUI(d.id, d.rev); }""",
                           {'id': carga['id'], 'rev': revisao})
        await pgA.wait_for_timeout(2500)
        peso = await pgA.evaluate("""(id)=>{
          const c = DB.cargas.find(x=>x.id===id); return c ? c.peso : null;
        }""", carga['id'])
        ck('a carga voltou ao peso da versão anterior, sem aval de ninguém',
           peso == 21500, f'peso={peso}')

        print('\n=== 3. O MOTIVO CHEGOU À TRILHA DE AUDITORIA ===')
        # Lê direto de log_eventos, e não de DB.log, porque DB.log NÃO
        # EXISTE: o painel carrega cargas e movimentações, não a trilha de
        # auditoria. Ela é consultada sob demanda (revisões da carga) e
        # pelos relatórios. Medir pelo cliente daria verde falso — ou
        # vermelho falso, que foi o que aconteceu ao escrever este teste.
        linhas = sql("SELECT acao, operador_nome, setor FROM log_eventos "
                     "WHERE carga_id = '" + carga['id'] + "' "
                     "  AND acao LIKE '%restaurada%' "
                     "ORDER BY data_evento DESC LIMIT 1")
        ck('o motivo digitado está na trilha, com o nome de quem fez',
           bool(linhas) and motivo in (linhas[0] or '')
           and linhas[1] == 'Admin Um' and linhas[2] == 'Administração',
           str(linhas))

        print('\n=== 4. O CARD DE APROVAÇÕES SUMIU ===')
        await pgA.evaluate("()=>abrirTab('usuarios')")
        await pgA.wait_for_timeout(2000)
        card = await pgA.evaluate("""()=>{
          const c = document.getElementById('card-aprovacoes');
          if(!c) return { existe:false };
          return { existe:true, visivel: getComputedStyle(c).display !== 'none',
                   texto: (c.innerText||'').trim() };
        }""")
        ck('o card "Pedidos de aprovação" não aparece',
           not card.get('visivel'), str(card))

        print('\n=== 5. SEM ERRO DE JAVASCRIPT ===')
        # A remoção mexeu em quatro arquivos; uma função esquecida em algum
        # onclick só apareceria aqui.
        erros = []
        pgA.on('pageerror', lambda e: erros.append(str(e)))
        await pgA.evaluate("()=>abrirTab('usuarios')")
        await pgA.wait_for_timeout(1200)
        ck('console limpo', not erros, '; '.join(erros[:2]))

        await ctxA.close()
        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('  Tudo verde.')
    return 0


sys.exit(asyncio.run(main()))
