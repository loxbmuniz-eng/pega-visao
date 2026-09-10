#!/usr/bin/env python3
"""A mesma placa em duas linhas do dia: avisa, e deixa montar.

O RELATO DO DONO, 10/09/2026:
  "Uma carga em Ribeirão Preto e uma em Marília. Não deixa duplicar as
   placas. Precisamos que sejam placas duplicadas, porque são duas placas:
   uma na carreta e uma em Marília, na mesma rota. Então o mesmo veículo vai
   carregar as duas cargas, tanto em Ribeirão Preto quanto em Marília."

E, quando perguntado se era isso:
  "Na verdade, quando vai repetir a placa numa carga para ela ser duas
   cargas da mesma placa, não está deixando repetir na montagem do dia."

O QUE BARRAVA: o índice ÚNICO `ux_prog_montagem_placa_dia`, criado em 031
com a intenção certa — pegar o acidente de duas pessoas montando o dia ao
mesmo tempo — e com a força errada. UNIQUE não distingue o acidente do caso
legítimo, e o caso legítimo é rotina.

A Programação já tinha resolvido isso em 11/08/2026 do jeito certo: avisa,
diz onde a placa já está, e deixa passar com um clique. A Montagem ficou
para trás um mês. Agora é a MESMA frase, da mesma função.

O que este teste trava:
  · o servidor ACEITA a segunda linha com a mesma placa (migração 050);
  · a tela AVISA, nomeando a outra linha, e diz que é permitido;
  · o aviso sai da mesma função que a Programação usa — uma função, dois
    chamadores, que é a regra que esta ocorrência nasceu de quebrar;
  · as duas linhas viram DUAS cargas, com a mesma placa.

    python3 testes/test_placa_repetida_na_montagem.py
"""
import asyncio, json, os, subprocess, sys, urllib.error, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
PAINEL = 'file://' + str(RAIZ / 'index.html')
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAIL = 'placa-repetida@teste.local'
DIA = '2026-09-21'
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
    return r.stdout.strip()


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


