#!/usr/bin/env python3
"""A vitrine mostra TODAS as abas do painel, do jeito que quem abre a vê (05/10/2026).

OCORRÊNCIA #111. A caixinha do canhoto original foi publicada e eu mandei ao
dono uma foto da aba Pagamento de Frete "na vitrine". Ele abriu a vitrine e a
aba não existia: a vitrine entrava como "Demonstração · Logística", e essa aba
é só do setor Pagamento de Frete e da Administração. A foto tinha sido tirada
forçando a aba por código (um `click()` em botão escondido) — um atalho que a
pessoa olhando a vitrine não tem. Prova por atalho não é prova.

O QUE ESTE TESTE TRAVA

  1. a vitrine gerada AGORA (não uma cópia velha) entra como Administração,
     que vê tudo;
  2. cada aba da barra está VISÍVEL (não `display:none`), com a contagem
     fixa — 13 — para uma aba nova entrar aqui de propósito, não por acaso;
  3. cada aba abre com um clique de verdade, como o dono clicaria, e vira a
     aba ativa, sem erro de página;
  4. a aba Pagamento de Frete mostra a demonstração (as caixinhas do canhoto).

Roda na fase "com servidor" da bateria (uma a uma) de propósito — a marca
é esta menção a 127.0.0.1 — porque gera a vitrine, e o outro teste da vitrine
(test_vitrine_nao_fala_com_producao) também mexe no index.html enquanto roda:
os dois em paralelo poderiam ler um painel adulterado.

    python3 testes/test_vitrine_mostra_todas_as_abas.py
"""
import asyncio
import subprocess
import sys
from pathlib import Path

from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
VITRINE = RAIZ / 'vitrine' / 'vitrine.html'
ABAS_NO_AR = 13   # Torre, Pátio ao vivo, Programação, Devoluções, Portaria, Expedição, Faturamento,
                  # Indicadores, Cadastros, Histórico, Relatórios, Pagamento de Frete, Usuários
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    r = subprocess.run([sys.executable, 'vitrine/gerar_vitrine.py'], cwd=str(RAIZ), capture_output=True, text=True, timeout=180)
    ck('a vitrine foi gerada agora, do painel atual', r.returncode == 0 and VITRINE.exists(), (r.stdout + r.stderr).strip()[-200:])
    if r.returncode != 0:
        return

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await (await nav.new_context(viewport={'width': 1440, 'height': 900})).new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(VITRINE.as_uri())
        await pg.wait_for_timeout(1500)

        # Lê o CRACHÁ, não o texto da página inteira. Até 09/10 isto era uma
        # busca por "Demonstração · …" em document.body.innerText; com o crachá
        # em três peças (nome · setor, #127) o innerText dele quebra linha
        # entre elas, e a busca passou a achar "Demonstração · Logística" nas
        # linhas da Torre que dizem QUEM FEZ cada passo — reprovando uma
        # vitrine que entrava, sim, como Administração (portão 72, causa 2).
        quem = await pg.evaluate("() => document.getElementById('operator-name').textContent.trim()")
        setor = await pg.evaluate("() => DB.operador && DB.operador.setor")
        ck('o painel da vitrine está com o setor Administração', setor == 'Administração', str(setor))
        ck('quem abre a vitrine é a Administração (vê todas as abas)', quem == 'Demonstração · Administração', quem)

        abas = await pg.evaluate("() => [...document.querySelectorAll('.nav-tab[data-tab]')].map(t => t.dataset.tab)")
        ck(f'a barra tem as {ABAS_NO_AR} abas do painel', len(abas) == ABAS_NO_AR, str(abas))
        escondidas = [a for a in abas if not await pg.is_visible(f'.nav-tab[data-tab="{a}"]')]
        ck('nenhuma aba está escondida para quem olha', not escondidas, f'escondidas: {escondidas}')

        for aba in abas:
            if escondidas and aba in escondidas:
                continue
            await pg.click(f'.nav-tab[data-tab="{aba}"]')   # clique de verdade, não click() em botão escondido
            await pg.wait_for_timeout(600)
            ativa = await pg.evaluate("() => (document.querySelector('.nav-tab.active') || {}).dataset?.tab || null")
            ck(f'a aba {aba} abre com um clique e fica ativa', ativa == aba, f'ativa: {ativa}')

        await pg.click('.nav-tab[data-tab="frete"]')
        await pg.wait_for_timeout(1200)
        caixinhas = await pg.evaluate("() => document.querySelectorAll('#frete-tbody td[data-col=\"canhoto\"] input[type=checkbox]').length")
        ck('a aba Pagamento de Frete mostra a demonstração com as caixinhas do canhoto', caixinhas >= 1, str(caixinhas))
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()


asyncio.run(main())
print('\n' + ('FALHAS: ' + '; '.join(falhas) if falhas else 'TUDO OK'))
sys.exit(1 if falhas else 0)
