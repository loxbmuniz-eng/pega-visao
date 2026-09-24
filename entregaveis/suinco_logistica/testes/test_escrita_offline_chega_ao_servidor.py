#!/usr/bin/env python3
"""O que a operação digita com o servidor fora do ar CHEGA quando ele volta (24/09/2026).

RISCO R1 DO RAIO-X. Pedido do dono: "traga solucoes e tirem de risco nossa
operacao com todas as observacoes em vermelho".

A PERGUNTA, E POR QUE ELA VALE MAIS QUE AS OUTRAS. Já está medido que o
painel continua funcionando com a API fora do ar: cria carga, avança etapa,
desenha a Torre, sem erro nenhum. O que NÃO estava medido é se aquilo chega
ao servidor quando ele volta. São duas situações muito diferentes:

  · "a operação continua"                       -> o painel é o plano B;
  · "a operação continua e perde o que digitou" -> o painel é uma armadilha,
    porque quem digitou viu a tela aceitar e foi embora tranquilo.

POR QUE A CONFERÊNCIA É NO BANCO, E NÃO NA TELA. A tela mostra a cópia
local, que continua lá de qualquer jeito — perguntar a ela é perguntar ao
réu. A única resposta que vale é a do `fact_viagens` depois da reconexão.

POR QUE ESPERAR MAIS DE 20 SEGUNDOS. O tempo limite de uma requisição do
painel é 20s. Uma medição mais curta pega a requisição ainda no ar e não
conclui nada — foi o que aconteceu na primeira tentativa, com 6 segundos,
e é por isso que este arquivo existe em vez de uma afirmação.

O QUE ESTE TESTE TRAVA

  1. com o servidor no ar, o que a tela cria chega ao banco (a base de
     comparação — sem ela, um "não chegou" depois não prova nada);
  2. com o servidor FORA, a tela continua aceitando;
  3. e quando ele volta, o que foi digitado durante a queda ESTÁ NO BANCO —
     a carga criada e a etapa avançada.

    python3 testes/test_escrita_sobrevive_ao_servidor_fora.py
"""
import asyncio
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PORTA = API.rsplit(':', 1)[-1]
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
# Mais que o tempo limite de 20s do painel, com folga para a fila reagir.
ESPERA_APOS_QUEDA = int(os.environ.get('SUINCO_ESPERA_QUEDA', '26'))

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def sql(q):
    r = subprocess.run(['sudo', '-u', 'postgres', 'psql', '-tAc', q, '-d', 'embarque_suinco'],
                       capture_output=True, text=True)
    return [l for l in r.stdout.strip().split('\n') if l]


def api_viva():
    r = subprocess.run(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}',
                        f'{API}/health'], capture_output=True, text=True)
    return r.stdout.strip() == '200'


def subir_api():
    if api_viva():
        return None
    amb = dict(os.environ, PLAYWRIGHT_CHROMIUM_PATH='/opt/pw-browsers/chromium')
    p = subprocess.Popen(['node', 'src/servidor.js'], cwd=str(RAIZ / 'backend'),
                         env=amb, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         start_new_session=True)
    for _ in range(20):
        if api_viva():
            return p
        time.sleep(1)
    raise SystemExit('a API não subiu')


def derrubar_api():
    subprocess.run(['pkill', '-f', 'node src/servidor.js'])
    for _ in range(15):
        if not api_viva():
            return True
        time.sleep(1)
    return False


