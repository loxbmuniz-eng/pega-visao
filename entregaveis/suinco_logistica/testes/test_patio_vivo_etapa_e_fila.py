#!/usr/bin/env python3
"""Pátio ao vivo: parado além do normal da etapa, e programada passada na fila (30/09/2026).

PEDIDO DO DONO: o Pátio ao vivo "mais dinâmico", "com mais funcionalidades",
"algo lógico inteligente logístico". Das oito ideias, as duas primeiras, com
as respostas dele: "pergunta 1 B, pergunta 2 A".

#2 — PARADO ALÉM DO NORMAL NESTA ETAPA. O cartão diz há quanto tempo o
caminhão está na etapa em que está, e compara com o normal DAQUELA etapa nos
últimos 30 dias (JANELA_LOCAL_DIAS). "Além do normal" (resposta 1-B) = mais
que 9 em cada 10 caminhões levaram nela: o percentil 90, de posto mais
próximo. Menos de 10 passagens na janela = "sem histórico suficiente", e
nada é marcado. Aguardando Veículo não entra (o caminhão não está no pátio).

#5 — PASSADA NA FILA (resposta 2-A). Não existe hora prevista de chegada na
carga; existe a sequência do dia. A carga em Aguardando Veículo "foi passada"
quando cargas do MESMO dia (programado_em, a mesma regra da fila do servidor)
com sequência MAIOR já entraram no pátio. Sem sequência, não se compara.

O QUE NÃO MUDA, e este teste confere: o tempo de pátio do cartão (a conta
única, tempoDePatioDe) e a linha "parados há mais de 3 horas".

Dados inventados e marcados (cargas 900201+, rota TESTE), só no navegador.

    python3 testes/test_patio_vivo_etapa_e_fila.py
"""
import asyncio
import json
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


# 12 passagens antigas por Embarque Iniciado, com estas durações (min).
# Percentil 90 de posto mais próximo: ceil(0,9 × 12) = 11º menor = 40 min.
DURACOES = [10, 12, 14, 16, 18, 20, 22, 25, 30, 35, 40, 45]

SEMEAR = """(duracoes) => {
  DB.operador = {nome:'Teste', setor:'Administração'};
  document.getElementById('modal-operador')?.classList.remove('open');
  const agora = Date.now(), min = 60000, dia = 86400000, iso = t => new Date(t).toISOString();
  const hoje0 = new Date(); hoje0.setHours(0, 0, 0, 0);
  // programadas hoje de madrugada: o "dia" da fila é hoje
  const progHoje = iso(Math.min(hoje0.getTime() + 60 * min, agora - 180 * min));
  const cargas = [], movs = [];
  let n = 0;
  const carga = (o) => { const c = Object.assign({ id:'teste-ef-' + n, numeroCarga:String(900201 + n),
      placa:'TST' + (2000 + n), rota:'TESTE', peso:1000, qtdEntregas:1, programadoEm:progHoje,
      criadoEm:progHoje, atualizadoEm:iso(agora) }, o); n++; cargas.push(c); return c; };
  const mov = (c, st, t) => movs.push({ id:'teste-ef-m-' + movs.length, cargaId:c.id, placa:c.placa,
      statusNovo:st, setor:'Logística', timestamp:iso(t) });

  // O HISTÓRICO: 12 cargas de 2 a 13 dias atrás, já seguiram viagem.
  duracoes.forEach((d, i) => {
    const t0 = agora - (2 + i) * dia;
    const c = carga({ status:'Seguiu Viagem', sequencia:null, programadoEm:iso(t0 - 60 * min), criadoEm:iso(t0 - 60 * min) });
    mov(c, 'Aguardando Embarque', t0);
    mov(c, 'Embarque Iniciado', t0 + 10 * min);
    mov(c, 'Embarque Finalizado', t0 + (10 + d) * min);
    if(i < 3){ mov(c, 'Faturado', t0 + (15 + d) * min); }       // só 3 passam por Faturado
    mov(c, 'Seguiu Viagem', t0 + (20 + d) * min);
  });

  // O PÁTIO DE HOJE
  const D1 = carga({ status:'Aguardando Veículo', sequencia:1 });
  const D2 = carga({ status:'Aguardando Embarque', sequencia:2 });
  mov(D2, 'Aguardando Embarque', agora - 5 * min);
  const A = carga({ status:'Embarque Iniciado', sequencia:3 });           // 90 min na etapa
  mov(A, 'Aguardando Embarque', agora - 100 * min); mov(A, 'Embarque Iniciado', agora - 90 * min);
  const B = carga({ status:'Embarque Iniciado', sequencia:4 });           // 20 min na etapa
  mov(B, 'Aguardando Embarque', agora - 30 * min); mov(B, 'Embarque Iniciado', agora - 20 * min);
  const D5 = carga({ status:'Aguardando Veículo', sequencia:5 });
  const C = carga({ status:'Faturado', sequencia:null });                 // Faturado: só 3 passagens
  mov(C, 'Aguardando Embarque', agora - 120 * min); mov(C, 'Embarque Iniciado', agora - 100 * min);
  mov(C, 'Embarque Finalizado', agora - 60 * min); mov(C, 'Faturado', agora - 30 * min);
  const D7 = carga({ status:'Aguardando Veículo', sequencia:null });
  // ONTEM, sequência 6, entrou e saiu: é de outro dia, não passa ninguém de hoje
  const ontem = agora - dia;
  const D6 = carga({ status:'Seguiu Viagem', sequencia:6, programadoEm:iso(ontem - 60 * min), criadoEm:iso(ontem - 60 * min) });
  mov(D6, 'Aguardando Embarque', ontem); mov(D6, 'Seguiu Viagem', ontem + 60 * min);

  DB.cargas = cargas; DB.movimentacoes = movs;
  invalidarIndiceMovimentacoes();
  renderAll(); abrirTab('patio');
  return { D1:D1.id, D2:D2.id, A:A.id, B:B.id, D5:D5.id, C:C.id, D7:D7.id };
}"""