async def main():
    print('\n=== 0. O ÍNDICE NÃO PODE MAIS SER ÚNICO ===')
    # A causa raiz é de BANCO, e é aqui que ela se mede. Sem isto, o resto
    # do teste passaria a descrever o sintoma sem travar a causa: amanhã
    # alguém recria o UNIQUE e só a operação descobre.
    unico = psql("SELECT indisunique FROM pg_index i "
                 "JOIN pg_class c ON c.oid = i.indexrelid "
                 "WHERE c.relname = 'ix_prog_montagem_placa_dia';")
    sobrou = psql("SELECT 1 FROM pg_class WHERE relname = 'ux_prog_montagem_placa_dia';")
    ck('o índice de placa por dia existe, e NÃO é único', unico == 'f',
       f'indisunique = {unico!r}')
    ck('e o índice único antigo não existe mais', sobrou == '',
       f'ux_prog_montagem_placa_dia: {sobrou or "não existe"}')

    print('\n=== 1. O SERVIDOR ACEITA A MESMA PLACA EM DUAS LINHAS ===')
    h = subprocess.run(['node', '-e',
                        f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True)
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}';")
    psql("INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES "
         f"('{EMAIL}', 'Wemerson', 'Logística', '{h.stdout.strip()}', true);")
    st, r = http('/auth/login', metodo='POST', corpo={'email': EMAIL, 'senha': SENHA})
    token = (r or {}).get('token')
    ck('login', bool(token), f'HTTP {st}')
    if not token:
        print('\n  FALHAS:', ', '.join(falhas)); sys.exit(1)

    # A placa tem que ser de verdade: o servidor recusa placa fora da Frota,
    # e inventar uma faria o teste medir a trava errada.
    placa = psql('SELECT placa FROM dim_veiculos LIMIT 1;')
    rota = psql('SELECT codigo FROM dim_rotas LIMIT 1;')
    ck('há placa cadastrada na Frota para o teste usar', bool(placa), repr(placa))
    psql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}';")

    ids = []
    for i in (1, 2):
        st, n = http('/api/montagem', token=token, metodo='POST', corpo={
            'dia': DIA, 'rotaCodigo': rota, 'sequencia': i,
            'qtdEntregas': 1, 'paletizada': 'Não'})
        ids.append(((n or {}).get('montagem') or {}).get('montagem_id'))
    ck('duas linhas no dia', all(ids), str(ids))

    st1, _ = http(f'/api/montagem/{ids[0]}', token=token, metodo='PATCH',
                  corpo={'placa': placa})
    ck('a primeira linha aceita a placa', st1 == 200, f'HTTP {st1}')

    # AQUI ESTAVA O DEFEITO: 409 PLACA_DUPLICADA, e o dia impossível de montar.
    st2, e2 = http(f'/api/montagem/{ids[1]}', token=token, metodo='PATCH',
                   corpo={'placa': placa})
    ck('a SEGUNDA linha aceita a mesma placa', st2 == 200,
       f"HTTP {st2} · {str((e2 or {}).get('erro'))[:80]}")

    st, dia = http(f'/api/montagem?dia={DIA}', token=token)
    comPlaca = [m for m in (dia or {}).get('montagens', [])
                if (m.get('placa') or '') == placa]
    ck('as duas linhas do dia estão com a placa', len(comPlaca) == 2,
       f'{len(comPlaca)} linha(s)')

    print('\n=== 2. A TELA AVISA, E O AVISO DIZ ONDE A PLACA JÁ ESTÁ ===')
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        erros = []
        pg.on('pageerror', lambda ex: erros.append(str(ex)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(1200)
        # Conferir que as funções EXISTEM antes de chamá-las: sem isto, o
        # painel publicado (que não as tem) derruba o teste com traceback de
        # Playwright em vez de dizer qual ponto reprovou.
        existem = await pg.evaluate(
            "() => ['outrasLinhasComAPlaca','fraseDePlacaRepetida']"
            ".filter(n => typeof window[n] !== 'function')")
        ck('as funções do aviso existem no painel', existem == [],
           'faltando: ' + ', '.join(existem) if existem else '')
        if existem:
            await nav.close()
            print('\n  FALHAS:', ', '.join(falhas)); sys.exit(1)
        d = await pg.evaluate("""(placa) => {
              DB.operador = {nome:'Wemerson', setor:'Logística'};
              renderAll();
              _montagemDia = { dia:'2026-09-21', diaSemana:1, modelo:[], montagens:[
                { montagem_id:'mA', data_prog:'2026-09-21', rota_codigo:'500',
                  rota_nome:'Ribeirão Preto', apelido_rota:'', sequencia:1,
                  numero_carga:'', placa:placa, transportadora:'', peso:null,
                  qtd_entregas:1, qtd_ganchos:0, paletizada:'Não',
                  tipo_operacao:'', motorista:'', observacoes:'' },
                { montagem_id:'mB', data_prog:'2026-09-21', rota_codigo:'500',
                  rota_nome:'Marília', apelido_rota:'', sequencia:2,
                  numero_carga:'', placa:placa, transportadora:'', peso:null,
                  qtd_entregas:1, qtd_ganchos:0, paletizada:'Não',
                  tipo_operacao:'', motorista:'', observacoes:'' },
              ]};
              const outras = outrasLinhasComAPlaca('mB', placa);
              return { quantas: outras.length,
                       texto: outras.length
                         ? fraseDePlacaRepetida(placa, outras) : '' };
            }""", placa)
        ck('a linha sabe que a placa está em outra linha do dia',
           d['quantas'] == 1, f"{d['quantas']} outra(s)")
        ck('o aviso nomeia a outra rota', 'Ribeirão Preto' in d['texto'],
           repr(d['texto'][:110]))
        ck('e diz que é PERMITIDO, em vez de só negar',
           'PERMITIDO' in d['texto'], repr(d['texto'][:110]))

        print('\n=== 3. UMA FUNÇÃO, DOIS CHAMADORES ===')
        # A ocorrência nasceu de a mesma decisão estar escrita em dois
        # lugares: a Programação abrandou a trava em 11/08 e a Montagem
        # ficou com a dela. Se cada tela tiver a sua frase, a próxima
        # correção volta a pegar só uma.
        d2 = await pg.evaluate("""(placa) => {
              DB.cargas = [{ id:'c1', placa:placa, numeroCarga:'90001',
                status:'Aguardando Veículo', rota:'500' }];
              return { caixa: avisoPlacaJaProgramada(placa),
                       recado: fraseDePlacaRepetida(placa, ['Marília (sem número ainda)']) };
            }""", placa)
        comum = ('Duas cargas no mesmo caminhão é PERMITIDO — é a carreta que '
                 'carrega em duas praças da mesma rota.')
        ck('a caixa da Programação usa a frase compartilhada',
           comum in d2['caixa'], repr(d2['caixa'][:120]))
        ck('o recado da Montagem usa a MESMA frase',
           comum in d2['recado'], repr(d2['recado'][:120]))
        ck('e a caixa da Programação continua dizendo o número da carga',
           '90001' in d2['caixa'], repr(d2['caixa'][:120]))
        ck('nenhum erro de JavaScript', not erros, str(erros[:1]))
        await nav.close()

    print('\n=== 4. AS DUAS LINHAS VIRAM DUAS CARGAS ===')
    # Não adianta liberar a montagem e travar na efetivação: o dia só fica
    # montável se as duas linhas chegarem à Torre.
    for i, mid in enumerate(ids):
        st, _ = http(f'/api/montagem/{mid}/efetivar', token=token, metodo='POST',
                     corpo={'cargaId': f'carga-teste-placa-{i}'})
        ck(f'a linha {i+1} pode ser efetivada', st in (200, 201), f'HTTP {st}')
    efetivadas = psql("SELECT count(*) FROM programacao_montagem "
                      f"WHERE data_prog = '{DIA}' AND efetivada_em IS NOT NULL;")
    ck('as duas linhas ficaram efetivadas, com a mesma placa', efetivadas == '2',
       f'{efetivadas} efetivada(s)')

    psql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}';")
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}';")
    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)


asyncio.run(main())
