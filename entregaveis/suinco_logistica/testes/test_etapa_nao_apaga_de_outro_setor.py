#!/usr/bin/env python3
"""Avançar uma etapa não apaga o que outro setor preencheu. (28/08/2026)

RELATO DO DONO:

  "quando se está realizando um processo de devolução e alguém de outro
   setor atualiza a carga ou alguma informação, isso apaga o que estava
   sendo feito na devolução. Precisamos entender onde está o problema,
   onde ele é registrado no servidor e por que esse caminho não está sendo
   executado corretamente."

ONDE ESTAVA, E POR QUE O CAMINHO NÃO EXECUTAVA DIREITO

  O botão que avança a etapa manda, junto com o novo status, o campo
  daquela etapa. Cinco das seis etapas mandavam `v('campo') || ''` — ou
  seja, a string VAZIA ia junto, e `POST /devolucoes/:id/etapa` gravava
  por cima com um UPDATE. Não é a tela que perde o dado: é o servidor que
  o apaga, a pedido.

  E o campo fica vazio em duas situações que acontecem todo dia:

    · a tela de quem avança foi desenhada ANTES de o outro setor preencher
      aquele campo pelo cabeçalho — ela carrega um retrato velho (a
      ocorrência #16, "duas escritas em voo, a velha ganha", aqui);
    · quem avança não é quem preenche: a Logística cobre todos os postos e
      avança etapas dos outros o tempo todo.

  A PORTARIA já tinha a proteção, escrita no código com estas palavras:
  "campo vazio do porteiro não pode apagar um valor que a Logística já
  tenha posto no cabeçalho". As outras cinco etapas não tinham.

O QUE ESTE TESTE EXIGE, conferindo NO BANCO e não na tela:

  1. peso de entrada gravado pelo cabeçalho sobrevive a alguém avançar a
     etapa do Faturamento com o campo vazio;
  2. o mesmo para o peso final;
  3. o mesmo para as observações da Expedição, dos Controles Internos e da
     Central de Notas;
  4. e o que é ESCRITO no campo da etapa continua sendo gravado — a
     proteção não pode virar "a etapa não grava mais nada".

    python3 testes/test_etapa_nao_apaga_de_outro_setor.py
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


# A esteira inteira, com o campo de cada etapa preenchido ANTES pelo
# cabeçalho e o botão da etapa clicado com o campo VAZIO na tela.
ETAPAS = [
    ('Recebida na Portaria',     'faturamento', 'peso_entrada',  '18500', 'pesoEntrada'),
    ('Descarga Conferida',       'pesofinal',   'peso_final',    '9200',  'pesoFinal'),
    ('Conferida no Faturamento', 'expedicao',   'obs_expedicao', 'DESCARGA OK - PALETE 3 MOLHADO', 'obsExpedicao'),
    ('Peso Final Registrado',    'controles',   'obs_controles', 'DESTINO DEFINIDO NA REUNIAO',    'obsControles'),
    ('Destinada',                'notas',       'obs_notas',     'NOTA CONFERIDA COM O FISCAL',    'obsNotas'),
]


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        sql("DELETE FROM devolucoes WHERE regiao = 'TESTE-APAGA'")
        ctx = await nav.new_context(viewport={'width': 1440, 'height': 950})
        pg = await ctx.new_page()
        html = open(PAINEL_ARQ, encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = f'{API}/__etapa_apaga'
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
        ck('há uma rota cadastrada para o teste', bool(rota and rota[0]), str(rota))
        if not rota:
            await nav.close()
            return 1

        print('\n=== O CAMPO DE CADA ETAPA SOBREVIVE A QUEM AVANÇA COM ELE VAZIO ===')
        for status, carimbo, coluna, valor, chave in ETAPAS:
            # Um checklist por caso, levado até a etapa anterior pelo
            # servidor — é o mesmo caminho que a operação percorre.
            dev = await pg.evaluate(
                """async ([rota, status]) => {
                     const hoje = new Date().toISOString().slice(0,10);
                     const d = await SuincoSharePoint.devolucoes.criar({
                       dataDev: hoje, rotas: [rota], regiao: 'TESTE-APAGA'});
                     const CAMINHO = ['Lançada','Recebida na Portaria','Conferida no Faturamento',
                       'Descarga Conferida','Peso Final Registrado','Destinada','Nota Finalizada'];
                     let atual = d.status;
                     while(atual !== status){
                       const prox = CAMINHO[CAMINHO.indexOf(atual)+1];
                       if(!prox) break;
                       await SuincoSharePoint.devolucoes.etapa(d.id, {para: prox});
                       atual = prox;
                     }
                     return d.id;
                   }""", [rota[0], status])

            # OUTRO SETOR grava o campo pelo cabeçalho — é o "alguém de
            # outro setor atualiza alguma informação" do relato.
            await pg.evaluate("""async ([id, chave, valor]) =>
                SuincoSharePoint.devolucoes.editar(id, {[chave]: valor})""",
                              [dev, chave, valor])
            antes = sql(f"SELECT {coluna} FROM devolucoes WHERE devolucao_id = '{dev}'")
            ck(f'{carimbo}: o campo foi gravado pelo cabeçalho',
               antes and str(antes[0]).startswith(valor.split('.')[0][:12]), str(antes))

            # Agora alguém avança a etapa com o campo VAZIO na tela dele.
            await pg.evaluate("""async (id) => {
                 await carregarDevolucoes();
                 _devExpandida = id;
                 renderListaDevolucoes();
               }""", dev)
            await pg.wait_for_timeout(400)
            sufixo = {'faturamento': 'pesoentrada', 'pesofinal': 'pesofinal'}.get(carimbo, 'obs')
            limpou = await pg.evaluate("""([id, sufixo]) => {
                 const el = document.getElementById(`dev-et-${id}-${sufixo}`);
                 if(!el) return false;
                 el.value = '';
                 return true;
               }""", [dev, sufixo])
            ck(f'{carimbo}: o campo da etapa existe na tela', limpou is True)
            await pg.evaluate("(id) => avancarEtapaDevolucaoUI(id)", dev)
            await pg.wait_for_timeout(1200)

            depois = sql(f"SELECT {coluna} FROM devolucoes WHERE devolucao_id = '{dev}'")
            ck(f'{carimbo}: avançar a etapa com o campo vazio NÃO apagou o que estava lá',
               depois and depois[0] not in ('', None, 'None'),
               f"antes {antes and antes[0]!r} → depois {depois and depois[0]!r}")

        print('\n=== E O QUE É ESCRITO NA ETAPA CONTINUA SENDO GRAVADO ===')
        # A proteção não pode virar "a etapa não grava mais nada": este
        # caso é o contrapeso dela.
        dev2 = await pg.evaluate(
            """async (rota) => {
                 const hoje = new Date().toISOString().slice(0,10);
                 const d = await SuincoSharePoint.devolucoes.criar({
                   dataDev: hoje, rotas: [rota], regiao: 'TESTE-APAGA'});
                 await SuincoSharePoint.devolucoes.etapa(d.id, {para: 'Recebida na Portaria'});
                 await SuincoSharePoint.devolucoes.etapa(d.id, {para: 'Conferida no Faturamento'});
                 return d.id;
               }""", rota[0])
        await pg.evaluate("""async (id) => {
             await carregarDevolucoes(); _devExpandida = id; renderListaDevolucoes();
           }""", dev2)
        await pg.wait_for_timeout(400)
        escreveu = await pg.evaluate("""([id]) => {
             const el = document.getElementById(`dev-et-${id}-obs`);
             if(!el) return false;
             el.value = 'RECADO DA EXPEDICAO';
             return true;
           }""", [dev2])
        ck('o campo de observações da Expedição existe na etapa dela', escreveu is True)
        await pg.evaluate("(id) => avancarEtapaDevolucaoUI(id)", dev2)
        await pg.wait_for_timeout(1200)
        v = sql(f"SELECT obs_expedicao, status FROM devolucoes WHERE devolucao_id = '{dev2}'")
        ck('o recado escrito na etapa da Expedição foi gravado',
           v and v[0] == 'RECADO DA EXPEDICAO', str(v))
        ck('e a etapa avançou', v and v[1] == 'Descarga Conferida', str(v))

        ck('nenhum erro de JavaScript', not erros, ' | '.join(erros[:3]))
        sql("DELETE FROM devolucoes WHERE regiao = 'TESTE-APAGA'")
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
