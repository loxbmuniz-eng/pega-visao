#!/usr/bin/env python3
"""A carga diz uma transportadora, a Frota diz outra — e a tela mostra (09/09/2026).

RELATO DO DONO (fotos): carga 118675, placa JJB8946 — a Torre dizia
"Rodosousa"; o cadastro da Frota, "Denia Transportes". Duas verdades para a
mesma placa, cada uma certa sozinha.

A transportadora da carga é uma CÓPIA feita quando a placa entra, e é
editável à mão ("da Frota — dá para trocar"). Depois disso, mudar a Frota
não avisava as cargas, e trocar à mão não deixava rastro. Nenhuma tela
mostrava a diferença.

Decisão do dono (A): quando a placa muda de transportadora na Frota, as
cargas ABERTAS daquela placa acompanham, com log; as concluídas ficam como
registro; trocar à mão continua permitido, mas marcado.

O que se prova aqui (modo local — a parte de servidor está no api.test.js):
  1. Carga com transportadora ≠ Frota mostra o marcador "≠ Frota: …" na
     Torre e na Fila.
  2. O marcador tem um clique "usar a da Frota" que alinha a carga.
  3. Carga alinhada não mostra marcador.

    python3 testes/test_transportadora_divergente.py
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


SEED = """() => {
  DB.operador = {nome:'Chefe', setor:'Logística'};
  DB.frota = [{placa:'JJB8946', transportadora:'Denia Transportes', tipoVeiculo:'Truck', uf:'MG', capacidadeKg:14000, atualizadoEm:new Date().toISOString()},
              {placa:'GZI1H37', transportadora:'Coopdiesel', tipoVeiculo:'Bitruck', uf:'MG', capacidadeKg:20000, atualizadoEm:new Date().toISOString()}];
  DB.cargas = []; DB.movimentacoes = [];
  const agora = new Date(); agora.setHours(8,0,0,0);
  const mk = (id, numero, placa, transp) => DB.cargas.push({ id, numeroCarga:numero, placa, transportadora:transp,
    tipoVeiculo:'Truck', motorista:'Carlos', cliente:'C', destino:'D', peso:12000, doca:'', sequencia:1, observacoes:'',
    praOnde:'Entrega', rota:'500', paletizada:'Não', qtdGanchos:0, qtdEntregas:1, status:'Aguardando Veículo',
    aguardandoCarga:false, criadoEm:agora.toISOString(), programadoEm:agora.toISOString(), atualizadoEm:agora.toISOString(), criadoPor:'Logística' });
  mk('c_div', '118675', 'JJB8946', 'Rodosousa');
  mk('c_ok',  '118682', 'GZI1H37', 'Coopdiesel');
  document.getElementById('modal-operador')?.classList.remove('open');
  renderAll();
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []
        pg = await nav.new_page(viewport={'width': 1366, 'height': 768})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(SEED)

        print('\n=== 1. O MARCADOR APARECE ONDE A CARGA DIVERGE DA FROTA ===')
        await pg.evaluate("abrirTab('programacao')")
        await pg.wait_for_timeout(500)
        fila_div = await pg.evaluate("() => { const tr = document.querySelector('#prog-fila-tbody tr[data-carga=\"c_div\"]'); return tr ? tr.innerText : null; }")
        fila_ok = await pg.evaluate("() => { const tr = document.querySelector('#prog-fila-tbody tr[data-carga=\"c_ok\"]'); return tr ? tr.innerText : null; }")
        ck('na Fila, a carga 118675 mostra "≠ Frota: Denia Transportes"',
           fila_div is not None and 'Frota' in fila_div and 'Denia Transportes' in fila_div, (fila_div or '')[:140])
        ck('a carga alinhada (118682) NÃO mostra marcador', fila_ok is not None and 'Frota' not in fila_ok, (fila_ok or '')[:100])
        await pg.evaluate("abrirTab('torre')")
        await pg.wait_for_timeout(500)
        # a linha da Torre não carrega data-carga e, para a Logística, o número é um <input>: acha pelo value, na tabela principal (não na Visão do Pátio)
        torre = await pg.evaluate("() => { const tr = [...document.querySelectorAll('#torre-tbody tr')].find(t => (t.querySelector('.numero-carga-input')||{}).value === '118675' || t.innerText.includes('118675')); return tr ? tr.innerText : null; }")
        ck('na Torre também', torre is not None and 'Frota' in torre and 'Denia' in torre, (torre or '')[:140])

        print('\n=== 2. UM CLIQUE ALINHA A CARGA À FROTA ===')
        existe = await pg.evaluate("() => typeof usarTransportadoraDaFrotaUI === 'function'")
        ck('existe a ação "usar a da Frota"', existe)
        await pg.evaluate("usarTransportadoraDaFrotaUI('c_div')")
        await pg.wait_for_timeout(400)
        depois = await pg.evaluate("() => ({ transp: DB.cargas.find(c=>c.id==='c_div').transportadora, tr: ([...document.querySelectorAll('#torre-tbody tr')].find(t => (t.querySelector('.numero-carga-input')||{}).value === '118675' || t.innerText.includes('118675'))||{}).innerText || '' })")
        ck('a carga passa a dizer Denia Transportes', depois['transp'] == 'Denia Transportes', str(depois['transp']))
        ck('e o marcador some', 'Frota' not in depois['tr'], depois['tr'][:120])

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros)[:300])
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
