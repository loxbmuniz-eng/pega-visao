#!/usr/bin/env python3
"""Dois números iguais na Montagem do Dia não entram mais — o servidor recusa.

PEDIDO DO DONO, 11/09/2026: "fecha dois buracos de numero repedido".
Antes disso, no mesmo dia: "E SE A GENTE TIRAR A PARADA DE ARRASTAR E DEIXAR
SO A SEQUENCIA SENDO ORGANIZADA POR UM BOTAO (...) E SEM DEIXAR QUE REPITA
NUMEROS DA SEQUENCIA".

A CASCATA DE 10/09 fechou o caminho do meio — digitar 3 numa linha que vai
carregar passa por /sequenciar e o servidor renumera a fila inteira numa
transação. Sobraram DOIS buracos por onde número repetido ainda entrava:

  BURACO 1 — PATCH /api/montagem/:id gravava `sequencia` cru. Quem chega
  aqui é a linha CANCELADA (a tela manda o campo direto para cá quando a
  linha não vai mais carregar) e qualquer valor que não seja inteiro. O
  número de uma linha cancelada é RESERVADO: se ele passar a ser o mesmo de
  uma linha que vai carregar, `numerosDaFila` entende que o número é de quem
  saiu, tira a linha viva do pool e a renumera na próxima cascata. Quem
  montou o dia vê a ordem mudar sozinha.

  BURACO 2 — POST /api/montagem aceitava o número que o painel mandava, e o
  painel mandava `montagens.length + 1`. Com o dia esburacado (linha
  cancelada, linha reordenada) essa conta acerta um número que já existe:
  três linhas em 1, 2 e 9 fazem a quarta nascer como 4 — mas três linhas em
  1, 2 e 3 com uma cancelada em 4 fazem a quinta nascer como 5 enquanto
  1, 2, 3, 4, 5 já podem estar todos tomados. Contar linhas não é achar
  casa livre.

O QUE ESTE TESTE TRAVA: o servidor nunca grava número repetido no dia, nem
na criação, nem na edição, nem com duas pessoas montando ao mesmo tempo — e
a recusa ENSINA o caminho em vez de só negar.

    python3 testes/test_numero_de_sequencia_nao_repete.py
"""
import json, os, subprocess, sys, threading, urllib.error, urllib.request
from pathlib import Path

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAIL = 'seq-nao-repete@teste.local'
DIA = '2026-09-22'
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
        d = json.dumps(corpo).encode()
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, d, timeout=25) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or 'null')
        except Exception:
            return e.code, None


def criar(token, rota, **extra):
    corpo = {'dia': DIA, 'rotaCodigo': rota, 'qtdEntregas': 1, 'paletizada': 'Não'}
    corpo.update(extra)
    st, n = http('/api/montagem', token=token, metodo='POST', corpo=corpo)
    return st, ((n or {}).get('montagem') or {})


def dia_do_servidor(token):
    st, d = http(f'/api/montagem?dia={DIA}', token=token)
    return (d or {}).get('montagens', [])


def numeros(montagens):
    return [m['sequencia'] for m in montagens if m['sequencia'] is not None]


