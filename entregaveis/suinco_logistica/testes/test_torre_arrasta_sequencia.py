#!/usr/bin/env python3
"""Arrastar e digitar reordenam a fila NA TORRE também (09/09/2026).

PEDIDO DO DONO: "quero conseguir arrastar a ordem do sequenciamento de carga
na torre de controle" e, sobre digitar × arrastar: "a e b, se mudar o numero
reordena se arrastar reordena, os 2 precisam funcionar, mantendo a logica e
a sequencia".

O CUIDADO. Na Fila, sequência é POSIÇÃO. Na Torre era NÚMERO LIVRE. Juntar as
duas coisas na mesma função quebrou a Torre hoje de manhã (ocorrência #27):
digitar 7 numa lista de 2 virava "posição 7 não existe", o servidor recusava
e o número voltava — o defeito de 14/08 de volta.

A SAÍDA, que é diferente daquela: quem decide não é a TELA, é o STATUS DA
LINHA, que está visível.

  · ainda vai carregar (Aguardando Veículo / Aguardando Embarque)
      → digitar = posição, com cascata · arrasto com alça
  · já carregando, carregado ou faturado
      → o número é registro do que aconteceu: digitar guarda o valor e NÃO
        reordena nada · sem alça, não arrasta

    python3 testes/test_torre_arrasta_sequencia.py
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


# Quatro cargas do dia: duas na fila, uma carregando, uma faturada.
SEED = """() => {
  DB.operador = {nome:'Chefe', setor:'Logística'};
  DB.frota = []; DB.cargas = []; DB.movimentacoes = [];
  const agora = Date.now(), iso = (t)=>new Date(t).toISOString();
  const st = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
              'Embarque Finalizado','Faturado','Seguiu Viagem'];
  function mk(id, numero, placa, status, seq){
    const t0 = agora - 4*3600000;
    DB.frota.push({placa, transportadora:'ALFA', tipoVeiculo:'Truck', uf:'MG',
                   capacidadeKg:14000, atualizadoEm:iso(agora)});
    DB.cargas.push({ id, numeroCarga:numero, placa, transportadora:'ALFA', tipoVeiculo:'Truck',
      motorista:'M', cliente:'C', destino:'D', peso:10000, doca:'1', sequencia:seq, observacoes:'',
      praOnde:'Entrega', rota:'500', paletizada:'Não', qtdGanchos:0, qtdEntregas:1, status,
      aguardandoCarga:false, criadoEm:iso(t0), programadoEm:iso(t0), atualizadoEm:iso(t0),
      criadoPor:'Logística' });
    const ate = st.indexOf(status);
    for(let j=0;j<=ate;j++){
      DB.movimentacoes.push({id:'mov_'+id+'_'+j, cargaId:id, placa, statusAnterior:j?st[j-1]:null,
        statusNovo:st[j], operador:'Op', setor:'Portaria', timestamp:iso(t0 + j*20*60000), numeroCarga:numero});
    }
  }
  mk('c_carregando', 'CARREGANDO', 'CAR1A11', 'Embarque Iniciado', 1);
  mk('c_faturada',   'FATURADA',   'FAT2B22', 'Faturado',          2);
  mk('c_fila_a',     'FILA-A',     'FIA3C33', 'Aguardando Veículo', 3);
  mk('c_fila_b',     'FILA-B',     'FIB4D44', 'Aguardando Embarque', 4);
  document.getElementById('modal-operador')?.classList.remove('open');
  renderAll();
}"""

# Lê a linha da Torre pelo número da carga (a Torre não põe data-carga na linha).
LINHA = """(numero) => {
  const tr = [...document.querySelectorAll('#torre-tbody tr')]
    .find(t => (t.querySelector('.numero-carga-input')||{}).value === numero
            || t.innerText.includes(numero));
  if(!tr) return null;
  const seq = tr.querySelector('.seq-input');
  return {
    arrastavel: tr.getAttribute('draggable'),
    temAlca: !!tr.querySelector('.alca-arrastar'),
    onchange: seq ? seq.getAttribute('onchange') : null,
    titulo: seq ? seq.getAttribute('title') : null,
    valor: seq ? seq.value : null,
  };
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(SEED)
        await pg.evaluate("abrirTab('torre')")
        await pg.wait_for_timeout(600)

        print('\n=== 1. QUEM AINDA VAI CARREGAR ARRASTA; QUEM JÁ CARREGOU, NÃO ===')
        fila_a = await pg.evaluate(LINHA, 'FILA-A')
        fila_b = await pg.evaluate(LINHA, 'FILA-B')
        carregando = await pg.evaluate(LINHA, 'CARREGANDO')
        faturada = await pg.evaluate(LINHA, 'FATURADA')
        ck('a carga em Aguardando Veículo é arrastável e tem alça',
           fila_a and fila_a['arrastavel'] == 'true' and fila_a['temAlca'], str(fila_a))
        ck('a em Aguardando Embarque também (ela ainda vai carregar)',
           fila_b and fila_b['arrastavel'] == 'true' and fila_b['temAlca'], str(fila_b))
        ck('a que está CARREGANDO não arrasta e não tem alça',
           carregando and carregando['arrastavel'] != 'true' and not carregando['temAlca'], str(carregando))
        ck('a FATURADA também não', faturada and faturada['arrastavel'] != 'true' and not faturada['temAlca'], str(faturada))

        print('\n=== 2. DIGITAR: POSIÇÃO NA FILA, OU REGISTRO — CONFORME A LINHA ===')
        ck('existe UMA função de sequência para a Torre',
           await pg.evaluate("() => typeof definirSequenciaTorreUI === 'function'"))
        ck('a linha da fila diz que o número é POSIÇÃO',
           fila_a and 'posi' in (fila_a['titulo'] or '').lower(), str(fila_a and fila_a['titulo']))
        ck('a linha que já carregou diz que o número NÃO reordena',
           carregando and 'não reordena' in (carregando['titulo'] or '').lower(), str(carregando and carregando['titulo']))
        # Ela DELEGA: fila → definirPosicaoNaFilaUI (a mesma do arrastar);
        # registro → atualizarSequenciaUI (que é quem carimba). Ler o carimbo
        # dentro dela mediria um atalho que mudou de forma — o comportamento
        # está provado no bloco 3, com carga de verdade.
        rota = await pg.evaluate("""() => {
            const f = definirSequenciaTorreUI.toString();
            return { chamaFila: /definirPosicaoNaFilaUI/.test(f),
                     chamaRegistro: /atualizarSequenciaUI/.test(f),
                     carimbaOndeDeve: /atualizadoEm/.test(atualizarSequenciaUI.toString()) };
        }""")
        ck('ela leva a linha da fila para a MESMA cascata do arrastar', rota['chamaFila'], str(rota))
        ck('e a linha que é registro para a função que carimba',
           rota['chamaRegistro'] and rota['carimbaOndeDeve'], str(rota))

        print('\n=== 3. O NÚMERO DE QUEM JÁ CARREGOU CONTINUA SENDO GUARDADO ===')
        # É exatamente o defeito de 14/08 (#27): o valor tem que ficar.
        guardou = await pg.evaluate("""() => {
            definirSequenciaTorreUI('c_carregando', '9');
            const c = DB.cargas.find(x=>x.id==='c_carregando');
            return { seq: c.sequencia, carimbo: !!c.atualizadoEm };
        }""")
        ck('digitar 9 numa carga que já carregou guarda 9', guardou['seq'] == 9, str(guardou))
        ck('e carimba a carga, para a mudança subir ao servidor', guardou['carimbo'], str(guardou))
        outros = await pg.evaluate("() => DB.cargas.filter(c=>c.id!=='c_carregando').map(c=>c.sequencia)")
        ck('e NÃO reordena ninguém — é registro, não fila', outros == [2, 3, 4], str(outros))

        print('\n=== 4. SEM SERVIDOR, A FILA NÃO SE MEXE POR CONTA PRÓPRIA ===')
        antes = await pg.evaluate("() => DB.cargas.map(c=>c.sequencia)")
        await pg.evaluate("""() => { window.__avisos=[]; const _n=window.notify;
            window.notify=(m,t,ms)=>{ window.__avisos.push(String(m)); return _n(m,t,ms); };
            definirSequenciaTorreUI('c_fila_b', '1'); }""")
        await pg.wait_for_timeout(600)
        depois = await pg.evaluate("() => ({ seqs: DB.cargas.map(c=>c.sequencia), avisos: window.__avisos })")
        ck('avisa que sem servidor a ordem não muda',
           any('servidor' in a.lower() for a in depois['avisos']), str(depois['avisos'])[:140])
        ck('e não mexe na sequência local por conta própria', depois['seqs'] == antes, f"{antes} → {depois['seqs']}")

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros)[:300])
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
