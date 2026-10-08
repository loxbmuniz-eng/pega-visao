#!/usr/bin/env python3
"""Indicadores: o recorte e o que pede ação no topo (08/10/2026, /impeccable Lote 3).

ACHADO DA AUDITORIA (ocorrência #123), medido a 1440×900:
  · a aba tinha 4.746 px e 12 seções; "Cargas paradas há mais tempo" — que a
    própria tela chama de "o bloco mais acionável" — era o ÚLTIMO bloco,
    a 4.406 px do topo;
  · o filtro do recorte morava dentro do segundo cartão, a 987 px, abaixo da
    dobra, e o texto dos Gráficos mandava usar "o filtro no topo da aba";
  · o mesmo número aparecia em mais de um lugar (status em aberto repetindo
    o Pulso; o tempo de pátio histórico repetindo os Tempos Médios).

O QUE ESTE TESTE TRAVA, pela tela, como a pessoa vê:
  1. o recorte é o primeiro cartão da aba e está acima da dobra; cada campo
     dele tem rótulo ligado;
  2. "Cargas paradas há mais tempo" é o cartão logo depois do Pulso do dia,
     mostra a carga parada, e NÃO se repete dentro de Gargalos;
  3. os três cartões que repetem ou só explicam nascem fechados, abrem com
     um clique no título (e pelo teclado), e o painel lembra o que ficou
     aberto depois de recarregar;
  4. com um recorte ativo, a nota diz que o Pulso do dia é o pátio inteiro.

    bash testes/rodar_tudo.sh test_indicadores_acao_no_topo
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
  const ordem = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado','Seguiu Viagem'];
  for(let n = 0; n < 8; n++){
    const f = DB.frota[n];
    criarCargaProgramada({freteObservacao:'TABELA', placa:f.placa, numeroCarga:String(30720+n), peso:12000,
      rota:'50'+(n%5), motorista:'José da Silva', qtdEntregas:1, operador:'Ana' });
    const c = DB.cargas[DB.cargas.length-1];
    const ate = n < 3 ? 5 : (n < 6 ? 2 : 1);   // 3 concluídas, 3 em Embarque Iniciado, 2 aguardando embarque
    for(let s = 1; s <= ate; s++) avancarStatusCarga(c.id, ordem[s], 'Operador '+s, 'Logística');
  }
  // UMA carga parada há 9 horas: tudo dela recua junto, para o carimbo ficar coerente
  const parada = DB.cargas.find(c => c.status === 'Embarque Iniciado');
  parada.numeroCarga = 'PARADA-9H';
  const recua = iso => iso ? new Date(new Date(iso).getTime() - 9*3600e3).toISOString() : iso;
  Object.keys(parada).filter(k => /Em$/.test(k) && typeof parada[k] === 'string').forEach(k => { parada[k] = recua(parada[k]); });
  DB.movimentacoes.filter(m => m.cargaId === parada.id).forEach(m => { m.timestamp = recua(m.timestamp); });
  SuincoStore.save();
}"""

ORDEM = """() => {
  const aba = document.getElementById('tab-indicadores');
  const cartoes = [...aba.children].filter(e => e.classList.contains('card') && e.getBoundingClientRect().height > 0);
  const idx = (el) => el ? cartoes.indexOf(el.closest('.card')) : -1;
  const filtro = document.getElementById('ind-filtros');
  return {
    filtroTopo: filtro ? Math.round(filtro.getBoundingClientRect().top + scrollY) : null,
    filtroCartao: idx(filtro),
    pulso: idx(document.getElementById('card-pulso-dia')),
    paradas: idx(document.getElementById('ind-paradas')),
    paradasTopo: document.getElementById('ind-paradas') ? Math.round(document.getElementById('ind-paradas').closest('.card').getBoundingClientRect().top + scrollY) : null,
    paradasTexto: (document.getElementById('ind-paradas') || {}).innerText || '',
    gargalos: (document.getElementById('ind-gargalos') || {}).innerText || '',
    semRotulo: [...document.querySelectorAll('#ind-filtros select, #ind-filtros input')]
      .filter(el => !document.querySelector(`label[for="${el.id}"]`)).map(el => el.id),
  };
}"""

