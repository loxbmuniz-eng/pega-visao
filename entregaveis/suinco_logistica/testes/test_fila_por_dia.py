#!/usr/bin/env python3
"""A carga programada ontem e ainda sem veículo NÃO some da Fila (09/09/2026).

RELATO DO DONO:
  "A carga criada ontem, mas não contratada na programação de ontem (...)
   ela some da programação. Ela começou a ser montada, mas a placa não foi
   contratada, então vai sumir da programação. Isso não pode acontecer.
   (...) seria bom conseguir acessar a fila de programados de cada dia."

O QUE ACONTECIA (reproduzido em modo local, 09/09/2026): a carga estava
GRAVADA — servidor, observações, tudo — e aparecia na Torre em "Programação
anterior". Mas a Fila de Programados listava só as do dia de hoje e
transformava as outras numa linha de aviso "veja na Torre de Controle".
Para quem programa, isso é sumir.

O que se prova aqui:
  1. A Fila tem um seletor de dia; o padrão é hoje.
  2. A carga de ontem ainda sem veículo aparece SEMPRE, num bloco próprio
     abaixo da fila do dia — editável (placa, número), com a data dela, e
     sem arrasto (a sequência é do dia de cada uma).
  3. Escolher ontem no seletor traz a carga para a fila principal (e ela
     não aparece duas vezes); "Hoje" volta; amanhã também funciona.
  4. O aviso deixa de mandar para a Torre: diz que está logo abaixo.

    python3 testes/test_fila_por_dia.py
"""
import asyncio
import sys
from datetime import date, timedelta
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


SEED = """() => {
  DB.operador = {nome:'Programador', setor:'Logística'};
  DB.frota = [{placa:'FIL1A11', transportadora:'ALFA', tipoVeiculo:'Truck', uf:'MG', capacidadeKg:14000, atualizadoEm:new Date().toISOString()}];
  DB.cargas = []; DB.movimentacoes = [];
  const dia = (delta, h) => { const d = new Date(); d.setDate(d.getDate()+delta); d.setHours(h,0,0,0); return d; };
  const mk = (id, numero, quando, placa) => DB.cargas.push({ id, numeroCarga:numero, placa,
    transportadora: placa ? 'ALFA' : '', tipoVeiculo: placa ? 'Truck' : '', motorista:'', cliente:'C', destino:'D',
    peso:12000, doca:'', sequencia:1, observacoes:'montagem começada ontem', praOnde:'Entrega', rota:'500',
    paletizada:'Não', qtdGanchos:0, qtdEntregas:1, status:'Aguardando Veículo', aguardandoCarga:false,
    criadoEm:quando.toISOString(), programadoEm:quando.toISOString(), atualizadoEm:quando.toISOString(), criadoPor:'Logística' });
  mk('c_ontem',  'ONTEM-SEM-PLACA', dia(-1, 15), '');
  mk('c_hoje',   'HOJE',            dia(0, 8),   'FIL1A11');
  mk('c_amanha', 'AMANHA',          dia(1, 7),   '');
  document.getElementById('modal-operador')?.classList.remove('open');
  renderAll();
}"""

IDS = "(sel) => [...document.querySelectorAll(sel + ' tr[data-carga]')].map(t => t.dataset.carga)"


async def main():
    hoje = date.today()
    ontem = (hoje - timedelta(days=1)).isoformat()
    amanha = (hoje + timedelta(days=1)).isoformat()
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []
        pg = await nav.new_page(viewport={'width': 1366, 'height': 768})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(SEED)
        await pg.evaluate("abrirTab('programacao')")
        await pg.wait_for_timeout(500)

        print('\n=== 1. SELETOR DE DIA, PADRÃO HOJE ===')
        sel = await pg.evaluate("() => { const e = document.getElementById('prog-fila-dia'); return e ? e.value : null; }")
        ck('existe o seletor de dia da Fila e ele começa em hoje', sel == hoje.isoformat(), f"valor={sel!r}")
        principal = await pg.evaluate(IDS, '#prog-fila-tbody')
        ck('a fila de hoje lista a carga de hoje, e só ela', principal == ['c_hoje'], str(principal))

        print('\n=== 2. A DE ONTEM NÃO SOME: BLOCO PRÓPRIO, EDITÁVEL, COM DATA ===')
        anteriores = await pg.evaluate(IDS, '#prog-fila-anteriores-tbody')
        ck('a carga de ontem sem veículo está listada no bloco de dias anteriores',
           anteriores == ['c_ontem'], str(anteriores))
        detalhe = await pg.evaluate("""() => {
          const tr = document.querySelector('#prog-fila-anteriores-tbody tr[data-carga="c_ontem"]');
          if(!tr) return null;
          return { arrastavel: tr.getAttribute('draggable'), temPlaca: !!tr.querySelector('.placa-input'),
                   temNumero: !!tr.querySelector('.numero-carga-input'), texto: tr.innerText };
        }""")
        ck('a linha é editável (placa e número) — dá para contratar o caminhão ali mesmo',
           detalhe and detalhe['temPlaca'] and detalhe['temNumero'], str(detalhe)[:120])
        ck('a linha NÃO é arrastável (a sequência é do dia dela)',
           detalhe and detalhe['arrastavel'] == 'false', str(detalhe and detalhe['arrastavel']))
        d, m, a = ontem.split('-')[2], ontem.split('-')[1], ontem.split('-')[0]
        ck('a linha mostra a data em que foi programada',
           detalhe and f"{d}/{m}" in detalhe['texto'], (detalhe or {}).get('texto', '')[:100])
        aviso = await pg.inner_text('#prog-fila-outros-dias')
        ck('o aviso não manda mais para a Torre — diz que está logo abaixo',
           'Torre' not in aviso and 'abaixo' in aviso, aviso)
        obs = await pg.evaluate("() => (DB.cargas.find(c=>c.id==='c_ontem')||{}).observacoes")
        ck('o que foi preenchido ontem continua salvo', obs == 'montagem começada ontem', str(obs))

        print('\n=== 3. ESCOLHER O DIA ===')
        await pg.evaluate(f"mudarDiaFilaUI('{ontem}')")
        await pg.wait_for_timeout(400)
        principal = await pg.evaluate(IDS, '#prog-fila-tbody')
        anteriores = await pg.evaluate(IDS, '#prog-fila-anteriores-tbody')
        ck('com ontem escolhido, a fila principal lista a de ontem', principal == ['c_ontem'], str(principal))
        ck('e ela não aparece duas vezes (o bloco de anteriores não a repete)', 'c_ontem' not in anteriores, str(anteriores))
        await pg.evaluate("mudarDiaFilaUI('hoje')")
        await pg.wait_for_timeout(300)
        principal = await pg.evaluate(IDS, '#prog-fila-tbody')
        ck('"Hoje" volta para a fila de hoje', principal == ['c_hoje'], str(principal))
        await pg.evaluate("mudarDiaFilaUI(1)")
        await pg.wait_for_timeout(300)
        sel = await pg.evaluate("() => document.getElementById('prog-fila-dia').value")
        principal = await pg.evaluate(IDS, '#prog-fila-tbody')
        ck('▶ vai para amanhã e lista a programação de amanhã', sel == amanha and principal == ['c_amanha'], f"{sel} {principal}")

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros)[:300])
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
