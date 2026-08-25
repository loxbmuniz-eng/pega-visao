#!/usr/bin/env python3
"""O QR do segundo fator é lido de verdade pelo aplicativo. (25/08/2026)

Pedido do gestor: "a autenticação de dois fatores eu quero pelo Microsoft
Authenticator".

O painel já falava a língua do aplicativo desde a etapa 4 — faltava o QR.
Sem ele, a tela pede que a pessoa ache "inserir chave manualmente" num menu
e digite 32 caracteres embaralhados no celular. É o passo em que a adesão
morre: quem erra dois caracteres vê "código inválido" e desiste.

COMO SE PROVA QUE UM QR ESCRITO À MÃO FUNCIONA. Não é olhando: quadrado
errado também parece quadrado. São duas camadas:

  A) DECODIFICADOR INDEPENDENTE. Quando o OpenCV está instalado, este teste
     desenha o QR e LÊ DE VOLTA com um decodificador de outra gente,
     conferindo que o texto que sai é idêntico ao que entrou. É a única
     verificação que vale de verdade.

  B) IMPRESSÕES DIGITAIS CONGELADAS (qr_referencia.json). Cada linha daquele
     arquivo foi gerada SOMENTE depois de o decodificador da camada A
     confirmar. A partir daí o hash da matriz é comparado a cada rodada —
     sem depender de nenhuma biblioteca instalada. Se alguém mexer no
     codificador e mudar um módulo, esta camada reprova mesmo num contêiner
     pelado.

A camada B roda SEMPRE. A camada A roda quando dá, e diz alto quando não dá.

E mais: que a tela mostra o QR, que a chave manual continua disponível para
câmera quebrada, e que o desenho tem a zona de silêncio de 4 módulos que a
especificação exige (sem ela a câmera não acha onde o código começa).

    python3 testes/test_qr_segundo_fator.py
"""
import asyncio
import hashlib
import json
import os
import sys
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
REFS = json.load(open(os.path.join(AQUI, 'qr_referencia.json'), encoding='utf-8'))
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def impressao(m):
    return hashlib.sha256(''.join(str(v) for linha in m for v in linha).encode()).hexdigest()


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)

        print('\n=== 1. O CODIFICADOR EXISTE E ESTÁ NO ARQUIVO ÚNICO ===')
        tem = await pg.evaluate(
            "() => typeof SuincoQR === 'object' && typeof SuincoQR.matriz === 'function'")
        ck('SuincoQR embutido no painel', tem)
        if not tem:
            await nav.close()
            print('\n  sem codificador, o resto não faz sentido')
            return 1

        print('\n=== 2. IMPRESSÕES DIGITAIS CONGELADAS (roda sempre) ===')
        matrizes = await pg.evaluate(
            "(ts) => ts.map(t => SuincoQR.matriz(t))", [r['texto'] for r in REFS])
        for ref, m in zip(REFS, matrizes):
            rotulo = ref['texto'][:34] + ('…' if len(ref['texto']) > 34 else '')
            if m is None:
                ck(f'{rotulo}', False, 'devolveu null')
                continue
            ck(f'{len(m)}x{len(m)} · {rotulo}',
               len(m) == ref['lado'] and impressao(m) == ref['sha256'],
               f"lado {len(m)} (esperado {ref['lado']})")

        print('\n=== 3. DECODIFICADOR INDEPENDENTE (a prova de verdade) ===')
        try:
            import cv2
            import numpy as np
        except ImportError:
            print('  ATENÇÃO: OpenCV não está instalado neste ambiente.')
            print('  A camada forte NÃO rodou — só as impressões congeladas acima,')
            print('  que por sua vez foram geradas com o decodificador confirmando.')
            print('  Para rodar a camada forte: pip install opencv-python-headless numpy')
        else:
            det = cv2.QRCodeDetector()
            for ref, m in zip(REFS, matrizes):
                if m is None:
                    continue
                n = len(m)
                borda, px = 4, 12
                img = np.full(((n + 2 * borda) * px, (n + 2 * borda) * px), 255, np.uint8)
                for l in range(n):
                    for c in range(n):
                        if m[l][c]:
                            img[(l + borda) * px:(l + borda + 1) * px,
                                (c + borda) * px:(c + borda + 1) * px] = 0
                lido, _, _ = det.detectAndDecode(img)
                rotulo = ref['texto'][:34] + ('…' if len(ref['texto']) > 34 else '')
                ck(f'lido de volta: {rotulo}', lido == ref['texto'],
                   f'saiu {lido[:40]!r}')

        print('\n=== 4. O DESENHO TEM A ZONA DE SILÊNCIO DA ESPECIFICAÇÃO ===')
        # 4 módulos claros em volta. Sem isso a câmera não acha o começo do
        # código — e é a "otimização" que mais quebra QR na prática.
        d = await pg.evaluate("""() => {
              const svg = SuincoQR.svg('HELLO', 200);
              const vb = /viewBox="0 0 (\\d+) (\\d+)"/.exec(svg);
              const m = SuincoQR.matriz('HELLO');
              return { total: vb ? Number(vb[1]) : 0, lado: m.length,
                       temFundoBranco: svg.includes('fill="#ffffff"'),
                       temPontosPretos: svg.includes('fill="#000000"'),
                       largura: /width="(\\d+)"/.exec(svg)[1] };
            }""")
        ck('a borda clara tem 4 módulos de cada lado',
           d['total'] == d['lado'] + 8, f"viewBox {d['total']} para matriz {d['lado']}")
        ck('fundo branco e pontos pretos, independentes do tema',
           d['temFundoBranco'] and d['temPontosPretos'], str(d))
        ck('o tamanho pedido é respeitado', d['largura'] == '200', d['largura'])

        print('\n=== 5. TEXTO GRANDE DEMAIS DEVOLVE NULL, NÃO UM QUADRADO QUEBRADO ===')
        # Resposta honesta: quem chama cai no caminho manual em vez de
        # desenhar algo que a câmera não lê.
        d = await pg.evaluate("""() => ({
              cabe: SuincoQR.matriz('x'.repeat(210)) !== null,
              naoCabe: SuincoQR.matriz('x'.repeat(400)),
              svgNaoCabe: SuincoQR.svg('x'.repeat(400)),
            })""")
        ck('210 caracteres ainda cabem', d['cabe'])
        ck('400 caracteres devolvem null', d['naoCabe'] is None)
        ck('e o svg também devolve null', d['svgNaoCabe'] is None)

        print('\n=== 6. A TELA DO SEGUNDO FATOR MOSTRA O QR ===')
        # Sem servidor aqui: a tela é montada com uma resposta simulada de
        # /mfa/iniciar, para provar que o HTML sai certo — o caminho com
        # servidor de verdade é coberto por test_segundo_fator.py.
        #
        # A ABA PRECISA ESTAR ABERTA para a medida valer: #mfa-painel mora na
        # aba Usuários, e elemento em aba escondida tem caixa de tamanho zero.
        # Medir com a aba fechada acusaria "QR de 0px" todo dia.
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        # O login sem servidor oferece só os quatro setores de pátio; a aba
        # Usuários é aberta direto, porque aqui o que se mede é o desenho.
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)
        await pg.evaluate("() => abrirTab('usuarios')")
        await pg.wait_for_timeout(400)
        d = await pg.evaluate("""() => {
              // O #mfa-painel JÁ EXISTE na página (aba Usuários). Criar um
              // segundo com o mesmo id não adianta: getElementById devolve o
              // primeiro, e iniciarMfaUI escreveria no de verdade.
              const alvo = document.getElementById('mfa-painel');
              const endereco = 'otpauth://totp/Embarque%20Suinco%3Aana%40teste.local'
                + '?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Embarque%20Suinco'
                + '&algorithm=SHA1&digits=6&period=30';
              const antes = SuincoSharePoint.mfa.iniciar;
              SuincoSharePoint.mfa.iniciar = async () => ({
                segredo: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP', endereco });
              return iniciarMfaUI().then(() => {
                SuincoSharePoint.mfa.iniciar = antes;
                const svg = alvo.querySelector('.mfa-qr svg');
                const det = alvo.querySelector('.mfa-manual');
                const r = {
                  temQr: !!svg,
                  qrVisivel: svg ? svg.getBoundingClientRect().width : 0,
                  citaMicrosoft: alvo.textContent.includes('Microsoft Authenticator'),
                  temChaveManual: !!alvo.querySelector('.mfa-segredo'),
                  manualFechadoPorPadrao: det ? !det.open : false,
                  temCampoCodigo: !!alvo.querySelector('#mfa-confirmar-codigo'),
                };
                alvo.innerHTML = '';
                return r;
              });
            }""")
        ck('o QR aparece na tela', d['temQr'], str(d))
        ck('e tem tamanho de verdade (não 0px)', d['qrVisivel'] >= 150,
           f"{d['qrVisivel']:.0f}px")
        ck('a tela cita o Microsoft Authenticator pelo nome', d['citaMicrosoft'])
        ck('a chave manual continua disponível (câmera quebrada)',
           d['temChaveManual'])
        ck('mas fechada por padrão, sem competir com o QR',
           d['manualFechadoPorPadrao'])
        ck('e o campo do código de 6 dígitos está lá', d['temCampoCodigo'])

        print('\n=== 7. SEM ERRO DE JAVASCRIPT ===')
        ck('console limpo', not erros, '; '.join(erros[:3]))

        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('  Tudo verde.')
    return 0


sys.exit(asyncio.run(main()))