RECOLHIDOS = """() => [...document.querySelectorAll('#tab-indicadores details.ind-recolhe')]
  .map(d => ({ chave: d.dataset.recolhe, aberto: d.open, titulo: d.querySelector('summary').textContent.trim() }))"""


async def entrar(pg):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(900)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(500)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        ctx = await nav.new_context(viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)
        await pg.evaluate(SEMEAR)
        await pg.click('.nav-tab[data-tab="indicadores"]')
        await pg.wait_for_timeout(1200)

        print('\n=== 1. O RECORTE NO TOPO ===')
        o = await pg.evaluate(ORDEM)
        ck('o recorte é o primeiro cartão da aba', o['filtroCartao'] == 0, str(o['filtroCartao']))
        ck('e está acima da dobra (900 px)', o['filtroTopo'] is not None and o['filtroTopo'] < 900, str(o['filtroTopo']))
        ck('cada campo do recorte tem rótulo ligado', not o['semRotulo'], str(o['semRotulo']))

        print('\n=== 2. O QUE PEDE AÇÃO, LOGO DEPOIS DO PULSO ===')
        ck('"Cargas paradas há mais tempo" é o cartão logo depois do Pulso do dia',
           o['pulso'] >= 0 and o['paradas'] == o['pulso'] + 1, f"pulso {o['pulso']}, paradas {o['paradas']}")
        ck('e começa antes de 1.300 px (era 4.406)', o['paradasTopo'] is not None and o['paradasTopo'] < 1300, str(o['paradasTopo']))
        ck('mostra a carga parada há 9 horas', 'PARADA-9H' in o['paradasTexto'], o['paradasTexto'][:120])
        ck('e não se repete dentro de Gargalos', 'paradas há mais tempo' not in o['gargalos'].lower())

        print('\n=== 3. O QUE REPETE, RECOLHIDO — NÃO APAGADO ===')
        r = await pg.evaluate(RECOLHIDOS)
        chaves = sorted(x['chave'] for x in r)
        ck('três cartões recolhíveis: OTIF, status em aberto e tempo médio de pátio',
           chaves == ['otif', 'patio-medio', 'status'], str(chaves))
        ck('todos nascem fechados', r and all(not x['aberto'] for x in r), str(r))
        if r:
            await pg.click('details[data-recolhe="patio-medio"] > summary')
            await pg.wait_for_timeout(300)
            visivel = await pg.evaluate("() => (document.getElementById('ind-patio-medio') || {}).innerText || ''")
            ck('um clique no título abre e mostra o conteúdo', 'Tempo Médio de Pátio' in visivel, visivel[:80])
            await pg.focus('details[data-recolhe="status"] > summary')
            await pg.keyboard.press('Enter')
            await pg.wait_for_timeout(300)
            ck('pelo teclado também abre (Enter no título)',
               await pg.evaluate("() => document.querySelector('details[data-recolhe=\"status\"]').open"))
            alvo = await pg.evaluate("() => Math.round(document.querySelector('details[data-recolhe=\"otif\"] > summary').getBoundingClientRect().height)")
            ck('o título recolhível tem 44 px de alvo', alvo >= 44, str(alvo))
            await pg.reload()
            await pg.wait_for_timeout(1200)
            await pg.click('.nav-tab[data-tab="indicadores"]')
            await pg.wait_for_timeout(900)
            r2 = {x['chave']: x['aberto'] for x in await pg.evaluate(RECOLHIDOS)}
            ck('depois de recarregar, o painel lembra o que ficou aberto',
               r2.get('patio-medio') is True and r2.get('status') is True and r2.get('otif') is False, str(r2))

        print('\n=== 4. A NOTA DO RECORTE DIZ A EXCEÇÃO ===')
        await pg.select_option('#ind-f-periodo', 'semana')
        await pg.wait_for_timeout(600)
        nota = await pg.evaluate("() => (document.getElementById('ind-filtro-nota') || {}).innerText || ''")
        ck('com recorte ativo, a nota diz que o Pulso do dia é o pátio inteiro', 'Pulso do dia' in nota, nota[:140])
        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()

    print('\nRESULTADO:', 'OK' if not falhas else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
