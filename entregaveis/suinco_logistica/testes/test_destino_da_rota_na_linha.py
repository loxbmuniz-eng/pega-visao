#!/usr/bin/env python3
"""O destino da carga aparece — na Montagem, na Torre e no Operacional.

RELATO DO DONO (21/09/2026), duas mensagens:

  "na torre de controle precisa aparecer o destino também de cada carga, ao
   invés de sair alto paranaiba por exemplo, que saia a cidade exata"

  "na hora de pegar o template da montagem do dia ela ta puxando os nomes das
   cidades e quando sao criadas novas na montagem do dia ela os mantem a rota
   e nao puxa o nome das cidades"

O MECANISMO, medido antes de mexer:

  A linha da Montagem monta o nome em `destinoMontagemHtml()`:

      apelido_rota ? <strong>apelido</strong> + rota_nome · codigo
                   : <strong>rota_nome</strong> + codigo

  `rota_nome` vem do servidor como `r.nome AS rota_nome` — é `dim_rotas.nome`,
  e NUNCA traz cidade. Quem traz a cidade é o `apelido_rota`, que o dono
  digitou no modelo da semana. Linha do modelo tem apelido; linha criada na
  Montagem nasce sem — e é a divergência inteira.

O QUE ESTE TESTE NÃO ASSUME. A rota 504 tem CINCO apelidos no modelo, um por
cidade (Paracatu, Unaí, João Pinheiro, Arinos / Buritis, Riachinho). Não
existe "o apelido da rota": preencher a linha nova com um deles seria escolher
por quem programa para qual cidade a carga vai. Por isso o teste exige ESCOLHA
oferecida, não preenchimento automático.

    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
        python3 testes/test_destino_da_rota_na_linha.py
    # contra o que está no ar (tem de REPROVAR):
    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
        python3 testes/test_destino_da_rota_na_linha.py --painel /tmp/publicado.html
"""
import argparse
import asyncio
import os
import pathlib
import subprocess
import sys
import urllib.error
import urllib.request

from playwright.async_api import async_playwright

BASE = pathlib.Path(__file__).resolve().parent.parent
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH', '/opt/pw-browsers/chromium')
SENHA = 'senha-de-teste-123'
ROTA = '504'          # a rota do relato: cinco cidades, nome de região
PREFIXO = 'DEST21'

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def sql(q):
    r = subprocess.run(['su', 'postgres', '-c', f'psql -At -d embarque_suinco -c "{q}"'],
                       capture_output=True, text=True)
    return [l for l in r.stdout.strip().split('\n') if l]