def main():
    h = subprocess.run(['node', '-e',
                        f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True)
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}';")
    psql("INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES "
         f"('{EMAIL}', 'Programador de Embarque', 'Logística', '{h.stdout.strip()}', true);")
    st, r = http('/auth/login', metodo='POST', corpo={'email': EMAIL, 'senha': SENHA})
    token = (r or {}).get('token')
    ck('login', bool(token), f'HTTP {st}')
    if not token:
        return 1
    rota = psql('SELECT codigo FROM dim_rotas LIMIT 1;').stdout.strip()
    ck('há rota cadastrada para montar', bool(rota), rota)
    if not rota:
        return 1
    psql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}';")

    print('\n=== 1. CRIAR LINHA COM NÚMERO JÁ OCUPADO NÃO DUPLICA (buraco 2) ===')
    ids = []
    for i in (1, 2, 3):
        st, m = criar(token, rota, sequencia=i)
        ids.append(m.get('montagem_id'))
    ck('três linhas nascem em 1, 2 e 3', all(ids) and numeros(dia_do_servidor(token)) != [],
       str(numeros(dia_do_servidor(token))))

    st, nova = criar(token, rota, sequencia=2)      # 2 já é de outra linha
    ck('a criação com número ocupado é aceita (não trava quem monta)', st == 201, f'HTTP {st}')
    ck('mas o número dela NÃO é o 2', nova.get('sequencia') != 2, str(nova.get('sequencia')))
    ns = numeros(dia_do_servidor(token))
    ck('e o dia não tem número repetido', len(ns) == len(set(ns)), str(sorted(ns)))
    ck('a linha nova entrou ACIMA do maior, sem empurrar ninguém',
       nova.get('sequencia') == 4, str(nova.get('sequencia')))

    print('\n    a conta do painel (montagens.length + 1) no dia esburacado')
    psql(f"UPDATE programacao_montagem SET sequencia = 9 WHERE montagem_id = '{ids[2]}';")
    st, n5 = criar(token, rota, sequencia=4)        # 4 já é da linha criada acima
    ns = numeros(dia_do_servidor(token))
    ck('com 1, 2, 4 e 9 no dia, a linha nova não repete nenhum',
       len(ns) == len(set(ns)), str(sorted(ns)))
    ck('ela nasce acima do 9', (n5.get('sequencia') or 0) == 10, str(n5.get('sequencia')))

    print('\n    número livre pedido continua sendo respeitado')
    st, n6 = criar(token, rota, sequencia=3)        # 3 ficou livre quando ids[2] virou 9
    ck('o 3, que estava livre, é honrado', n6.get('sequencia') == 3, str(n6.get('sequencia')))

    print('\n    linha criada SEM número ganha casa livre (não fica sem lugar na fila)')
    st, n7 = criar(token, rota)
    ck('nasce numerada', isinstance(n7.get('sequencia'), int), str(n7.get('sequencia')))
    ns = numeros(dia_do_servidor(token))
    ck('e o dia segue sem repetição', len(ns) == len(set(ns)), str(sorted(ns)))

    print('\n=== 2. EDITAR PARA UM NÚMERO DE OUTRA LINHA É RECUSADO (buraco 1) ===')
    psql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}';")
    ids = []
    for i in (1, 2, 3):
        st, m = criar(token, rota, sequencia=i)
        ids.append(m.get('montagem_id'))
    st, e = http(f'/api/montagem/{ids[0]}', token=token, metodo='PATCH',
                 corpo={'sequencia': 3})
    ck('o servidor recusa', st == 409, f'HTTP {st}')
    ck('com código próprio', (e or {}).get('codigo') == 'SEQUENCIA_EM_USO',
       str((e or {}).get('codigo')))
    msg = str((e or {}).get('erro', ''))
    ck('a recusa diz QUAL número está em uso', '3' in msg, msg[:110])
    ck('e ENSINA o caminho em vez de só negar',
       'Seq' in msg and ('descem' in msg or 'desce' in msg), msg[:160])
    pos = {m['montagem_id']: m['sequencia'] for m in dia_do_servidor(token)}
    ck('nada foi gravado — a linha continua no 1', pos.get(ids[0]) == 1, str(pos.get(ids[0])))

    print('\n    número quebrado não pode virar o número de outro por arredondamento')
    st, e = http(f'/api/montagem/{ids[0]}', token=token, metodo='PATCH',
                 corpo={'sequencia': 2.7})
    pos = {m['montagem_id']: m['sequencia'] for m in dia_do_servidor(token)}
    ck('2,7 não vira o 2 nem o 3 de outra linha',
       pos.get(ids[0]) == 1 and len(set(numeros(dia_do_servidor(token)))) == 3,
       f"linha ficou {pos.get(ids[0])}, dia {sorted(numeros(dia_do_servidor(token)))}")

    print('\n    o que a tela precisa continuar fazendo')
    st, _ = http(f'/api/montagem/{ids[0]}', token=token, metodo='PATCH',
                 corpo={'sequencia': ''})
    ck('apagar o número continua apagando', st == 200, f'HTTP {st}')
    pos = {m['montagem_id']: m['sequencia'] for m in dia_do_servidor(token)}
    ck('a linha ficou sem número', pos.get(ids[0]) is None, str(pos.get(ids[0])))
    st, _ = http(f'/api/montagem/{ids[1]}', token=token, metodo='PATCH',
                 corpo={'sequencia': 2, 'motorista': 'Tião'})
    ck('reenviar o PRÓPRIO número junto com outro campo não é conflito', st == 200, f'HTTP {st}')
    st, _ = http(f'/api/montagem/{ids[1]}', token=token, metodo='PATCH',
                 corpo={'peso': 1000})
    ck('gravar outro campo sem mexer na sequência passa', st == 200, f'HTTP {st}')

    print('\n=== 3. LINHA CANCELADA NÃO ROUBA O NÚMERO DE QUEM VAI CARREGAR ===')
    psql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}';")
    ids = []
    for i in (1, 2, 3):
        st, m = criar(token, rota, sequencia=i)
        ids.append(m.get('montagem_id'))
    st, _ = http(f'/api/montagem/{ids[2]}/cancelar', token=token, metodo='POST',
                 corpo={'motivo': 'cliente cancelou a carga'})
    ck('a terceira linha foi cancelada', st == 200, f'HTTP {st}')
    st, e = http(f'/api/montagem/{ids[2]}', token=token, metodo='PATCH',
                 corpo={'sequencia': 1})
    ck('a cancelada não pode assumir o 1, que é de quem vai carregar', st == 409, f'HTTP {st}')
    pos = {m['montagem_id']: m['sequencia'] for m in dia_do_servidor(token)}
    ck('a linha viva do 1 continua com o 1', pos.get(ids[0]) == 1, str(pos.get(ids[0])))
    ck('e a cancelada ficou com o número dela', pos.get(ids[2]) == 3, str(pos.get(ids[2])))

    print('\n=== 4. O CAMINHO LEGÍTIMO NÃO FOI FECHADO JUNTO ===')
    st, _ = http(f'/api/montagem/{ids[1]}/sequenciar', token=token, metodo='POST',
                 corpo={'posicao': 1})
    ck('a cascata de /sequenciar continua aceitando', st == 200, f'HTTP {st}')
    vivas = [m for m in dia_do_servidor(token) if not m['cancelada_em']]
    ck('a linha pedida foi para o 1', next(
        (m['sequencia'] for m in vivas if m['montagem_id'] == ids[1]), None) == 1,
       str([(m['montagem_id'][-4:], m['sequencia']) for m in vivas]))
    ns = numeros(dia_do_servidor(token))
    ck('e o dia inteiro segue sem repetição', len(ns) == len(set(ns)), str(sorted(ns)))

    print('\n=== 5. DUAS PESSOAS MONTANDO O MESMO DIA AO MESMO TEMPO ===')
    print('    (puxar rotas de dois computadores: a leitura e a gravação')
    print('     precisam ser uma coisa só, ou os dois acham a mesma casa livre)')
    psql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}';")
    resultados = []
    trava = threading.Lock()

    def criar_em_paralelo():
        st, m = criar(token, rota, sequencia=1)     # todos pedem a MESMA casa
        with trava:
            resultados.append((st, m.get('sequencia')))

    fios = [threading.Thread(target=criar_em_paralelo) for _ in range(6)]
    for f in fios:
        f.start()
    for f in fios:
        f.join()
    ck('as seis linhas foram criadas', len(resultados) == 6
       and all(s == 201 for s, _ in resultados), str(resultados))
    seqs = [s for _, s in resultados if s is not None]
    ck('cada uma com um número diferente', len(seqs) == len(set(seqs)), str(sorted(seqs)))
    ns = numeros(dia_do_servidor(token))
    ck('e o banco confirma: nenhum número repetido no dia',
       len(ns) == len(set(ns)), str(sorted(ns)))

    print('\n=== 6. A TRAVA É A MESMA NOS TRÊS CAMINHOS (criar, editar, cascata) ===')
    print('    (achado da revisão de 11/09: o POST trancava a data como texto ISO e o')
    print('     PATCH e a cascata trancavam a mesma data no formato que o banco devolve —')
    print('     duas chaves diferentes não se excluem, e a trava não travava nada)')
    psql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}';")
    ids = []
    for i in (1, 2):
        st, m = criar(token, rota, sequencia=i)
        ids.append(m.get('montagem_id'))
    # Alguém segura a trava do dia com a chave que o POST usa (a data em texto ISO).
    dono_da_trava = subprocess.Popen(['su', 'postgres', '-c', 'psql -q -d embarque_suinco'],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE, text=True)
    dono_da_trava.stdin.write(
        "BEGIN; SELECT pg_advisory_xact_lock(hashtext('montagem_sequencia'), "
        f"hashtext('{DIA}'));\n")
    dono_da_trava.stdin.flush()
    import time; time.sleep(0.8)

    def bloqueou(caminho, metodo, corpo):
        req = urllib.request.Request(f'{API}{caminho}', method=metodo,
                                     data=json.dumps(corpo).encode())
        req.add_header('Authorization', f'Bearer {token}')
        req.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(req, timeout=3) as r:
                return False, r.status
        except urllib.error.URLError as e:
            return 'timed out' in str(e.reason).lower() or isinstance(e.reason, TimeoutError), str(e.reason)[:40]
        except TimeoutError:
            return True, 'timeout'

    b1, d1 = bloqueou(f'/api/montagem/{ids[0]}', 'PATCH', {'sequencia': 5})
    ck('editar a sequência ESPERA quem segura a trava do dia', b1, f'{d1}')
    b2, d2 = bloqueou(f'/api/montagem/{ids[1]}/sequenciar', 'POST', {'posicao': 2})
    ck('a cascata também espera', b2, f'{d2}')

    dono_da_trava.stdin.write('COMMIT;\n'); dono_da_trava.stdin.flush()
    dono_da_trava.stdin.close(); dono_da_trava.wait(timeout=10)
    time.sleep(1.0)     # as duas requisições presas terminam agora
    st, _ = http(f'/api/montagem/{ids[0]}', token=token, metodo='PATCH', corpo={'peso': 900})
    ck('solta a trava, o servidor volta a responder na hora', st == 200, f'HTTP {st}')
    ns = numeros(dia_do_servidor(token))
    ck('e o dia segue sem número repetido', len(ns) == len(set(ns)), str(sorted(ns)))

    psql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}';")
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}';")
    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(main())
