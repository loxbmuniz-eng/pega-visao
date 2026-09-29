#!/usr/bin/env python3
"""Pátio ao vivo no celular: o pátio inteiro numa rolagem só (29/09/2026).

PEDIDO DO DONO, olhando no celular: "achei o pátio ao vivo muito grande no
celular, só consigo ver 1 tela de etapa por vez, isso precisa ser dinâmico
no celular também". Mostrado na vitrine, "APROVADO".

A REGRA QUE ESTE TESTE TRAVA (390px, celular):
  1. as seis etapas ficam EMPILHADAS (uma abaixo da outra), não lado a lado;
  2. nada vaza para o lado — a pista não rola na horizontal;
  3. os caminhões de uma etapa ficam dois por linha;
  4. etapa vazia encolhe (sem a frase "Nenhum caminhão nesta etapa.");
  5. no computador (1440px) continua uma coluna por etapa, lado a lado.

Dados de teste inventados e marcados (cargas 900101+), só no navegador.

    python3 testes/test_patio_vivo_celular.py
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
PAINEL = 'file://' + os.path.join(os.path.dirname(AQUI), 'index.html')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


SEMEAR = """() => {
  DB.operador = {nome:'Teste', setor:'Administração'};
  document.getElementById('modal-operador')?.classList.remove('open');
  const agora = Date.now(), min = 60000, iso = t => new Date(t).toISOString();
  const etapas = ['Aguardando Embarque','Aguardando Embarque','Aguardando Embarque','Embarque Iniciado','Embarque Iniciado'];
  DB.cargas = etapas.map((st, i) => ({ id:'teste-pv-' + i, numeroCarga:String(900101 + i), placa:'TST' + (1000 + i),
    rota:'TESTE', sequencia:i + 1, status:st, peso:1000, qtdEntregas:1,
    criadoEm:iso(agora - 90*min), atualizadoEm:iso(agora - 30*min) }));
  DB.movimentacoes = DB.cargas.map((c, i) => ({ id:'teste-m-' + i, cargaId:c.id, placa:c.placa, statusAnterior:'Aguardando Veículo',
    statusNovo:'Aguardando Embarque', setor:'Portaria', timestamp:iso(agora - 60*min) }));
  renderAll(); abrirTab('patio');
}"""

MEDIR = """() => {
  const pista = document.getElementById('pv-pista');
  const cols = [...pista.querySelectorAll('.pv-col')];
  const r = cols.map(c => c.getBoundingClientRect());
  const cheia = cols.find(c => c.querySelectorAll('.pv-card').length >= 2);
  const cards = cheia ? [...cheia.querySelectorAll('.pv-card')].map(c => c.getBoundingClientRect()) : [];
  const vazia = cols.find(c => c.classList.contains('vazia'));
  const aviso = vazia ? vazia.querySelector('.pv-col-vazio') : null;
  return {
    n: cols.length,
    empilhadas: r.every((b, i) => i === 0 || b.top >= r[i - 1].bottom - 1),
    ladoALado: r.every((b, i) => i === 0 || Math.abs(b.top - r[i - 1].top) < 2),
    vazaLado: pista.scrollWidth > pista.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1,
    doisPorLinha: cards.length >= 2 && Math.abs(cards[0].top - cards[1].top) < 2 && cards[1].left > cards[0].right - 1,
    avisoVazio: aviso ? getComputedStyle(aviso).display : 'sem-coluna-vazia',
  };
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        erros = []

        print('\n=== CELULAR (390px) ===')
        pg = await nav.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(SEMEAR)
        await pg.wait_for_timeout(600)
        m = await pg.evaluate(MEDIR)
        print('  ', m)
        ck('as seis etapas estão na tela', m['n'] == 6, str(m['n']))
        ck('etapas empilhadas, uma abaixo da outra', m['empilhadas'], str(m))
        ck('nada vaza para o lado', not m['vazaLado'], str(m))
        ck('dois caminhões por linha', m['doisPorLinha'], str(m))
        ck('etapa vazia encolhe (sem a frase de vazio)', m['avisoVazio'] == 'none', m['avisoVazio'])
        await pg.close()

        print('\n=== COMPUTADOR (1440px) ===')
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(SEMEAR)
        await pg.wait_for_timeout(600)
        d = await pg.evaluate(MEDIR)
        ck('no computador, uma coluna por etapa lado a lado', d['ladoALado'] and d['n'] == 6, str(d))
        await pg.close()

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
