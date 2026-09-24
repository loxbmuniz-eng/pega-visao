#!/usr/bin/env python3
"""A vitrine: o painel da branch de trabalho, para olhar antes de subir.

PEDIDO DO DONO: "eu sempre vou conseguir testar as coisas antes num
artefato de teste antes de subir".

O QUE ELA É. Uma cópia do `index.html` gerado, com cinco mudanças — e
nenhuma delas toca no painel publicado:

  1. `SP_CONFIG.ativo` vira `false`. É o modo local que o painel já tem:
     ele não procura o servidor, não lê o pátio, não grava nada. A vitrine
     NÃO TEM LIGAÇÃO com a operação — não é que ela evite mexer, é que não
     existe caminho.
  2. A tag do socket.io sai. Ela aponta para a API de produção, e uma tag
     de script é buscada pelo navegador antes de qualquer linha nossa
     rodar — `SP_CONFIG.ativo` não alcança. Foi o teste que pegou isto.
  3. O registro do service worker sai. A vitrine mora noutro endereço; um
     service worker ali guardaria uma cópia da vitrine no navegador e
     poderia aparecer depois no lugar errado.
  4. A base de demonstração entra pronta no localStorage. Sem isto toda
     tela abriria vazia, e tela vazia não se julga.
  5. Uma tarja fixa no topo diz o que é — inclusive que baixar arquivo
     não funciona na vitrine. O visualizador de artefato não dá à página
     permissão de entregar arquivo, então os botões de PDF e CSV não
     produzem nada ali. Sem esse aviso, a primeira coisa que acontece é
     alguém relatar como defeito um comportamento do lugar, não do painel.
     O registro do service worker sai. Cópia do painel sem aviso é a
     coisa mais fácil de confundir com o painel — e alguém tomaria decisão
     de operação olhando número de mentira.

    python3 build_arquivo_unico.py
    python3 vitrine/gerar_demonstracao.py
    python3 vitrine/gerar_vitrine.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PAINEL = RAIZ / 'index.html'
BASE = RAIZ / 'vitrine' / 'demonstracao.json'
SAIDA = RAIZ / 'vitrine' / 'vitrine.html'
CHAVE = 'suinco_painel_v1'

TARJA = """
<div id="vitrine-tarja" role="status">
  <b>VITRINE — não é o painel</b>
  <span>Cópia para olhar antes de publicar. Sem ligação com o servidor;
  os dados são de demonstração. <b>Baixar PDF e CSV não funciona aqui</b> —
  a vitrine não tem permissão de entregar arquivo; no painel funciona.</span>
  <span class="vitrine-commit">%(commit)s</span>
</div>
<style>
  #vitrine-tarja{
    position:sticky; top:0; z-index:99999;
    display:flex; align-items:baseline; gap:.6rem; flex-wrap:wrap;
    padding:.45rem .9rem;
    background:#7a1224; color:#fff;
    font:600 13px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
    border-bottom:2px solid #ffd97a;
  }
  #vitrine-tarja span{font-weight:400; opacity:.92; font-size:12px}
  #vitrine-tarja .vitrine-commit{margin-left:auto; font-family:ui-monospace,monospace}
  @media (max-width:640px){ #vitrine-tarja .vitrine-commit{margin-left:0} }
</style>
"""


def erro(msg):
    print(f'ERRO: {msg}')
    sys.exit(1)


def main():
    if not PAINEL.exists():
        erro('não achei o index.html — rode antes: python3 build_arquivo_unico.py')
    if not BASE.exists():
        erro('não achei a base de demonstração — rode antes: '
             'python3 vitrine/gerar_demonstracao.py')

    html = PAINEL.read_text(encoding='utf-8')
    commit = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=str(RAIZ),
                            capture_output=True, text=True).stdout.strip() or 'sem commit'

    # 1. modo local — sem servidor, sem rede.
    html, n = re.subn(r'\n(\s*)ativo: true,', r'\n\1ativo: false,', html, count=1)
    if n != 1:
        erro('não achei `ativo: true` no SP_CONFIG. O painel mudou de forma — '
             'sem esta troca a vitrine falaria com o servidor de produção.')

    # 2. o service worker não acompanha a vitrine.
    alvo = "if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {"
    if alvo not in html:
        erro('não achei o registro do service worker para desligar.')
    html = html.replace(alvo, "if (false) { /* vitrine: sem service worker */", 1)

    # 2b. O SOCKET.IO VINHA DO SERVIDOR DE PRODUÇÃO, e foi o teste que pegou.
    #
    # O painel carrega a biblioteca de tempo real por `<script src>` apontando
    # para a API. Isso é um GET ao servidor de produção, feito pelo navegador
    # ANTES de qualquer linha de JavaScript nossa rodar — `SP_CONFIG.ativo`
    # não alcança uma tag de script. A primeira versão deste gerador deixou
    # passar: a vitrine dizia "sem ligação com o servidor" na tarja e pedia
    # um arquivo a ele na abertura.
    #
    # `onerror` já existe no painel e marca `__socketIoFalhou` — o caminho de
    # "sem tempo real" é previsto e testado. Tirar a tag é entrar por ele.
    html, n = re.subn(
        r'<script src="https://api\.embarquesuinco\.com\.br/socket\.io/socket\.io\.js"'
        r'[^>]*></script>',
        '<script>/* vitrine: sem tempo real — nada sai daqui */ '
        'window.__socketIoFalhou = true;</script>',
        html, count=1)
    if n != 1:
        erro('não achei a tag do socket.io para tirar. Sem esta troca a vitrine '
             'pede um arquivo ao servidor de produção na abertura.')

    # 2c. A ABA DO NAVEGADOR TAMBÉM PRECISA DIZER O QUE É. Duas abas abertas
    # com o mesmo título — o painel e a vitrine — é a forma mais fácil de
    # alguém clicar na errada.
    html, n = re.subn(r'<title>Programação de Embarque — Suinco</title>',
                      '<title>VITRINE — Programação de Embarque</title>', html, count=1)
    if n != 1:
        erro('não achei o <title> do painel para marcar como vitrine.')

    # 3 e 4. a base de demonstração e a tarja, antes de qualquer script rodar.
    dados = json.loads(BASE.read_text(encoding='utf-8'))
    semente = (
        '<script>/* vitrine: a base de demonstração entra antes de o painel ler o disco */\n'
        'try{ localStorage.setItem(' + json.dumps(CHAVE) + ', '
        + json.dumps(json.dumps(dados, ensure_ascii=False)) + '); }catch(e){}\n'
        '</script>\n'
    )
    corpo = re.search(r'<body[^>]*>', html)
    if not corpo:
        erro('não achei a abertura do <body>.')
    ponto = corpo.end()
    html = html[:ponto] + '\n' + semente + (TARJA % {'commit': commit}) + html[ponto:]

    # A conferência que vale: depois de tudo, não pode ter sobrado nada
    # apontando para a API de produção fora de comentário.
    if re.search(r"api:\s*'https://api\.embarquesuinco\.com\.br'", html) and \
       not re.search(r'ativo: false,', html):
        erro('a vitrine ficou com o modo servidor ligado.')

    SAIDA.parent.mkdir(exist_ok=True)
    SAIDA.write_text(html, encoding='utf-8')
    kb = len(html.encode('utf-8')) / 1024
    print(f'OK: vitrine/{SAIDA.name} gerada ({kb:.0f} KB) — painel {commit}, '
          f'{len(dados.get("cargas", []))} carga(s) de demonstração')
    return 0


if __name__ == '__main__':
    sys.exit(main())
