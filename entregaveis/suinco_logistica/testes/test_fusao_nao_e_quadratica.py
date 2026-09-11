#!/usr/bin/env python3
"""A fusão do estado remoto não pode crescer ao quadrado.

RELATO DO DONO, 10/09/2026, com print: "Page Unresponsive", depois "travou
no meu também" — duas máquinas — e "ta demorando muito pra entrar no site".

A CAUSA, medida. `fundirEstadoRemoto` fazia, para CADA movimentação que
chegava do servidor, um `findIndex` sobre TODAS as movimentações locais,
procurando a provisória correspondente. Na leitura COMPLETA — exatamente a
que roda ao entrar no painel — isso é M²/2 comparações. Com o processador 4x
mais lento:

      600 movimentações ......    43 ms
    1.200 movimentações ......    68 ms
    2.400 movimentações ......   173 ms
    4.800 movimentações ......   553 ms
    7.200 movimentações ......  1.143 ms

Dobrar o volume quadruplicava o tempo. Extrapolando a curva, 20 mil
movimentações passam de 9 segundos de aba congelada.

A CORREÇÃO: as provisórias entram num índice montado UMA vez, e a remoção
acontece de uma vez no fim (splice dentro do laço traria a mesma conta de
volta pela outra porta).

ESTE TESTE TRAVA AS DUAS METADES, e a primeira é a que importa mais:

  1. o CASAMENTO não mudou — provisória local do mesmo evento (carga,
     de → para) sai quando a do servidor chega, UMA por vez, e o horário
     que fica é o do servidor;
  2. a CURVA é de reta, não de parábola — quadruplicar o volume não pode
     multiplicar o tempo por muito mais que quatro.

O ponto 2 mede tempo, e tempo em máquina ocupada é ruidoso — por isso ele
compara a FORMA da curva, não um número absoluto. Uma conta quadrática dá
fator 16 onde a linear dá 4; o limite de 8 separa as duas com folga.

    python3 testes/test_fusao_nao_e_quadratica.py
"""
import asyncio, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