LER = """(ids) => {
  const out = {};
  for(const [k, id] of Object.entries(ids)){
    const el = document.querySelector(`.pv-card[data-id="${id}"]`);
    const nota = el && el.querySelector('.pv-nota');
    out[k] = el ? { nota: nota ? nota.textContent.trim() : null,
                    visivel: !!(nota && nota.getClientRects().length && nota.textContent.trim()),
                    parado: el.dataset.parado || '', passada: el.dataset.passada || '',
                    tempo: el.querySelector('.pv-tempo').textContent.trim(),
                    aria: el.getAttribute('aria-label') } : null;
  }
  const c = DB.cargas.find(x => x.id === ids.A);
  out._tempoA = pvDur(tempoDePatioDe(c).minutos);
  out._parado = (document.getElementById('pv-k-parado-sub') || {}).textContent || null;
  out._prog = (document.getElementById('pv-k-prog-sub') || {}).textContent || null;
  out._tresHoras = (document.getElementById('pv-k-patio-sub') || {}).textContent || null;
  return out;
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        erros = []
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        ids = await pg.evaluate(SEMEAR, DURACOES)
        await pg.wait_for_timeout(500)
        r = await pg.evaluate(LER, ids)
        # o painel escreve "20\u00a0min" (espaço que não quebra, #119): lido como espaço
        r = json.loads(json.dumps(r).replace('\\u00a0', ' '))
        for k in ('A', 'B', 'C', 'D1', 'D2', 'D5', 'D7'):
            print('  ', k, r[k] and {x: r[k][x] for x in ('nota', 'parado', 'passada')})

        print('\n=== #2 — PARADO ALÉM DO NORMAL NESTA ETAPA ===')
        a, b, c = r['A'], r['B'], r['C']
        ck('90 min em Embarque Iniciado, onde 9 em 10 saem em até 40 min: marcado',
           a and a['parado'] == '1', str(a))
        ck('o cartão diz o tempo na etapa e o normal dela',
           a and a['nota'] == '1h30 nesta etapa · 9 em 10 saem em até 40 min', a and a['nota'])
        ck('20 min na mesma etapa: não marcado, só o tempo',
           b and b['parado'] == '' and b['nota'] == '20 min nesta etapa', str(b))
        ck('Faturado com 3 passagens na janela: "sem histórico suficiente", nada marcado',
           c and c['parado'] == '' and c['nota'] == '30 min nesta etapa · sem histórico suficiente', str(c))
        ck('quem lê a tela ouve o mesmo (aria-label)', a and '9 em 10 saem em até 40 min' in (a['aria'] or ''),
           a and a['aria'])
        ck('o topo conta 1 além do normal', r['_parado'] == '1 além do normal da etapa', repr(r['_parado']))

        print('\n=== #5 — PASSADA NA FILA ===')
        d1, d5, d7 = r['D1'], r['D5'], r['D7']
        ck('seq 1 sem chegar, seq 2, 3 e 4 de hoje já entraram: passada por 3',
           d1 and d1['passada'] == '3' and d1['nota'] == '3 da fila já entraram na frente', str(d1))
        ck('seq 5: ninguém de hoje com sequência maior entrou (a seq 6 é de ontem)',
           d5 and d5['passada'] == '' and not d5['visivel'], str(d5))
        ck('sem sequência, não se compara', d7 and d7['passada'] == '' and not d7['visivel'], str(d7))
        ck('Aguardando Veículo não mostra "nesta etapa" (o caminhão não está no pátio)',
           all('nesta etapa' not in (x['nota'] or '') for x in (d1, d5, d7)))
        ck('o topo conta 1 programada passada na fila', r['_prog'] == '1 passada na fila', repr(r['_prog']))

        print('\n=== O QUE NÃO MUDA ===')
        ck('o tempo de pátio do cartão é a conta única', a and a['tempo'] == r['_tempoA'], f"{a and a['tempo']} x {r['_tempoA']}")
        ck('a linha das 3 horas continua', r['_tresHoras'] == 'nenhum parado há mais de 3 horas', repr(r['_tresHoras']))

        print('\n=== CELULAR (390px): A NOTA CABE NO CARTÃO ===')
        pc = await nav.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pc.on('pageerror', lambda e: erros.append(str(e)))
        await pc.goto(PAINEL)
        await pc.wait_for_timeout(700)
        ids = await pc.evaluate(SEMEAR, DURACOES)
        await pc.wait_for_timeout(500)
        m = await pc.evaluate("""(id) => {
          const el = document.querySelector(`.pv-card[data-id="${id}"]`), n = el.querySelector('.pv-nota');
          const a = el.getBoundingClientRect(), b = n.getBoundingClientRect();
          return { dentro: b.left >= a.left - .5 && b.right <= a.right + .5 && b.bottom <= a.bottom + .5,
                   corta: n.scrollWidth > n.clientWidth + 1,
                   vaza: document.documentElement.scrollWidth > innerWidth + 1 };
        }""", ids['A'])
        ck('a nota fica dentro do cartão, sem cortar texto', m['dentro'] and not m['corta'], str(m))
        ck('nada vaza para o lado', not m['vaza'], str(m))
        await pc.close()

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
