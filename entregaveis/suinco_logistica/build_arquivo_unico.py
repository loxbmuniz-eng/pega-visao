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
app.js, suinco-sharepoint.js ou frota_seed_2026.csv — o arquivo único é uma
cópia derivada, não a fonte.
"""

import base64
import json
import pathlib
import re
import sys

BASE = pathlib.Path(__file__).parent
FONTE = 'index_suinco.html'
SAIDA = BASE / 'index.html'


def ler(nome):
    caminho = BASE / nome
    if not caminho.exists():
        sys.exit(f'ERRO: não encontrei {nome} em {BASE}')
    return caminho.read_text(encoding='utf-8')


def main():
    # A fonte é sempre index_suinco.html. Não existe fallback para
    # index.html: esse é o ARQUIVO GERADO, e lê-lo como fonte faria o build
    # se alimentar da própria saída — o CSS e o JS entrariam duas vezes.
    html = ler(FONTE)
    css = ler('styles.css')
    adapter_js = ler('suinco-sharepoint.js')
    data_js = ler('data.js')
    app_js = ler('app.js')
    csv = ler('frota_seed_2026.csv')

    logo_bytes = (BASE / 'assets' / 'logo_suinco.png').read_bytes()
    logo_uri = 'data:image/png;base64,' + base64.b64encode(logo_bytes).decode('ascii')

    # 1. Logo vira data URI embutido em todo lugar que aponta pra ele: HTML
    #    (favicon e chip do cabeçalho), CSS, e app.js (cabeçalho dos PDFs
    #    Operacional/Executivo — sem isso o PDF exportado sai sem logo).
    html = html.replace('assets/logo_suinco.png', logo_uri)
    css = css.replace('assets/logo_suinco.png', logo_uri)
    app_js = app_js.replace('assets/logo_suinco.png', logo_uri)

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

    # 4. O adaptador do SharePoint também entra inline. O <script> do MSAL
    #    continua apontando para a CDN da Microsoft: não dá para embutir uma
    #    biblioteca de autenticação que precisa de rede de qualquer forma, e
    #    o adaptador já trata a ausência dela caindo em modo local.
    html, n_ad = re.subn(
        r'<script src="suinco-sharepoint\.js"></script>',
        lambda _: '<script>\n' + adapter_js + '\n</script>',
        html,
    )
    if n_ad != 1:
        sys.exit(f'ERRO: esperava 1 script para suinco-sharepoint.js, encontrei {n_ad}')

    # 5. <script src="data.js"> e <script src="app.js"> viram código inline.
    #    A ordem original (data.js antes de app.js) é preservada.
    html, n_data = re.subn(
        r'<script src="data\.js"></script>',
        lambda _: seed + '\n<script>\n' + data_js + '\n</script>',
        html,
    )
    if n_data != 1:
        sys.exit(f'ERRO: esperava 1 script para data.js, encontrei {n_data}')

    html, n_app = re.subn(
        r'<script src="app\.js"></script>',
        lambda _: '<script>\n' + app_js + '\n</script>',
        html,
    )
    if n_app != 1:
        sys.exit(f'ERRO: esperava 1 script para app.js, encontrei {n_app}')

    # Nada pode sobrar apontando para arquivo externo, senão quebra offline.
    sobras = re.findall(r'(?:src|href)="(?!data:|https?://|#)([^"]+)"', html)
    if sobras:
        sys.exit(f'ERRO: ainda há referências a arquivos externos: {sobras}')

    SAIDA.write_text(html, encoding='utf-8')
    kb = len(html.encode('utf-8')) / 1024
    print(f'OK: {SAIDA.name} gerado ({kb:.0f} KB, {len(csv.splitlines()) - 1} placas embutidas)')


if __name__ == '__main__':
    main()
