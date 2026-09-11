#!/usr/bin/env python3
"""Apagar da vista os registros de uma placa: só Administração, com motivo, e com rastro.

PEDIDO DO DONO, 11/09/2026, em emergência (placa RYV8G03 multiplicada por
defeito — ocorrência #48): "EXCLUA TODOS OS LANÇAMENTOS PRA ESSA PLACA AGORA
(...) eu preciso conseguir apagar do histórico e essa autorização é somente
para o meu token".

O QUE ESTE TESTE TRAVA
  1. a Administração marca todas as movimentações da placa como apagadas,
     com motivo obrigatório, e o servidor registra em log_eventos quem apagou;
  2. as linhas SOMEM do /api/estado e do /api/historico — e da tela de quem
     apagou — mas CONTINUAM na tabela (append-only: prova do defeito fica);
  3. Logística, Portaria etc. recebem 403; sem motivo é 400;
  4. na tela, o botão só aparece para Administração, com uma placa filtrada.

    python3 testes/test_apagar_historico_da_placa.py
"""
import asyncio, json, os, subprocess, sys, urllib.error, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
PAINEL = 'file://' + str(RAIZ / 'index.html')
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
PLACA = 'APG1A23'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def psql(q):
    r = subprocess.run(['su', 'postgres', '-c', 'psql -q -tA -d embarque_suinco'],
                       input=q, capture_output=True, text=True)
    if r.returncode != 0:
        print('    [psql]', (r.stderr or '').strip()[:140])
    return r


def http(c, token=None, metodo='GET', corpo=None):
    req = urllib.request.Request(f'{API}{c}', method=metodo)
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    d = None
    if corpo is not None:
        d = json.dumps(corpo).encode(); req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, d, timeout=25) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or 'null')
        except Exception:
            return e.code, None


def operador(email, setor):
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True).stdout.strip()
    psql(f"DELETE FROM operadores WHERE email = '{email}';")
    psql(f"INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES ('{email}', '{setor} Teste', '{setor}', '{h}', true);")
    st, r = http('/auth/login', metodo='POST', corpo={'email': email, 'senha': SENHA})
    return (r or {}).get('token')


def main_api():
    print('\n=== 0. A COLUNA EXISTE (migração 051) ===')
    col = psql("SELECT count(*) FROM information_schema.columns WHERE table_name='fact_statusfrota' AND column_name='apagada_em';").stdout.strip()
    ck('fact_statusfrota.apagada_em existe', col == '1', col)

    adm = operador('apaga-adm@teste.local', 'Administração')
    log = operador('apaga-log@teste.local', 'Logística')
    ck('logins', bool(adm) and bool(log))
    if not (adm and log):
        return

    # a placa com três lançamentos, numa carga já excluída (o caso real)
    psql(f"DELETE FROM fact_statusfrota WHERE placa = '{PLACA}'; DELETE FROM fact_viagens WHERE placa = '{PLACA}'; DELETE FROM log_eventos WHERE placa = '{PLACA}';")
    psql(f"INSERT INTO fact_viagens (carga_id, placa, status_atual, excluida_em) VALUES ('carga_apg1', '{PLACA}', 'Aguardando Embarque', now());")
    for i, (a, n) in enumerate([('', 'Aguardando Embarque'), ('Aguardando Embarque', 'Embarque Iniciado'), ('', 'Aguardando Embarque')]):
        psql(f"INSERT INTO fact_statusfrota (movimentacao_id, carga_id, placa, status_anterior, status_novo, setor, operador_nome) "
             f"VALUES ('mov_apg{i}', 'carga_apg1', '{PLACA}', {repr(a) if a else 'NULL'}, '{n}', 'Administração', 'Alguém');")
    antes = psql(f"SELECT count(*) FROM fact_statusfrota WHERE placa = '{PLACA}';").stdout.strip()
    ck('três lançamentos da placa no banco', antes == '3', antes)

    print('\n=== 1. SEM MOTIVO NÃO APAGA; SEM SER ADMINISTRAÇÃO NÃO APAGA ===')
    st, e = http('/api/movimentacoes/apagar', token=adm, metodo='POST', corpo={'placa': PLACA, 'motivo': ''})
    ck('sem motivo → 400', st == 400, f'HTTP {st} {(e or {}).get("codigo")}')
    st, e = http('/api/movimentacoes/apagar', token=log, metodo='POST', corpo={'placa': PLACA, 'motivo': 'teste'})
    ck('Logística → 403', st == 403, f'HTTP {st} {(e or {}).get("codigo")}')
    vivas = psql(f"SELECT count(*) FROM fact_statusfrota WHERE placa = '{PLACA}' AND apagada_em IS NULL;").stdout.strip()
    ck('nada foi marcado', vivas == '3', vivas)

    print('\n=== 2. ADMINISTRAÇÃO APAGA DA VISTA — A LINHA FICA, MARCADA ===')
    st, r = http('/api/movimentacoes/apagar', token=adm, metodo='POST',
                 corpo={'placa': PLACA, 'motivo': 'carga multiplicada por defeito do painel (#48)'})
    ck('responde ok', st == 200 and (r or {}).get('ok') is True, f'HTTP {st} {r}')
    ck('diz quantas apagou', (r or {}).get('apagadas') == 3, str((r or {}).get('apagadas')))
    fica = psql(f"SELECT count(*) FROM fact_statusfrota WHERE placa = '{PLACA}';").stdout.strip()
    ck('as três linhas CONTINUAM na tabela (append-only)', fica == '3', fica)
    marc = psql(f"SELECT count(*) FROM fact_statusfrota WHERE placa = '{PLACA}' AND apagada_em IS NOT NULL AND apagada_por <> '' AND apagada_motivo LIKE '%#48%';").stdout.strip()
    ck('marcadas com quem, quando e por quê', marc == '3', marc)
    rastro = psql(f"SELECT count(*) FROM log_eventos WHERE placa = '{PLACA}' AND acao LIKE '%apag%';").stdout.strip()
    ck('e o log_eventos guarda a ação', rastro == '1', rastro)

    print('\n=== 3. SOMEM DAS LEITURAS ===')
    st, est = http('/api/estado', token=adm)
    ids = [m.get('Movimentacao_ID') or m.get('movimentacao_id') for m in (est or {}).get('movimentacoes', [])]
    ck('/api/estado não devolve mais nenhuma da placa', not any(str(i).startswith('mov_apg') for i in ids), str([i for i in ids if str(i).startswith('mov_apg')]))
    st, r2 = http('/api/movimentacoes/apagar', token=adm, metodo='POST', corpo={'placa': PLACA, 'motivo': 'de novo'})
    ck('apagar de novo não é erro e não conta nada', st == 200 and (r2 or {}).get('apagadas') == 0, str(r2))

    psql(f"DELETE FROM fact_statusfrota WHERE placa = '{PLACA}'; DELETE FROM fact_viagens WHERE placa = '{PLACA}';")
    psql("DELETE FROM operadores WHERE email IN ('apaga-adm@teste.local','apaga-log@teste.local');")


