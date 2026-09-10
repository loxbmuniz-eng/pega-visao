#!/usr/bin/env python3
"""
Gera `index.html`: uma versão de ARQUIVO ÚNICO do painel, com CSS,
JavaScript, logo e a base de Frota todos embutidos no próprio HTML.

Por que isso existe: a fonte `index_suinco.html` referencia styles.css/
data.js/app.js/logo como arquivos separados. Isso é o certo para editar,
mas quem recebe só o HTML por e-mail/WhatsApp e dá duplo clique vê a página
crua, sem layout nenhum — o navegador não carrega os arquivos vizinhos.
Esta versão de arquivo único resolve isso: um .html só, que funciona
offline, com duplo clique, sem servidor.

O nome de saída é `index.html` porque é esse o arquivo que a Vercel publica
em embarquesuinco.com.br. Ou seja: o que roda em produção é sempre o build,
nunca a fonte.

Uso:  python3 build_arquivo_unico.py

Rode de novo sempre que mexer em index_suinco.html, styles.css, data.js,
app.js, suinco-api.js ou frota_seed_2026.csv — o arquivo único é uma cópia
derivada, não a fonte.
"""

import base64
import datetime
import json
import pathlib
import re
import subprocess
import sys

BASE = pathlib.Path(__file__).parent
FONTE = 'index_suinco.html'
SAIDA = BASE / 'index.html'


def carimbo_do_build():
    """Identifica esta build: data + commit curto (ex.: '05/08 f515508').

    É o que aparece no rodapé do painel. Sem isso, depois de publicar não há
    como saber pela tela se o navegador pegou a versão nova ou serviu a
    antiga do cache — e essa dúvida já custou uma rodada inteira.

    Se o git não estiver disponível (alguém rodando o build a partir de um
    .zip), cai só na data. Não é motivo para falhar o build.
    """
    data = datetime.datetime.now().strftime('%d/%m %H:%M')
    try:
        sha = subprocess.run(
            ['git', 'rev-parse', '--short', 'HEAD'],
            cwd=BASE, capture_output=True, text=True, timeout=10,
        )
        if sha.returncode == 0 and sha.stdout.strip():
            return f'{data} · {sha.stdout.strip()}'
    except (OSError, subprocess.SubprocessError):
        pass
    return data


def ler(nome):
    caminho = BASE / nome
    if not caminho.exists():
        sys.exit(f'ERRO: não encontrei {nome} em {BASE}')
    return caminho.read_text(encoding='utf-8')


def carimbar_service_worker(carimbo):
    """Grava o carimbo do build dentro do sw.js.

    Sem isto a auto-atualização do painel não funciona. O navegador só troca
    o service worker quando os BYTES do sw.js mudam; se o arquivo é sempre
    igual, `skipWaiting`/`clients.claim` nunca rodam de novo e a aba aberta
    no pátio continua servindo a versão antiga. Carimbar aqui faz cada
    deploy virar um SW novo — que é o gatilho da recarga automática.

    O sw.js é registrado por JavaScript, então ele não passa pelo processo de
    embutir tudo no arquivo único: continua sendo um arquivo próprio,
    publicado ao lado do index.html. Por isso é reescrito no lugar.
    """
    caminho = BASE / 'sw.js'
    if not caminho.exists():
        # O painel funciona sem service worker (o registro é protegido por
        # try/catch). Não é motivo para derrubar o build.
        print('AVISO: sw.js não encontrado — build segue sem carimbá-lo')
        return
    texto = caminho.read_text(encoding='utf-8')
    # Aceita aspas simples E duplas: a fonte versionada usa simples, mas o
    # próprio build grava com json.dumps (duplas). Casar só com simples fazia
    # o SEGUNDO build seguido abortar — encontrado rodando duas vezes.
    novo, n = re.subn(
        r"""^const BUILD = (?:'[^']*'|"[^"]*");$""",
        lambda _: "const BUILD = " + json.dumps(carimbo, ensure_ascii=False) + ";",
        texto,
        flags=re.MULTILINE,
    )
    if n != 1:
        sys.exit(f"ERRO: esperava 1 linha `const BUILD = '...';` em sw.js, "
                 f"encontrei {n}. Sem ela a auto-atualização do painel para "
                 f"de funcionar em silêncio — corrija antes de publicar.")
    if novo != texto:
        caminho.write_text(novo, encoding='utf-8')


