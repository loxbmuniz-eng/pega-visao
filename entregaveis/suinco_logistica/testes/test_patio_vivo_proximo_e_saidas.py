#!/usr/bin/env python3
"""Pátio ao vivo: próximo a carregar e saídas previstas (01/10/2026).

PEDIDO DO DONO: as ideias #4 e #6 do Pátio ao vivo, com as respostas dele:
"pergunta 1 a pergunta b a" (1-A e 2-A da proposta de 01/10/2026).

#4 — PRÓXIMO A CARREGAR (resposta 1-A: a SEQUÊNCIA DO DIA). Na coluna
Aguardando Embarque, UM cartão ganha a marca "próximo a carregar": o de
menor sequência, entre os que já estão no pátio — quem ainda não chegou não
entra (está em Aguardando Veículo). Dia da programação mais antigo primeiro
(a sobra de ontem vem antes da sequência de hoje), a mesma regra de dia da
fila do servidor. Sem sequência não se compara; ninguém com sequência,
ninguém marcado.

#6 — SAÍDAS PREVISTAS (resposta 2-A: só o que dá para dizer com verdade).
Não existe hora prevista de CHEGADA; existe a previsão de SAÍDA de cada
caminhão no pátio (a mesma pvPrevisaoDeSaida do cartão). A faixa conta
quantas saídas caem na próxima hora, de 1 a 2 h e de 2 a 3 h. Quem não
tem previsão (etapa sem histórico suficiente) é contado à parte — null não
é zero.

Dados inventados e marcados (cargas 900501+, rota TESTE), só no navegador.

    bash testes/rodar_tudo.sh test_patio_vivo_proximo_e_saidas
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


# 12 passagens antigas. Medianas (posto mais próximo, 6º de 12):
#   Aguardando Embarque 20 · Embarque Iniciado 80 · Embarque Finalizado 10 · Faturado 15
DURACOES_EI = [50, 55, 60, 65, 70, 80, 90, 100, 110, 120, 130, 140]

# cargas: [nome, status, minutos na etapa, sequência, dias atrás da programação]
SEMEAR = """([duracoes, comFaturado, cargasDoTeste]) => {
  DB.operador = {nome:'Teste', setor:'Administração'};
  document.getElementById('modal-operador')?.classList.remove('open');
  const agora = Date.now(), min = 60000, dia = 86400000, iso = t => new Date(t).toISOString();
  const cargas = [], movs = [];
  let n = 0;
  const carga = (o) => { const c = Object.assign({ id:'teste-px-' + n, numeroCarga:String(900501 + n),
      placa:'TST' + (5000 + n), rota:'TESTE', peso:1000, qtdEntregas:1, sequencia:null,
      programadoEm:iso(agora - 300 * min), criadoEm:iso(agora - 300 * min), atualizadoEm:iso(agora) }, o);
      n++; cargas.push(c); return c; };
  const mov = (c, st, t) => movs.push({ id:'teste-px-m-' + movs.length, cargaId:c.id, placa:c.placa,
      statusNovo:st, setor:'Logística', timestamp:iso(t) });
  duracoes.forEach((d, i) => {
    let t = agora - (2 + i) * dia;
    const c = carga({ status:'Seguiu Viagem', programadoEm:iso(t - 60 * min), criadoEm:iso(t - 60 * min) });
    mov(c, 'Aguardando Embarque', t); t += 20 * min;
    mov(c, 'Embarque Iniciado', t); t += d * min;
    mov(c, 'Embarque Finalizado', t); t += 10 * min;
    if(i < comFaturado){ mov(c, 'Faturado', t); t += 15 * min; }
    mov(c, 'Seguiu Viagem', t);
  });
  const ids = {};
  cargasDoTeste.forEach(([nome, status, haMin, seq, diasAtras]) => {
    const prog = new Date(agora); prog.setHours(6, 0, 0, 0); prog.setDate(prog.getDate() - (diasAtras || 0));
    const c = carga({ status, sequencia: seq, programadoEm: iso(prog.getTime()), criadoEm: iso(prog.getTime()) });
    if(status !== 'Aguardando Veículo'){
      mov(c, 'Aguardando Embarque', agora - (status === 'Aguardando Embarque' ? haMin : haMin + 10) * min);
      if(status !== 'Aguardando Embarque') mov(c, status, agora - haMin * min);
    }
    ids[nome] = c.id;
  });
  DB.cargas = cargas; DB.movimentacoes = movs;
  invalidarIndiceMovimentacoes();
  renderAll(); abrirTab('patio');
  return ids;
}"""

LER = """(ids) => {
  const out = { marcados: [], cartoes: {} };
  for(const [k, id] of Object.entries(ids)){
    const el = document.querySelector(`.pv-card[data-id="${id}"]`);
    if(!el) { out.cartoes[k] = null; continue; }
    const p = el.querySelector('.pv-proximo');
    const marca = !!el.dataset.proximo;
    if(marca) out.marcados.push(k);
    out.cartoes[k] = { marca, texto: p ? p.textContent.trim() : null, aria: el.getAttribute('aria-label') };
  }
  const s = document.getElementById('pv-saidas');
  out.saidas = s ? s.textContent.trim().replace(/\\s+/g, ' ') : null;
  return out;
}"""


async def abrir(nav, largura=1440, altura=900, celular=False):
    pg = await nav.new_page(viewport={'width': largura, 'height': altura}, is_mobile=celular, has_touch=celular)
    pg.on('pageerror', lambda e: erros.append(str(e)))
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(700)
    return pg

erros = []


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')

        print('\n=== #4 — PRÓXIMO A CARREGAR: A SEQUÊNCIA DO DIA ===')
        pg = await abrir(nav)
        hoje = [['nao_chegou', 'Aguardando Veículo', 0, 1, 0],    # seq 1, mas ainda não chegou
                ['seq5', 'Aguardando Embarque', 40, 5, 0],          # chegou primeiro
                ['seq2', 'Aguardando Embarque', 15, 2, 0],          # chegou depois, sequência menor
                ['sem_seq', 'Aguardando Embarque', 60, None, 0],    # sem sequência: não se compara
                ['embarcando', 'Embarque Iniciado', 5, 1, 0]]       # já embarcando: não é "próximo"
        ids = await pg.evaluate(SEMEAR, [DURACOES_EI, 12, hoje])
        await pg.wait_for_timeout(400)
        r = await pg.evaluate(LER, ids)
        print('  ', r['marcados'], r['cartoes']['seq2'])
        ck('a menor sequência entre os que já chegaram ganha a marca (seq 2)', r['marcados'] == ['seq2'], str(r['marcados']))
        ck('a marca diz "próximo a carregar"', (r['cartoes']['seq2'] or {}).get('texto') == 'próximo a carregar',
           repr((r['cartoes']['seq2'] or {}).get('texto')))
        ck('quem lê a tela ouve a marca (aria-label)', 'próximo a carregar' in ((r['cartoes']['seq2'] or {}).get('aria') or '').lower(),
           (r['cartoes']['seq2'] or {}).get('aria'))
        ck('nenhum outro cartão tem o texto da marca',
           all(not v['texto'] for k, v in r['cartoes'].items() if v and k != 'seq2'), str(r['cartoes']))
        await pg.close()

        print('\n=== #4 — A SOBRA DE ONTEM VEM PRIMEIRO ===')
        pg = await abrir(nav)
        ids = await pg.evaluate(SEMEAR, [DURACOES_EI, 12, hoje + [['ontem', 'Aguardando Embarque', 5, 7, 1]]])
        await pg.wait_for_timeout(400)
        r = await pg.evaluate(LER, ids)
        ck('a carga do dia anterior, ainda esperando, é a próxima', r['marcados'] == ['ontem'], str(r['marcados']))
        await pg.close()

        print('\n=== #4 — NINGUÉM COM SEQUÊNCIA: NINGUÉM MARCADO ===')
        pg = await abrir(nav)
        ids = await pg.evaluate(SEMEAR, [DURACOES_EI, 12, [['x', 'Aguardando Embarque', 30, None, 0],
                                                          ['y', 'Aguardando Embarque', 10, None, 0]]])
        await pg.wait_for_timeout(400)
        r = await pg.evaluate(LER, ids)
        ck('sem sequência não se adivinha', r['marcados'] == [], str(r['marcados']))
        await pg.close()

        print('\n=== #4 — A MARCA ANDA QUANDO O PRÓXIMO COMEÇA A EMBARCAR ===')
        pg = await abrir(nav)
        ids = await pg.evaluate(SEMEAR, [DURACOES_EI, 12, hoje])
        await pg.wait_for_timeout(400)
        await pg.evaluate("""(id) => {
          const c = DB.cargas.find(x => x.id === id); c.status = 'Embarque Iniciado';
          DB.movimentacoes.push({ id:'teste-px-m-anda', cargaId:id, placa:c.placa, statusNovo:'Embarque Iniciado',
            setor:'Expedição', timestamp:new Date().toISOString() });
          invalidarIndiceMovimentacoes(); renderAll();
        }""", ids['seq2'])
        await pg.wait_for_timeout(900)
        r = await pg.evaluate(LER, ids)
        ck('seq 2 começou a embarcar: a marca passa para a seq 5', r['marcados'] == ['seq5'], str(r['marcados']))
        ck('e o cartão que saiu da fila perde o texto da marca', not (r['cartoes']['seq2'] or {}).get('texto'),
           str(r['cartoes']['seq2']))
        await pg.close()

        print('\n=== #6 — SAÍDAS PREVISTAS POR HORA ===')
        pg = await abrir(nav)
        patio = [['F', 'Faturado', 5, None, 0],                 # faltam ~10 min           → próxima hora
                 ['A', 'Embarque Iniciado', 90, None, 0],       # passou da mediana: ~25   → próxima hora
                 ['B', 'Embarque Iniciado', 5, None, 0],        # 75 + 10 + 15 = ~100      → de 1 a 2 h
                 ['E', 'Aguardando Embarque', 0, None, 0],      # 20 + 80 + 10 + 15 = ~125 → de 2 a 3 h
                 ['V', 'Aguardando Veículo', 0, 3, 0]]          # não chegou: não conta
        ids = await pg.evaluate(SEMEAR, [DURACOES_EI, 12, patio])
        await pg.wait_for_timeout(400)
        r = await pg.evaluate(LER, ids)
        print('  ', repr(r['saidas']))
        ck('a faixa conta por hora', r['saidas'] == 'Saídas previstas — próxima hora: 2 · de 1 a 2 h: 1 · de 2 a 3 h: 1',
           repr(r['saidas']))
        # a faixa e o cartão usam a MESMA previsão
        prev = await pg.evaluate("""(ids) => Object.fromEntries(Object.entries(ids).map(([k, id]) => {
          const el = document.querySelector(`.pv-card[data-id="${id}"] .pv-previsao`); return [k, el ? el.textContent : null]; }))""", ids)
        ck('os quatro do pátio têm "sai por volta de" no cartão',
           all((prev[k] or '').startswith('sai por volta de') for k in 'FABE'), str(prev))
        await pg.close()

        print('\n=== #6 — SEM HISTÓRICO SUFICIENTE: DIZ, NÃO ZERA ===')
        pg = await abrir(nav)
        ids = await pg.evaluate(SEMEAR, [DURACOES_EI, 3, patio])
        await pg.wait_for_timeout(400)
        r = await pg.evaluate(LER, ids)
        ck('ninguém com previsão: a faixa diz por quê, sem "0"',
           r['saidas'] == 'Saídas previstas — sem histórico suficiente para prever os 4 no pátio', repr(r['saidas']))
        await pg.close()

        print('\n=== #6 — PÁTIO VAZIO ===')
        pg = await abrir(nav)
        ids = await pg.evaluate(SEMEAR, [DURACOES_EI, 12, [['V', 'Aguardando Veículo', 0, 3, 0]]])
        await pg.wait_for_timeout(400)
        r = await pg.evaluate(LER, ids)
        ck('pátio vazio: diz que não há caminhão', r['saidas'] == 'Saídas previstas — nenhum caminhão no pátio agora',
           repr(r['saidas']))
        await pg.close()

        print('\n=== CELULAR (390px) ===')
        pc = await abrir(nav, 390, 844, True)
        ids = await pc.evaluate(SEMEAR, [DURACOES_EI, 12, hoje + patio[:4]])
        await pc.wait_for_timeout(500)
        m = await pc.evaluate("""(id) => {
          const el = document.querySelector(`.pv-card[data-id="${id}"]`), n = el.querySelector('.pv-proximo');
          const s = document.getElementById('pv-saidas');
          if(!n || !s) return { dentro:false, corta:true, vaza:false, falta: !n ? 'a marca' : 'a faixa' };
          const a = el.getBoundingClientRect(), b = n.getBoundingClientRect();
          return { dentro: b.left >= a.left - .5 && b.right <= a.right + .5 && b.top >= a.top - .5,
                   corta: n.scrollWidth > n.clientWidth + 1 || s.scrollWidth > s.clientWidth + 1,
                   vaza: document.documentElement.scrollWidth > innerWidth + 1 };
        }""", ids['seq2'])
        ck('a marca fica dentro do cartão e nada corta', m['dentro'] and not m['corta'], str(m))
        ck('nada vaza para o lado', not m['vaza'], str(m))
        await pc.close()

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
