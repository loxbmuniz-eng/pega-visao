#!/usr/bin/env python3
"""Onde o dedo precisa arrastar a barra para ver o resto — com o pátio CHEIO.

O DONO, 16/09/2026: "tem hora que tem rolagem lateral sim e precisa mover a
barra pra ver o resto das informações, queria que não tivesse isso em lugar
nenhum".

A guarda do padrão respondeu ZERO. Ela estava certa no método e errada no
cenário: media um painel com 0 cargas. Sem carga não há tabela larga, e sem
tabela larga nada rola. Ele vê com o pátio cheio.

Aqui o painel é semeado com o volume real dele — 467 cargas — e a pergunta
é medida em cada aba, nas duas larguras:

  · que elemento rola de lado;
  · quanto ele mostra e quanto precisa;
  · QUAL COLUNA fica fora da vista (é essa a informação que o operador
    perde, e é ela que decide se a coluna vira linha no cartão ou se sai).

Não mede só tabela: qualquer coisa com `overflow-x` que esteja rolando.
"""
import asyncio, json, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
ABAS = ['torre','programacao','devolucoes','portaria','expedicao','faturamento',
        'indicadores','cadastros','historico','relatorios','usuarios']
TELAS = [('celular', 390, 844, True), ('computador', 1280, 800, False)]

# Volume real do navegador do dono. Os textos têm o COMPRIMENTO típico do
# que a operação escreve — é o comprimento que decide a largura da coluna.
SEMEAR = """(n) => {
  const rotas = ['505 — Triângulo Mineiro','517 — Rio de Janeiro (Varejo)',
    '538 — São Paulo Interior · Marília','521 — São Paulo Interior · Ribeirão Preto',
    '525 — Bahia Capital','510 — Belo Horizonte','006 — GPA - DF','030 — Mavisa'];
  const transp = ['BAIXOTES TRANSPORTE','AJB TRANSPORTES','DENIA TRANSPORTES',
    'MARQUES E SILVA','AC Transportes','COOPEDIESEL','MULTEXPRESS','TransOliveira'];
  const motoristas = ['WESLEY JUNIO BORGES NOGUEIRA','ANTAONIO MARCOS','Vinicius alves fonseca',
    'ROOSEVELT MARQUES DA SILVA','ITALO AUGUSTO MEIRA DA SILVA','JOSE DOS REIS'];
  const status = ['Programado','Aguardando Carregamento','Embarque Iniciado',
    'Embarque Finalizado','Faturado','Seguiu Viagem'];
  const tipos = ['Carreta','Bitruck','Truck','Toco'];
  const ops = ['CROSS-DOCKING','ENTREGA DIRETA','RET FRIGO'];
  DB.cargas = []; DB.movimentacoes = [];
  for (let i = 0; i < n; i++) {
    DB.cargas.push({
      id: 'sem_' + i, numeroCarga: String(118700 + i),
      placa: 'TST' + String(1000 + i % 900).slice(0,4),
      motorista: motoristas[i % motoristas.length],
      transportadora: transp[i % transp.length],
      tipoVeiculo: tipos[i % tipos.length],
      rota: rotas[i % rotas.length].slice(0,3),
      peso: 8000 + (i * 137) % 17000, paletes: 12 + i % 16,
      tipoOperacao: ops[i % ops.length],
      status: status[i % status.length],
      sequencia: (i % 40) + 1, ganchos: i % 3, entradas: 1 + i % 2,
      kmDeslocamento: 120 + (i * 7) % 900,
      criadoEm: '2026-09-16T08:00:00.000Z', atualizadoEm: '2026-09-16T12:00:00.000Z',
      chegadaEm: '2026-09-16T07:30:00.000Z',
      operador: 'Rene Araujo', setor: 'Expedicao',
    });
  }
  for (let i = 0; i < 2992; i++) DB.movimentacoes.push({
    id: 'mov_' + i, cargaId: 'sem_' + (i % n), placa: 'TST' + String(1000 + i % 900).slice(0,4),
    statusAnterior: status[i % 5], statusNovo: status[(i+1) % 6], setor: 'Expedicao',
    data: '2026-09-16T12:00:00.000Z', operador: 'Rene Araujo',
  });
  if (typeof invalidarIndiceMovimentacoes === 'function') invalidarIndiceMovimentacoes();
  return DB.cargas.length;
}"""

MEDIR = """() => {
  const vis = (el) => { const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const achados = [];
  document.querySelectorAll('.tab-page.active, .tab-page.active *').forEach(el => {
    if (!vis(el)) return;
    const sobra = el.scrollWidth - el.clientWidth;
    if (sobra <= 2) return;
    const cs = getComputedStyle(el);
    if (!/auto|scroll/.test(cs.overflowX)) return;

    /* QUAL COLUNA FICA FORA — é esta a informação que o operador perde.
       Sem ela o laudo diz "rola" e não diz o que sumiu, que é justamente
       o que decide se a coluna vira linha no cartão ou se sai da tabela. */
    const fora = [];
    const limite = el.clientWidth;
    el.querySelectorAll('thead th').forEach(th => {
      const r = th.getBoundingClientRect(), base = el.getBoundingClientRect();
      if (r.left - base.left + r.width > limite + 2)
        fora.push(th.textContent.trim().replace(/\\s+/g,' ').slice(0,22));
    });
    achados.push({
      sel: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
      mostra: el.clientWidth, precisa: el.scrollWidth, sobra,
      colunasFora: fora,
      totalColunas: el.querySelectorAll('thead th').length,
    });
  });
  return achados;
}"""

async def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 467
    laudo = {}
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        for tela, larg, alt, movel in TELAS:
            pg = await nav.new_page(viewport={'width': larg, 'height': alt}, is_mobile=movel)
            await pg.goto(PAINEL)
            await pg.wait_for_function('typeof irParaTab === "function"')
            await pg.evaluate("""() => { document.body.classList.remove('pre-login');
              document.querySelectorAll('.modal, .modal-bg, .modal-overlay, [class*="overlay"],'
                + ' [class*="notif"], [class*="toast"]').forEach(e => e.style.display='none'); }""")
            quantas = await pg.evaluate(SEMEAR, n)
            print(f'\n=== {tela.upper()} ({larg}px) — {quantas} cargas no painel ===')
            for aba in ABAS:
                await pg.evaluate("(a) => irParaTab(a)", aba)
                await pg.wait_for_timeout(450)
                r = await pg.evaluate(MEDIR)
                laudo[f'{aba}·{tela}'] = r
                for x in r:
                    falta = ', '.join(x['colunasFora']) or '(não é tabela)'
                    print(f"  {aba:12s} {x['sel']:24s} mostra {x['mostra']:4d}px · precisa {x['precisa']:4d}px"
                          f" · faltam {x['sobra']:4d}")
                    print(f"  {'':12s} fora da vista ({len(x['colunasFora'])} de {x['totalColunas']} colunas): {falta}")
            await pg.close()
        await nav.close()
    saida = ('/tmp/claude-0/-home-user-pega-visao/82f87c99-e223-5c72-91d0-65150266c838'
             '/scratchpad/perf/rolagem_com_dado.json')
    json.dump(laudo, open(saida, 'w'), ensure_ascii=False, indent=1)
    total = sum(len(v) for v in laudo.values())
    print(f'\n{total} elemento(s) rolando de lado. Laudo em {saida}')

asyncio.run(main())
