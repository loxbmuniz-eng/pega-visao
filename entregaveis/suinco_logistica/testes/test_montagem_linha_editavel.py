#!/usr/bin/env python3
"""Montagem do Dia: os campos da linha se preenchem NA LINHA. (28/08/2026)

RELATO DO DONO, com foto da tela de produção:

  "porra ficou faltando os campos rota peso numero de carga, veiculo ta
   aparecendo sem placa, porque nao estao editaveis??? editaveis, as placas
   que estao neles nao estao puxando direto as infos da placa como veiculo"

O QUE A FOTO MOSTRAVA

  39 linhas montadas. As colunas Nº Carga, Veículo e Peso exibiam um traço
  em todas elas, e não recebiam digitação: eram TEXTO. O único campo que
  aceitava escrita na linha era o de Motorista — e era exatamente ali que
  as placas do dia estavam escritas (RNT5J03, RNV2A77, RNW7J57...), porque
  era o único lugar onde dava para escrever. Coluna que mostra um traço e
  não aceita o dado ensina a pessoa a guardá-lo no campo errado, e o dado
  vai parar onde ninguém vai procurar.

  O servidor aceitava numeroCarga, peso, placa e rotaCodigo desde sempre.
  Faltava a TELA oferecer.

O QUE ESTE TESTE TRAVA

  1. as quatro colunas são campos de verdade na linha, não texto;
  2. digitar em cada uma grava no servidor (relê do banco, não da tela);
  3. a placa traz o que a Frota já sabe — transportadora, tipo de veículo
     e motorista — em vez de exigir redigitação;
  4. o motorista escrito à mão NÃO é sobrescrito pelo cadastro: é a
     exceção do dia e apagá-la seria pior que não preencher nada;
  5. digitar não abre nem fecha a linha (o clique na linha expande, e sem
     stopPropagation cada tecla brigaria com isso).

    python3 testes/test_montagem_linha_editavel.py
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
        sql("DELETE FROM programacao_montagem WHERE numero_carga LIKE 'ED-%' "
            "OR criado_por LIKE '%teste%'")

        # A placa do teste é CADASTRADA ANTES DE ABRIR O PAINEL, com
        # motorista e tipo, e apagada no fim.
        #
        # Duas razões. Pegar uma placa qualquer da Frota real fazia o teste
        # depender de sorte: vindo uma sem motorista, a checagem mais
        # importante — "a placa puxa o motorista" — passava em branco sem
        # provar nada. E cadastrar DEPOIS do login não adianta: a Frota é
        # dimensão de leitura, carregada uma vez na abertura do painel, e
        # um sincronizarAgora() não traz placa nova.
        PLACA, TRANSP = 'TST9E99', 'TRANSPORTES DO TESTE'
        MOTORISTA_FROTA, TIPO = 'CARLOS DA FROTA', 'Carreta'
        sql(f"DELETE FROM dim_veiculos WHERE placa = '{PLACA}'")
        sql("INSERT INTO dim_veiculos (placa, transportadora, tipo_veiculo, motorista, "
            f"atualizado_em) VALUES ('{PLACA}', '{TRANSP}', '{TIPO}', '{MOTORISTA_FROTA}', now())")
        conferido = sql(f"SELECT placa, motorista FROM dim_veiculos WHERE placa = '{PLACA}'")
        ck('a placa de teste entrou na Frota com motorista',
           conferido and conferido[1] == MOTORISTA_FROTA, str(conferido))
        print(f"      placa {PLACA} · {TRANSP} · motorista no cadastro: {MOTORISTA_FROTA!r}")


        ctx = await nav.new_context(viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        html = open(PAINEL_ARQ, encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = f'{API}/__montagem_edit'
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


        rota = sql("SELECT codigo FROM dim_rotas ORDER BY codigo LIMIT 1")
        rota2 = sql("SELECT codigo FROM dim_rotas ORDER BY codigo DESC LIMIT 1")

        print('\n=== 1. A LINHA NASCE E APARECE NA TELA ===')
        mid = await pg.evaluate(
            """async (rota) => {
                 const hoje = new Date().toISOString().slice(0,10);
                 const r = await SuincoSharePoint.montagem.criar({
                   dia: hoje, rotaCodigo: rota, sequencia: 1, qtdEntregas: 1});
                 return r.montagem.montagem_id;
               }""", rota[0])
        await pg.evaluate("() => abrirTab('programacao')")
        await pg.evaluate("async () => { await carregarMontagemUI(); }")
        await pg.wait_for_timeout(900)
        # MIRA A LINHA DELE, NÃO A PRIMEIRA DA TABELA. Uma execução
        # anterior que morreu no meio deixa uma linha órfã no dia, e o
        # teste seguinte passava a preencher a linha errada — reprovando
        # com o código certo. O id da montagem está no onclick da linha.
        LINHA = f'#mont-tbody tr.mont-linha[onclick*="{mid}"]'
        linhas = await pg.evaluate(f"() => document.querySelectorAll('{LINHA}').length")
        ck('a linha montada aparece na Montagem do Dia', linhas == 1, f'{linhas} linha(s)')

        print('\n=== 2. AS QUATRO COLUNAS SÃO CAMPOS, NÃO TEXTO ===')
        # É a checagem que reprova contra a versão que o dono fotografou:
        # lá estas células não tinham input nenhum.
        campos = await pg.evaluate("""(SELETOR) => {
            const tr = document.querySelector(SELETOR);
            if(!tr) return null;
            const q = s => !!tr.querySelector(s);
            return {
              numero:    q('.numero-carga-input'),
              placa:     q('.placa-input'),
              peso:      q('.peso-input'),
              rota:      q('select.rota-inline'),
              motorista: q('.motorista-input'),
              sequencia: q('.seq-input'),
            };
        }""", LINHA)
        for nome, achou in (campos or {}).items():
            ck(f'a coluna {nome} aceita digitação na linha', achou is True)

        # Sem os campos, tudo daqui para baixo tentaria digitar em coisa
        # que não existe e ficaria 30 segundos por tentativa esperando um
        # seletor que nunca aparece. Contra a versão que o dono fotografou
        # isso são minutos de espera para dizer o que já está dito acima.
        if not campos or not all(campos.values()):
            print('\n  Os campos não existem na linha — o resto do teste não '
                  'tem o que preencher.')
            sql(f"DELETE FROM programacao_montagem WHERE montagem_id = '{mid}'")
            sql(f"DELETE FROM dim_veiculos WHERE placa = '{PLACA}'")
            await nav.close()
            print('\n' + '=' * 55)
            print(f"  {len(falhas)} FALHA(S):")
            for f in falhas:
                print(f"    - {f}")
            return 1

        print('\n=== 3. DIGITAR NA LINHA GRAVA NO SERVIDOR ===')
        # Lê do BANCO, não da tela: tela que mostra o valor certo e não
        # gravou é o defeito mais caro deste painel, e já aconteceu.
        await pg.fill(LINHA + ' .numero-carga-input', 'ED-77')
        await pg.dispatch_event(LINHA + ' .numero-carga-input', 'change')
        await pg.wait_for_timeout(900)
        v = sql(f"SELECT numero_carga FROM programacao_montagem WHERE montagem_id = '{mid}'")
        ck('o número da carga digitado na linha chegou ao banco',
           v and v[0] == 'ED-77', str(v))

        await pg.fill(LINHA + ' .peso-input', '8450')
        await pg.dispatch_event(LINHA + ' .peso-input', 'change')
        await pg.wait_for_timeout(900)
        v = sql(f"SELECT peso FROM programacao_montagem WHERE montagem_id = '{mid}'")
        ck('o peso digitado na linha chegou ao banco',
           v and str(v[0]).startswith('8450'), str(v))

        print('\n=== 4. A PLACA TRAZ O QUE A FROTA JÁ SABE ===')
        await pg.fill(LINHA + ' .placa-input', PLACA)
        await pg.dispatch_event(LINHA + ' .placa-input', 'change')
        await pg.wait_for_timeout(1200)
        v = sql(f"SELECT placa, transportadora, motorista FROM programacao_montagem "
                f"WHERE montagem_id = '{mid}'")
        ck('a placa digitada na linha chegou ao banco', v and v[0] == PLACA, str(v))
        ck('a transportadora veio da Frota sozinha',
           v and v[1] == TRANSP, f"gravado {v and v[1]!r}, cadastro diz {TRANSP!r}")
        ck('o motorista veio da Frota sozinho',
           v and v[2] == MOTORISTA_FROTA, f"gravado {v and v[2]!r}")

        # A tela precisa MOSTRAR o que puxou: gravar sem mostrar é o mesmo
        # que não puxar, do ponto de vista de quem monta o dia.
        await pg.wait_for_timeout(400)
        visivel = await pg.evaluate("""(SELETOR) => {
            const c = document.querySelector(SELETOR + ' .cel-veiculo');
            return c ? c.innerText.replace(/\\s+/g,' ').trim() : '';
        }""", LINHA)
        ck('a célula do veículo mostra a transportadora puxada',
           TRANSP.split(' ')[0].upper() in visivel.upper(), visivel[:90])
        if TIPO:
            ck('a célula do veículo mostra o tipo de veículo puxado',
               TIPO.upper() in visivel.upper(), visivel[:90])

        print('\n=== 5. MOTORISTA ESCRITO À MÃO NÃO É APAGADO PELO CADASTRO ===')
        await pg.evaluate("""async (id) =>
            SuincoSharePoint.montagem.alterar(id, {placa: '', motorista: 'JOAO DO DIA'})""", mid)
        await pg.evaluate("async () => { await carregarMontagemUI(); }")
        await pg.wait_for_timeout(700)
        await pg.fill(LINHA + ' .placa-input', PLACA)
        await pg.dispatch_event(LINHA + ' .placa-input', 'change')
        await pg.wait_for_timeout(1200)
        v = sql(f"SELECT motorista FROM programacao_montagem WHERE montagem_id = '{mid}'")
        ck('o motorista do dia sobrevive à troca de placa',
           v and v[0] == 'JOAO DO DIA', str(v))

        print('\n=== 6. TROCAR A ROTA NA LINHA ===')
        if rota2 and rota2[0] != rota[0]:
            await pg.select_option(LINHA + ' select.rota-inline', rota2[0])
            await pg.wait_for_timeout(1100)
            v = sql(f"SELECT rota_codigo, apelido_rota FROM programacao_montagem "
                    f"WHERE montagem_id = '{mid}'")
            ck('a rota trocada na linha chegou ao banco', v and v[0] == rota2[0], str(v))
            # O apelido vem do modelo e descreve a rota ANTIGA: mantê-lo
            # deixaria o nome errado em negrito por cima da rota certa.
            ck('o apelido do modelo não sobrevive à troca de rota',
               v and not v[1], f"apelido ficou {v and v[1]!r}")

        print('\n=== 7. DIGITAR NÃO ABRE NEM FECHA A LINHA ===')
        antes = await pg.evaluate("() => document.querySelectorAll('#mont-tbody tr.mont-detalhe').length")
        await pg.click(LINHA + ' .numero-carga-input')
        await pg.wait_for_timeout(500)
        depois = await pg.evaluate("() => document.querySelectorAll('#mont-tbody tr.mont-detalhe').length")
        ck('clicar dentro de um campo não expande a linha', antes == depois,
           f'{antes} → {depois} formulário(s) abertos')

        print('\n=== 8. CELULAR ===')
        # A MESMA PÁGINA, ESTREITADA. Abrir uma aba nova no mesmo contexto
        # dava uma Montagem vazia: a página nasce já logada (a sessão é do
        # contexto) e o caminho que carrega o dia não roda. Estreitar a
        # página que já está com o dia na tela testa exatamente o que
        # interessa — a MESMA linha, no viewport do celular.
        await pg.set_viewport_size({'width': 390, 'height': 844})
        await pg.wait_for_timeout(600)
        await pg.evaluate("async () => { await carregarMontagemUI(); }")
        await pg.wait_for_timeout(900)
        larg = await pg.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        ck('a Montagem não ganhou rolagem lateral no celular', larg <= 1, f'{larg}px sobrando')
        toque = await pg.evaluate("""(SELETOR) => {
            const e = document.querySelector(SELETOR + ' .placa-input');
            if(!e) return null;
            // No celular a linha vira cartão: o alvo de toque é a CÉLULA
            // inteira, com o rótulo em cima do campo.
            const td = e.closest('td');
            return Math.round((td || e).getBoundingClientRect().height);
        }""", LINHA)
        ck('o campo de placa tem alvo de toque no celular',
           toque is not None and toque >= 44, f'{toque}px')
        # Os campos que o dono cobrou precisam estar à MÃO no celular, sem
        # exigir que ele abra o cartão antes: foi por não ter onde escrever
        # que as placas foram parar no campo de motorista.
        visiveis = await pg.evaluate("""(SELETOR) => {
            const tr = document.querySelector(SELETOR);
            if(!tr) return null;
            const vis = s => { const e = tr.querySelector(s);
              return !!e && e.getBoundingClientRect().height > 0; };
            return { numero: vis('.numero-carga-input'), placa: vis('.placa-input'),
                     peso: vis('.peso-input'), rota: vis('select.rota-inline') };
        }""", LINHA)
        for nome, ok in (visiveis or {}).items():
            ck(f'no celular o campo {nome} aparece sem precisar abrir o cartão', ok is True)

        ck('nenhum erro de JavaScript', not erros, ' | '.join(erros[:3]))
        sql(f"DELETE FROM programacao_montagem WHERE montagem_id = '{mid}'")
        sql(f"DELETE FROM dim_veiculos WHERE placa = '{PLACA}'")
        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f"  {len(falhas)} FALHA(S):")
        for f in falhas:
            print(f"    - {f}")
        return 1
    print('  Tudo verde.')
    return 0


sys.exit(asyncio.run(main()))
