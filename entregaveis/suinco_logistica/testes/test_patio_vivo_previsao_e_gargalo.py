#!/usr/bin/env python3
"""Pátio ao vivo: previsão de saída e gargalo agora (30/09/2026).

PEDIDO DO DONO: as ideias #1 e #3 do Pátio ao vivo, com as respostas dele:
"pergunta 1 a pergunta 2 a".

#1 — PREVISÃO DE SAÍDA (resposta 1-A: o tempo TÍPICO). Cada caminhão no
pátio mostra "sai por volta de HHhMM". A conta: o que falta da etapa atual
pela mediana dela (se já passou da mediana, falta zero) mais a mediana de
cada etapa seguinte até Seguiu Viagem — as medianas dos últimos 30 dias, a
mesma base do "normal da etapa". Arredonda para 5 minutos ("por volta de").
Se alguma etapa que falta tem menos de 10 passagens, não há previsão.

#3 — GARGALO AGORA (resposta 2-A). A faixa acima das etapas aponta a
etapa com MAIS caminhões além do normal; empate, a que tem mais caminhões;
empate de novo, a que vem primeiro no fluxo. Ninguém além do normal: "sem
gargalo agora". A coluna do gargalo fica marcada.

Dados inventados e marcados (cargas 900401+, rota TESTE), só no navegador.

    python3 testes/test_patio_vivo_previsao_e_gargalo.py
"""
import asyncio
import os
import re
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
#   Aguardando Embarque 20 · Embarque Iniciado 20 · Embarque Finalizado 10 · Faturado 15
# Percentis 90 (11º de 12): AE 20 · EI 40 · EF 10 · Fat 15
DURACOES_EI = [10, 12, 14, 16, 18, 20, 22, 25, 30, 35, 40, 45]

SEMEAR = """([duracoes, comFaturado, patio]) => {
  DB.operador = {nome:'Teste', setor:'Administração'};
  document.getElementById('modal-operador')?.classList.remove('open');
  const agora = Date.now(), min = 60000, dia = 86400000, iso = t => new Date(t).toISOString();
  const cargas = [], movs = [];
  let n = 0;
  const carga = (o) => { const c = Object.assign({ id:'teste-pg-' + n, numeroCarga:String(900401 + n),
      placa:'TST' + (4000 + n), rota:'TESTE', peso:1000, qtdEntregas:1, sequencia:null,
      programadoEm:iso(agora - 300 * min), criadoEm:iso(agora - 300 * min), atualizadoEm:iso(agora) }, o);
      n++; cargas.push(c); return c; };
  const mov = (c, st, t) => movs.push({ id:'teste-pg-m-' + movs.length, cargaId:c.id, placa:c.placa,
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
  patio.forEach(([nome, status, haMin]) => {
    const c = carga({ status });
    mov(c, 'Aguardando Embarque', agora - (haMin + 10) * min);
    if(status !== 'Aguardando Embarque') mov(c, status, agora - haMin * min);
    ids[nome] = c.id;
  });
  DB.cargas = cargas; DB.movimentacoes = movs;
  invalidarIndiceMovimentacoes();
  renderAll(); abrirTab('patio');
  return { ids, agora };
}"""

LER = """(ids) => {
  const out = {};
  for(const [k, id] of Object.entries(ids)){
    const el = document.querySelector(`.pv-card[data-id="${id}"]`);
    const p = el && el.querySelector('.pv-previsao');
    out[k] = el ? { previsao: p ? p.textContent.trim() : null, aria: el.getAttribute('aria-label') } : null;
  }
  const g = document.getElementById('pv-gargalo');
  out._gargalo = g ? g.textContent.trim().replace(/\\s+/g, ' ') : null;
  out._colunas = [...document.querySelectorAll('.pv-col.gargalo')].map(c => c.getAttribute('aria-label'));
  return out;
}"""


