#!/usr/bin/env python3
"""Devoluções: a ordem que a operação enxerga, e sem filtro de dia (02/09/2026).

DOIS PEDIDOS, no mesmo dia.

1. A SEQUÊNCIA. A Bruna numerou os cartões num print da tela:

       1 Portaria · 2 Balança (entrada) · 3 Balança (PESO FINAL)
       4 Expedição · 5 Controles Internos · 6 Central de Notas

   A segunda pesagem vem ANTES da Expedição, e é assim no pátio: o caminhão
   descarrega, volta na balança e vai embora; a conferência da Expedição
   acontece depois, no ritmo deles — foi por isso que em 28/08 a etapa
   virou só o "OKzinho".

   O dono foi perguntado se era ordem DE TELA ou ordem DE TRABALHO, e
   escolheu tela: mudar a máquina de estados deixaria as devoluções em
   andamento com a pesagem final PULADA. Então a ordem do trabalho
   (DEV_ETAPAS) NÃO muda — e este teste guarda as duas coisas ao mesmo
   tempo, porque a tentação de "alinhar as duas" é exatamente o que
   desfaria o pedido sem ninguém perceber.

2. SEM FILTRO DE DIA. Nas palavras dela: "seria possível remover a opção de
   filtrar por dados no checklist (...) Não precisamos filtrar por dia, pois
   os demais setores acham complicado ficar filtrando por dia para
   localizar".

   A causa estava em `carregarDevolucoes`, que pedia `listar(dia, dia)` —
   UM dia só. Checklist criado ontem sumia hoje, e quem chegava para dar o
   OK da própria etapa tinha que adivinhar a data para achar o próprio
   trabalho. A Expedição e os Controles entram depois, às vezes no dia
   seguinte: era o caso normal, não a exceção.

   O servidor não precisou mudar — a rota já devolve 30 dias sem período.

Exige o backend local no ar.

    python3 testes/test_devolucoes_ordem_e_sem_filtro_de_dia.py
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
        url = f'{API}/__devordem'
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

        print('\n=== 1. O CAMPO "DIA" SAIU DA TELA ===')
        sumiu = await pg.evaluate("""() => ({
            temCampoDia: !!document.getElementById('dev-filtro-dia'),
            temBotaoHoje: /Hoje</.test(
              (document.getElementById('tab-devolucoes') || {}).innerHTML || '')
        })""")
        ck('não existe mais campo de filtrar por dia', not sumiu['temCampoDia'], str(sumiu))

        print('\n=== 2. CHECKLIST DE ONTEM APARECE HOJE ===')
        # O caso que travava a operação: a Expedição chega no dia seguinte
        # para dar o próprio OK e não acha o checklist.
        criado = await pg.evaluate("""async () => {
              document.getElementById('dev-operador-cod').value = '700001';
              document.getElementById('dev-rota').value = '500';
              await criarDevolucaoUI();
              await carregarDevolucoes();
              return DEVOLUCOES.length ? DEVOLUCOES[0].id : null;
            }""")
        ck('checklist criado para o teste', bool(criado), str(criado))
        if not criado:
            await nav.close()
            return 1
        # Empurra a data para 5 dias atrás, direto no banco: é o mesmo que
        # acontece quando o checklist envelhece de um dia para o outro.
        sql(f"UPDATE devolucoes SET data_dev = (now() - interval '5 days')::date "
            f"WHERE devolucao_id = '{criado}'")
        achou = await pg.evaluate("""async (id) => {
              await carregarDevolucoes();
              return { total: DEVOLUCOES.length,
                       achou: DEVOLUCOES.some(d => d.id === id) };
            }""", criado)
        ck('checklist de 5 dias atrás continua na lista, sem filtrar nada',
           achou['achou'], str(achou))

        print('\n=== 3. A ORDEM NA TELA É A QUE A BRUNA MARCOU ===')
        ordem = await pg.evaluate("""() => {
            renderDevolucoes();
            const tira = document.querySelector('#tab-devolucoes .dev-carimbos');
            if(!tira) return { semTira: true };
            return { rotulos: [...tira.querySelectorAll('.dev-carimbo-rot')]
                       .map(x => x.textContent.trim()) };
        }""")
        esperado = ['Portaria', 'Balança (entrada)', 'Balança (peso final)',
                    'Expedição', 'Controles Internos', 'Central de Notas']
        if ordem.get('semTira'):
            ck('a tira de etapas apareceu', False, 'não achei .dev-carimbos')
        else:
            ck('os seis cartões estão na ordem 1..6 que ela numerou',
               ordem['rotulos'] == esperado,
               ' | '.join(ordem['rotulos']))

        print('\n=== 4. A ORDEM DO TRABALHO NÃO MUDOU ===')
        # A tentação de "alinhar as duas ordens" é o que desfaria o pedido
        # sem ninguém perceber — e mudar o fluxo deixaria devolução em
        # andamento com a pesagem final pulada. Por isso está travado aqui.
        fluxo = await pg.evaluate("() => DEV_ETAPAS.map(e => e.status)")
        ck('a Expedição continua vindo antes da segunda pesagem no FLUXO',
           fluxo.index('Conferida no Faturamento') < fluxo.index('Descarga Conferida'),
           ' → '.join(fluxo))
        ck('e "Descarga Conferida" continua antes de "Peso Final Registrado"',
           fluxo.index('Descarga Conferida') < fluxo.index('Peso Final Registrado'),
           ' → '.join(fluxo))

        sql(f"DELETE FROM devolucoes WHERE devolucao_id = '{criado}'")
        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


sys.exit(asyncio.run(main()))
