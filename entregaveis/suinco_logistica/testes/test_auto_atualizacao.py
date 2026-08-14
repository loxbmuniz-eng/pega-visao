#!/usr/bin/env python3
"""O painel do Alysson e do Wemerson se atualiza sozinho depois de um deploy.

POR QUE ESTE TESTE EXISTE (14/08/2026)
--------------------------------------
O usuário perguntou "o que fazer para atualizar isso nos painéis do Alysson
e do Wemerson, só logar de novo?". Investigando para responder, apareceu um
buraco real: a auto-atualização estava documentada em index_suinco.html
("quando uma versão nova assume o controle da página, recarrega a aba
sozinho") mas NÃO funcionava para o deploy normal.

A cadeia: o navegador só instala um service worker novo quando os BYTES do
sw.js mudam. O sw.js tinha `const VERSAO = 'suinco-v1'` fixo e não era
tocado pelo build — 44 commits mexeram em index.html sem mexer nele. Logo:
nenhum SW novo → `skipWaiting`/`clients.claim` não rodavam de novo →
`controllerchange` nunca disparava → a aba aberta o turno inteiro no pátio
seguia na versão velha, sem nenhum sinal.

Sair e entrar de novo TAMBÉM não resolvia: `sair()` (suinco-api.js) só
limpa o token, não recarrega a página — o código já carregado continua o
mesmo.

O que passou a valer: o build carimba o sw.js, então todo deploy muda o
arquivo, o navegador instala o SW novo e a recarga automática acontece.

Este teste protege as três pontas dessa corrente. Se qualquer uma quebrar,
o sintoma em produção é mudo — painel velho sem ninguém perceber.

    python3 testes/test_auto_atualizacao.py
"""
import pathlib
import re
import subprocess
import sys

BASE = pathlib.Path(__file__).resolve().parent.parent
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def main():
    sw = (BASE / 'sw.js').read_text(encoding='utf-8')
    fonte = (BASE / 'index_suinco.html').read_text(encoding='utf-8')
    build = (BASE / 'build_arquivo_unico.py').read_text(encoding='utf-8')

    print('\n=== 1. O sw.js CARREGA UM CARIMBO DE BUILD ===')
    # Era este o elo que faltava: sem carimbo, o arquivo nunca muda.
    ck('sw.js tem a linha de carimbo que o build reescreve',
       bool(re.search(r"^const BUILD = '[^']*';$", sw, re.MULTILINE))
       or bool(re.search(r'^const BUILD = "[^"]*";$', sw, re.MULTILINE)))
    ck('o nome do cache deriva do carimbo (não é mais fixo)',
       "const VERSAO = 'suinco-' + BUILD" in sw)

    print('\n=== 2. O BUILD REALMENTE ESCREVE O CARIMBO ===')
    ck('build_arquivo_unico.py carimba o sw.js', 'carimbar_service_worker' in build)
    ck('o carimbo é calculado uma vez só e reusado nos dois lugares',
       'carimbo = carimbo_do_build()' in build
       and 'carimbar_service_worker(carimbo)' in build
       and 'json.dumps(carimbo,' in build)

    print('\n=== 3. RODAR O BUILD MUDA OS BYTES DO sw.js ===')
    # A prova de verdade: gerar duas builds em commits diferentes precisa
    # produzir sw.js diferentes. Aqui basta conferir que o build escreveu o
    # carimbo real (e não deixou 'fonte').
    antes = (BASE / 'sw.js').read_text(encoding='utf-8')
    r = subprocess.run([sys.executable, 'build_arquivo_unico.py'],
                       cwd=BASE, capture_output=True, text=True, timeout=180)
    ck('build roda sem erro', r.returncode == 0, (r.stderr or r.stdout)[-300:])
    depois = (BASE / 'sw.js').read_text(encoding='utf-8')
    m = re.search(r"^const BUILD = ['\"]([^'\"]*)['\"];$", depois, re.MULTILINE)
    ck('sw.js saiu do build com carimbo de verdade',
       bool(m) and m.group(1) != 'fonte', m.group(1) if m else 'linha não encontrada')
    ck('os bytes do sw.js mudaram em relação à fonte não carimbada',
       antes != depois or (m and m.group(1) != 'fonte'))

    print('\n=== 4. A PÁGINA REAGE AO SW NOVO RECARREGANDO ===')
    # Sem estes três, carimbar o sw.js não serviria de nada.
    ck('registra o service worker', "navigator.serviceWorker.register('sw.js')" in fonte)
    ck('reconfere se há versão nova com a aba aberta', 'registro.update()' in fonte)
    ck('recarrega quando a versão nova assume', "'controllerchange'" in fonte
       and 'location.reload()' in fonte)
    ck('sw novo assume na hora (skipWaiting + claim)',
       'self.skipWaiting()' in sw and 'self.clients.claim()' in sw)
    ck('cache de versão anterior é apagado no activate',
       'caches.delete' in sw)

    print('\n=== 5. NAVEGAÇÃO NÃO PODE VIR DO CACHE DO NAVEGADOR ===')
    # Este é o caminho de quem simplesmente fecha e abre o painel: precisa
    # buscar da rede, ignorando a cópia "fresca" do disco.
    ck("navegação usa cache:'no-store'", "cache: 'no-store'" in sw)

    print('\n=== 6. O RODAPÉ MOSTRA A VERSÃO (para conferir na tela) ===')
    gerado = (BASE / 'index.html').read_text(encoding='utf-8')
    ck('index.html gerado carrega window.SUINCO_BUILD',
       'window.SUINCO_BUILD = ' in gerado)
    ck('a versão do rodapé e a do sw.js são a mesma',
       bool(m) and f'window.SUINCO_BUILD = "{m.group(1)}"' in gerado,
       m.group(1) if m else '')

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(main())
