#!/usr/bin/env python3
"""A linha da montagem abre e vira formulário de carga. (25/08/2026)

Pedido do gestor: "cadê os campos pra poder começar a preencher essa rota
na programação? eu preciso que essas linhas sejam expansíveis e quando se
expande pode ser criada carga nela normalmente".

Os campos existiam — como dez inputs espremidos numa linha de tabela.
Existir e ser usável são coisas diferentes: no celular não cabia, e
faltavam justamente os campos que a Programação tem (motorista,
observações, o aviso da Frota).

E a decisão que o gestor pediu para eu tomar: a carga vai para a Torre por
CLIQUE, não automaticamente ao digitar a placa. O campo da placa grava ao
sair dele — um dígito errado ou um autocompletar criaria carga de verdade
na Torre, e desfazer custa ir lá cancelar. Com clique, o custo do erro é
fechar o formulário. Para o pedágio não pesar numa sexta de 39 cargas,
existe o envio em lote.

O que se prova aqui:

  1. a linha começa fechada e mostra só o que identifica a carga;
  2. clicar abre o formulário com TODOS os campos da aba Programação;
  3. Transportadora e Tipo de Veículo vêm da Frota e não são digitáveis —
     duas verdades sobre o mesmo caminhão é pior que uma incompleta;
  4. o que se digita no formulário chega ao banco;
  5. sem placa, "Criar carga" fica desabilitado — e a carga NÃO vai para a
     Torre só porque a placa foi digitada;
  6. com placa, o clique cria a carga e ela aparece na Torre;
  7. o apelido da rota ("Brasília - Versatto") tem campo próprio e não é
     mais apagado quando alguém escreve uma observação;
  8. o botão de lote diz quantas vai mandar e some quando não há nenhuma;
  9. no celular o formulário cabe e dá para tocar.

    python3 testes/test_montagem_expansivel.py
"""
import asyncio
import os
import subprocess
import sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
DIA = '2026-09-07'   # uma segunda que NÃO é hoje: montar 13 cargas no dia de
                    # hoje no meio da bateria contamina quem lê "a programação
                    # de hoje". Segunda que vem prova exatamente o mesmo.

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


async def abrir(nav, largura=1360, altura=950, movel=False):
    ctx = await nav.new_context(viewport={'width': largura, 'height': altura},
                                is_mobile=movel, has_touch=movel)
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__montexp'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.fill('#login-email', 'ana@teste.local')
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(2500)
    return ctx, pg


