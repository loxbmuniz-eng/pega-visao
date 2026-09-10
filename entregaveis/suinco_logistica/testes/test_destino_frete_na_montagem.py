#!/usr/bin/env python3
"""A Montagem do Dia leva destino e valor de frete (10/09/2026).

RELATO DO DONO: "quando o wemerson coloca adicionar linha nao ta aparecendo na
hora de montar a programcao" e, precisando o sintoma, "quando adiciona a linha
ela nao aparece o destino". Depois: "montagem do dia precisa seguir com destino
valor de frete" e "é pra aparecer e conectar com tudo".

O DEFEITO ERA DE COBERTURA, E MEU. A migração 047 criou o destino de frete e os
dois KM em fact_viagens — as cargas. A Montagem do Dia é o SEGUNDO caminho de
criar carga (efetivarMontagemUI monta o payload a partir da linha) e não recebeu
os campos. Toda carga nascida pela Montagem nascia sem destino; sem destino não
há KM; sem KM o servidor não calcula frete. É a regra da casa quebrada por quem
a escreveu: uma função, dois chamadores.

O QUE ESTE TESTE TRAVA
  1. a linha da montagem GRAVA destino e KM de deslocamento;
  2. o KM DO DESTINO é resolvido pelo SERVIDOR, a partir do cadastro — mandar
     um número pelo cliente não muda nada. Sem isso, o valor do frete passaria
     a ser escolhido por quem envia a requisição;
  3. a leitura do dia CALCULA o valor (km de deslocamento x tarifa do tipo de
     veículo, que vem da placa pela Frota);
  4. a tela mostra as três colunas — Destino, KM e Frete;
  5. e a efetivação LEVA destino e KM para a carga, que é onde o defeito doía.

    python3 testes/test_destino_frete_na_montagem.py
"""
import asyncio
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
PAINEL = 'file://' + str(RAIZ / 'index.html')
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAIL = 'montagem-frete@teste.local'
DIA = '2026-09-13'

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def psql(q):
    """SQL por stdin: o hash do bcrypt tem `$` e o shell o comeria."""
    r = subprocess.run(['su', 'postgres', '-c', 'psql -q -tA -d embarque_suinco'],
                       input=q, capture_output=True, text=True)
    if r.returncode != 0:
        print('    [psql]', (r.stderr or '').strip()[:140])
    return r


def http(caminho, token=None, metodo='GET', corpo=None):
    req = urllib.request.Request(f'{API}{caminho}', method=metodo)
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    dados = None
    if corpo is not None:
        dados = json.dumps(corpo).encode()
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, dados, timeout=25) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or 'null')
        except Exception:
            return e.code, None