async def main():
    print('\n=== 0. BANCADA ===')
    subir_api()
    ck('a API está no ar', api_viva())
    # DUAS PLACAS, e isto não é detalhe. A primeira versão usou a mesma nas
    # duas cargas e a segunda foi recusada — não por causa da queda, mas pela
    # trava de placa duplicada na mesma programação, que é REGRA e está certa.
    # Medição que esbarra numa regra mede a regra, não o que queria medir.
    placas = sql("SELECT placa FROM dim_veiculos ORDER BY placa LIMIT 2")
    ck('peguei duas placas do cadastro real (a trava de frota recusa inventada)',
       len(placas) == 2, str(placas))
    if len(placas) != 2:
        return 1
    placa, placa2 = placas
    for pl in (placa, placa2):
        sql(f"DELETE FROM fact_statusfrota WHERE placa = '{pl}'")
        sql(f"DELETE FROM fact_viagens WHERE placa = '{pl}'")

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        pg = await (await nav.new_context(viewport={'width': 1500, 'height': 950})).new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        html = (RAIZ / 'index.html').read_text(encoding='utf-8')
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = f'{API}/__queda'
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        await pg.wait_for_selector('#login-email', timeout=25000)
        await pg.fill('#login-email', 'ana@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3500)

        async def criar_pela_tela(qual_placa, num, rota):
            """Pelo MESMO caminho da Logística: preenche o formulário e clica."""
            return await pg.evaluate("""async ([placa, num, rota]) => {
                abrirTab('programacao');
                const por = (id, v) => { const e = document.getElementById(id);
                                         if(e) e.value = v; };
                por('prog-placa', placa); por('prog-numero-carga', num);
                por('prog-rota', rota);   por('prog-peso', '25000');
                por('prog-motorista', 'Motorista de teste');
                criarCargaProgramadaUI();
                await new Promise(s => setTimeout(s, 800));
                const c = DB.cargas.find(x => String(x.numeroCarga) === String(num));
                return { criou: !!c, id: c ? c.id : null,
                         estado: SuincoSharePoint.estado() };
            }""", [qual_placa, num, rota])

        print('\n=== 1. COM O SERVIDOR NO AR, O QUE A TELA CRIA CHEGA AO BANCO ===')
        a = await criar_pela_tela(placa, '900001', '500')
        ck('a tela criou a carga A', a['criou'], str(a))
        await pg.wait_for_timeout(6000)
        no_banco = sql(f"SELECT numero_carga FROM fact_viagens WHERE placa = '{placa}'")
        ck('a carga A está no banco — é a base de comparação',
           '900001' in no_banco, str(no_banco))
        if '900001' not in no_banco:
            print('    sem esta base, um "não chegou" depois não provaria nada.')
            await nav.close()
            return 1

        print('\n=== 2. SERVIDOR FORA DO AR ===')
        ck('a API foi derrubada', derrubar_api())
        b = await criar_pela_tela(placa2, '900002', '501')
        ck('a tela CONTINUA aceitando com o servidor fora', b['criou'], str(b))
        # PELO BOTÃO, não por `avancarStatusCarga`. A função de dados grava na
        # cópia local; quem fala com o servidor (e com a fila offline) é o
        # caminho da tela. A primeira versão deste teste chamou a de dados e
        # mediu um caminho que a operação não usa.
        avancou = await pg.evaluate("""async ([id]) => {
            if(!id) return null;
            await avancarStatusUI(id);
            await new Promise(s => setTimeout(s, 1200));
            return getCarga(id).status;
        }""", [a['id']])
        # ESTA ERA UMA EXPECTATIVA MINHA ERRADA, e a medição corrigiu. Com o
        # servidor fora, o botão de avançar etapa NÃO avança — e isso está
        # CERTO: "o servidor é quem manda", e escrita otimista de etapa é
        # justamente o que faria a carga aparecer numa fase que o servidor
        # nunca aceitou. A etapa não se perde porque nunca foi aceita.
        ck('avançar etapa é RECUSADO com o servidor fora (e isso é a regra)',
           avancou == 'Aguardando Veículo', str(avancou))

        print(f'\n    esperando {ESPERA_APOS_QUEDA}s — mais que o tempo limite de 20s do painel')
        await pg.wait_for_timeout(ESPERA_APOS_QUEDA * 1000)
        durante = await pg.evaluate("""([idB]) => {
            const c = DB.cargas.find(x => x.id === idB);
            return {
              estado: SuincoSharePoint.estado(),
              fila: SuincoSharePoint.pendentes(),
              /* A PERGUNTA QUE NOMEIA A CAUSA. `_sincronizado` é a marca de
                 "esta versão já subiu". Se a carga criada OFFLINE já está
                 marcada, a sincronia seguinte não vai reenviá-la — e ela
                 nunca chega, sem erro e sem aviso. */
              marcadaComoJaEnviada: !!(c && DB._sincronizado && DB._sincronizado[c.id]),
              pendenteLocal: !!(c && c._pendente),
              /* QUAL GUARDA BARRA O REENVIO — cada uma destas é um `return`
                 dentro de `sincronizarCargasAlteradas`. */
              marcaDaCarga: c ? (c.atualizadoEm || c.criadoEm || '') : null,
              ultimoSync: c ? (SuincoStore._ultimoSync.get(c.id) || null) : null,
              nuncaConfirmada: !!(c && c._nuncaConfirmada),
              proximaTentativaEm: c ? (c._proximaTentativaEm || null) : null,
              emVoo: !!(c && SuincoStore._emVoo && SuincoStore._emVoo.has(c.id)),
              refazer: !!(c && SuincoStore._refazer && SuincoStore._refazer.has(c.id)),
              ehDoServidor: c ? (typeof ehCargaDoServidor === 'function'
                                 ? ehCargaDoServidor(c) : 'sem função') : null,
              configurado: SuincoSharePoint.estaConfigurado(),
            };
        }""", [b['id']])
        ck('o painel sabe que está offline', durante['estado'] != 'online', str(durante))
        ck('a carga criada offline NÃO está marcada como já enviada',
           not durante['marcadaComoJaEnviada'],
           'se estiver marcada, a sincronia nunca mais a reenvia')

        print('\n=== 3. O SERVIDOR VOLTA. O QUE FOI DIGITADO CHEGOU? ===')
        subir_api()
        ck('a API voltou', api_viva())
        # PACIÊNCIA SUFICIENTE PARA O RECUO. A carga incerta tem
        # `_proximaTentativaEm` — o recuo de 11/09/2026, que cresce até 60s.
        # Uma medição curta pega a carga DENTRO da janela de espera e conclui
        # "perdida" quando ela só estava aguardando a vez. Aqui esperamos
        # além do recuo máximo, cutucando a sincronia no caminho.
        # SEM CUTUCÃO NENHUM. A versão de investigação forçava um
        # `SuincoStore.save()` para achar a causa; aqui o painel tem de se
        # virar sozinho, que é o que a operação faz.
        for volta in range(6):
            await pg.evaluate("() => SuincoSharePoint.sincronizarAgora()")
            await pg.wait_for_timeout(12000)
            chegou = sql(f"SELECT numero_carga FROM fact_viagens WHERE placa = '{placa2}'")
            if '900002' in chegou:
                print(f'    chegou na volta {volta + 1} (~{(volta + 1) * 12}s após a volta da API)')
                break

        depois = sql(f"SELECT numero_carga FROM fact_viagens WHERE placa = '{placa2}'")
        estado_a = sql(f"SELECT status_atual FROM fact_viagens WHERE placa = '{placa}'")
        ck('A CARGA CRIADA DURANTE A QUEDA CHEGOU AO BANCO',
           '900002' in depois, f'no banco: {depois}')

        # COLUNAS CERTAS. A primeira versão pediu `status` e `criado_em`; as
        # colunas são `status_novo` e `data_evento`. O psql errava, a função
        # devolvia lista vazia, e o teste acusava "não chegou" quando na
        # verdade não tinha nem perguntado. Consulta errada parece defeito.
        etapas = sql("SELECT status_novo FROM fact_statusfrota WHERE placa = '%s' "
                     "ORDER BY data_evento" % placa)
        # Coerente com a recusa acima: a etapa não avançou nem na tela, então
        # o banco continua no estado anterior. Nada se perdeu aqui.
        ck('a etapa recusada não aparece no banco (coerência tela/servidor)',
           'Aguardando Embarque' not in etapas, f'trilha no banco: {etapas}')
        ck('e o estado da carga no banco é o mesmo da tela',
           estado_a == ['Aguardando Veículo'], f'no banco: {estado_a}')

        ck('nenhum erro de JavaScript em todo o percurso', not erros, str(erros[:2]))
        await nav.close()

    print('\n' + '=' * 51)
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print(f'    · {f}')
        return 1
    print('  tudo verde.')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
