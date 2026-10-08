#!/usr/bin/env python3
"""A pergunta do painel no lugar das caixas do navegador (08/10/2026, /impeccable Lote 2).

ACHADO DA AUDITORIA (ocorrência #122):
  · 20 confirm(), 12 prompt() e 1 alert() do navegador. Três deles pediam
    SENHA — e a caixa do navegador mostra a senha À VISTA enquanto se digita;
  · "Encerrar a programação anterior" abria com o motivo JÁ ESCRITO ("Caminhões
    já saíram…"): um Enter de reflexo carimbava em cada carga um motivo que
    ninguém escreveu;
  · a caixa do navegador corta a lista em 8 cargas, não tem título, e quando
    a pessoa erra ela fecha e manda começar de novo.

O QUE ESTE TESTE TRAVA, pela tela, como a pessoa usa (sem servidor):
  1. nenhum prompt()/confirm()/alert() sobra no código do painel (fora a
     ferramenta de travamentos, que é de diagnóstico);
  2. Encerrar na Torre abre a pergunta do painel — e NENHUMA caixa do
     navegador —, com o motivo EM BRANCO, a lista inteira (10 cargas, não 8)
     e o cursor no campo; confirmar sem motivo mostra o erro DENTRO da
     janela, e ela não fecha; Esc desiste e o foco volta ao botão;
  3. Excluir na Torre pelo teclado (com o mouse é "segure 1,5 s"): o foco
     nasce no Cancelar (o Enter de reflexo desiste, não apaga); Tab não sai
     da janela; confirmando, a carga sai;
  4. a pergunta cabe no celular (390 px) sem rolar de lado, com botões de
     44 px.
A senha escondida é provada com servidor: test_senha_nao_aparece.

    bash testes/rodar_tudo.sh test_pergunta_do_painel
"""
import asyncio
import re
import sys
from pathlib import Path
from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
PAINEL = f'file://{RAIZ}/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def caixas_do_navegador():
    """Linhas de código (não comentário) que ainda chamam a caixa do navegador."""
    achados = []
    arquivos = sorted((RAIZ / 'app').glob('*.js')) + [RAIZ / n for n in
               ('data.js', 'devolucoes.js', 'suinco-api.js', 'patio_vivo.js', 'graficos2027.js') if (RAIZ / n).exists()]
    for arq in arquivos:
        em_bloco = False
        for i, linha in enumerate(arq.read_text(encoding='utf-8').splitlines(), 1):
            t = linha.strip()
            if em_bloco:
                if '*/' in t:
                    em_bloco = False
                continue
            if t.startswith('/*') and '*/' not in t:
                em_bloco = True
                continue
            if t.startswith('//') or t.startswith('*'):
                continue
            codigo = re.sub(r'//.*$', '', linha)
            if re.search(r'(?<![\w.])(prompt|confirm|alert)\s*\(', codigo):
                # a ferramenta de diagnóstico de travamentos (00_base) fica
                if arq.name == '00_base.js' and 'TRAVAMENTOS' in codigo:
                    continue
                achados.append(f'{arq.name}:{i}')
    return achados


SEMEAR = """() => {
  DB.operador.setor = 'Logística'; aplicarPermissoesSetor();
  DB.cargas = []; DB.movimentacoes = [];
  const ontem = new Date(Date.now() - 26*3600e3).toISOString();
  for(let n = 0; n < 12; n++){
    const f = DB.frota[n];
    criarCargaProgramada({freteObservacao:'TABELA', placa:f.placa, numeroCarga:String(20480+n),
      peso:12000, rota:'50'+(n%5), motorista:'José da Silva', qtdEntregas:1, operador:'Ana' });
    const c = DB.cargas[DB.cargas.length-1];
    c.sequencia = n + 1;
    // 10 de ontem (programação anterior), 2 de hoje
    if(n < 10){ c.programadoEm = ontem; c.criadoEm = ontem; }
  }
  SuincoStore.save();
}"""


async def entrar(nav, viewport):
    pg = await nav.new_page(viewport=viewport)
    erros, nativas = [], []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    pg.on('dialog', lambda d: (nativas.append(d.message), asyncio.ensure_future(d.dismiss())))
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(900)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(500)
    await pg.evaluate(SEMEAR)
    # No celular a aba mora na gaveta do menu: abre como a pessoa abre.
    if viewport['width'] < 821 and await pg.is_visible('#btn-menu'):
        fora = await pg.evaluate("() => document.querySelector('.nav-tab[data-tab=torre]').getBoundingClientRect().right <= 0")
        if fora:
            await pg.click('#btn-menu')
            await pg.wait_for_timeout(450)
    await pg.click('.nav-tab[data-tab="torre"]')
    await pg.wait_for_timeout(800)
    return pg, erros, nativas