async def main_tela():
    print('\n=== 4. NA TELA: BOTÃO SÓ PARA ADMINISTRAÇÃO, COM PLACA FILTRADA, E PEDE MOTIVO ===')
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL); await pg.wait_for_timeout(1000)
        r = await pg.evaluate("""() => {
          const mk = (setor) => { DB.operador = {nome:'X', setor}; document.getElementById('modal-operador')?.classList.remove('open');
            DB.cargas = []; DB.movimentacoes = [
              { id:'m1', cargaId:'c1', placa:'APG1A23', statusAnterior:'', statusNovo:'Aguardando Embarque', setor:'Administração', operador:'A', data:new Date().toISOString(), timestamp:new Date().toISOString() },
              { id:'m2', cargaId:'c2', placa:'OUT9R99', statusAnterior:'', statusNovo:'Aguardando Embarque', setor:'Portaria', operador:'B', data:new Date().toISOString(), timestamp:new Date().toISOString() } ];
            if(typeof invalidarIndiceMovimentacoes==='function') invalidarIndiceMovimentacoes();
            renderAll(); abrirTab('historico');
            const f = document.getElementById('hist-filtro-placa'); f.value = ''; renderHistorico();
            const semFiltro = !!document.querySelector('#btn-apagar-historico-placa:not([hidden])');
            f.value = 'APG1A23'; renderHistorico();
            const comFiltro = !!document.querySelector('#btn-apagar-historico-placa:not([hidden])');
            return { semFiltro, comFiltro }; };
          return { logistica: mk('Logística'), adm: mk('Administração') };
        }""")
        ck('Logística nunca vê o botão', r['logistica'] == {'semFiltro': False, 'comFiltro': False}, str(r['logistica']))
        ck('Administração sem placa filtrada: sem botão', r['adm']['semFiltro'] is False, str(r['adm']))
        ck('Administração com placa filtrada: botão aparece', r['adm']['comFiltro'] is True, str(r['adm']))

        c = await pg.evaluate("""async () => {
          const chamadas = [];
          const oApagar = SuincoSharePoint.apagarMovimentacoesDaPlaca;
          SuincoSharePoint.apagarMovimentacoesDaPlaca = async (placa, motivo) => { chamadas.push({placa, motivo}); return { ok:true, apagadas:1, ids:['m1'] }; };
          // A remoção real acontece na sincronia seguinte (o servidor manda o
          // estado sem a placa); aqui só provamos que o clique PEDE a
          // sincronia depois do apagar — a remoção em si já está provada
          // pelos blocos 1-3, contra o servidor de verdade.
          let sincronizou = 0;
          const oSync = SuincoSharePoint.sincronizarAgora;
          SuincoSharePoint.sincronizarAgora = async () => { sincronizou++; };
          window.prompt = () => 'carga multiplicada (#48)';
          window.confirm = () => true;
          document.getElementById('btn-apagar-historico-placa').click();
          await new Promise(r => setTimeout(r, 150));
          SuincoSharePoint.apagarMovimentacoesDaPlaca = oApagar;
          SuincoSharePoint.sincronizarAgora = oSync;
          return { chamadas, sincronizou };
        }""")
        ck('o clique pede ao servidor com placa e motivo', c['chamadas'] == [{'placa': 'APG1A23', 'motivo': 'carga multiplicada (#48)'}], str(c['chamadas']))
        ck('e busca o estado atualizado do servidor depois — é lá que a linha some (blocos 1-3)',
           c['sincronizou'] >= 1, str(c['sincronizou']))
        ck('nenhum erro de JavaScript', not erros, str(erros[:1]))
        await nav.close()


main_api()
asyncio.run(main_tela())
print('\n=== RESULTADO ===')
print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
sys.exit(1 if falhas else 0)