CARGA_PAYLOAD = """(n) => {
  const status=['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
                'Embarque Finalizado','Aguardando Documentos','Seguiu Viagem'];
  DB.cargas = []; DB.movimentacoes = [];
  const cargas=[], movs=[];
  const nCargas = Math.max(1, Math.round(n/6));
  for(let i=0;i<nCargas;i++){
    const d=new Date(Date.now()-(i%5)*3600000).toISOString();
    cargas.push({ Carga_ID:'c'+i, Numero_Carga:String(100000+i), Placa:'AAK8958',
      Status_Atual: status[i%status.length], Atualizado_Em:d, Criado_Em:d,
      Qtd_Entregas:1, Rota:'500' });
  }
  let k=0;
  for(let i=0;i<nCargas && k<n;i++){
    for(let j=0;j<6 && k<n;j++,k++){
      const d=new Date(Date.now()-(k%500)*60000).toISOString();
      movs.push({ Movimentacao_ID:'mv'+k, Carga_ID:'c'+i, Placa:'AAK8958',
        Data_Evento:d, Operador_Nome:'Fulano', Setor:'Logística',
        Status_Anterior: j?status[(j-1)%6]:null, Status_Novo: status[j%6] });
    }
  }
  const t0=performance.now();
  fundirEstadoRemoto({ completo:true, marca:new Date().toISOString(),
                       cargas, movimentacoes: movs });
  return { ms: performance.now()-t0, guardadas: DB.movimentacoes.length };
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(1200)
        await pg.evaluate("() => { DB.operador = {nome:'Ana', setor:'Logística'}; }")

        print('\n=== 1. A PROVISÓRIA LOCAL SAI QUANDO A DO SERVIDOR CHEGA ===')
        # É a razão de o casamento existir: sem isso o mesmo caminhão fica
        # com duas horas de entrada no mesmo aparelho — uma do relógio de
        # quem clicou, outra do servidor (decisão de 25/08/2026).
        d = await pg.evaluate("""() => {
              DB.cargas = []; DB.movimentacoes = [];
              DB.movimentacoes.push({ id:'local-1', cargaId:'c1', placa:'AAK8958',
                timestamp:'2026-09-11T09:00:00.000Z', operador:'Ana',
                setor:'Logística', statusAnterior:'Aguardando Veículo',
                statusNovo:'Aguardando Embarque', _local:true });
              const r = fundirEstadoRemoto({ cargas:[], movimentacoes:[{
                Movimentacao_ID:'servidor-1', Carga_ID:'c1', Placa:'AAK8958',
                Data_Evento:'2026-09-11T09:00:07.000Z', Operador_Nome:'Ana',
                Setor:'Logística', Status_Anterior:'Aguardando Veículo',
                Status_Novo:'Aguardando Embarque' }]});
              return { total: DB.movimentacoes.length,
                       ids: DB.movimentacoes.map(m=>m.id),
                       hora: (DB.movimentacoes[0]||{}).timestamp,
                       novas: r.movimentacoesNovas };
            }""")
        ck('fica UMA movimentação, não duas', d['total'] == 1, str(d['ids']))
        ck('e a que fica é a do SERVIDOR', d['ids'] == ['servidor-1'], str(d['ids']))
        ck('com o horário do servidor, não o do aparelho',
           d['hora'] == '2026-09-11T09:00:07.000Z', str(d['hora']))

        print('\n=== 2. DUAS TRANSIÇÕES IGUAIS DE VERDADE: SAI UMA POR VEZ ===')
        # Correção de etapa faz a MESMA transição acontecer duas vezes. A
        # segunda provisória tem que continuar esperando a dela.
        d = await pg.evaluate("""() => {
              DB.cargas = []; DB.movimentacoes = [];
              ['local-a','local-b'].forEach(id => DB.movimentacoes.push({
                id, cargaId:'c1', placa:'AAK8958',
                timestamp:'2026-09-11T09:00:00.000Z', operador:'Ana',
                setor:'Logística', statusAnterior:'Aguardando Veículo',
                statusNovo:'Aguardando Embarque', _local:true }));
              fundirEstadoRemoto({ cargas:[], movimentacoes:[{
                Movimentacao_ID:'servidor-1', Carga_ID:'c1', Placa:'AAK8958',
                Data_Evento:'2026-09-11T09:00:07.000Z', Operador_Nome:'Ana',
                Setor:'Logística', Status_Anterior:'Aguardando Veículo',
                Status_Novo:'Aguardando Embarque' }]});
              return { ids: DB.movimentacoes.map(m=>m.id).sort() };
            }""")
        ck('sai só UMA provisória, a outra continua esperando a sua',
           d['ids'] == ['local-b', 'servidor-1'], str(d['ids']))

        print('\n=== 3. PROVISÓRIA DE OUTRA CARGA NÃO É TOCADA ===')
        d = await pg.evaluate("""() => {
              DB.cargas = []; DB.movimentacoes = [];
              DB.movimentacoes.push({ id:'local-outra', cargaId:'c2', placa:'XXX0X00',
                timestamp:'2026-09-11T09:00:00.000Z', operador:'Ana', setor:'Logística',
                statusAnterior:'Aguardando Veículo', statusNovo:'Aguardando Embarque',
                _local:true });
              fundirEstadoRemoto({ cargas:[], movimentacoes:[{
                Movimentacao_ID:'servidor-1', Carga_ID:'c1', Placa:'AAK8958',
                Data_Evento:'2026-09-11T09:00:07.000Z', Operador_Nome:'Ana',
                Setor:'Logística', Status_Anterior:'Aguardando Veículo',
                Status_Novo:'Aguardando Embarque' }]});
              return { ids: DB.movimentacoes.map(m=>m.id).sort() };
            }""")
        ck('a provisória de outra carga continua lá',
           d['ids'] == ['local-outra', 'servidor-1'], str(d['ids']))

        print('\n=== 4. A CURVA É DE RETA, NÃO DE PARÁBOLA ===')
        # Aquece antes de medir: a primeira passada paga compilação e é a
        # que faria o teste acusar lentidão inexistente.
        await pg.evaluate(CARGA_PAYLOAD, 600)
        base = await pg.evaluate(CARGA_PAYLOAD, 1500)
        grande = await pg.evaluate(CARGA_PAYLOAD, 6000)
        ck('as movimentações todas entraram', grande['guardadas'] == 6000,
           str(grande['guardadas']))
        fator = (grande['ms'] / base['ms']) if base['ms'] > 0 else 999
        ck('quadruplicar o volume não multiplica o tempo por 6 ou mais',
           fator < 6,
           f"1.500 -> {base['ms']:.0f} ms · 6.000 -> {grande['ms']:.0f} ms "
           f"· fator {fator:.1f} (linear ≈ 4, quadrática ≈ 16)")
        ck('nenhum erro de JavaScript', not erros, str(erros[:1]))

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)


asyncio.run(main())