def main():
    # A fonte é sempre index_suinco.html. Não existe fallback para
    # index.html: esse é o ARQUIVO GERADO, e lê-lo como fonte faria o build
    # se alimentar da própria saída — o CSS e o JS entrariam duas vezes.
    carimbo = carimbo_do_build()

    # Mesmo carimbo no rodapé do painel e dentro do sw.js: quando alguém
    # pergunta "atualizou?", a resposta é um olhar no rodapé, e o número que
    # está lá é o mesmo que decidiu a troca do service worker.
    carimbar_service_worker(carimbo)

    html = ler(FONTE)
    css = ler('styles.css')
    adapter_js = ler('suinco-api.js')
    data_js = ler('data.js')
    app_js = ler('app.js')
    devolucoes_js = ler('devolucoes.js')
    qr_js = ler('qr.js')
    csv = ler('frota_seed_2026.csv')

    logo_bytes = (BASE / 'assets' / 'logo_suinco.png').read_bytes()
    logo_uri = 'data:image/png;base64,' + base64.b64encode(logo_bytes).decode('ascii')

    # 1. Logo vira data URI embutido em todo lugar que aponta pra ele: HTML
    #    (favicon e chip do cabeçalho), CSS, e app.js (cabeçalho dos PDFs
    #    Operacional/Executivo — sem isso o PDF exportado sai sem logo).
    html = html.replace('assets/logo_suinco.png', logo_uri)
    css = css.replace('assets/logo_suinco.png', logo_uri)
    app_js = app_js.replace('assets/logo_suinco.png', logo_uri)

    # 1b. Fonte dos relatórios (@font-face em styles.css) — mesmo tratamento
    #     do logo: vira data URI, zero requisição em tempo de uso. Existe
    #     pra garantir que o Operacional/Executivo/Fretes saiam com a MESMA
    #     tipografia em computador, Android e iPhone (pedido de 08/08/2026)
    #     — sem ela, cada SO substitui pela própria fonte de sistema.
    fonte_bytes = (BASE / 'assets' / 'inter-variable-latin.woff2').read_bytes()
    fonte_uri = 'data:font/woff2;base64,' + base64.b64encode(fonte_bytes).decode('ascii')
    css = css.replace('assets/inter-variable-latin.woff2', fonte_uri)

    # NOTA: todas as substituições abaixo passam o conteúdo via `lambda _: ...`
    # em vez de string literal. Isso é obrigatório: re.sub() interpreta
    # sequências de escape no texto de substituição, e o JS está cheio delas
    # (`\n`, `\r?\n`, `\d` dentro de expressões regulares). Com string literal,
    # o Python converte `\r?\n` em quebra de linha de verdade e corrompe o
    # código embutido — a página abre sem layout e sem funcionar.

    # 2. <link rel="stylesheet" href="styles.css"> vira <style> inline.
    html, n_css = re.subn(
        r'<link[^>]+href="styles\.css"[^>]*>',
        lambda _: '<style>\n' + css + '\n</style>',
        html,
    )
    if n_css != 1:
        sys.exit(f'ERRO: esperava 1 link para styles.css, encontrei {n_css}')

    # 3. A base de Frota entra como constante JS — em file:// o fetch do CSV
    #    é bloqueado por CORS, então data.js lê window.FROTA_SEED_CSV.
    seed = ('<script>window.FROTA_SEED_CSV = ' + json.dumps(csv, ensure_ascii=False)
            + ';</script>')

    # 3b. Carimbo do build. app.js lê window.SUINCO_BUILD e mostra no rodapé,
    #     para dar para responder "atualizou?" olhando a tela.
    seed += ('\n<script>window.SUINCO_BUILD = '
             + json.dumps(carimbo, ensure_ascii=False) + ';'
             # A hora do build em ISO, ao lado do texto: é o que permite ao
             # painel COMPARAR com a versão que o /health informa e perceber
             # sozinho que o servidor ficou para trás. Sem isto, saber que o
             # atualizar.sh não rodou dependia de alguém lembrar de avisar.
             + 'window.SUINCO_BUILD_EM = '
             + json.dumps(datetime.datetime.now().astimezone().isoformat())
             + ';</script>')

    # 4. O adaptador da API entra inline. O <script> do Socket.IO continua
    #    apontando para o próprio backend: é uma biblioteca que só faz
    #    sentido com rede, e o adaptador já trata a ausência dela caindo na
    #    consulta periódica.
    html, n_ad = re.subn(
        r'<script src="suinco-api\.js"></script>',
        lambda _: '<script>\n' + adapter_js + '\n</script>',
        html,
    )
    if n_ad != 1:
        sys.exit(f'ERRO: esperava 1 script para suinco-api.js, encontrei {n_ad}')

    # 5. <script src="data.js"> e <script src="app.js"> viram código inline.
    #    A ordem original (data.js antes de app.js) é preservada.
    html, n_data = re.subn(
        r'<script src="data\.js"></script>',
        lambda _: seed + '\n<script>\n' + data_js + '\n</script>',
        html,
    )
    if n_data != 1:
        sys.exit(f'ERRO: esperava 1 script para data.js, encontrei {n_data}')

    # 5a. O desenhista do QR do segundo fator. Entra ANTES do app.js, que o
    #     usa na tela de ativar o segundo fator.
    html, n_qr = re.subn(
        r'<script src="qr\.js"></script>',
        lambda _: '<script>\n' + qr_js + '\n</script>',
        html,
    )
    if n_qr != 1:
        sys.exit(f'ERRO: esperava 1 script para qr.js, encontrei {n_qr}')

    html, n_app = re.subn(
        r'<script src="app\.js"></script>',
        lambda _: '<script>\n' + app_js + '\n</script>',
        html,
    )
    if n_app != 1:
        sys.exit(f'ERRO: esperava 1 script para app.js, encontrei {n_app}')

    # 5b. Módulo de Devoluções — depois de app.js (usa os globais dele).
    html, n_dev = re.subn(
        r'<script src="devolucoes\.js"></script>',
        lambda _: '<script>\n' + devolucoes_js + '\n</script>',
        html,
    )
    if n_dev != 1:
        sys.exit(f'ERRO: esperava 1 script para devolucoes.js, encontrei {n_dev}')

    # Nada pode sobrar apontando para arquivo externo, senão quebra offline.
    #
    # Exceção única: o manifest do PWA. Ele não pode ser embutido — o
    # navegador exige um arquivo próprio para oferecer a instalação — e é
    # opcional por construção: sem ele o painel funciona igual, só não vira
    # ícone na tela inicial. Quem abre por duplo clique recebe um 404 que o
    # navegador ignora em silêncio.
    #
    # O sw.js não aparece nesta checagem porque é registrado por JavaScript,
    # não por src/href. Mesma lógica: opcional, e o registro está protegido.
    OPCIONAIS = {'manifest.webmanifest'}
    sobras = [s for s in re.findall(r'(?:src|href)="(?!data:|https?://|#)([^"]+)"', html)
              if s not in OPCIONAIS]
    if sobras:
        sys.exit(f'ERRO: ainda há referências a arquivos externos: {sobras}')

    SAIDA.write_text(html, encoding='utf-8')
    kb = len(html.encode('utf-8')) / 1024
    print(f'OK: {SAIDA.name} gerado ({kb:.0f} KB, {len(csv.splitlines()) - 1} placas embutidas)')


if __name__ == '__main__':
    main()