async def montar_dia(pg):
    """Puxa o modelo da segunda para o dia de teste e devolve a 1ª linha."""
    await pg.evaluate(f"""async () => {{
          document.getElementById('mont-data').value = '{DIA}';
          await carregarMontagemUI();
          window.confirm = () => true;
          await aplicarModeloDoDiaUI();
        }}""")
    await pg.wait_for_timeout(800)
    return await pg.evaluate(
        "() => _montagemDia.montagens.filter(m => !m.cancelada_em)[0]")


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        sql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}'")
        sql("DELETE FROM fact_statusfrota WHERE placa IN "
            "(SELECT placa FROM fact_viagens WHERE numero_carga LIKE 'MX-%')")
        sql("DELETE FROM fact_viagens WHERE numero_carga LIKE 'MX-%'")

        ctx, pg = await abrir(nav)
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.click(".nav-tab[data-tab='programacao']")
        await pg.wait_for_timeout(1200)

        print('\n=== 0. O DIA MONTADO A PARTIR DO MODELO ===')
        linha = await montar_dia(pg)
        ck('o modelo da segunda montou as cargas', bool(linha),
           f"{linha['rota_nome'] if linha else '—'}")
        if not linha:
            await nav.close()
            return 1
        mid = linha['montagem_id']
        ck('e a linha traz o apelido da rota em campo próprio',
           bool(linha.get('apelido_rota')), str(linha.get('apelido_rota')))

        print('\n=== 1. A LINHA COMEÇA FECHADA ===')
        d = await pg.evaluate("""() => ({
              linhas: document.querySelectorAll('#mont-tbody tr.mont-linha').length,
              detalhes: document.querySelectorAll('#mont-tbody tr.mont-detalhe').length,
              colunas: document.querySelectorAll('#mont-tabela thead th').length,
            })""")
        ck('todas as linhas aparecem', d['linhas'] > 0, str(d))
        ck('nenhum formulário aberto de saída', d['detalhes'] == 0, str(d))
        ck('a tabela tem 6 colunas, não 10 (o resto está no formulário)',
           d['colunas'] == 6, f"{d['colunas']} colunas")

        print('\n=== 2. CLICAR ABRE O FORMULÁRIO COMPLETO ===')
        await pg.evaluate("(id) => alternarLinhaMontagemUI(id)", mid)
        await pg.wait_for_timeout(400)
        d = await pg.evaluate("""() => {
              const det = document.querySelector('#mont-tbody tr.mont-detalhe');
              if(!det) return { aberto: false };
              const rot = [...det.querySelectorAll('label')].map(l => l.textContent.trim());
              return {
                aberto: true,
                rotulos: rot,
                temTextarea: !!det.querySelector('textarea'),
                botaoCriar: !!det.querySelector('.mont-btn-criar'),
              };
            }""")
        ck('o formulário abriu', d['aberto'], str(d)[:80])
        ROTULOS = ['Placa', 'Transportadora', 'Tipo de Veículo', 'Número de Carga',
                   'Motorista', 'Tipo de Operação', 'Peso (kg)', 'Sequência',
                   'Paletizada?', 'Qtd. Ganchos', 'Qtd. Entregas', 'Observações']
        juntos = ' | '.join(d.get('rotulos', []))
        for r in ROTULOS:
            ck(f'tem o campo {r}', r in juntos, juntos[:100] if r not in juntos else '')
        ck('Observações é caixa de texto, não linha única', d.get('temTextarea'))
        ck('e o botão de criar carga está no formulário', d.get('botaoCriar'))

        print('\n=== 3. TRANSPORTADORA E TIPO DE VEÍCULO VÊM DA FROTA ===')
        d = await pg.evaluate("""() => {
              const det = document.querySelector('#mont-tbody tr.mont-detalhe');
              const ins = [...det.querySelectorAll('input')];
              const desabilitados = ins.filter(i => i.disabled).length;
              return { desabilitados, total: ins.length };
            }""")
        ck('os dois campos da Frota não são digitáveis',
           d['desabilitados'] == 2, str(d))

        print('\n=== 4. O QUE SE DIGITA CHEGA AO BANCO ===')
        await pg.evaluate("""async (id) => {
              await alterarMontagemUI(id, 'numeroCarga', 'MX-1');
              await alterarMontagemUI(id, 'motorista', 'Jose da Silva');
              await alterarMontagemUI(id, 'peso', '13500');
              await alterarMontagemUI(id, 'observacoes', 'carregar por ultimo');
            }""", mid)
        await pg.wait_for_timeout(1000)
        r = sql(f"SELECT numero_carga, motorista, peso, observacoes, apelido_rota "
                f"FROM programacao_montagem WHERE montagem_id = '{mid}'")
        ck('número, motorista, peso e observação gravaram',
           r and r[0] == 'MX-1' and r[1] == 'Jose da Silva'
           and str(r[2]).startswith('13500') and r[3] == 'carregar por ultimo', str(r))
        ck('e a observação NÃO apagou o apelido da rota',
           r and r[4] and r[4] != 'carregar por ultimo', str(r[4] if r else None))

        print('\n=== 5. SEM PLACA NÃO VAI PARA A TORRE ===')
        d = await pg.evaluate("""() => {
              const det = document.querySelector('#mont-tbody tr.mont-detalhe');
              const b = det.querySelector('.mont-btn-criar');
              return { desabilitado: b ? b.disabled : null };
            }""")
        ck('"Criar carga" fica desabilitado sem placa', d['desabilitado'] is True, str(d))

        placa = sql("SELECT v.placa FROM dim_veiculos v LEFT JOIN fact_viagens f "
                    "ON f.placa = v.placa AND f.excluida_em IS NULL "
                    "WHERE v.transportadora <> '' AND f.carga_id IS NULL "
                    "ORDER BY v.placa LIMIT 1")
        ck('há placa livre na Frota para o teste', bool(placa), str(placa))
        await pg.evaluate("""async ([id, p]) => { await definirPlacaMontagemUI(id, p); }""",
                          [mid, placa[0]])
        await pg.wait_for_timeout(1200)
        naTorre = sql(f"SELECT count(*) FROM fact_viagens WHERE numero_carga = 'MX-1'")
        ck('digitar a placa NÃO cria a carga sozinha — a decisão é do clique',
           naTorre and naTorre[0] == '0', f"cargas na Torre: {naTorre}")

        print('\n=== 6. O CLIQUE CRIA A CARGA E ELA VAI PARA A TORRE ===')
        await pg.evaluate("(id) => efetivarMontagemUI(id)", mid)
        await pg.wait_for_timeout(2500)
        await pg.evaluate("() => SuincoSharePoint.sincronizarAgora()")
        await pg.wait_for_timeout(1500)
        r = sql("SELECT placa, motorista, peso_kg, observacoes FROM fact_viagens "
                "WHERE numero_carga = 'MX-1'")
        ck('a carga existe na Torre com os dados do formulário',
           r and r[0] == placa[0] and r[1] == 'Jose da Silva', str(r))
        ck('a observação da carga traz o apelido E o recado da Logística',
           r and 'carregar por ultimo' in (r[3] or '') and ' — ' in (r[3] or ''),
           str(r[3] if r else None))
        efet = sql(f"SELECT efetivada_em IS NOT NULL FROM programacao_montagem "
                   f"WHERE montagem_id = '{mid}'")
        ck('e a linha da montagem virou histórico, não sumiu',
           efet and efet[0] == 't', str(efet))
        d = await pg.evaluate("""(id) => {
              const m = _montagemDia.montagens.find(x => x.montagem_id === id);
              return { trancada: !!m.efetivada_em,
                       aberta: !!document.querySelector('#mont-tbody tr.mont-detalhe') };
            }""", mid)
        ck('o formulário fecha sozinho depois de virar carga',
           d['trancada'] and not d['aberta'], str(d))

        print('\n=== 7. O BOTÃO DE LOTE DIZ QUANTAS VAI MANDAR ===')
        d = await pg.evaluate("""() => {
              const b = document.getElementById('mont-btn-lote');
              return { escondido: b.hidden, texto: b.textContent.trim() };
            }""")
        ck('sem nenhuma pronta, o botão de lote some', d['escondido'], str(d))
        # Duas linhas com placa: o botão precisa aparecer e contar certo.
        placas = sql("SELECT string_agg(placa, '|') FROM (SELECT v.placa FROM dim_veiculos v "
                     "LEFT JOIN fact_viagens f ON f.placa = v.placa AND f.excluida_em IS NULL "
                     f"WHERE v.transportadora <> '' AND f.carga_id IS NULL AND v.placa <> '{placa[0]}' "
                     "ORDER BY v.placa LIMIT 2) t")
        alvos = await pg.evaluate(
            "() => _montagemDia.montagens.filter(m => !m.efetivada_em && !m.cancelada_em)"
            "        .slice(0,2).map(m => m.montagem_id)")
        for m_id, pl in zip(alvos, placas):
            await pg.evaluate("async ([id,p]) => definirPlacaMontagemUI(id,p)", [m_id, pl])
            await pg.wait_for_timeout(900)
        d = await pg.evaluate("""() => {
              const b = document.getElementById('mont-btn-lote');
              return { escondido: b.hidden, texto: b.textContent.trim() };
            }""")
        ck('com duas prontas, o botão aparece dizendo "as 2"',
           not d['escondido'] and '2' in d['texto'], str(d))

        print('\n=== 8. NO CELULAR O FORMULÁRIO CABE E DÁ PARA TOCAR ===')
        ctxm, pgm = await abrir(nav, 390, 844, movel=True)
        # No celular a navegação vira gaveta e a aba fica fora da viewport;
        # abrir por função testa a mesma tela sem depender do menu.
        await pgm.evaluate("() => abrirTab('programacao')")
        await pgm.wait_for_timeout(1200)
        alvo = await pgm.evaluate(f"""async () => {{
              document.getElementById('mont-data').value = '{DIA}';
              await carregarMontagemUI();
              const m = _montagemDia.montagens.find(x => !x.efetivada_em && !x.cancelada_em);
              if(m) alternarLinhaMontagemUI(m.montagem_id);
              return m ? m.montagem_id : null;
            }}""")
        await pgm.wait_for_timeout(600)
        m = await pgm.evaluate("""() => {
              const det = document.querySelector('#mont-tbody tr.mont-detalhe');
              if(!det) return { aberto: false };
              const campos = [...det.querySelectorAll('input:not([disabled]), select, textarea')];
              const baixos = campos.filter(c => c.getBoundingClientRect().height < 44).length;
              return { aberto: true, campos: campos.length, baixos,
                       vazaLado: document.documentElement.scrollWidth > 390 };
            }""")
        ck('o formulário abre no celular', m['aberto'] and bool(alvo), str(m)[:70])
        ck('não vaza para os lados', not m.get('vazaLado'), str(m))
        ck('todo campo tem 44px de alvo de toque',
           m.get('baixos') == 0, f"{m.get('baixos')} de {m.get('campos')} abaixo de 44px")
        await pgm.close()
        await ctxm.close()

        print('\n=== 10. O BOTÃO DE CRIAR CARGA FICA NA LINHA, NÃO SÓ NO FORMULÁRIO ===')
        # Eu tinha movido as ações para dentro do formulário e isso foi um
        # retrocesso: numa sexta de 39 cargas, mandar uma para a Torre
        # passava a exigir abrir a linha, clicar, e a linha fechar sozinha.
        d = await pg.evaluate("""() => {
              // Linha já efetivada é LEITURA: ali a coluna mostra "virou
              // carga", não um botão. Contar ela junto reprovaria o
              // comportamento certo.
              const linhas = [...document.querySelectorAll(
                '#mont-tbody tr.mont-linha:not(.linha-fraca)')];
              const comBotao = linhas.filter(tr => tr.querySelector('.mont-btn-criar')).length;
              const semPlaca = linhas.find(tr => tr.textContent.includes('sem placa'));
              const comPlaca = linhas.find(tr => {
                const b = tr.querySelector('.mont-btn-criar');
                return b && !b.disabled;
              });
              return {
                linhas: linhas.length, comBotao,
                desabilitadoSemPlaca: semPlaca
                  ? semPlaca.querySelector('.mont-btn-criar').disabled : null,
                habilitadoComPlaca: !!comPlaca,
              };
            }""")
        ck('toda linha ainda em montagem traz o botão de criar carga',
           d['comBotao'] == d['linhas'], str(d))
        ck('sem placa o botão fica desabilitado na própria linha',
           d['desabilitadoSemPlaca'] is True, str(d))
        ck('com placa ele fica clicável', d['habilitadoComPlaca'], str(d))

        # O clique no botão NÃO pode abrir/fechar a linha junto: a linha
        # inteira é clicável, e sem stopPropagation criar a carga abriria o
        # formulário de uma linha que acabou de virar leitura.
        antes = await pg.evaluate(
            "() => !!document.querySelector('#mont-tbody tr.mont-detalhe')")
        await pg.evaluate("""() => {
              const tr = [...document.querySelectorAll('#mont-tbody tr.mont-linha')]
                .find(t => { const b = t.querySelector('.mont-btn-criar'); return b && b.disabled; });
              tr.querySelector('.mont-btn-criar').click();
            }""")
        await pg.wait_for_timeout(400)
        depois = await pg.evaluate(
            "() => !!document.querySelector('#mont-tbody tr.mont-detalhe')")
        ck('clicar no botão não abre a linha por tabela',
           antes == depois, f'antes {antes} · depois {depois}')

        print('\n=== 11. CARGA FORA DO MODELO ===')
        # Frete extra e cliente novo não são exceção rara, são terça-feira.
        # Sem esta porta a Logística sai da tela e cria a carga na aba de
        # cima — e o dia deixa de estar todo num lugar só.
        antes = await pg.evaluate("() => _montagemDia.montagens.length")
        d = await pg.evaluate("""async () => {
              const sel = document.getElementById('mont-rota-extra');
              const opcoes = sel.options.length;
              sel.value = '500';
              await adicionarCargaForaDoModeloUI();
              const aberta = document.querySelector('#mont-tbody tr.mont-detalhe');
              return { opcoes, depois: _montagemDia.montagens.length,
                       abriuSozinha: !!aberta };
            }""")
        ck('o seletor traz as rotas do cadastro oficial', d['opcoes'] > 10, str(d['opcoes']))
        ck('a linha nova entrou no dia', d['depois'] == antes + 1,
           f"{antes} → {d['depois']}")
        ck('e já abre para preencher', d['abriuSozinha'], str(d))
        nova = sql(f"SELECT apelido_rota, rota_codigo FROM programacao_montagem "
                   f"WHERE data_prog = '{DIA}' ORDER BY criado_em DESC LIMIT 1")
        ck('a linha avulsa nasce SEM apelido — não veio de planilha nenhuma',
           nova and nova[0] == '' and nova[1] == '500', str(nova))

        print('\n=== 12. DESTINOS DIFERENTES NAO LEEM COMO DUPLICATA ===')
        # Relato do dono: "tao saindo duplicadas as rotas". Nao eram
        # duplicatas: o de-para colapsa destinos diferentes no mesmo codigo
        # (na terca, Arinos/Buritis, Joao Pinheiro, Paracatu, Riachinho e
        # Unai sao todos "504"), e a tela gritava a PRACA e sussurrava o
        # destino. Seis linhas com o mesmo titulo em negrito.
        d = await pg.evaluate(
            """() => {
                 const tit = [...document.querySelectorAll('#mont-tbody tr.mont-linha strong')]
                   .map(e => e.textContent.trim());
                 const comApelido = _montagemDia.montagens
                   .filter(m => !m.cancelada_em && m.apelido_rota);
                 return { titulos: tit,
                          distintos: new Set(tit).size,
                          apelidos: comApelido.map(m => m.apelido_rota),
                          apelidosDistintos: new Set(comApelido.map(m => m.apelido_rota)).size };
               }""")
        ck('cada destino distinto tem um titulo distinto na tela',
           d['distintos'] >= d['apelidosDistintos'],
           f"{d['distintos']} titulos para {d['apelidosDistintos']} destinos")
        ck('e o titulo e o destino da planilha, nao o nome da praca',
           all(a in d['titulos'] for a in set(d['apelidos'])),
           str(d['titulos'][:4]))

        print('\n=== 13. EXCLUIR NA PROPRIA LINHA ===')
        # Numa sexta de 42 linhas, tirar a que nao vai rodar nao pode
        # exigir abrir o formulario antes.
        alvo = await pg.evaluate(
            "() => _montagemDia.montagens.find(m => !m.efetivada_em && !m.cancelada_em).montagem_id")
        d = await pg.evaluate(
            """() => {
                 const tr = [...document.querySelectorAll('#mont-tbody tr.mont-linha')]
                   .find(t => t.querySelector('.mont-btn-excluir'));
                 return { temBotao: !!tr };
               }""")
        ck('a linha traz o botao de excluir sem precisar abrir', d['temBotao'], str(d))
        antes = await pg.evaluate(
            "() => _montagemDia.montagens.filter(m => !m.cancelada_em).length")
        await pg.evaluate("() => { window.prompt = () => 'nao vai rodar hoje'; }")
        await pg.evaluate("(id) => cancelarMontagemUI(id)", alvo)
        await pg.wait_for_timeout(1500)
        depois = await pg.evaluate(
            "() => _montagemDia.montagens.filter(m => !m.cancelada_em).length")
        ck('excluir tira a linha do dia', depois == antes - 1, f'{antes} -> {depois}')
        noBanco = sql("SELECT cancelada_em IS NOT NULL, motivo_cancelo "
                      "FROM programacao_montagem WHERE montagem_id = '" + alvo + "'")
        ck('e ela continua no banco, com o motivo — nao some sem rastro',
           bool(noBanco) and noBanco[0] == 't' and bool(noBanco[1]), str(noBanco))

        print('\n=== 14. O DIA SAI EM PLANILHA ===')
        # O painel substituiu o Excel na operacao, mas a planilha tambem era
        # o ARQUIVO do dia. Tirar sem repor troca um problema por outro.
        d = await pg.evaluate(
            """async () => {
                 let baixado = null;
                 const antes = window.baixarCsvDoDia;
                 window.baixarCsvDoDia = (nome, cab, linhas) => {
                   baixado = { nome, cab, linhas };
                 };
                 await exportarMontagemDoDiaUI();
                 window.baixarCsvDoDia = antes;
                 if(!baixado) return { gerou: false };
                 return { gerou: true, nome: baixado.nome,
                          colunas: baixado.cab,
                          linhas: baixado.linhas.length,
                          primeira: baixado.linhas[0],
                          vivas: _montagemDia.montagens.filter(m => !m.cancelada_em).length };
               }""")
        ck('a exportacao gera o arquivo', d['gerou'], str(d)[:80])
        ck('o nome do arquivo traz o dia', DIA in (d.get('nome') or ''), str(d.get('nome')))
        for coluna in ('Sequência', 'Carga', 'Rota', 'Pra onde?', 'Placa',
                       'Transportadora', 'Peso (t)', 'Paletizada', 'Situação'):
            ck(f'tem a coluna {coluna}', coluna in (d.get('colunas') or []),
               str(d.get('colunas'))[:90])
        ck('uma linha por carga viva do dia',
           d.get('linhas') == d.get('vivas'), f"{d.get('linhas')} de {d.get('vivas')}")

        print('\n=== 9. SEM ERRO DE JAVASCRIPT ===')
        ck('console limpo', not erros, '; '.join(erros[:3]))

        sql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}'")
        sql("DELETE FROM fact_statusfrota WHERE placa IN "
            "(SELECT placa FROM fact_viagens WHERE numero_carga LIKE 'MX-%')")
        sql("DELETE FROM fact_viagens WHERE numero_carga LIKE 'MX-%'")
        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('  Tudo verde.')
    return 0


sys.exit(asyncio.run(main()))
