#!/usr/bin/env python3
"""A meta de 3 horas sai dos indicadores — por enquanto (26/09/2026).

PEDIDO DO DONO, com as palavras dele: "esquece esse kpi de 3 horas por
enquanto ele so ta ai sujando nossos indicadores". Perguntado de onde ela
sai, escolheu: a aba Indicadores e o relatório executivo em PDF. A Torre
de Controle FICA como está — ali o vermelho da carga parada há mais de 3h
é alerta para agir agora, não indicador.

"POR ENQUANTO" DECIDIU O DESENHO. Nada foi apagado: uma chave só, em
data.js (`META_PATIO_NOS_INDICADORES`), esconde a meta em todos os
lugares. Para voltar, vira a chave. Espalhar sete `if` independentes
obrigaria alguém a LEMBRAR onde estava cada pedaço no dia da volta — e
controle que depende de memória é defeito aqui.

O QUE ESTE TESTE TRAVA
  1. na aba Indicadores não sobra meta: nem o número "acima da meta" do
     Pulso do dia, nem a comparação do Tempo Médio, nem o cartão do
     Ranking de Atraso, nem os três blocos de Gargalos que só existem por
     causa dela (recorrência, transportadora e rota com atraso);
  2. o que NÃO depende da meta continua: o tempo médio de pátio (sem
     comparar), os horários de congestionamento, as cargas paradas há
     mais tempo;
  3. o relatório executivo em PDF segue a mesma chave;
  4. a Torre continua destacando a carga parada há mais de 3h;
  5. A CHAVE FUNCIONA NOS DOIS SENTIDOS: ligada de novo, tudo volta. É a
     prova de que "por enquanto" é mesmo por enquanto.

Não precisa do servidor: roda sobre o index.html com dados de exemplo.

    python3 testes/test_meta_patio_fora_dos_indicadores.py
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


# Cargas com pátio LONGO de propósito (etapas de 70 a 95 min): sem carga
# acima de 3h, nenhum dos blocos de meta apareceria mesmo antes da mudança,
# e o teste passaria pelo motivo errado. Metade concluída, metade aberta.
SEED = """() => {
  DB.operador = {nome:'Chefe', setor:'Administração'};
  const st = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
              'Embarque Finalizado','Faturado','Seguiu Viagem'];
  const tr = ['TRANSPORTES ALFA','LOG BETA','RODO GAMA'];
  DB.frota = []; DB.cargas = []; DB.movimentacoes = [];
  const agora = Date.now();
  for(let i = 0; i < 18; i++){
    const placa = 'MTA' + (1 + i % 3) + 'B' + String(10 + i);
    DB.frota.push({placa, transportadora:tr[i%3], tipoVeiculo:'Truck', uf:'MG',
                   capacidadeKg:14000, atualizadoEm:new Date().toISOString()});
    const aberta = i % 2 === 1;
    const s = aberta ? st[1 + (i % 4)] : 'Seguiu Viagem';
    const passo = 70 + (i % 4) * 8;
    const nasce = agora - (aberta ? 6 : 10) * 3600000 - (i % 5) * 600000;
    const c = { id:'mt_'+i, numeroCarga:String(40100+i), placa, transportadora:tr[i%3],
      tipoVeiculo:'Truck', motorista:'M '+i, cliente:'C', destino:'D', produto:'Suíno',
      peso:9000, doca:'1', sequencia:i+1, observacoes:'', praOnde:'Entrega',
      rota:['500','510','517'][i%3], paletizada:'Não', qtdGanchos:10, qtdEntregas:1,
      status:s, aguardandoCarga:false, criadoEm:new Date(nasce).toISOString(),
      criadoPor:'Logística', programadoEm:new Date(nasce).toISOString(),
      atualizadoEm:new Date(nasce).toISOString() };
    DB.cargas.push(c);
    st.slice(0, st.indexOf(s) + 1).forEach((sx, k) => {
      DB.movimentacoes.push({id:'mtm_'+i+'_'+k, cargaId:c.id, placa,
        statusAnterior:k ? st[k-1] : null, statusNovo:sx, operador:'Op',
        setor:['Logística','Portaria','Expedição','Expedição','Faturamento','Portaria'][k],
        timestamp:new Date(nasce + k*passo*60000).toISOString(), numeroCarga:c.numeroCarga});
    });
    if(s === 'Seguiu Viagem') c.concluidoEm = new Date(nasce + 5*passo*60000).toISOString();
  }
  document.getElementById('modal-operador')?.classList.remove('open');
  renderAll();
}"""

# O que a aba Indicadores MOSTRA — texto visível, não o HTML escondido.
LER_INDICADORES = """() => {
  abrirTab('indicadores');
  renderIndicadores();
  const aba = document.getElementById('tab-indicadores');
  const cartaoRanking = document.getElementById('ind-ranking-tbody').closest('.card');
  return {
    texto: aba.innerText,
    rankingVisivel: !!(cartaoRanking && cartaoRanking.offsetParent !== null),
    gargalos: (document.getElementById('ind-gargalos') || {}).innerText || '',
    paradas: (document.getElementById('card-paradas') || {}).innerText || '',
    patioMedio: (document.getElementById('ind-patio-medio') || {}).innerText || '',
    pulso: (document.getElementById('pulso-numeros') || {}).innerText || '',
  };
}"""

# O relatório executivo é montado no navegador e SÓ DEPOIS vai ao servidor
# virar PDF. Troca-se a ida ao servidor por nada e lê-se o HTML montado.
LER_EXECUTIVO = """async () => {
  window.exportarViaServidor = async () => {};
  await exportarPdfExecutivo();
  return document.getElementById('print-executivo').innerText;
}"""

PROIBIDOS_NA_ABA = ['acima da meta', 'meta de 3', 'dentro da meta', 'Maior Atraso',
                    'atraso recorrente', 'concentração de atraso', 'incidência de atraso']
PROIBIDOS_NO_PDF = ['Meta', 'acima da meta', 'Maior Atraso', 'atraso recorrente',
                    'incidência de atraso', '⚠']


async def ler_indicadores(pg):
    """Abre a aba e os cartões recolhidos COM CLIQUE no título, como a
    pessoa faz (o Tempo Médio de Pátio nasce recolhido desde o Lote 3 do
    /impeccable), e só então lê o que a aba mostra."""
    await pg.evaluate("() => { abrirTab('indicadores'); renderIndicadores(); }")
    for s in await pg.query_selector_all('#tab-indicadores details.ind-recolhe:not([open]) > summary'):
        await s.click()
    await pg.wait_for_timeout(200)
    return await pg.evaluate(LER_INDICADORES)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(SEED)
        await pg.wait_for_timeout(600)

        print('\n=== 0. A BASE TEM O QUE A META MEDIRIA ===')
        acima = await pg.evaluate("""() => DB.cargas.filter(c => {
            const t = tempoDePatioDe(c); return t.minutos !== null && t.minutos > 180; }).length""")
        ck('existem cargas com mais de 3h de pátio (senão o teste passaria à toa)', acima >= 4, str(acima))
        chave = await pg.evaluate("() => typeof metaNosIndicadores === 'function' ? metaNosIndicadores() : 'SEM CHAVE'")
        ck('a chave existe e está desligada', chave is False, repr(chave))

        print('\n=== 1. A ABA INDICADORES NÃO MOSTRA MAIS A META ===')
        ind = await ler_indicadores(pg)
        for palavra in PROIBIDOS_NA_ABA:
            ck(f'a aba não diz "{palavra}"', palavra.lower() not in ind['texto'].lower())
        ck('o cartão do Ranking de Veículos com Maior Atraso está escondido', not ind['rankingVisivel'])
        # Defeito achado de passagem: a legenda do gráfico de entradas por
        # hora falava de uma "linha pontilhada" que nunca foi desenhada.
        ck('a legenda da linha pontilhada que não existe saiu',
           'linha pontilhada' not in ind['texto'].lower())

        print('\n=== 2. O QUE NÃO DEPENDE DA META CONTINUA ===')
        ck('o tempo médio de pátio continua na tela', 'h' in ind['patioMedio'] and 'Tempo Médio' in ind['patioMedio'],
           ind['patioMedio'][:120])
        # o Pulso escreve os rótulos em caixa alta por CSS: compara em minúscula
        ck('o Pulso do dia continua com a média e o mais parado',
           'média no pátio' in ind['pulso'].lower() and 'o mais parado' in ind['pulso'].lower(), ind['pulso'][:160])
        ck('os horários de congestionamento continuam em Gargalos',
           'congestionamento' in ind['gargalos'].lower(), ind['gargalos'][:160])
        ck('as cargas paradas há mais tempo continuam na aba (cartão próprio, logo depois do Pulso)',
           'paradas há mais tempo' in ind['paradas'].lower())

        print('\n=== 3. O RELATÓRIO EXECUTIVO SEGUE A MESMA CHAVE ===')
        pdf = await pg.evaluate(LER_EXECUTIVO)
        for palavra in PROIBIDOS_NO_PDF:
            ck(f'o PDF não traz "{palavra}"', palavra not in pdf)
        ck('o PDF continua com o Tempo Médio de Pátio', 'Tempo Médio de Pátio' in pdf)
        ck('o PDF continua com as cargas paradas há mais tempo', 'paradas há mais tempo' in pdf)

        print('\n=== 4. A TORRE CONTINUA ALERTANDO ===')
        await pg.evaluate("() => abrirTab('torre')")
        await pg.wait_for_timeout(300)
        # O vermelho mora na Visão do Pátio (coluna "No pátio"), que a aba
        # Torre desenha abaixo da tabela principal — não em #torre-tbody.
        vermelhos = await pg.evaluate("() => document.querySelectorAll('#tab-torre .vp-atrasado').length")
        ck('a Torre ainda destaca a carga parada há mais de 3h', vermelhos > 0, str(vermelhos))

        print('\n=== 5. A CHAVE FUNCIONA NOS DOIS SENTIDOS ===')
        await pg.evaluate("() => { window.metaNosIndicadores = () => true; }")
        ind2 = await ler_indicadores(pg)
        ck('ligada de novo, a meta volta ao Tempo Médio', 'acima da meta' in ind2['patioMedio'].lower(),
           ind2['patioMedio'][:160])
        ck('ligada de novo, o Ranking de Atraso volta', ind2['rankingVisivel'])
        ck('ligada de novo, os gargalos de atraso voltam', 'atraso recorrente' in ind2['gargalos'].lower()
           or 'incidência de atraso' in ind2['gargalos'].lower())
        pdf2 = await pg.evaluate(LER_EXECUTIVO)
        ck('ligada de novo, a meta volta ao PDF', 'Paradas Além da Meta' in pdf2 and 'Meta' in pdf2)

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
