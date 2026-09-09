#!/usr/bin/env python3
"""A tela usa a MESMA régua do servidor para a reentrada (09/09/2026).

Auditoria de arquitetura: a regra "caminhão que não saiu não chega de novo"
estava escrita duas vezes, diferente. O servidor compara o dia de programação
da carga que JÁ ESTÁ no pátio com o dia de programação da carga que CHEGA
(`cargas.js`, trava de 20/08). A tela comparava com HOJE, no relógio do
aparelho — e nem chamava o servidor.

O caso: duas cargas programadas ontem à noite para hoje (programação noturna
é rotina, ocorrência #07). A primeira já está em Embarque Iniciado; "Chegou"
da segunda → tela: ontem < hoje → BLOQUEIA; servidor: ontem < ontem →
aceitaria. O porteiro lia "registre a SAÍDA antes" para um caminhão
legitimamente entrando pela segunda vez — a #06 de volta.

O que se prova, em modo local:
  1. Duas cargas da MESMA programação (ontem) → a segunda entra.
  2. Carga no pátio de programação ANTERIOR à que chega → continua barrada.
  3. Chegada sem programação (nenhuma carga esperando) → vale hoje, como
     o servidor faz com now().

    python3 testes/test_reentrada_mesma_programacao.py
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


SEED = """(diasDaPrimeira) => {
  DB.operador = {nome:'Porteiro', setor:'Portaria'};
  DB.frota = [{placa:'REE1N22', transportadora:'TRANSPORTES ALFA', tipoVeiculo:'Truck', uf:'MG',
               capacidadeKg:14000, atualizadoEm:new Date().toISOString()}];
  DB.cargas = []; DB.movimentacoes = [];
  const iso = (ms) => new Date(ms).toISOString();
  const H = 3600000;
  // "ontem às 22h" no relógio do aparelho
  const ontem22 = (() => { const d = new Date(); d.setDate(d.getDate()-1); d.setHours(22,0,0,0); return d.getTime(); })();
  const primeira = ontem22 - (diasDaPrimeira - 1) * 24 * H;
  const mk = (id, numero, status, prog) => {
    const c = { id, numeroCarga:numero, placa:'REE1N22', transportadora:'TRANSPORTES ALFA',
      tipoVeiculo:'Truck', motorista:'M', cliente:'C', destino:'D', peso:10000, doca:'1',
      sequencia:1, observacoes:'', praOnde:'Entrega', rota:'500', paletizada:'Não', qtdGanchos:0,
      qtdEntregas:1, status, aguardandoCarga:false, criadoEm:iso(prog), programadoEm:iso(prog),
      atualizadoEm:iso(prog), criadoPor:'Logística' };
    DB.cargas.push(c);
    DB.movimentacoes.push({id:'m0'+id, cargaId:id, placa:c.placa, statusAnterior:null,
      statusNovo:'Aguardando Veículo', operador:'Op', setor:'Logística', timestamp:iso(prog), numeroCarga:numero});
    return c;
  };
  const c1 = mk('c1', 'PRIMEIRA', 'Embarque Iniciado', primeira);
  DB.movimentacoes.push({id:'m1c1', cargaId:'c1', placa:'REE1N22', statusAnterior:'Aguardando Veículo',
    statusNovo:'Aguardando Embarque', operador:'Op', setor:'Portaria', timestamp:iso(primeira + 8*H), numeroCarga:'PRIMEIRA'});
  DB.movimentacoes.push({id:'m2c1', cargaId:'c1', placa:'REE1N22', statusAnterior:'Aguardando Embarque',
    statusNovo:'Embarque Iniciado', operador:'Op', setor:'Expedição', timestamp:iso(primeira + 9*H), numeroCarga:'PRIMEIRA'});
  mk('c2', 'SEGUNDA', 'Aguardando Veículo', ontem22);
  document.getElementById('modal-operador')?.classList.remove('open');
  renderAll();
  return { primeira: new Date(primeira).toISOString(), segunda: new Date(ontem22).toISOString() };
}"""

CHEGAR = """() => {
  try {
    const r = registrarChegadaPortaria('REE1N22', 'Porteiro');
    return { bloqueada: !!r.bloqueadaPorPendencia, atualizadas: (r.atualizadas||[]).map(c=>c.numeroCarga),
             criadas: (r.criadas||[]).length, statusSegunda: (DB.cargas.find(c=>c.id==='c2')||{}).status };
  } catch(e) { return { erro: String(e && e.message || e) }; }
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []
        pg = await nav.new_page(viewport={'width': 1366, 'height': 768})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)

        print('\n=== 1. DUAS CARGAS DA MESMA PROGRAMAÇÃO (ONTEM À NOITE) — A SEGUNDA ENTRA ===')
        datas = await pg.evaluate(SEED, 1)
        r = await pg.evaluate(CHEGAR)
        ck('a chegada da segunda carga NÃO é barrada pela tela',
           not r.get('bloqueada') and not r.get('erro'), str(r))
        ck('a segunda carga foi para Aguardando Embarque',
           r.get('statusSegunda') == 'Aguardando Embarque', str(r))

        print('\n=== 2. CARGA NO PÁTIO DE PROGRAMAÇÃO ANTERIOR — CONTINUA BARRADA ===')
        await pg.evaluate(SEED, 2)   # a primeira é de ANTEONTEM
        r2 = await pg.evaluate(CHEGAR)
        ck('carga pendurada de programação anterior barra a chegada (regra do servidor)',
           r2.get('bloqueada') is True, str(r2))

        print('\n=== 3. SEM CARGA ESPERANDO, A RÉGUA É HOJE (como now() no servidor) ===')
        await pg.evaluate(SEED, 1)
        await pg.evaluate("() => { DB.cargas = DB.cargas.filter(c => c.id !== 'c2'); }")
        r3 = await pg.evaluate(CHEGAR)
        ck('primeira de ontem ainda no pátio + chegada sem programação hoje → barrada',
           r3.get('bloqueada') is True, str(r3))

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros)[:300])
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