def descobrir_api():
    for porta in (3010, 3011, 3012, 3013, 3014, 3015):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{porta}/health', timeout=2) as r:
                if r.status == 200:
                    return f'http://127.0.0.1:{porta}'
        except (urllib.error.URLError, OSError):
            continue
    return None


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--painel', default=str(BASE / 'index.html'))
    args = ap.parse_args()

    api = descobrir_api()
    if not api:
        sys.exit('  X  a API não respondeu em 3010-3015. Suba o servidor antes.')

    cidades = sql("SELECT DISTINCT apelido_rota FROM programacao_modelo "
                  f"WHERE rota_codigo = '{ROTA}' AND ativo AND apelido_rota <> ''")
    if len(cidades) < 2:
        sys.exit(f'  X  a rota {ROTA} precisa de 2+ apelidos no modelo para este teste; '
                 f'achei {len(cidades)}. Rode o seed do modelo.')
    print(f'\n  rota {ROTA} tem {len(cidades)} destino(s) no modelo: {", ".join(cidades)}')

    sql(f"DELETE FROM programacao_montagem WHERE numero_carga LIKE '{PREFIXO}%'")
    html = pathlib.Path(args.painel).read_text(encoding='utf-8')
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{api}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{api}/socket.io/socket.io.js')
    url = f'{api}/__destino_da_rota'

    print(f'  medindo: {args.painel}')
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROMIUM)
        ctx = await nav.new_context(viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        await pg.wait_for_selector('#login-email', timeout=25000)
        await pg.fill('#login-email', 'ana@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3000)

        print('\n=== 1. A FUNÇÃO ÚNICA QUE RESOLVE O DESTINO ===')
        existe = await pg.evaluate("() => typeof destinosDaRota === 'function'")
        ck('destinosDaRota() existe — uma função, todos os chamadores', existe)

        # SEM O CATÁLOGO DO MODELO, o cadastro responde sozinho. Medido antes
        # de abrir a Montagem, que é quem carrega o catálogo: o valor aqui tem
        # de vir do `detalhe` da rota e NUNCA ser vazio, senão a tela diria
        # "sem destino cadastrado" com o cadastro cheio.
        antes = await pg.evaluate(
            "(r) => (typeof destinosDaRota === 'function' ? destinosDaRota(r) : null)", ROTA)
        ck('sem o catálogo carregado, o cadastro da rota responde sozinho',
           isinstance(antes, list) and len(antes) > 0, f'devolveu {antes}')

        print('\n=== 2. A LINHA NOVA OFERECE A ESCOLHA DO DESTINO ===')
        await pg.evaluate("() => abrirTab('programacao')")
        await pg.wait_for_timeout(2500)

        # Com o catálogo de pé, o MODELO manda: é a lista que o dono digitou.
        lista = await pg.evaluate(
            "(r) => (typeof destinosDaRota === 'function' ? destinosDaRota(r) : null)", ROTA)
        ck(f'com o catálogo, destinosDaRota("{ROTA}") devolve EXATAMENTE o modelo',
           isinstance(lista, list) and sorted(lista) == sorted(cidades),
           f'devolveu {lista}')
        ck('nada duplicado — "Arinos / Buritis" não vira também "Arinos" e "Buritis"',
           isinstance(lista, list) and len(lista) == len(set(lista)) == len(cidades),
           f'{lista}')
        # O seletor de rota abre em qualquer rota; sem escolher a 504 o teste
        # leria os destinos de outra e acusaria defeito que não existe.
        seletor = await pg.evaluate("""(rota) => {
            const sel = document.getElementById('mont-rota-extra');
            if (!sel) return null;
            sel.value = rota;
            sel.dispatchEvent(new Event('change'));
            const el = document.getElementById('mont-destino-extra');
            if (!el) return null;
            return [...el.options].map(o => o.textContent.trim());
        }""", ROTA)
        ck('existe um seletor de DESTINO ao lado do de rota', seletor is not None,
           'mont-destino-extra não existe na tela')
        if seletor is not None:
            achou = [c for c in cidades if any(c in s for s in seletor)]
            ck(f'o seletor traz os {len(cidades)} destinos da rota {ROTA}',
               len(achou) >= len(cidades),
               f'achou {len(achou)}: {achou}')

        print('\n=== 3. A LINHA CRIADA GUARDA O DESTINO ESCOLHIDO ===')
        escolhida = cidades[0]
        criou = await pg.evaluate("""async ([rota, destino]) => {
            try {
              const r = await SuincoSharePoint.montagem.criar({
                rotaCodigo: rota, numeroCarga: 'DEST21-1', qtdEntregas: 1,
                apelidoRota: destino });
              return r && r.montagem ? r.montagem.apelido_rota : null;
            } catch (e) { return 'ERRO: ' + (e.message || e); }
        }""", [ROTA, escolhida])
        ck('a linha nasce com o destino escolhido no apelido_rota',
           criou == escolhida, f'gravou {criou!r}, esperava {escolhida!r}')

        print('\n=== 4. A TELA MOSTRA A CIDADE, NÃO SÓ A REGIÃO ===')
        await pg.evaluate("() => carregarMontagemUI()")
        await pg.wait_for_timeout(2500)
        texto = await pg.evaluate("""() => {
            const t = document.querySelector('#mont-tabela');
            return t ? t.innerText : '';
        }""")
        ck(f'"{escolhida}" aparece na linha da Montagem', escolhida in texto,
           'a linha mostra só a região')

        print('\n=== 5. A AVULSA COM DESTINO NÃO ENGOLE A LINHA DO MODELO ===')
        """A armadilha que este bloco trava.

        Até 21/09 a carga avulsa escapava da contagem por ACIDENTE: nascia sem
        apelido, e a chave do modelo tem um ("rt:504¦Unaí"), então as duas
        nunca casavam. Ao passar a PERGUNTAR o destino, a avulsa ganhou
        apelido — e casaria. A linha prevista do dia sumiria da oferta em
        silêncio, que é "uma rota que não embarca, e ninguém descobre".
        """
        antes_falta = await pg.evaluate("""(rota) => {
            const modelo = [{ modelo_id: 9001, rota_codigo: rota, apelido_rota: 'Unaí' }];
            return linhasDoModeloQueFaltam(modelo, []).length;
        }""", ROTA)
        depois_falta = await pg.evaluate("""(rota) => {
            const modelo = [{ modelo_id: 9001, rota_codigo: rota, apelido_rota: 'Unaí' }];
            /* avulsa do fluxo novo: marcada no banco pela migração 055 */
            const avulsa = [{ modelo_id: null, avulsa: true, rota_codigo: rota, apelido_rota: 'Unaí' }];
            return linhasDoModeloQueFaltam(modelo, avulsa).length;
        }""", ROTA)
        ck('a linha do modelo continua sendo oferecida depois de uma avulsa do mesmo destino',
           antes_falta == 1 and depois_falta == 1,
           f'faltando sem avulsa: {antes_falta} · com avulsa: {depois_falta} (tem de ser 1 e 1)')

        consome = await pg.evaluate("""(rota) => {
            const modelo = [{ modelo_id: 9001, rota_codigo: rota, apelido_rota: 'Unaí' }];
            /* a MESMA linha, puxada do modelo: essa SIM consome */
            const doModelo = [{ modelo_id: 9001, rota_codigo: rota, apelido_rota: 'Unaí' }];
            return linhasDoModeloQueFaltam(modelo, doModelo).length;
        }""", ROTA)
        ck('a linha puxada do modelo continua consumindo a própria linha',
           consome == 0, f'faltando: {consome} (tem de ser 0)')

        await ctx.close()
        await nav.close()

    sql(f"DELETE FROM programacao_montagem WHERE numero_carga LIKE '{PREFIXO}%'")

    print('\n=== RESULTADO ===')
    if falhas:
        print(f'  FALHAS: {"; ".join(falhas)}')
        sys.exit(1)
    print('  FALHAS: NENHUMA')


asyncio.run(main())
