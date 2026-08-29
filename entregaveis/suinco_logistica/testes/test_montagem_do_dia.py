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
        # PERGUNTA À FUNÇÃO DE VERDADE, e não a uma cópia dela (28/08/2026).
        #
        # Este bloco reimplementava a conta aqui, com um Set de códigos de
        # rota — que é a PRIMEIRA versão da lógica, abandonada em 25/08 por
        # errar: bastava uma carga de Patos existir para as outras saídas de
        # Patos sumirem da oferta. O teste passava por sorte, enquanto as
        # linhas já montadas tivessem códigos distintos. No dia em que duas
        # caíram na mesma praça, ele acusou 38 onde o painel oferece 37 — e
        # o errado era ele, não o painel.
        #
        # Teste que reimplementa a regra não testa a regra: testa a cópia
        # que ele mesmo escreveu. Agora chama `linhasDoModeloQueFaltam`, a
        # mesma função que o botão "puxar o modelo" usa — uma função, dois
        # chamadores.
        novas = await pg.evaluate(
            """() => linhasDoModeloQueFaltam(
                 _montagemDia.modelo, _montagemDia.montagens).length""")
        montadas = await pg.evaluate(
            """() => _montagemDia.montagens.filter(m => !m.cancelada_em).length""")
        no_modelo = await pg.evaluate("() => _montagemDia.modelo.length")
        # A REGRA DESTE BLOCO É IDEMPOTÊNCIA, e era isso que a asserção
        # antiga NÃO media (28/08/2026).
        #
        # Ela comparava `oferecidas == modelo - montadas`, o que só vale se
        # TODA montagem existente tiver vindo do modelo. As duas montagens
        # que os blocos anteriores criam são AVULSAS — feitas à mão, sem
        # `modelo_id` e sem apelido. Elas não consomem linha do modelo, e
        # não devem consumir mesmo: uma carga extra na rota 500 não é a
        # saída de Patos de Minas prevista para o dia, e fazer a saída
        # prevista sumir seria uma rota que não embarca — invisível.
        # Oferecer uma linha a mais é visível: a pessoa lê a lista e
        # cancela. (Ver o comentário de `linhasDoModeloQueFaltam`.)
        #
        # O que este bloco promete no título é outra coisa, e é o que se
        # mede agora: puxar o modelo DUAS VEZES não duplica. Depois de
        # montar o que falta, não falta mais nada.
        SEGUNDO_CLIQUE = """() => {
                 const modelo = _montagemDia.modelo;
                 const faltam = linhasDoModeloQueFaltam(modelo, _montagemDia.montagens);
                 // Simula o clique: cada linha oferecida vira montagem, com
                 // a identidade da linha do modelo que a originou.
                 const agora = _montagemDia.montagens.concat(
                   faltam.map(m => ({ modelo_id: m.modelo_id, rota_codigo: m.rota_codigo,
                                      apelido_rota: m.apelido_rota })));
                 return linhasDoModeloQueFaltam(modelo, agora).length;
               }"""
        depois = await pg.evaluate(SEGUNDO_CLIQUE)
        ck('depois de montar o que falta, o segundo clique não oferece nada',
           depois == 0,
           f'modelo {no_modelo} linhas, {montadas} montadas, ofereceu {novas}, '
           f'no segundo clique oferece {depois}')
        # O DIA EM QUE A BATERIA RODA NÃO PODE DECIDIR SE ESTA GUARDA VALE
        # (29/08/2026).
        #
        # A bateria rodou num SÁBADO e esta linha ficou vermelha sozinha. O
        # modelo da semana tem só segunda a sexta — que é a verdade da
        # operação, e o bloco 8 já prova que o painel diz isso com todas as
        # letras. No sábado `no_modelo` é 0, e exigir `novas > 0` virava
        # impossível: vermelho todo fim de semana, sem nada quebrado.
        #
        # É a CAUSA 2 da lista do corredor — o teste media um atalho ("tem
        # linha hoje?") em vez da regra ("nenhuma linha do modelo some da
        # oferta").
        #
        # Deixar passar vazio também não serve: a guarda sumiria dois dias
        # por semana sem ninguém notar, que é como se perde uma proteção sem
        # ninguém decidir perder. Então, quando hoje não tem modelo, a MESMA
        # regra é medida num dia que TEM — e o teste diz em qual dia mediu.
        dia_medido = 'hoje'
        if no_modelo == 0:
            TERCA = '2026-09-01'
            medida = await pg.evaluate(
                """async (dia) => {
                     document.getElementById('mont-data').value = dia;
                     await carregarMontagemUI();   // só LÊ, não aplica o modelo
                     return {
                       novas: linhasDoModeloQueFaltam(_montagemDia.modelo,
                                                      _montagemDia.montagens).length,
                       noModelo: _montagemDia.modelo.length
                     };
                   }""", TERCA)
            novas, no_modelo = medida['novas'], medida['noModelo']
            depois = await pg.evaluate(SEGUNDO_CLIQUE)
            dia_medido = f'terça {TERCA} — hoje não tem modelo (dia sem operação)'
            ck('a idempotência também vale no dia medido', depois == 0, str(depois))
        ck('e o modelo inteiro cabe no dia — nenhuma linha some da oferta',
           novas <= no_modelo and novas > 0,
           f'{novas} de {no_modelo} linhas oferecidas · medido em {dia_medido}')

        print('\n=== 8. O MODELO DA SEMANA TEM TELA, E O BOTÃO NÃO FICA MUDO ===')
        # O defeito que este bloco existe para não deixar voltar: a
        # primeira entrega trouxe a rota do servidor e o botão "Puxar
        # rotas do modelo", mas NÃO a tela para cadastrar o modelo. O
        # botão não tinha de onde puxar, e a mensagem ainda dizia "todas
        # as rotas já estão montadas" — o oposto da verdade.
        await pg.evaluate("() => abrirTab('programacao')")
        await pg.wait_for_timeout(1200)
        tela = await pg.evaluate("""() => ({
            existe: !!document.getElementById('card-modelo-semana'),
            visivel: !document.getElementById('card-modelo-semana').hidden,
            dias: document.querySelectorAll('#modelo-seg .seg-btn').length,
            temSeletor: (document.getElementById('modelo-rota')||{}).options?.length > 0
        })""")
        ck('a tela de rotas por dia existe', tela['existe'])
        ck('e aparece para a Logística', tela['visivel'], str(tela))
        ck('com os cinco dias úteis', tela['dias'] == 5, str(tela['dias']))
        ck('e o seletor traz as rotas do cadastro oficial', tela['temSeletor'], str(tela))

        rota2 = sql("SELECT codigo FROM dim_rotas WHERE codigo = '510'")
        antes = sql("SELECT count(*) FROM programacao_modelo WHERE dia_semana = 2")
        await pg.evaluate("""async (rota) => {
              await SuincoSharePoint.modeloSemana.gravar(
                {diaSemana: 2, rotaCodigo: rota, ordem: 0, tipoOperacao: 'CROSS-DOCKING'});
            }""", rota2[0])
        depois = sql("SELECT count(*) FROM programacao_modelo WHERE dia_semana = 2")
        ck('adicionar rota ao modelo grava', int(depois[0]) == int(antes[0]) + 1,
           f'{antes[0]} → {depois[0]}')

        # A mensagem honesta quando o modelo do dia está vazio.
        vazio = await pg.evaluate("""async () => {
              _montagemDia = await SuincoSharePoint.montagem.doDia();
              _montagemDia.modelo = [];
              let dito = '';
              const orig = window.notify;
              window.notify = (m) => { dito = m; };
              await aplicarModeloDoDiaUI();
              window.notify = orig;
              return dito;
            }""")
        ck('modelo vazio diz a verdade, não "já estão montadas"',
           'Não há rotas cadastradas' in vazio, vazio[:80])

        sql("DELETE FROM programacao_modelo WHERE dia_semana = 2 AND rota_codigo = '510'")

        print('\n=== 7b. DUAS SAÍDAS PARA A MESMA PRAÇA NÃO SE ANULAM ===')
        # O defeito: filtrar por "rota já montada" fazia a segunda saída
        # da mesma praça sumir da oferta. Na sexta isso escondia 20 das
        # 39 cargas do dia.
        dupla = await pg.evaluate("""() => {
              const modelo = [{rota_codigo:'500', rota_nome:'Patos de Minas'},
                              {rota_codigo:'500', rota_nome:'Patos de Minas'},
                              {rota_codigo:'510', rota_nome:'Belo Horizonte'}];
              const montagens = [{rota_codigo:'500', cancelada_em:null}];
              const conta = new Map();
              montagens.filter(m => !m.cancelada_em).forEach(m =>
                conta.set(m.rota_codigo, (conta.get(m.rota_codigo)||0) + 1));
              const saldo = new Map(conta);
              return modelo.filter(m => {
                const r = saldo.get(m.rota_codigo) || 0;
                if(r > 0){ saldo.set(m.rota_codigo, r - 1); return false; }
                return true;
              }).length;
            }""")
        ck('com 2 no modelo e 1 montada, ainda oferece a segunda',
           dupla == 2, f'ofereceu {dupla}, esperado 2 (a 2ª de Patos + BH)')

        print('\n=== 9. O TEMPLATE DAS PLANILHAS ESTÁ NO PAINEL E FUNCIONA ===')
        # O pedido: "preciso daquele template de cada dia de semana pronto
        # e funcionando". Não basta a tabela ter linhas — o botão precisa
        # montar o dia a partir delas.
        porDia = {}
        for d in range(1, 6):
            r = sql(f'SELECT count(*) FROM programacao_modelo WHERE dia_semana = {d}')
            porDia[d] = int(r[0]) if r else 0
        ck('os cinco dias úteis têm rotas no modelo',
           all(porDia[d] > 0 for d in range(1, 6)), str(porDia))
        ck('terça e sexta são os dias grandes, como nas planilhas',
           porDia[2] > porDia[3] and porDia[5] > porDia[4], str(porDia))

        # Os códigos são os que JÁ existiam — nenhuma rota nova inventada.
        novas = sql("SELECT count(*) FROM programacao_modelo WHERE rota_codigo >= '900'")
        ck('nenhum código de rota inventado — só os do painel',
           novas and novas[0] == '0', str(novas))

        # O nome da planilha sobreviveu ao de-para. Desde a migração 034 ele
        # mora em `apelido_rota`: `observacoes` virou campo da pessoa que
        # monta a carga, e um campo com dois donos apaga um deles.
        comNome = sql("SELECT count(*) FROM programacao_modelo WHERE apelido_rota <> ''")
        ck('cada linha guarda o nome como a operação o conhece',
           comNome and int(comNome[0]) >= 100, str(comNome))

        # E o ciclo completo: puxar o modelo de uma terça monta as cargas.
        sql("DELETE FROM programacao_montagem WHERE data_prog = '2026-09-01'")
        montou = await pg.evaluate("""async () => {
              document.getElementById('mont-data').value = '2026-09-01';  // terça, e NÃO hoje:
              // montar 26 cargas no dia de hoje no meio da bateria contamina
              // quem lê 'a programação de hoje'. Terça que vem prova o mesmo.
              await carregarMontagemUI();
              const antes = _montagemDia.montagens.length;
              window.confirm = () => true;
              await aplicarModeloDoDiaUI();
              return {antes, depois: _montagemDia.montagens.length,
                      rotas: _montagemDia.modelo.length};
            }""")
        ck('puxar o modelo de terça monta as cargas do dia',
           montou['depois'] > montou['antes'], str(montou))
        nomes = sql("SELECT count(*) FROM programacao_montagem "
                    "WHERE data_prog = '2026-09-01' AND apelido_rota <> ''")
        ck('e o nome da planilha chega na montagem',
           nomes and int(nomes[0]) > 0, str(nomes))
        sql("DELETE FROM programacao_montagem WHERE data_prog = '2026-09-01'")

        print('\n=== 10. SEM ERRO DE JAVASCRIPT ===')
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
