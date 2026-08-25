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
                // Sem placa o rodape traz "Colocar placa"; com placa,
                // "Criar carga". O que se garante e que SEMPRE ha uma acao
                // de avanco ali — nunca um botao travado (ver bloco 5).
                botaoAvanco: !!det.querySelector('.mont-btn-criar, .mont-btn-placa'),
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
        ck('e o formulário termina com a ação de avanço da linha',
           d.get('botaoAvanco'))

        print('\n=== 3. O QUE VEM DA FROTA E O QUE DÁ PARA TROCAR ===')
        # MUDOU EM 25/08/2026, a pedido do dono ("transportadora também").
        # Antes os DOIS campos da Frota eram travados. Hoje só o Tipo de
        # Veículo é: ele descreve o caminhão, e o caminhão é o que é.
        # Transportadora é OUTRA coisa — descreve quem faz a viagem, e isso
        # muda no dia (subcontratação, freteiro, troca de última hora). A
        # planilha antiga permitia escrever isso sem discussão; travar era
        # perder informação verdadeira, não proteger o cadastro.
        d = await pg.evaluate("""() => {
              const det = document.querySelector('#mont-tbody tr.mont-detalhe');
              const ins = [...det.querySelectorAll('input')];
              const porRotulo = (txt) => {
                const g = [...det.querySelectorAll('.form-group')]
                  .find(x => x.querySelector('label')
                          && x.querySelector('label').innerText.includes(txt));
                return g ? g.querySelector('input') : null;
              };
              const transp = porRotulo('Transportadora');
              const tipo = porRotulo('Tipo de Veículo');
              return {
                desabilitados: ins.filter(i => i.disabled).length,
                transpEditavel: transp ? !transp.disabled : null,
                transpTemLista: transp ? transp.getAttribute('list') : null,
                tipoTravado: tipo ? tipo.disabled : null,
              };
            }""")
        ck('Tipo de Veículo continua vindo travado da Frota',
           d['tipoTravado'] is True, str(d))
        ck('Transportadora virou campo editável', d['transpEditavel'] is True, str(d))
        ck('e oferece as transportadoras já cadastradas',
           d['transpTemLista'] == 'lista-transportadoras', str(d))
        ck('só o Tipo de Veículo fica travado agora',
           d['desabilitados'] == 1, str(d))

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
        # MUDOU EM 25/08/2026. Antes o formulário mostrava "Criar carga"
        # desabilitado. O dono mandou foto da tela perguntando "por que nao
        # consigo clicar em cima de criar carga?????" — a regra estava
        # certa (sem placa não há carga) e a comunicação estava errada: um
        # botão dourado que não aperta nega sem ensinar o caminho.
        # A trava continua; o que mudou é que agora ela ABRE o caminho.
        d = await pg.evaluate("""() => {
              const det = document.querySelector('#mont-tbody tr.mont-detalhe');
              return {
                temCriar: !!det.querySelector('.mont-btn-criar'),
                temColocarPlaca: !!det.querySelector('.mont-btn-placa'),
                desabilitados: [...det.querySelectorAll('button')]
                                 .filter(b => b.disabled).length,
              };
            }""")
        ck('sem placa não existe botão de criar carga', d['temCriar'] is False, str(d))
        ck('no lugar dele aparece "Colocar placa"', d['temColocarPlaca'] is True, str(d))
        ck('e nenhum botão fica no beco sem saída (desabilitado)',
           d['desabilitados'] == 0, str(d))

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
              const semPlaca = linhas.find(tr => tr.textContent.includes('sem placa'));
              const comPlaca = linhas.find(tr => {
                const b = tr.querySelector('.mont-btn-criar');
                return b && !b.disabled;
              });
              return {
                linhas: linhas.length,
                // Toda linha oferece UMA ação de avanço: criar (com placa)
                // ou colocar placa (sem). Nenhuma fica sem saída.
                comAcao: linhas.filter(tr =>
                  tr.querySelector('.mont-btn-criar, .mont-btn-placa')).length,
                semPlacaOferecePlaca: semPlaca
                  ? !!semPlaca.querySelector('.mont-btn-placa') : null,
                semPlacaNaoTemCriar: semPlaca
                  ? !semPlaca.querySelector('.mont-btn-criar') : null,
                habilitadoComPlaca: !!comPlaca,
                // A regra que o dono reclamou: zero botões travados na tela.
                travadosNaTela: [...document.querySelectorAll(
                  '#mont-tbody button')].filter(b => b.disabled).length,
              };
            }""")
        ck('toda linha ainda em montagem traz uma ação de avanço',
           d['comAcao'] == d['linhas'], str(d))
        ck('sem placa a linha oferece "Colocar placa"',
           d['semPlacaOferecePlaca'] is True, str(d))
        ck('e não mostra "Criar carga" só para negá-lo',
           d['semPlacaNaoTemCriar'] is True, str(d))
        ck('com placa o botão de criar fica clicável', d['habilitadoComPlaca'], str(d))
        ck('nenhum botão travado na montagem do dia',
           d['travadosNaTela'] == 0, str(d))

        # O clique no botão NÃO pode abrir/fechar a linha junto: a linha
        # inteira é clicável, e sem stopPropagation criar a carga abriria o
        # formulário de uma linha que acabou de virar leitura.
        antes = await pg.evaluate(
            "() => !!document.querySelector('#mont-tbody tr.mont-detalhe')")
        # Clica no EXCLUIR de uma linha e cancela o prompt: a ação não
        # acontece, então o único efeito observável seria a linha abrir por
        # tabela — que é justamente o que o stopPropagation impede.
        # (Antes este trecho clicava num "Criar carga" desabilitado; esse
        #  botão não existe mais desde 25/08 — ver bloco 5.)
        await pg.evaluate("() => { window.__promptReal = window.prompt; window.prompt = () => null; }")
        await pg.evaluate("""() => {
              const tr = [...document.querySelectorAll(
                '#mont-tbody tr.mont-linha:not(.linha-fraca)')][0];
              tr.querySelector('.mont-btn-excluir').click();
            }""")
        await pg.wait_for_timeout(400)
        depois = await pg.evaluate(
            "() => !!document.querySelector('#mont-tbody tr.mont-detalhe')")
        await pg.evaluate("() => { window.prompt = window.__promptReal; }")
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

        print('\n=== 15. PUXAR DUAS VEZES NAO DUPLICA, NEM COM CODIGO REPETIDO ===')
        # Relato do dono: "ta tudo duplicado ainda na montagem do dia".
        # Na terca, Arinos/Buritis, Joao Pinheiro, Paracatu, Riachinho e
        # Unai sao todos o codigo 504. Contando por codigo, o painel sabia
        # que "faltam 2 de 504" e nao sabia QUAIS 2 — puxava duas quaisquer.
        # Agora casa pela LINHA do modelo.
        d = await pg.evaluate(
            """async () => {
                 window.confirm = () => true;
                 const antes = _montagemDia.montagens.filter(m => !m.cancelada_em).length;
                 // Linha do modelo que foi CANCELADA volta a ser oferecida, e
                 // isso e certo: quem cancelou por engano puxa de novo e ela
                 // volta. Entao o esperado nao e "zero novas" — e "nenhuma
                 // linha do modelo aparecendo duas vezes".
                 const canceladasDoModelo = new Set(
                   _montagemDia.montagens.filter(m => m.cancelada_em && m.modelo_id != null)
                     .map(m => String(m.modelo_id))).size;
                 await aplicarModeloDoDiaUI();
                 const depois = _montagemDia.montagens.filter(m => !m.cancelada_em).length;
                 const vivas = _montagemDia.montagens.filter(m => !m.cancelada_em);
                 const doModelo = vivas.filter(m => m.modelo_id != null)
                                       .map(m => String(m.modelo_id));
                 return { antes, depois, canceladasDoModelo,
                          linhasDoModelo: doModelo.length,
                          distintas: new Set(doModelo).size };
               }""")
        ck('puxar de novo so recria o que foi cancelado',
           d['depois'] - d['antes'] == d['canceladasDoModelo'],
           f"{d['antes']} -> {d['depois']}, {d['canceladasDoModelo']} cancelada(s)")
        ck('nenhuma linha do modelo virou carga duas vezes',
           d['linhasDoModelo'] == d['distintas'],
           f"{d['linhasDoModelo']} linhas, {d['distintas']} distintas")

        print('\n=== 16. CANCELADA SOME DA TELA, MAS NAO DO BANCO ===')
        # Pedido do dono: a montagem e a lista do que VAI rodar hoje; linha
        # cancelada ali e ruido entre as que ainda pedem trabalho.
        alvo2 = await pg.evaluate(
            "() => _montagemDia.montagens.find(m => !m.efetivada_em && !m.cancelada_em).montagem_id")
        await pg.evaluate("() => { window.prompt = () => 'rota nao sai hoje'; }")
        await pg.evaluate("(id) => cancelarMontagemUI(id)", alvo2)
        await pg.wait_for_timeout(1500)
        d = await pg.evaluate(
            """(id) => {
                 const linhas = [...document.querySelectorAll('#mont-tbody tr.mont-linha')];
                 return { naTela: linhas.some(t => t.outerHTML.includes(id)),
                          textoCancelada: linhas.some(t => /CANCELADA/i.test(t.textContent)),
                          total: linhas.length };
               }""", alvo2)
        ck('a linha cancelada some da tela', not d['naTela'], str(d))
        ck('e nenhuma linha fica marcada como CANCELADA',
           not d['textoCancelada'], str(d))
        noBanco = sql("SELECT cancelada_em IS NOT NULL, motivo_cancelo "
                      "FROM programacao_montagem WHERE montagem_id = '" + alvo2 + "'")
        ck('mas continua no banco, com motivo e hora',
           bool(noBanco) and noBanco[0] == 't' and bool(noBanco[1]), str(noBanco))

        print('\n=== 17. ORDENAR E TROCAR A TRANSPORTADORA SEM ABRIR A LINHA ===')
        # Pedido do dono, 25/08/2026, em duas mensagens seguidas: "o campo
        # da sequencia na cargas do dia precisa ter o campo sequencia
        # disponivel para edicao e organizacao de sequencia tambem" e, logo
        # depois, "transportadora tambem".
        #
        # Por que na LINHA e nao so no formulario: ordenar o dia e trabalho
        # de VARREDURA. A pessoa olha as 42 linhas de sexta e decide quem
        # carrega primeiro. Abrir e fechar um formulario por linha para
        # mexer num numero e exatamente o que fazia isso continuar sendo
        # feito no Excel.
        # Prefere uma linha COM placa: sem placa, a checagem de que a
        # transportadora do dia nao reescreve o cadastro da Frota nao teria
        # o que exercer, e passaria por omissao.
        alvo3 = await pg.evaluate(
            """() => {
                 const vivas = _montagemDia.montagens
                   .filter(m => !m.efetivada_em && !m.cancelada_em);
                 return (vivas.find(m => m.placa) || vivas[0]).montagem_id;
               }""")

        d = await pg.evaluate("""(id) => {
              const tr = [...document.querySelectorAll('#mont-tbody tr.mont-linha')]
                .find(t => t.outerHTML.includes(id));
              const inp = tr ? tr.querySelector('input.seq-input') : null;
              return {
                temCampo: !!inp,
                tipo: inp ? inp.type : null,
                // O <td> em volta precisa engolir o clique: a linha inteira
                // abre ao ser clicada, e sem isso digitar a sequencia
                // abriria/fecharia o formulario a cada toque.
                tdBloqueiaClique: inp
                  ? !!inp.closest('td').getAttribute('onclick') : null,
                aberta: !!document.querySelector('#mont-tbody tr.mont-detalhe'),
              };
            }""", alvo3)
        ck('a sequencia e um campo na propria linha', d['temCampo'] is True, str(d))
        ck('e um campo numerico', d['tipo'] == 'number', str(d))
        ck('o clique nele nao abre a linha por tabela',
           d['tdBloqueiaClique'] is True, str(d))

        # Digitar na linha tem que CHEGAR AO BANCO — o resto e enfeite.
        await pg.evaluate("""async (id) => {
              const tr = [...document.querySelectorAll('#mont-tbody tr.mont-linha')]
                .find(t => t.outerHTML.includes(id));
              const inp = tr.querySelector('input.seq-input');
              inp.value = '77';
              inp.dispatchEvent(new Event('change', { bubbles: true }));
            }""", alvo3)
        await pg.wait_for_timeout(1500)
        r = sql("SELECT sequencia FROM programacao_montagem WHERE montagem_id = '" + alvo3 + "'")
        ck('a sequencia digitada na linha chega ao banco',
           bool(r) and str(r[0]) == '77', str(r))

        # TRANSPORTADORA: vazio significa "o que a Frota disser"; preenchido
        # e a excecao do dia, e nao pode encostar no cadastro do veiculo.
        #
        # A linha precisa TER placa para a garantia valer alguma coisa: sem
        # placa nao ha cadastro de Frota para (nao) ser reescrito, e o teste
        # passaria por omissao. A esta altura da bateria as linhas com placa
        # ja viraram carga, entao o teste poe uma.
        placaAlvo = sql("SELECT placa FROM programacao_montagem "
                        "WHERE montagem_id = '" + alvo3 + "'")
        if not (placaAlvo and placaAlvo[0]):
            livre = sql("SELECT v.placa FROM dim_veiculos v LEFT JOIN fact_viagens f "
                        "ON f.placa = v.placa AND f.excluida_em IS NULL "
                        "WHERE v.transportadora <> '' AND f.carga_id IS NULL "
                        "AND v.placa NOT IN (SELECT placa FROM programacao_montagem "
                        "                     WHERE data_prog = '" + DIA + "' AND placa <> '') "
                        "ORDER BY v.placa LIMIT 1")
            if livre:
                await pg.evaluate("(a) => definirPlacaMontagemUI(a[0], a[1])",
                                  [alvo3, livre[0]])
                await pg.wait_for_timeout(1500)
                placaAlvo = sql("SELECT placa FROM programacao_montagem "
                                "WHERE montagem_id = '" + alvo3 + "'")
        await pg.evaluate("(id) => alterarMontagemUI(id, 'transportadora', 'TRANSPORTES TESTE 77')", alvo3)
        await pg.wait_for_timeout(1500)
        r = sql("SELECT transportadora FROM programacao_montagem WHERE montagem_id = '" + alvo3 + "'")
        ck('a transportadora do dia grava na linha da montagem',
           bool(r) and r[0] == 'TRANSPORTES TESTE 77', str(r))

        ck('a linha escolhida tem placa — a garantia abaixo tem o que exercer',
           bool(placaAlvo and placaAlvo[0]), str(placaAlvo))
        if placaAlvo and placaAlvo[0]:
            cad = sql("SELECT transportadora FROM dim_veiculos WHERE placa = '" + placaAlvo[0] + "'")
            ck('e NAO reescreve o cadastro da Frota daquela placa',
               bool(cad) and cad[0] != 'TRANSPORTES TESTE 77', str(cad))

        # E O PONTO INTEIRO DO CAMPO: a excecao do dia tem que CHEGAR NA
        # CARGA. Se ficasse so na linha da montagem, quem confere o frete
        # continuaria vendo a transportadora do cadastro — e o campo seria
        # enfeite.
        await pg.evaluate("(id) => efetivarMontagemUI(id, { silencioso: true })", alvo3)
        await pg.wait_for_timeout(2500)
        r = sql("SELECT f.transportadora FROM fact_viagens f "
                "JOIN programacao_montagem g ON g.carga_id = f.carga_id "
                "WHERE g.montagem_id = '" + alvo3 + "'")
        ck('a transportadora do dia vai junto para a carga na Torre',
           bool(r) and r[0] == 'TRANSPORTES TESTE 77', str(r))

        # E TEM QUE APARECER NA PLANILHA DO DIA. O arquivo do dia e o
        # registro que a Suinco sempre teve; se ele mostrasse a
        # transportadora do CADASTRO, a excecao registrada de proposito
        # sumiria justamente no papel que existe para guarda-la.
        d = await pg.evaluate(
            """async (id) => {
                 let baixado = null;
                 const real = window.baixarCsvDoDia;
                 window.baixarCsvDoDia = (nome, cab, linhas) => {
                   baixado = { nome, cab, linhas };
                 };
                 await exportarMontagemDoDiaUI();
                 window.baixarCsvDoDia = real;
                 if(!baixado) return { gerou: false };
                 const iTransp = baixado.cab.indexOf('Transportadora');
                 const iPlaca = baixado.cab.indexOf('Placa');
                 const m = _montagemDia.montagens.find(x => x.montagem_id === id);
                 const linha = baixado.linhas.find(l => m && l[iPlaca] === m.placa);
                 return { gerou: true, transpNaPlanilha: linha ? linha[iTransp] : null };
               }""", alvo3)
        ck('a transportadora do dia e a que sai na planilha do dia',
           d.get('transpNaPlanilha') == 'TRANSPORTES TESTE 77', str(d))

        print('\n=== 18. "COLOCAR PLACA" ABRE A LINHA NO CAMPO CERTO ===')
        # A promessa do botao e "clique para colocar a placa". Abrir a linha
        # e deixar a pessoa procurar o campo entre nove outros seria
        # prometer uma coisa e entregar outra.
        await pg.evaluate("() => { _montagemAberta = null; renderMontagem(); }")
        d = await pg.evaluate("""async () => {
              const tr = [...document.querySelectorAll(
                '#mont-tbody tr.mont-linha:not(.linha-fraca)')]
                .find(t => t.querySelector('.mont-btn-placa'));
              if(!tr) return { achou: false };
              tr.querySelector('.mont-btn-placa').click();
              await new Promise(r => setTimeout(r, 300));
              const det = document.querySelector('#mont-tbody tr.mont-detalhe');
              const foco = document.activeElement;
              return {
                achou: true,
                abriu: !!det,
                focoNaPlaca: !!(foco && foco.id && foco.id.startsWith('montf-placa-')),
                focoEm: foco ? (foco.id || foco.tagName) : null,
              };
            }""")
        ck('existe linha sem placa para o teste', d['achou'] is True, str(d))
        if d['achou']:
            ck('o botao abre o formulario da linha', d['abriu'] is True, str(d))
            ck('e o cursor ja fica no campo da placa',
               d['focoNaPlaca'] is True, str(d))

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
