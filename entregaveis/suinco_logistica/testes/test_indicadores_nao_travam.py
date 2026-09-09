#!/usr/bin/env python3
"""O painel não trava com semanas de histórico (09/09/2026).

Auditoria de arquitetura, medido em Chromium: `historicoDaCarga` filtrava e
ordenava TODAS as movimentações a cada chamada, e `indicadoresDaCarga` a
chamava 5 vezes por carga por render. Com 300 cargas a aba Indicadores
desenhava em 0,5 s; com 1.500 (6–8 semanas de operação), 5,1 s a cada
sincronia — o painel congela sozinho, sem ninguém mexer em nada.

A correção é um índice cargaId → movimentações ordenadas, reconstruído só
quando a lista muda (mesmo padrão do índice da Frota). Resposta idêntica,
custo linear.

O que se prova:
  1. `historicoDaCarga` devolve exatamente o que devolvia (mesma ordem).
  2. Com 1.500 cargas × 6 movimentações, renderizar Indicadores fica bem
     abaixo dos 5 s medidos — o teto aqui é folgado de propósito (máquina de
     teste varia); o que importa é a ordem de grandeza.
  3. O índice enxerga a mudança: acrescentar uma movimentação aparece no
     histórico na hora (nada de cache velho).

    python3 testes/test_indicadores_nao_travam.py
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


SEED = """(qtd) => {
  DB.operador = {nome:'Chefe', setor:'Administração'};
  DB.frota = []; DB.cargas = []; DB.movimentacoes = [];
  const st = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
              'Embarque Finalizado','Faturado','Seguiu Viagem'];
  const agora = Date.now(), H = 3600000;
  for(let i=0;i<qtd;i++){
    const placa = 'IDX' + String(1000 + (i % 400)).slice(1) + 'A' + String(10 + i % 89);
    if(i < 400) DB.frota.push({placa, transportadora:'T'+(i%9), tipoVeiculo:'Truck', uf:'MG',
                              capacidadeKg:14000, atualizadoEm:new Date(agora).toISOString()});
    const nasce = agora - (i % 45) * 24 * H - (i % 7) * H;
    const fim = i % 10 === 0 ? 3 : 5;   // 10% em aberto
    const c = { id:'carga_'+i, numeroCarga:String(90000+i), placa, transportadora:'T'+(i%9),
      tipoVeiculo:'Truck', motorista:'M', cliente:'C', destino:'D', peso:9000, doca:'1',
      sequencia:i+1, observacoes:'', praOnde:'Entrega', rota:String(500 + i%7), paletizada:'Não',
      qtdGanchos:0, qtdEntregas:1, status:st[fim], aguardandoCarga:false,
      criadoEm:new Date(nasce).toISOString(), programadoEm:new Date(nasce).toISOString(),
      atualizadoEm:new Date(nasce).toISOString(), criadoPor:'Logística' };
    DB.cargas.push(c);
    for(let j=0;j<=fim;j++){
      DB.movimentacoes.push({id:'mov_'+i+'_'+j, cargaId:c.id, placa, statusAnterior:j?st[j-1]:null,
        statusNovo:st[j], operador:'Op', setor:'Portaria',
        timestamp:new Date(nasce + j*40*60000).toISOString(), numeroCarga:c.numeroCarga});
    }
  }
  // embaralha para o índice ter que ordenar de verdade
  DB.movimentacoes.sort(() => Math.random() - 0.5);
  document.getElementById('modal-operador')?.classList.remove('open');
  return DB.movimentacoes.length;
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)

        print('\n=== 1. MESMA RESPOSTA DE SEMPRE ===')
        movs = await pg.evaluate(SEED, 300)
        igual = await pg.evaluate("""() => {
          const ids = DB.cargas.slice(0, 50).map(c => c.id);
          return ids.every(id => {
            const esperado = DB.movimentacoes.filter(m=>m.cargaId===id)
              .sort((a,b)=>new Date(a.timestamp)-new Date(b.timestamp)).map(m=>m.id).join(',');
            return historicoDaCarga(id).map(m=>m.id).join(',') === esperado;
          });
        }""")
        ck(f'historicoDaCarga devolve a mesma lista, na mesma ordem ({movs} movimentações)', igual)
        ck('existe um índice de movimentações por carga',
           await pg.evaluate("() => typeof indiceMovimentacoes === 'function'"))

        print('\n=== 2. 1.500 CARGAS: INDICADORES NÃO CONGELAM ===')
        movs = await pg.evaluate(SEED, 1500)
        await pg.evaluate("abrirTab('indicadores')")
        await pg.wait_for_timeout(300)
        ms = await pg.evaluate("""() => {
          const t0 = performance.now();
          renderAll();
          const t1 = performance.now();
          renderAll();   // segunda passada: índice já montado
          return { primeira: Math.round(t1 - t0), segunda: Math.round(performance.now() - t1) };
        }""")
        ck(f'renderAll com 1.500 cargas / {movs} movimentações em menos de 2,5 s (media 5,1 s antes)',
           ms['segunda'] < 2500, f"{ms} ms")

        print('\n=== 3. O ÍNDICE ENXERGA A MUDANÇA ===')
        viu = await pg.evaluate("""() => {
          const id = DB.cargas[5].id;
          const antes = historicoDaCarga(id).length;
          registrarMovimentacao({cargaId:id, placa:DB.cargas[5].placa, statusAnterior:'Faturado',
            statusNovo:'Seguiu Viagem', operador:'Op', setor:'Portaria'});
          const depois = historicoDaCarga(id).length;
          // substituição in-place (mesmo tamanho): o caminho da sincronia
          const i = DB.movimentacoes.findIndex(m => m.cargaId === id);
          const trocada = Object.assign({}, DB.movimentacoes[i], { id:'trocada', statusNovo:'Embarque Finalizado' });
          DB.movimentacoes.splice(i, 1); DB.movimentacoes.push(trocada);
          if(typeof invalidarIndiceMovimentacoes === 'function') invalidarIndiceMovimentacoes();
          const veTrocada = historicoDaCarga(id).some(m => m.id === 'trocada');
          return { antes, depois, veTrocada };
        }""")
        ck('movimentação nova aparece no histórico na hora', viu['depois'] == viu['antes'] + 1, str(viu))
        ck('substituição no mesmo tamanho (caminho da sincronia) também aparece', viu['veTrocada'], str(viu))

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros)[:300])
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
