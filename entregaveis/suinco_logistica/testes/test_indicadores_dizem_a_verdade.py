#!/usr/bin/env python3
"""Os números da aba Indicadores e do Relatório Executivo dizem a verdade.

AUDITORIA DE FIDELIDADE (09/09/2026), pedida pelo dono no refinamento geral.
A aritmética estava certa (17 KPIs conferidos ao minuto contra o SQL); o que
mentia era a GUARDA DE ENTRADA e o RÓTULO DE RECORTE. Cinco achados altos:

  1. "Paradas Além da Meta" e "Parada há" contavam pela hora da GRAVAÇÃO
     (`atualizadoEm`), não da chegada. Abrir o painel regrava tudo, então o
     indicador lia ZERO justamente quando estava em uso. Caminhão parado
     17h47 virava "Parada há 0 min" e "0 Paradas Além da Meta" no PDF.
     É a ocorrência #08 chegando a dois pontos que a correção não alcançou.
  2. Uma data impossível (chegada em 2029) levava a média de pátio a
     −243.504 min, publicada sem aviso em cartão, Raio-X, Gargalos e PDF.
  3. "os números abaixo consideram só este recorte" era falso para a tabela
     de comparação por período — ela ignorava o filtro (família da #18).
  4. "Gargalos" dizia respeitar o período selecionado e usava o histórico
     inteiro.
  5. Saída no futuro entrava nos cartões e sumia das tabelas de período.

E dois de UX/acessibilidade da mesma auditoria: as 11 abas eram <div> sem
tabindex (teclado não alcança), e o dourado do tema claro reprovava AA nos
títulos de coluna (4,33:1).

    python3 testes/test_indicadores_dizem_a_verdade.py
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


# Cenário controlado, em modo local (sem servidor):
#   PARADA  — chegou há 17h47, ainda no pátio, e foi REGRAVADA agora (o eco
#             de sincronização que zerava o indicador).
#   FUTURO  — concluída, mas com a chegada carimbada em 2029 (data impossível).
#   ALFA-1  — concluída hoje, 240 min de pátio, TRANSPORTES ALFA.
#   BETA-1  — concluída hoje, 120 min de pátio, LOG BETA.
#   VELHA   — concluída há 10 dias com 600 min de pátio (atraso), VELHA LTDA:
#             só pode aparecer nos Gargalos quando o período for "todo o
#             histórico", nunca em "Semana".
SEED = """() => {
  DB.operador = {nome:'Chefe', setor:'Administração'};
  DB.frota = []; DB.cargas = []; DB.movimentacoes = [];
  const agora = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const st = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
              'Embarque Finalizado','Faturado','Seguiu Viagem'];
  let n = 0;
  function carga(spec){
    n++;
    const c = { id:'carga_'+n, numeroCarga:spec.numero, placa:spec.placa,
      transportadora:spec.tr, tipoVeiculo:'Truck', motorista:'M'+n, cliente:'C'+n,
      destino:'D'+n, peso:10000, doca:'1', sequencia:n, observacoes:'', praOnde:'Entrega',
      rota:'500', paletizada:'Não', qtdGanchos:0, qtdEntregas:1, status:spec.status,
      aguardandoCarga:false, criadoEm:iso(spec.t0), programadoEm:iso(spec.t0),
      atualizadoEm:iso(spec.atualizadoEm ?? spec.t0), criadoPor:'Logística' };
    DB.frota.push({placa:spec.placa, transportadora:spec.tr, tipoVeiculo:'Truck', uf:'MG',
                   capacidadeKg:14000, atualizadoEm:iso(agora)});
    DB.cargas.push(c);
    spec.eventos.forEach((ev, j) => DB.movimentacoes.push({
      id:'mov_'+n+'_'+j, cargaId:c.id, placa:c.placa,
      statusAnterior: j ? spec.eventos[j-1][0] : null, statusNovo: ev[0],
      operador:'Op', setor:'Portaria', timestamp: iso(ev[1]), numeroCarga:c.numeroCarga }));
    if(spec.status === 'Seguiu Viagem') c.concluidoEm = iso(spec.eventos.at(-1)[1]);
    return c;
  }
  const H = 3600000, MIN = 60000;
  const chegada = agora - 1067*MIN;   // 17h47 atrás
  carga({numero:'PARADA', placa:'PAR1A11', tr:'TRANSPORTES ALFA', status:'Aguardando Embarque',
         t0: chegada - 2*H, atualizadoEm: agora,
         eventos:[['Aguardando Veículo', chegada - 2*H], ['Aguardando Embarque', chegada]]});
  const em2029 = Date.parse('2029-01-01T06:00:00Z');
  carga({numero:'FUTURO', placa:'FUT2B22', tr:'TRANSPORTES ALFA', status:'Seguiu Viagem',
         t0: agora - 6*H,
         eventos:[['Aguardando Veículo', agora-6*H], ['Aguardando Embarque', em2029],
                  ['Embarque Iniciado', agora-5*H], ['Embarque Finalizado', agora-4*H],
                  ['Faturado', agora-3*H], ['Seguiu Viagem', agora-2*H]]});
  function concluida(numero, placa, tr, chegou, patioMin){
    const t = chegou;
    carga({numero, placa, tr, status:'Seguiu Viagem', t0: t - H,
      eventos:[['Aguardando Veículo', t-H], ['Aguardando Embarque', t],
               ['Embarque Iniciado', t + patioMin*MIN*0.25], ['Embarque Finalizado', t + patioMin*MIN*0.5],
               ['Faturado', t + patioMin*MIN*0.75], ['Seguiu Viagem', t + patioMin*MIN]]});
  }
  concluida('ALFA-1', 'ALF3C33', 'TRANSPORTES ALFA', agora - 8*H, 240);
  concluida('BETA-1', 'BET4D44', 'LOG BETA',         agora - 8*H, 120);
  concluida('VELHA',  'VEL5E55', 'VELHA LTDA',       agora - 10*24*H, 600);
  document.getElementById('modal-operador')?.classList.remove('open');
  renderAll();
}"""

CONTRASTE = """() => {
  const lum = (hex) => {
    const h = hex.replace('#',''); const v = [0,2,4].map(i=>parseInt(h.substr(i,2),16)/255)
      .map(c => c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4));
    return 0.2126*v[0] + 0.7152*v[1] + 0.0722*v[2];
  };
  const razao = (a,b) => { const [x,y] = [lum(a),lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
  const cs = getComputedStyle(document.documentElement);
  const gold = cs.getPropertyValue('--gold-text').trim();
  const card = cs.getPropertyValue('--navy').trim();
  const pagina = cs.getPropertyValue('--navy-deep').trim();
  return { gold, card, pagina, noCard: razao(gold, card), naPagina: razao(gold, pagina) };
}"""


async def texto(pg, sel):
    el = await pg.query_selector(sel)
    return (await el.inner_text()).strip() if el else ''


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(SEED)
        await pg.wait_for_timeout(400)
        await pg.evaluate("abrirTab('indicadores')")
        await pg.wait_for_timeout(700)

        print('\n=== 1. "PARADA HÁ" CONTA DA CHEGADA, NÃO DA GRAVAÇÃO ===')
        parada = await pg.evaluate("""() => {
            const g = analiseGargalos(DB.cargas);
            const p = g.pendentesAntigas.find(x => x.numeroCarga === 'PARADA');
            return p ? p.paradaHaMin : 'nao-listada';
        }""")
        ck('a carga regravada agora continua "parada há" ~17h47',
           isinstance(parada, (int, float)) and 1060 <= parada <= 1075, f"paradaHaMin={parada}")
        alem = await pg.evaluate("""() => typeof paradasAlemDaMeta === 'function'
            ? paradasAlemDaMeta(cargasAbertas()) : 'funcao-nao-existe'""")
        ck('existe UMA função de "paradas além da meta" (Gargalos e PDF usam a mesma)',
           isinstance(alem, dict), str(alem))
        ck('o Relatório Executivo conta 1 parada além da meta, não 0',
           isinstance(alem, dict) and alem.get('total') == 1, str(alem))

        print('\n=== 2. DATA IMPOSSÍVEL SAI DA CONTA E É CONTADA À PARTE ===')
        medio = await pg.evaluate("() => tempoMedioPatio(DB.cargas.filter(c=>c.status==='Seguiu Viagem'))")
        # ALFA-1 240 + BETA-1 120 + VELHA 600 = 960 / 3 = 320. FUTURO fora.
        ck('média de pátio ignora a carga com chegada em 2029',
           medio.get('media') == 320 and medio.get('amostra') == 3, str(medio))
        ck('nenhum indicador é negativo',
           all((v is None or v >= 0) for v in [medio.get('media')]), str(medio))
        inconsistentes = await pg.evaluate("""() => typeof cargasComDataInconsistente === 'function'
            ? cargasComDataInconsistente(DB.cargas).map(c => c.numeroCarga) : 'funcao-nao-existe'""")
        ck('a carga descartada é listada, não escondida',
           inconsistentes == ['FUTURO'], str(inconsistentes))
        stats = await texto(pg, '#ind-stats')
        patio = await texto(pg, '#ind-patio-medio')
        ck('a tela diz quantas cargas ficaram fora da conta',
           'fora da conta' in (stats + patio), 'nota de descarte não aparece')
        import re as _re
        negativos = _re.findall(r'[−-]\s?\d+\s?min', stats + patio)
        ck('nenhum minuto negativo na aba', not negativos, str(negativos[:3]))

        print('\n=== 3. A COMPARAÇÃO POR PERÍODO RESPEITA O FILTRO ===')
        await pg.select_option('#ind-f-periodo', 'semana')
        await pg.wait_for_timeout(500)
        antes = await texto(pg, '#ind-periodos-tbody')
        await pg.select_option('#ind-f-transp', 'LOG BETA')
        await pg.wait_for_timeout(600)
        depois = await texto(pg, '#ind-periodos-tbody')
        ck('a tabela de comparação por período MUDA ao filtrar transportadora',
           antes != depois, 'tabela idêntica antes e depois do filtro')
        nota = await texto(pg, '#ind-filtro-nota')
        ck('a nota "só este recorte" continua — e agora é verdade', 'LOG BETA' in nota, nota)

        print('\n=== 4. GARGALOS RESPEITAM O PERÍODO ===')
        await pg.select_option('#ind-f-transp', '')
        await pg.wait_for_timeout(400)
        await pg.select_option('#ind-f-periodo', 'semana')
        await pg.wait_for_timeout(600)
        semana = await texto(pg, '#ind-gargalos')
        ck('com "Semana", a transportadora de 10 dias atrás NÃO aparece nos gargalos',
           'VELHA LTDA' not in semana, 'VELHA LTDA aparece em Semana')
        await pg.select_option('#ind-f-periodo', '')
        await pg.wait_for_timeout(600)
        tudo = await texto(pg, '#ind-gargalos')
        ck('com "todo o histórico", ela aparece', 'VELHA LTDA' in tudo, 'VELHA LTDA sumiu do histórico')
        ck('a carga parada continua listada nos dois casos',
           'PARADA' in semana and 'PARADA' in tudo)

        print('\n=== 5. AS ABAS EXISTEM PARA O TECLADO ===')
        abas = await pg.evaluate("""() => [...document.querySelectorAll('.nav-tab')].map(t => ({
            role: t.getAttribute('role'), tab: t.tabIndex, sel: t.getAttribute('aria-selected') }))""")
        ck('as 11 abas têm role="tab" e entram na ordem do Tab',
           len(abas) == 11 and all(a['role'] == 'tab' and a['tab'] == 0 for a in abas), str(abas[:3]))
        ck('a aba ativa declara aria-selected', any(a['sel'] == 'true' for a in abas))
        await pg.focus('.nav-tab[data-tab="historico"]')
        await pg.keyboard.press('Enter')
        await pg.wait_for_timeout(400)
        atual = await pg.evaluate('() => TAB_ATUAL')
        ck('Enter numa aba focada abre a aba', atual == 'historico', f"TAB_ATUAL={atual}")

        print('\n=== 6. DOURADO DO TEMA CLARO PASSA NO AA ===')
        await pg.evaluate("document.documentElement.setAttribute('data-tema','claro')")
        await pg.wait_for_timeout(200)
        c = await pg.evaluate(CONTRASTE)
        ck('contraste do dourado de texto sobre o card ≥ 4,5:1',
           c['noCard'] >= 4.5, f"{c['gold']} sobre {c['card']} = {c['noCard']:.2f}")
        ck('contraste do dourado de texto sobre a página ≥ 4,5:1',
           c['naPagina'] >= 4.5, f"{c['gold']} sobre {c['pagina']} = {c['naPagina']:.2f}")

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros)[:300])
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
