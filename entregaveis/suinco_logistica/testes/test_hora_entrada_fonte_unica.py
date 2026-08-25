#!/usr/bin/env python3
"""A hora de entrada no pátio é UMA só, e é a do servidor. (25/08/2026)

Relato do dono, com print do porteiro na mão: a mesma placa mostrava três
horários diferentes de entrada — um na Torre do celular, outro no print da
Portaria, outro na Torre do desktop. "Não pode haver quebra de dados em
relação aos horários."

CAUSA, achada lendo o código e reproduzida aqui:

  1. quando a Portaria registra a chegada, o painel grava uma movimentação
     LOCAL, com id gerado no aparelho (uid) e horário do RELÓGIO DO
     APARELHO — para a tela responder na hora, mesmo offline;
  2. o servidor grava a SUA movimentação, com id próprio e `data_evento`
     do relógio DELE (a coluna nem entra no INSERT: vai no default now());
  3. a fusão do estado remoto deduplica POR ID — e os dois ids nunca
     batem. Resultado: duas movimentações para o MESMO evento real, com
     horários diferentes, convivendo no aparelho de quem registrou;
  4. `entradaNoPatioDe` pega a PRIMEIRA da lista ordenada por horário.
     Quem tem as duas vê uma; quem só recebeu a do servidor vê outra.

  E somado a isso: três telas faziam `entradaNoPatioDe(c) || c.criadoEm`.
  Quando a função devolve null de propósito ("o caminhão ainda não
  chegou"), o `||` trocava a resposta honesta pela data em que a LINHA
  nasceu — que numa carga programada é a véspera. Era o "20:42 de ontem".

REGRA QUE ESTE TESTE GUARDA: a movimentação do servidor é a fonte de
verdade. A local existe só até a do servidor chegar, e some quando ela
chega. E onde a tela diz "entrada no pátio", ou é a entrada de verdade ou
é "chegada não registrada" — nunca outra data com cara de entrada.

    python3 testes/test_hora_entrada_fonte_unica.py
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


async def abrir(nav, email='ana@teste.local'):
    ctx = await nav.new_context(viewport={'width': 1360, 'height': 900})
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__hora{email[0]}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(2500)
    return ctx, pg


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        sql("DELETE FROM fact_statusfrota WHERE placa IN "
            "(SELECT placa FROM fact_viagens WHERE numero_carga LIKE 'HR-%')")
        sql("DELETE FROM fact_viagens WHERE numero_carga LIKE 'HR-%'")

        ctxA, pgA = await abrir(nav, 'ana@teste.local')
        erros = []
        pgA.on('pageerror', lambda e: erros.append(str(e)))

        print('\n=== 0. UMA CARGA PROGRAMADA, DEPOIS A CHEGADA ===')
        placa = sql("SELECT v.placa FROM dim_veiculos v LEFT JOIN fact_viagens f "
                    "ON f.placa = v.placa AND f.excluida_em IS NULL "
                    "WHERE v.transportadora <> '' AND f.carga_id IS NULL "
                    "ORDER BY v.placa LIMIT 1")
        ck('há placa livre para o teste', bool(placa), str(placa))
        if not placa:
            await nav.close()
            return 1

        cargaId = await pgA.evaluate("""async (p) => {
              const c = criarCargaProgramada({placa: p, numeroCarga: 'HR-1',
                peso: 9000, rota: '500', operador: 'Ana'});
              SuincoStore.save();
              await SuincoSharePoint.sincronizarAgora();
              return c.id;
            }""", placa[0])
        await pgA.wait_for_timeout(1200)

        # A chegada pelo caminho DOS BOTOES: avancarStatusCarga grava a
        # movimentacao LOCAL primeiro (e o que faz a tela responder na hora,
        # inclusive offline) e so depois sobe. E por aqui que a duplicata
        # nascia. O caminho que passa direto pelo servidor
        # (SuincoSharePoint.mudarStatus) NUNCA teve o problema — testar so
        # ele foi o que quase me fez dizer que nao havia defeito nenhum.
        antes = await pgA.evaluate(
            """(id) => {
                 avancarStatusCarga(id, 'Aguardando Embarque', 'Ana', 'Logística');
                 SuincoStore.save();
                 const l = DB.movimentacoes.filter(
                   m => m.cargaId === id && m.statusNovo === 'Aguardando Embarque');
                 return { quantas: l.length, provisoria: !!(l[0] && l[0]._local),
                          hora: l[0] && l[0].timestamp };
               }""", cargaId)
        ck('antes de sincronizar existe UMA provisória, com o relógio do aparelho',
           antes['quantas'] == 1 and antes['provisoria'], str(antes))
        await pgA.wait_for_timeout(2500)
        await pgA.evaluate("() => SuincoSharePoint.sincronizarAgora()")
        await pgA.wait_for_timeout(2500)

        noBanco = sql(f"SELECT count(*) FROM fact_statusfrota "
                      f"WHERE carga_id = '{cargaId}' AND status_novo = 'Aguardando Embarque'")
        ck('o servidor guardou UMA entrada para esta carga',
           noBanco and noBanco[0] == '1', f'{noBanco} no banco')

        print('\n=== 1. O APARELHO QUE REGISTROU NÃO FICA COM DUAS ===')
        # O defeito: a movimentação local (relógio do aparelho) e a do
        # servidor (relógio do servidor) conviviam, porque a fusão
        # deduplica por id e os ids nunca batem.
        d = await pgA.evaluate("""(id) => {
              const todas = DB.movimentacoes.filter(
                m => m.cargaId === id && m.statusNovo === 'Aguardando Embarque');
              return { quantas: todas.length,
                       horarios: todas.map(m => m.timestamp),
                       locais: todas.map(m => !!m._local),
                       ids: todas.map(m => m.id) };
            }""", cargaId)
        ck('só existe UMA movimentação de entrada no aparelho',
           d['quantas'] == 1, f"{d['quantas']}: {d['horarios']}")
        ck('e a que sobrou é a do SERVIDOR, não a provisória',
           d['quantas'] == 1 and not d['locais'][0],
           f"provisória? {d['locais']} · {d['ids']}")
        ck('a hora deixou de ser a do aparelho e passou a ser a do servidor',
           bool(d['horarios']) and d['horarios'][0] != antes['hora'],
           f"aparelho {antes['hora']} → final {d['horarios']}")

        print('\n=== 2. E O HORÁRIO É O DO SERVIDOR ===')
        doServidor = sql(f"SELECT to_char(data_evento AT TIME ZONE 'UTC', "
                         f"'YYYY-MM-DD\"T\"HH24:MI:SS') FROM fact_statusfrota "
                         f"WHERE carga_id = '{cargaId}' AND status_novo = 'Aguardando Embarque'")
        naTela = await pgA.evaluate("(id) => entradaNoPatioDe(getCarga(id))", cargaId)
        mesmo = bool(doServidor and naTela
                     and doServidor[0][:16] == naTela.replace('Z', '')[:16])
        ck('a entrada exibida é a gravada pelo servidor',
           mesmo, f'servidor {doServidor} · tela {naTela}')

        print('\n=== 3. OUTRO APARELHO VÊ EXATAMENTE O MESMO HORÁRIO ===')
        # A prova do relato: duas telas, o mesmo instante.
        ctxB, pgB = await abrir(nav, 'chefe@teste.local')
        await pgB.evaluate("() => SuincoSharePoint.sincronizarAgora()")
        await pgB.wait_for_timeout(2000)
        naTelaB = await pgB.evaluate("(id) => entradaNoPatioDe(getCarga(id))", cargaId)
        ck('os dois aparelhos mostram o mesmo instante de entrada',
           naTela == naTelaB, f'A={naTela} · B={naTelaB}')
        await ctxB.close()

        print('\n=== 3b. TODAS AS ETAPAS, NAO SO A ENTRADA ===')
        # Pedido do dono: "nao so o horario de entrada, mas qualquer
        # registro das etapas precisa ser unico e fiel".
        #
        # A correcao casa a provisoria com a do servidor por (carga, de ->
        # para), entao vale para as seis etapas — mas "vale por construcao"
        # nao e prova. Aqui a carga anda o ciclo inteiro pelo caminho dos
        # botoes, e cada etapa e conferida contra o banco.
        ETAPAS = ['Embarque Iniciado', 'Embarque Finalizado', 'Faturado',
                  'Seguiu Viagem']
        for etapa in ETAPAS:
            await pgA.evaluate(
                """([id, e]) => {
                     avancarStatusCarga(id, e, 'Ana', 'Logística');
                     SuincoStore.save();
                   }""", [cargaId, etapa])
            await pgA.wait_for_timeout(1800)
            await pgA.evaluate("() => SuincoSharePoint.sincronizarAgora()")
            await pgA.wait_for_timeout(1800)

            noBanco = sql("SELECT count(*) FROM fact_statusfrota WHERE carga_id = '"
                          + cargaId + "' AND status_novo = '" + etapa + "'")
            d = await pgA.evaluate(
                """([id, e]) => {
                     const l = DB.movimentacoes.filter(
                       m => m.cargaId === id && m.statusNovo === e);
                     return { quantas: l.length, provisorias: l.filter(m => m._local).length,
                              horarios: l.map(m => m.timestamp) };
                   }""", [cargaId, etapa])
            ck(f'{etapa}: uma no banco, uma no aparelho',
               bool(noBanco) and noBanco[0] == '1' and d['quantas'] == 1,
               f"banco {noBanco} · aparelho {d['quantas']} {d['horarios']}")
            ck(f'{etapa}: nenhuma provisoria sobrou',
               d['provisorias'] == 0, f"{d['provisorias']} provisoria(s)")

        # E os dois aparelhos contam a MESMA jornada, etapa por etapa.
        ctxC, pgC = await abrir(nav, 'chefe@teste.local')
        await pgC.evaluate("() => SuincoSharePoint.sincronizarAgora()")
        await pgC.wait_for_timeout(2500)
        jornadaA = await pgA.evaluate(
            """(id) => DB.movimentacoes.filter(m => m.cargaId === id)
                 .sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp))
                 .map(m => m.statusNovo + '@' + m.timestamp)""", cargaId)
        jornadaC = await pgC.evaluate(
            """(id) => DB.movimentacoes.filter(m => m.cargaId === id)
                 .sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp))
                 .map(m => m.statusNovo + '@' + m.timestamp)""", cargaId)
        ck('os dois aparelhos contam a mesma jornada, etapa por etapa',
           jornadaA == jornadaC,
           f'A={len(jornadaA)} etapas · C={len(jornadaC)} etapas')
        # SEIS, não cinco: a criação da carga ("Aguardando Veículo") também
        # é um registro de etapa — escrevi cinco de cabeça e o teste
        # corrigiu. As cinco transições do pátio mais o nascimento.
        ck('e a jornada tem as seis etapas do ciclo',
           len(jornadaA) == 6, ' | '.join(x.split('@')[0] for x in jornadaA))
        await ctxC.close()

        print('\n=== 3c. O SERVIDOR IGNORA A HORA QUE O PAINEL MANDA ===')
        # `atualizado_em` e `acao_em` NAO estao em CAMPOS_EDITAVEIS: o painel
        # os envia, e o servidor descarta e carimba o proprio relogio. Este
        # bloco existe para que alguem que amanha "complete" a lista de
        # campos editaveis descubra na hora o que esta abrindo.
        antes = sql("SELECT atualizado_em FROM fact_viagens WHERE carga_id = '" + cargaId + "'")
        await pgA.evaluate(
            """async (id) => {
                 const c = getCarga(id);
                 // Relogio do aparelho vinte anos no futuro.
                 c.atualizadoEm = '2046-01-01T00:00:00.000Z';
                 c.acaoEm = '2046-01-01T00:00:00.000Z';
                 c.observacoes = 'teste de relogio';
                 SuincoStore.save();
                 await SuincoSharePoint.sincronizarAgora();
               }""", cargaId)
        await pgA.wait_for_timeout(2000)
        depois = sql("SELECT atualizado_em, acao_em FROM fact_viagens WHERE carga_id = '"
                     + cargaId + "'")
        ck('a hora do aparelho nao entra no banco',
           bool(depois) and not str(depois[0]).startswith('2046')
           and not str(depois[1]).startswith('2046'), str(depois))

        print('\n=== 4. SEM CHEGADA, A TELA DIZ ISSO — NÃO INVENTA UMA DATA ===')
        # O "20:42 de ontem": três telas faziam `entradaNoPatioDe(c) ||
        # c.criadoEm`, trocando a resposta honesta pela data em que a LINHA
        # nasceu — que numa carga programada é a véspera.
        placa2 = sql("SELECT v.placa FROM dim_veiculos v LEFT JOIN fact_viagens f "
                     "ON f.placa = v.placa AND f.excluida_em IS NULL "
                     f"WHERE v.transportadora <> '' AND f.carga_id IS NULL AND v.placa <> '{placa[0]}' "
                     "ORDER BY v.placa LIMIT 1")
        d = await pgA.evaluate("""(p) => {
              const c = criarCargaProgramada({placa: p, numeroCarga: 'HR-2',
                peso: 9000, rota: '500', operador: 'Ana'});
              // Uma carga programada ONTEM que ainda não chegou.
              const ontem = new Date(Date.now() - 20 * 3600 * 1000).toISOString();
              c.criadoEm = ontem; c.programadoEm = ontem;
              return { id: c.id, criadoEm: ontem, entrada: entradaNoPatioDe(c) };
            }""", placa2[0])
        ck('sem chegada registrada, entradaNoPatioDe devolve nada',
           d['entrada'] is None, str(d['entrada']))

        # E nenhuma tela troca esse "nada" pela data de criação.
        textos = await pgA.evaluate("""(id) => {
              const c = getCarga(id);
              abrirCompletar(id);
              const completar = document.getElementById('completar-placa-info').textContent;
              fecharModalCompletar();
              return { completar };
            }""", d['id'])
        ck('a tela de completar não anuncia a véspera como "no pátio desde"',
           '/' not in textos['completar'].split('desde')[-1]
           or 'não registrada' in textos['completar'].lower(),
           textos['completar'][:100])

        print('\n=== 5. SEM ERRO DE JAVASCRIPT ===')
        ck('console limpo', not erros, '; '.join(erros[:3]))

        sql("DELETE FROM fact_statusfrota WHERE placa IN "
            "(SELECT placa FROM fact_viagens WHERE numero_carga LIKE 'HR-%')")
        sql("DELETE FROM fact_viagens WHERE numero_carga LIKE 'HR-%'")
        await ctxA.close()
        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('  Tudo verde.')
    return 0


sys.exit(asyncio.run(main()))