async def main():
    print('\n=== 0. PREPARO ===')
    h = subprocess.run(['node', '-e',
                        f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True)
    if h.returncode != 0:
        ck('gerar hash', False, h.stderr[:120]); return
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}';")
    psql("INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES "
         f"('{EMAIL}', 'Wemerson Teste', 'Logística', '{h.stdout.strip()}', true);")
    st, r = http('/auth/login', metodo='POST', corpo={'email': EMAIL, 'senha': SENHA})
    token = (r or {}).get('token') if st == 200 else None
    ck('login', bool(token), f'HTTP {st}')
    if not token:
        return

    rota = psql('SELECT codigo FROM dim_rotas LIMIT 1;').stdout.strip()
    linha = psql("SELECT placa || '|' || tipo_veiculo FROM dim_veiculos "
                 "WHERE tipo_veiculo = 'Truck' LIMIT 1;").stdout.strip()
    if '|' not in linha:
        ck('achar uma placa Truck na frota', False, linha[:80]); return
    placa, tipo = linha.split('|')
    dest = psql("SELECT destino || '|' || km FROM frete_destinos "
                "WHERE ativo AND km > 0 LIMIT 1;").stdout.strip()
    destino, km_cad = dest.split('|')
    km_cad = int(km_cad)
    tarifa = float(psql(f"SELECT valor_por_km FROM frete_tarifas "
                        f"WHERE tipo_veiculo = '{tipo}';").stdout.strip())
    ck('cadastro tem destino, placa e tarifa', True,
       f'{destino} ({km_cad} km) · {placa} {tipo} · R$ {tarifa}/km')
    psql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}';")

    print('\n=== 1. A LINHA GRAVA DESTINO E KM ===')
    KM_REAL = km_cad + 165          # o desvio do dia: é o que o frete usa
    st, novo = http('/api/montagem', token=token, metodo='POST', corpo={
        'dia': DIA, 'rotaCodigo': rota, 'sequencia': 1, 'qtdEntregas': 1,
        'paletizada': 'Não', 'freteDestino': destino, 'kmDeslocamento': KM_REAL})
    m = (novo or {}).get('montagem') or {}
    mid = m.get('montagem_id')
    ck('criar linha com destino', st == 201 and bool(mid), f'HTTP {st}')
    ck('o destino ficou gravado na linha', m.get('frete_destino') == destino,
       str(m.get('frete_destino')))
    ck('o KM de deslocamento é o do operador', m.get('km_deslocamento') == KM_REAL,
       str(m.get('km_deslocamento')))

    print('\n=== 2. QUEM DIZ A DISTÂNCIA É O CADASTRO, NÃO O CLIENTE ===')
    ck('o KM do destino veio do cadastro', m.get('km_destino') == km_cad,
       f'{m.get("km_destino")} (cadastro: {km_cad})')
    st, alt = http(f'/api/montagem/{mid}', token=token, metodo='PATCH',
                   corpo={'kmDestino': 99999})
    depois = ((alt or {}).get('montagem') or {}).get('km_destino')
    ck('mandar kmDestino pelo cliente NÃO muda o valor', depois == km_cad,
       f'ficou {depois}, cadastro diz {km_cad}')

    print('\n=== 3. A LEITURA DO DIA CALCULA O FRETE ===')
    http(f'/api/montagem/{mid}', token=token, metodo='PATCH', corpo={'placa': placa})
    st, dia = http(f'/api/montagem?dia={DIA}', token=token)
    linhas = [x for x in (dia or {}).get('montagens', []) if x['montagem_id'] == mid]
    ck('a linha volta na leitura do dia', len(linhas) == 1, f'{len(linhas)} linha(s)')
    if linhas:
        L = linhas[0]
        esperado = round(KM_REAL * tarifa, 2)
        ck('o tipo de veículo veio da placa', L.get('frota_tipo_veiculo') == tipo,
           str(L.get('frota_tipo_veiculo')))
        ck('a tarifa usada é a do tipo', float(L.get('frete_tarifa_usada') or 0) == tarifa,
           str(L.get('frete_tarifa_usada')))
        ck(f'o valor é km x tarifa ({KM_REAL} x {tarifa} = {esperado})',
           abs(float(L.get('frete_valor') or 0) - esperado) < 0.01,
           str(L.get('frete_valor')))

    print('\n=== 4. AS TRÊS COLUNAS APARECEM NA TELA ===')
    html = (RAIZ / 'index.html').read_text(errors='ignore')
    ck('o cabeçalho tem Destino', re.search(r'<th[^>]*>Destino</th>', html) is not None)
    ck('o cabeçalho tem Frete', re.search(r'<th[^>]*>Frete</th>', html) is not None)
    ck('a linha tem o campo de escolher destino',
       'freteDestinoMontagemHtml' in html)
    ck('e a célula do valor, que é só leitura', 'freteMontagemHtml' in html)
    ck('o detalhe expandido acompanha as colunas novas',
       'colspan="14"' in html, 'colspan não acompanhou as 3 colunas novas')

    print('\n=== 5. A EFETIVAÇÃO LEVA O DESTINO PARA A CARGA ===')
    # É aqui que o defeito doía: destino na montagem e carga sem destino.
    ck('efetivarMontagemUI passa o destino adiante',
       re.search(r'freteDestino:\s*m\.frete_destino', html) is not None)
    ck('e o KM de deslocamento junto',
       re.search(r'kmDeslocamento:\s*m\.km_deslocamento', html) is not None)

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(1200)
        existe = await pg.evaluate(
            "() => ['freteDestinoMontagemHtml','freteMontagemHtml']"
            ".every(n => typeof window[n] === 'function' || typeof eval(n) === 'function')")
        ck('as funções da linha existem no painel montado', existe)
        ck('nenhum erro de JavaScript', not erros, str(erros[:1]))
        await nav.close()

    psql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}';")
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}';")

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)


asyncio.run(main())
