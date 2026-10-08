#!/usr/bin/env python3
"""Torre de Controle: teclado, nome e alvo de toque (08/10/2026, auditoria /impeccable).

ACHADO DA AUDITORIA (Torre, tablet 1024×768 e computador):
  · as caixas de número que FILTRAM a tabela por etapa eram <div onclick>:
    quem usa teclado não chegava nelas (WCAG 2.1.1);
  · os seletores da linha (rota, paletizada, tipo de operação) e os filtros
    da Visão do Pátio não tinham nome para leitor de tela (o rótulo estava
    escrito, mas solto do campo);
  · no tablet, os campos da linha tinham 22–23 px de altura e o selo
    "frete a definir" 18 px — abaixo do alvo mínimo de 24 px (WCAG 2.5.8).

O QUE ESTE TESTE TRAVA, pela tela, como a pessoa usa:
  1. só com a tecla Tab chega-se a uma caixa de etapa; Enter filtra a tabela
     e a caixa anuncia que está ligada; Espaço também aciona;
  2. todo seletor e campo da linha da Torre e os filtros da Visão do Pátio
     têm nome acessível;
  3. em 1024×768, todo campo da linha e o selo de frete têm 24 px ou mais.

    bash testes/rodar_tudo.sh test_torre_teclado_e_toque
"""
import asyncio
import sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


SEMEAR = """() => {
  DB.operador.setor = 'Administração'; aplicarPermissoesSetor();
  DB.cargas = []; DB.movimentacoes = [];
  const ordem = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado'];
  ordem.forEach((alvo, k) => {
    for(let i = 0; i < 2; i++){
      const n = DB.cargas.length, f = DB.frota[n];
      criarCargaProgramada({freteObservacao:'TABELA', placa:f.placa, numeroCarga:String(10240+n),
        peso:12000+n*500, rota:'50'+(n%5), motorista:'José da Silva', qtdEntregas:1+(n%3), operador:'Ana' });
      const c = DB.cargas[DB.cargas.length-1];
      c.sequencia = n + 1;
      // metade como carga antiga, sem a observação do frete: é ela que mostra o selo "frete a definir"
      if(n % 2) c.freteObservacao = '';
      for(let s = 1; s <= k; s++) avancarStatusCarga(c.id, ordem[s], 'Operador '+s, 'Logística');
    }
  });
  SuincoStore.save();
}"""

NOMES = """() => {
  const nome = el => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.title
    || (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label')) ? true : false;
  const campos = [...document.querySelectorAll('#torre-tabela tbody input:not([type=hidden]), #torre-tabela tbody select, #torre-vp-de, #torre-vp-ate, #torre-vp-busca')]
    .filter(el => el.getBoundingClientRect().width > 0);
  return { total: campos.length, semNome: campos.filter(el => !nome(el)).map(el => el.className || el.id).slice(0, 8) };
}"""

ALVOS = """() => [...document.querySelectorAll('#torre-tabela tbody input:not([type=hidden]), #torre-tabela tbody select, #torre-tabela .selo-frete')]
  .filter(el => el.getBoundingClientRect().width > 0)
  .map(el => ({ c: (el.className || el.tagName).toString().split(' ')[0], h: Math.round(el.getBoundingClientRect().height * 10) / 10 }))"""


async def entrar(nav, viewport):
    pg = await nav.new_page(viewport=viewport)
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(900)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(500)
    await pg.evaluate(SEMEAR)
    await pg.click('.nav-tab[data-tab="torre"]')
    await pg.wait_for_timeout(700)
    return pg, erros


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')

        print('\n=== 1. TECLADO NAS CAIXAS DE ETAPA (computador) ===')
        pg, erros = await entrar(nav, {'width': 1440, 'height': 900})
        await pg.click('.nav-tab[data-tab="torre"]')   # o foco parte da aba, como quem acabou de clicar nela
        chegou = None
        for _ in range(80):
            await pg.keyboard.press('Tab')
            chegou = await pg.evaluate("() => { const a = document.activeElement; return a && a.classList.contains('stat-box') ? (a.querySelector('.stat-label')||{}).textContent : null; }")
            if chegou:
                break
        ck('só com Tab chega-se a uma caixa de etapa', bool(chegou), str(chegou))
        if chegou:
            antes = await pg.evaluate("() => document.querySelectorAll('#torre-tbody tr[data-carga], #torre-tbody tr').length")
            await pg.keyboard.press('Enter')
            await pg.wait_for_timeout(500)
            ligado = await pg.evaluate("(r) => { const b = [...document.querySelectorAll('.stat-box')].find(x => (x.querySelector('.stat-label')||{}).textContent === r); return b ? [b.classList.contains('stat-ativo'), b.getAttribute('aria-pressed')] : null; }", chegou)
            ck('Enter aciona o filtro da caixa e ela anuncia que está ligada', ligado == [True, 'true'], f'{chegou}: {ligado}')
            # Espaço na próxima caixa
            for _ in range(10):
                await pg.keyboard.press('Tab')
                outra = await pg.evaluate("() => { const a = document.activeElement; return a && a.classList.contains('stat-box') ? (a.querySelector('.stat-label')||{}).textContent : null; }")
                if outra:
                    break
            if outra:
                await pg.keyboard.press(' ')
                await pg.wait_for_timeout(500)
                ligado2 = await pg.evaluate("(r) => { const b = [...document.querySelectorAll('.stat-box')].find(x => (x.querySelector('.stat-label')||{}).textContent === r); return b ? b.getAttribute('aria-pressed') : null; }", outra)
                ck('Espaço também aciona', ligado2 == 'true', f'{outra}: {ligado2}')
            ck('a página não rolou com o Espaço (o painel segurou a tecla)', await pg.evaluate("() => scrollY") < 400)
        sem_role = await pg.evaluate("() => [...document.querySelectorAll('.stat-box.stat-clicavel, .stat-box[onclick]')].filter(b => b.getAttribute('role') !== 'button' || b.tabIndex !== 0).length")
        ck('toda caixa que filtra é botão para o teclado (role e tabindex)', sem_role == 0, str(sem_role))

        print('\n=== 2. NOME PARA LEITOR DE TELA ===')
        n = await pg.evaluate(NOMES)
        ck('todo campo e seletor da linha e os filtros da Visão do Pátio têm nome', n['total'] > 10 and not n['semNome'], str(n))
        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await pg.close()

        print('\n=== 3. ALVO DE TOQUE NO TABLET (1024×768) ===')
        pg, erros = await entrar(nav, {'width': 1024, 'height': 768})
        alvos = await pg.evaluate(ALVOS)
        pequenos = [a for a in alvos if a['h'] < 24]
        ck('a linha da Torre tem campos à vista para medir', len(alvos) > 20, str(len(alvos)))
        ck('todo campo da linha e o selo de frete com 24 px ou mais', not pequenos, str(pequenos[:6]))
        ck('nenhum erro de JavaScript (tablet)', not erros, '; '.join(erros[:2]))
        await nav.close()
    print('\nRESULTADO:', 'OK' if not falhas else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