async def main():
    print('\n=== 1. NENHUMA CAIXA DO NAVEGADOR NO CÓDIGO ===')
    sobra = caixas_do_navegador()
    ck('nenhum prompt()/confirm()/alert() no painel', not sobra, ', '.join(sobra[:12]) + (' …' if len(sobra) > 12 else ''))

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')

        print('\n=== 2. ENCERRAR NA TORRE: MOTIVO EM BRANCO, LISTA INTEIRA ===')
        pg, erros, nativas = await entrar(nav, {'width': 1440, 'height': 900})
        botao = '#torre-tbody .torre-sep button'
        ck('o botão de encerrar está na tela', await pg.is_visible(botao))
        await pg.click(botao)
        await pg.wait_for_timeout(500)
        aberta = await pg.is_visible('#modal-pergunta.open')
        ck('abre a pergunta do painel', aberta)
        ck('e NENHUMA caixa do navegador', not nativas, ' | '.join(m[:60] for m in nativas))
        if aberta:
            est = await pg.evaluate("""() => ({
              titulo: document.getElementById('pergunta-titulo').textContent,
              campo: document.getElementById('pergunta-campo').value,
              foco: document.activeElement && document.activeElement.id,
              itens: document.querySelectorAll('#modal-pergunta .pergunta-lista li').length,
              rotulo: !!document.querySelector('label[for="pergunta-campo"]') })""")
            ck('o motivo nasce EM BRANCO', est['campo'] == '', repr(est['campo']))
            ck('o cursor nasce no campo do motivo', est['foco'] == 'pergunta-campo', str(est['foco']))
            ck('o campo tem rótulo', est['rotulo'])
            ck('a lista mostra as 10 cargas (a caixa antiga parava em 8)', est['itens'] == 10, str(est['itens']))
            ck('o título diz quantas cargas', '10' in est['titulo'], est['titulo'])
            await pg.click('#pergunta-ok')
            await pg.wait_for_timeout(300)
            erro = await pg.evaluate("() => { const e = document.getElementById('pergunta-erro'); return e && !e.hidden ? e.textContent : ''; }")
            ck('sem motivo, o erro aparece DENTRO da janela', 'motivo' in erro.lower(), erro)
            ck('e a janela continua aberta', await pg.is_visible('#modal-pergunta.open'))
            await pg.keyboard.press('Escape')
            await pg.wait_for_timeout(300)
            ck('Esc desiste', not await pg.is_visible('#modal-pergunta.open'))
            volta = await pg.evaluate("() => !!(document.activeElement && document.activeElement.closest('.torre-sep'))")
            ck('e o foco volta ao botão que abriu a pergunta', volta)
            antigas = await pg.evaluate("() => DB.cargas.filter(c => c.status !== 'Seguiu Viagem').length")
            ck('desistir não encerra nada', antigas == 12, str(antigas))

        print('\n=== 3. EXCLUIR: O ENTER DE REFLEXO DESISTE, NÃO APAGA ===')
        excluir = '#torre-tbody tr button:has-text("Excluir")'
        ck('há um botão Excluir na Torre', await pg.locator(excluir).count() > 0)
        # Com o mouse, Excluir é "segure 1,5 s" — o gesto JÁ é a confirmação.
        # Quem chega pelo TECLADO não segurou nada: para esse, a pergunta.
        antes = await pg.evaluate("() => DB.cargas.length")
        await pg.locator(excluir).first.focus()
        await pg.keyboard.press('Enter')
        await pg.wait_for_timeout(500)
        ck('Excluir pelo teclado abre a pergunta do painel', await pg.is_visible('#modal-pergunta.open'))
        foco = await pg.evaluate("() => document.activeElement && document.activeElement.id")
        ck('o foco nasce no Cancelar', foco == 'pergunta-cancelar', str(foco))
        dentro = []
        for _ in range(5):
            await pg.keyboard.press('Tab')
            dentro.append(await pg.evaluate("() => !!(document.activeElement && document.activeElement.closest('#modal-pergunta'))"))
        ck('Tab circula sem sair da janela', all(dentro), str(dentro))
        await pg.focus('#pergunta-cancelar')
        await pg.keyboard.press('Enter')
        await pg.wait_for_timeout(400)
        ck('Enter no Cancelar fecha sem apagar', await pg.evaluate("() => DB.cargas.length") == antes)
        await pg.locator(excluir).first.focus()
        await pg.keyboard.press('Enter')
        await pg.wait_for_timeout(400)
        await pg.click('#pergunta-ok')
        await pg.wait_for_timeout(800)
        depois = await pg.evaluate("() => DB.cargas.length")
        ck('confirmando, a carga sai', depois == antes - 1, f'{antes} → {depois}')
        ck('nenhuma caixa do navegador em todo o caminho', not nativas, ' | '.join(m[:60] for m in nativas))
        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await pg.close()

        print('\n=== 4. NO CELULAR (390 px) ===')
        pg, erros, nativas = await entrar(nav, {'width': 390, 'height': 844})
        b = pg.locator('#torre-tbody .torre-sep button, #tab-torre .torre-sep button').first
        if await b.count():
            await b.scroll_into_view_if_needed()
            await b.click()
            await pg.wait_for_timeout(500)
        med = await pg.evaluate("""() => {
          const m = document.querySelector('#modal-pergunta.open .pergunta-box');
          if(!m) return null;
          const r = m.getBoundingClientRect();
          return { esq: Math.round(r.left), dir: Math.round(r.right), larg: innerWidth,
                   pagina: document.documentElement.scrollWidth,
                   botoes: [...m.querySelectorAll('.pergunta-botoes .btn')].map(x => Math.round(x.getBoundingClientRect().height)),
                   letra: parseFloat(getComputedStyle(document.getElementById('pergunta-campo')).fontSize) };
        }""")
        ck('a pergunta abre no celular', med is not None)
        if med:
            ck('cabe na largura, sem rolar de lado', med['esq'] >= 0 and med['dir'] <= med['larg'] and med['pagina'] <= med['larg'] + 1, str(med))
            ck('botões com 44 px ou mais', all(h >= 44 for h in med['botoes']), str(med['botoes']))
            ck('campo com letra de 16 px (o iPhone não dá zoom)', med['letra'] >= 16, str(med['letra']))
        ck('nenhum erro de JavaScript (celular)', not erros, '; '.join(erros[:2]))
        await nav.close()

    print('\nRESULTADO:', 'OK' if not falhas else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
