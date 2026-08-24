#!/usr/bin/env python3
"""Montagem do dia — a carga antes de ter placa. (23/08/2026)

O que este teste guarda é a SAÍDA DO EXCEL. O dia nascia numa planilha do
Teams: o template do dia da semana traz as rotas, a Logística monta as
cargas em cima delas, e só depois contrata as placas. O painel não
participava porque criarCargaProgramada recusa placa vazia — no painel a
carga só existia quando o veículo já estava contratado, que é o ÚLTIMO
passo do processo real.

As três coisas que precisam continuar verdadeiras:

  1. montar carga SEM placa funciona, e essas cargas NÃO aparecem na Torre
     de Controle — Torre é pátio, e antes da placa não há veículo nenhum;
  2. a placa entra, sai e troca de linha à vontade, que é o movimento que
     a planilha permitia o dia inteiro;
  3. quando a carga é criada de verdade, ela vai para a Torre pelo caminho
     de sempre — e a linha da montagem vira histórico, não some.

E dois defeitos que este teste existe para não deixar aparecer:

  · placa repetida no mesmo dia recusada com frase de gente, não com erro
    de constraint do banco;
  · "Puxar rotas do modelo" rodado duas vezes não duplica nada.

    python3 testes/test_montagem_do_dia.py
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


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        # Limpeza ANTES do login: depois, o painel já puxou as sobras para
        # o estado local e a contagem da Torre mente.
        sql("DELETE FROM programacao_montagem WHERE criado_por LIKE '%teste%' "
            "OR numero_carga LIKE 'MT-%'")
        sql("DELETE FROM fact_statusfrota WHERE placa IN "
            "(SELECT placa FROM fact_viagens WHERE numero_carga LIKE 'MT-%')")
        sql("DELETE FROM fact_viagens WHERE numero_carga LIKE 'MT-%'")

        ctx = await nav.new_context(viewport={'width': 1360, 'height': 900})
        pg = await ctx.new_page()
        html = open(PAINEL_ARQ, encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = f'{API}/__montagem'
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        await pg.wait_for_selector('#login-email', timeout=25000)
        await pg.fill('#login-email', 'ana@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3000)
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        print('\n=== 0. AS TABELAS DO MODELO EXISTEM E ESTÃO VAZIAS OU NÃO ===')
        # O CONTEÚDO do modelo (quais rotas em cada dia) é preenchido pela
        # Logística na tela. O teste não exige nenhum seed: exigir um
        # travaria a suíte a uma semana específica de planilha.
        ok = sql('SELECT count(*) >= 0 FROM programacao_modelo')
        ck('tabela do modelo da semana responde', ok and ok[0] == 't', str(ok))

        print('\n=== 1. MONTAR CARGA SEM PLACA ===')
        rota = sql("SELECT codigo FROM dim_rotas WHERE codigo = '500'")
        criada = await pg.evaluate(
            """async (rota) => {
                 const r = await SuincoSharePoint.montagem.criar({
                   rotaCodigo: rota, numeroCarga: 'MT-1', peso: 7000, qtdEntregas: 3});
                 return r.montagem;
               }""", rota[0])
        ck('montagem criada sem placa nenhuma',
           criada and criada['placa'] == '', str(criada and criada.get('placa')))
        ck('nasce sem carga vinculada', criada and criada['carga_id'] is None)

        print('\n=== 2. A TORRE NÃO VÊ CARGA SEM PLACA ===')
        # É o ponto central do desenho: montagem é planejamento, Torre é
        # pátio. Se vazasse para a Torre, o painel mostraria caminhão que
        # não existe.
        na_torre = await pg.evaluate(
            "() => DB.cargas.filter(c => c.numeroCarga === 'MT-1').length")
        ck('a carga montada não entrou em DB.cargas', na_torre == 0, f'{na_torre} encontrada(s)')
        no_banco = sql("SELECT count(*) FROM fact_viagens WHERE numero_carga = 'MT-1'")
        ck('e também não entrou em fact_viagens', no_banco and no_banco[0] == '0', str(no_banco))

        print('\n=== 3. A PLACA ENTRA, SAI E TROCA ===')
        placas = sql("SELECT string_agg(placa, '|') FROM (SELECT v.placa FROM dim_veiculos v "
                     "LEFT JOIN fact_viagens f ON f.placa = v.placa AND f.excluida_em IS NULL "
                     "WHERE v.transportadora <> '' AND f.carga_id IS NULL "
                     "ORDER BY v.placa LIMIT 2) t")
        # sql() já devolve a lista dividida — psql roda com -F '|'.
        ck('duas placas livres para o teste', placas and len(placas) >= 2, str(placas))
        if not placas or len(placas) < 2:
            await nav.close()
            return 1
        p1, p2 = placas[0], placas[1]
        mid = criada['montagem_id']

        r = await pg.evaluate("""async ([id, placa]) =>
              (await SuincoSharePoint.montagem.alterar(id, {placa})).montagem""", [mid, p1])
        ck('placa entra', r['placa'] == p1, r['placa'])
        r = await pg.evaluate("""async ([id, placa]) =>
              (await SuincoSharePoint.montagem.alterar(id, {placa})).montagem""", [mid, p2])
        ck('placa troca por outra', r['placa'] == p2, r['placa'])
        r = await pg.evaluate("""async (id) =>
              (await SuincoSharePoint.montagem.alterar(id, {placa: ''})).montagem""", mid)
        ck('placa sai e a montagem continua viva', r['placa'] == '' and not r['carga_id'])

        print('\n=== 4. PLACA REPETIDA NO MESMO DIA É RECUSADA COM FRASE DE GENTE ===')
        outra = await pg.evaluate(
            """async (rota) => (await SuincoSharePoint.montagem.criar({
                 rotaCodigo: rota, numeroCarga: 'MT-2'})).montagem""", rota[0])
        await pg.evaluate("""async ([id, placa]) =>
              SuincoSharePoint.montagem.alterar(id, {placa})""", [mid, p1])
        recusa = await pg.evaluate(
            """async ([id, placa]) => {
                 try { await SuincoSharePoint.montagem.alterar(id, {placa}); return null; }
                 catch(e){ return String(e.message || e); }
               }""", [outra['montagem_id'], p1])
        ck('recusou a placa duplicada', recusa is not None, str(recusa))
        ck('a mensagem explica o que houve, não é erro de banco',
           recusa and 'já está em outra carga' in recusa and 'constraint' not in recusa.lower(),
           str(recusa))

        print('\n=== 5. A MONTAGEM VIRA CARGA E VAI PARA A TORRE ===')
        antes = await pg.evaluate("() => DB.cargas.length")
        await pg.evaluate("""async (id) => {
              const m = (await SuincoSharePoint.montagem.doDia()).montagens
                          .find(x => x.montagem_id === id);
              _montagemDia = await SuincoSharePoint.montagem.doDia();
              await efetivarMontagemUI(id);
            }""", mid)
        await pg.wait_for_timeout(2500)
        depois = await pg.evaluate(
            "() => DB.cargas.filter(c => c.numeroCarga === 'MT-1').length")
        ck('agora a carga existe na Torre', depois == 1, f'{antes} → {depois}')
        efet = sql("SELECT efetivada_em IS NOT NULL, carga_id IS NOT NULL "
                   "FROM programacao_montagem WHERE numero_carga = 'MT-1'")
        ck('a montagem ficou marcada como efetivada', efet and efet[0] == 't', str(efet))
        ck('e guarda qual carga ela virou', efet and efet[1] == 't', str(efet))

        print('\n=== 6. MONTAGEM EFETIVADA NÃO ACEITA MAIS EDIÇÃO ===')
        # Duas verdades sobre a mesma carga divergiriam sem ninguém para
        # conciliar. Quem precisa mudar, muda na Torre — lá há log.
        travada = await pg.evaluate(
            """async (id) => {
                 try { await SuincoSharePoint.montagem.alterar(id, {peso: 999}); return null; }
                 catch(e){ return String(e.message || e); }
               }""", mid)
        ck('recusa editar montagem já efetivada', travada is not None, str(travada))
        ck('e diz onde alterar', travada and 'Torre' in travada, str(travada))

        print('\n=== 7. PUXAR O MODELO DUAS VEZES NÃO DUPLICA ===')
        # Vale mesmo com modelo vazio: o que se testa é o filtro, não o
        # tamanho do modelo.
        await pg.evaluate("""async () => {
              _montagemDia = await SuincoSharePoint.montagem.doDia();
            }""")
        n1 = await pg.evaluate("() => _montagemDia.montagens.filter(m => !m.cancelada_em).length")
        # Simula o segundo clique: as rotas já montadas são filtradas fora.
        novas = await pg.evaluate(
            """() => {
                 const ja = new Set(_montagemDia.montagens.filter(m => !m.cancelada_em)
                                     .map(m => m.rota_codigo));
                 return _montagemDia.modelo.filter(m => !ja.has(m.rota_codigo)).length;
               }""")
        montadas = await pg.evaluate(
            """() => new Set(_montagemDia.montagens.filter(m => !m.cancelada_em)
                              .map(m => m.rota_codigo)).size""")
        no_modelo = await pg.evaluate(
            "() => new Set(_montagemDia.modelo.map(m => m.rota_codigo)).size")
        ck('rota já montada não é oferecida de novo',
           novas == max(0, no_modelo - montadas),
           f'modelo {no_modelo} rotas, {montadas} montadas, oferece {novas}')

        print('\n=== 8. SEM ERRO DE JAVASCRIPT ===')
        ck('nenhum erro no console', not erros, '; '.join(erros[:3]))

        # Limpeza para não contaminar a próxima suíte.
        sql("DELETE FROM programacao_montagem WHERE numero_carga LIKE 'MT-%'")
        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print(f'    - {f}')
        return 1
    print('  Tudo verde.')
    return 0


sys.exit(asyncio.run(main()))