def minutos_do_texto(t):
    m = re.search(r'(\d{2})h(\d{2})', t or '')
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        erros = []

        print('\n=== #1 — PREVISÃO DE SAÍDA, E #3 — O GARGALO ===')
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        patio = [['A', 'Embarque Iniciado', 90],     # passou da mediana: faltam só EF 10 + Fat 15
                 ['A2', 'Embarque Iniciado', 60],    # também além do normal (p90 de EI = 40)
                 ['B', 'Embarque Iniciado', 5],      # faltam 15 de EI + 10 + 15
                 ['F', 'Faturado', 5],               # faltam 10 de Faturado
                 ['E', 'Aguardando Embarque', 25]]   # além do normal (p90 de AE = 20), sozinho
        sem = await pg.evaluate(SEMEAR, [DURACOES_EI, 12, patio])
        await pg.wait_for_timeout(500)
        r = await pg.evaluate(LER, sem['ids'])
        agora = await pg.evaluate("() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }")
        for k in ('A', 'B', 'F', 'E'):
            print('  ', k, r[k]['previsao'])
        print('  ', 'gargalo:', r['_gargalo'], r['_colunas'])

        def perto(k, falta):
            got = minutos_do_texto(r[k]['previsao'])
            esperado = (agora + falta) % 1440
            return got is not None and min(abs(got - esperado), 1440 - abs(got - esperado)) <= 5, r[k]['previsao']
        ok, t = perto('A', 25)
        ck('além da mediana na etapa: faltam só as etapas seguintes (~25 min)', ok and t.startswith('sai por volta de'), t)
        ok, t = perto('B', 40)
        ck('5 min em Embarque Iniciado: ~15 da etapa + 10 + 15 (~40 min)', ok, t)
        ok, t = perto('F', 10)
        ck('5 min em Faturado: ~10 min', ok, t)
        ck('arredonda para 5 minutos', all((minutos_do_texto(r[k]['previsao']) or 1) % 5 == 0 for k in ('A', 'B', 'F')),
           str([r[k]['previsao'] for k in ('A', 'B', 'F')]))
        ck('quem lê a tela ouve a previsão (aria-label)', 'sai por volta de' in (r['A']['aria'] or ''), r['A']['aria'])
        ck('o gargalo é Embarque Iniciado: 3 caminhões, 2 além do normal',
           r['_gargalo'] == 'Gargalo agora: Embarque Iniciado — 3 caminhões, 2 além do normal', repr(r['_gargalo']))
        ck('a coluna do gargalo fica marcada, e só ela', r['_colunas'] == ['Embarque Iniciado'], str(r['_colunas']))
        await pg.close()

        print('\n=== SEM HISTÓRICO DE FATURADO, SEM NINGUÉM ALÉM DO NORMAL ===')
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        sem = await pg.evaluate(SEMEAR, [DURACOES_EI, 3, [['B', 'Embarque Iniciado', 5]]])
        await pg.wait_for_timeout(500)
        r = await pg.evaluate(LER, sem['ids'])
        print('  ', r)
        ck('uma etapa que falta sem histórico suficiente: sem previsão', not r['B']['previsao'], repr(r['B']['previsao']))
        ck('ninguém além do normal: "sem gargalo agora"',
           r['_gargalo'] == 'Sem gargalo agora — nenhuma etapa com caminhão além do normal', repr(r['_gargalo']))
        ck('nenhuma coluna marcada', r['_colunas'] == [], str(r['_colunas']))
        await pg.close()

        print('\n=== CELULAR (390px) ===')
        pc = await nav.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        pc.on('pageerror', lambda e: erros.append(str(e)))
        await pc.goto(PAINEL)
        await pc.wait_for_timeout(700)
        sem = await pc.evaluate(SEMEAR, [DURACOES_EI, 12, patio])
        await pc.wait_for_timeout(500)
        m = await pc.evaluate("""(id) => {
          const el = document.querySelector(`.pv-card[data-id="${id}"]`), n = el.querySelector('.pv-previsao');
          const g = document.getElementById('pv-gargalo');
          const a = el.getBoundingClientRect(), b = n.getBoundingClientRect();
          return { dentro: b.left >= a.left - .5 && b.right <= a.right + .5 && b.bottom <= a.bottom + .5,
                   corta: n.scrollWidth > n.clientWidth + 1 || g.scrollWidth > g.clientWidth + 1,
                   vaza: document.documentElement.scrollWidth > innerWidth + 1 };
        }""", sem['ids']['A'])
        ck('a previsão fica dentro do cartão e nada corta', m['dentro'] and not m['corta'], str(m))
        ck('nada vaza para o lado', not m['vaza'], str(m))
        await pc.close()

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
