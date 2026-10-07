#!/usr/bin/env python3
"""Data, hora e duração nunca saem partidas nem cortadas (07/10/2026, #119).

RELATO DO DONO: "Aumentar o tamanho do campo na coluna Pagamentos da aba
Pagamento de Frete. Quando ela adiciona a data, ela fica sendo cortada ou
quebrada (...) isso não pode acontecer em nenhum outro ponto do Embarque
Suinco."

REPRODUZIDO pela tela, pagando uma nota como a Daniela faz: em 1280 e 1366 px
a coluna Pagamento da lista de notas mostrava "paga06/10/202" numa linha e
"6" na de baixo. Duas causas na mesma célula: a lista de notas manda
`overflow-wrap:anywhere` em TODA célula (o navegador pode partir até uma
data), e o selo "paga" não tinha estilo — colava na data e comia largura.

A VARREDURA de todas as abas (com as seções recolhidas abertas) achou a mesma
família no celular, na faixa de tempos médios dos Indicadores: "41 min"
partido em duas linhas e "2h22mi" cortado — o mini-gráfico de 74 px dividia a
linha com o número.

O QUE ESTE TESTE TRAVA:
  A. Vitrine, todas as abas, em 1280, 1366, 1440, 1920 e 390 px, com toda
     seção recolhida aberta por clique: nenhuma data (dd/mm, dd/mm/aaaa),
     hora (HH:MM, HHhMM) ou duração (N min, NhMMmin) partida em duas linhas
     ou escondida pela caixa; nenhum campo de data mais estreito do que a
     data que ele mostra (inclusive nas janelas do Pagamento de Frete).
  B. Servidor de teste: importar a 900802, pagar uma nota pela tela e
     conferir a coluna Pagamento nas mesmas larguras — data inteira numa
     linha, dentro da célula, e o selo "paga" separado da data.

    bash testes/rodar_tudo.sh test_datas_e_tempos_inteiros
"""
import asyncio
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

RAIZ = Path(__file__).resolve().parent.parent
VITRINE = 'file://' + str(RAIZ / 'vitrine' / 'vitrine.html')
PAINEL = RAIZ / 'index.html'
PDFS = RAIZ / 'backend' / 'testes' / 'fixtures' / 'frete'
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
LARGURAS = (1280, 1366, 1440, 1920, 390)

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


# Cada data, hora ou duração impressa na tela: está numa linha só e à vista?
# E cada campo de data: tem a largura de que precisa para mostrar a data?
SONDA = r"""(raiz) => {
  const RE = /\d{2}\/\d{2}\/\d{2,4}|\b\d{2}\/\d{2}\b|\b\d{1,2}:\d{2}\b|\b\d{1,3}h\d{2}(min)?\b|\b\d{1,3} min\b|\b\d{1,3} dias?\b/g;
  const base = document.querySelector(raiz) || document.body;
  const out = [];
  const visivel = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.offsetParent !== null
    && getComputedStyle(el).visibility !== 'hidden'; };
  const onde = el => ((el.closest('[id]') || {}).id || '?') + ' > ' + el.tagName.toLowerCase()
    + (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/)[0] : '');
  const w = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
  let n;
  while((n = w.nextNode())){
    const el = n.parentElement;
    if(!el || el.closest('script,style,svg,option,title,textarea') || !visivel(el)) continue;
    for(const m of n.textContent.matchAll(RE)){
      const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
      const rs = [...rg.getClientRects()].filter(r => r.width > 0);
      if(!rs.length) continue;
      if(new Set(rs.map(r => Math.round(r.top))).size > 1){ out.push({ defeito:'partida', txt:m[0], onde:onde(el) }); continue; }
      const d = rs[0];
      for(let a = el, k = 0; a && a !== document.body && k < 8; a = a.parentElement, k++){
        const cs = getComputedStyle(a);
        if(/auto|scroll/.test(cs.overflowX)) break;                 // rola: dá para ver
        if(cs.overflowX === 'visible' && cs.textOverflow !== 'ellipsis') continue;
        const ar = a.getBoundingClientRect();
        if(d.right > ar.right + 0.5 || d.left < ar.left - 0.5)
          out.push({ defeito:'cortada', txt:m[0], onde:onde(el), caixa:onde(a) });
        break;
      }
    }
  }
  base.querySelectorAll('input[type=date],input[type=datetime-local],input[type=time],input[type=month]').forEach(inp => {
    if(!visivel(inp)) return;
    const c = inp.cloneNode(), cs = getComputedStyle(inp);
    Object.assign(c.style, { position:'absolute', visibility:'hidden', left:'-9999px', width:'auto', minWidth:'0', maxWidth:'none',
      font:cs.font, padding:cs.padding, border:cs.border, boxSizing:cs.boxSizing, letterSpacing:cs.letterSpacing });
    if(!c.value) c.value = { time:'23:59', month:'2026-12', 'datetime-local':'2026-12-28T23:59' }[inp.type] || '2026-12-28';
    inp.parentElement.appendChild(c);
    const precisa = c.getBoundingClientRect().width; c.remove();
    const tem = inp.getBoundingClientRect().width;
    if(tem + 1 < precisa) out.push({ defeito:'campo de data estreito', onde:inp.id || onde(inp), tem:Math.round(tem), precisa:Math.round(precisa) });
  });
  return out;
}"""


async def abrir_aba(pg, aba):
    """Clique de verdade no menu — no celular, abrindo o menu antes."""
    seletor = f'.nav-tab[data-tab="{aba}"]'
    # no celular a aba mora no menu lateral: existe na página, mas fora da tela
    if await pg.is_visible('#btn-menu') and await pg.get_attribute('#btn-menu', 'aria-expanded') != 'true':
        await pg.click('#btn-menu')
        await pg.wait_for_timeout(400)
    await pg.click(seletor)
    await pg.wait_for_timeout(700)


async def abrir_recolhidos(pg, aba):
    """Toda seção recolhida da aba é aberta por clique, como a pessoa faz."""
    for _ in range(3):
        alvos = pg.locator(f'#tab-{aba} [aria-expanded="false"]:visible, #tab-{aba} details:not([open]) > summary:visible')
        n = await alvos.count()
        if not n:
            return
        for i in range(n):
            try:
                await alvos.nth(0).click(timeout=1500)
                await pg.wait_for_timeout(150)
            except Exception:
                break


def resumo(achados):
    """Um achado por LUGAR (aba, elemento, defeito), com quantas vezes e um exemplo."""
    grupos = {}
    for a in achados:
        chave = (a.get('aba', ''), a.get('onde', ''), a.get('defeito', ''))
        if chave not in grupos:
            grupos[chave] = dict(a, vezes=0)
        grupos[chave]['vezes'] += 1
    return list(grupos.values())


async def parte_a(nav):
    print('\n=== A. VITRINE: TODAS AS ABAS, SEÇÕES ABERTAS ===')
    for larg in LARGURAS:
        pg = await nav.new_page(viewport={'width': larg, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(VITRINE)
        await pg.wait_for_timeout(2500)
        abas = await pg.evaluate("() => [...document.querySelectorAll('.nav-tab[data-tab]')].map(t => t.dataset.tab)")
        achados = []
        for aba in abas:
            await abrir_aba(pg, aba)
            await abrir_recolhidos(pg, aba)
            await pg.wait_for_timeout(300)
            achados += [dict(a, aba=aba) for a in await pg.evaluate(SONDA, f'#tab-{aba}')]
        # as janelas do Pagamento de Frete que pedem data
        await abrir_aba(pg, 'frete')
        for nome, sel in (('Pagar carga', '#frete-tbody tr.frete-carga-linha td.frete-acoes button'),
                          ('Editar', '#frete-tbody tr.frete-carga-linha .frete-btn-editar'),
                          ('Pagar nota', '#frete-tbody .frete-btn-pagar-nota')):
            botao = pg.locator(sel).first
            if await botao.count() and await botao.is_visible():
                await botao.click()
                await pg.wait_for_timeout(500)
                achados += [dict(a, aba='frete/' + nome) for a in await pg.evaluate(SONDA, '#modal-frete')]
                await pg.keyboard.press('Escape')
                await pg.wait_for_timeout(200)
        achados = resumo(achados)
        ck(f'{larg}px: nenhuma data, hora ou duração partida ou cortada, nenhum campo de data estreito '
           f'({len(abas)} abas)', not achados, json.dumps(achados, ensure_ascii=False))
        ck(f'{larg}px: nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await pg.close()


# ------------------------------------------------------------ parte B
def psql(q):
    r = subprocess.run(['su', 'postgres', '-c', 'psql -q -tA -d embarque_suinco'], input=q, capture_output=True, text=True)
    return r.stdout.strip()


def http(c, token=None, metodo='GET', corpo=None):
    req = urllib.request.Request(f'{API}{c}', method=metodo)
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    d = None
    if corpo is not None:
        d = json.dumps(corpo).encode()
        req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, d, timeout=25) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or 'null')
        except Exception:
            return e.code, None


def operador(email, setor):
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True).stdout.strip()
    psql(f"DELETE FROM operadores WHERE email = '{email}';")
    psql(f"INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES ('{email}', '{setor} Teste', '{setor}', '{h}', true);")
    st, r = http('/auth/login', metodo='POST', corpo={'email': email, 'senha': SENHA})
    return (r or {}).get('token')


async def parte_b(nav):
    print('\n=== B. PAGAMENTO DE FRETE: PAGAR UMA NOTA E OLHAR A COLUNA PAGAMENTO ===')
    for t in ['pgfrete_eventos', 'pgfrete_leituras', 'pgfrete_pagamentos', 'pgfrete_pendencias', 'pgfrete_cargas']:
        psql(f'DELETE FROM {t};')
    tok = operador('frete.datas@teste.local', 'Pagamento de Frete')
    ck('operador do setor Pagamento de Frete criado', bool(tok))
    if not tok:
        return
    ctx = await nav.new_context()
    pg = await ctx.new_page()
    await pg.set_viewport_size({'width': 1600, 'height': 1000})
    html = PAINEL.read_text(encoding='utf-8').replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    url = API + '/__painel_teste'
    await pg.route(url, lambda rota: asyncio.ensure_future(rota.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.route('**/socket.io/socket.io.js', lambda rota: asyncio.ensure_future(
        rota.fulfill(status=200, content_type='application/javascript', body='')))
    await pg.goto(url)
    await pg.wait_for_timeout(1000)
    await pg.fill('#login-email', 'frete.datas@teste.local')
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(1500)

    await pg.click('#frete-btn-importar')
    await pg.wait_for_selector('#frete-arquivos', state='attached')
    await pg.set_input_files('#frete-arquivos', [str(PDFS / 'b2b_900802.pdf'), str(PDFS / 'sist_900802.pdf')])
    await pg.wait_for_selector('#modal-frete .frete-prev-ok', timeout=60000)
    await pg.click('#frete-btn-gravar')
    await pg.wait_for_timeout(2500)
    await pg.click('#frete-tbody tr.frete-primeira .frete-toggle')
    await pg.wait_for_timeout(500)
    notas = psql("SELECT string_agg(nota, ',' ORDER BY nota::bigint) FROM pgfrete_pendencias WHERE numero_carga='900802' "
                 "AND resolvida_em IS NULL AND categoria <> 'so_b2b'").split(',')
    linha = pg.locator(f'#frete-tbody tr.frete-nota[data-carga="900802"][data-nota="{notas[0]}"]')
    await linha.locator('select.frete-sel').select_option('OK')
    await pg.wait_for_timeout(2000)
    await linha.locator('td[data-col="dataPagamento"] button').click()
    await pg.wait_for_timeout(400)
    await pg.fill('#frete-pn-data', '2026-10-06')
    await pg.click('#frete-btn-pagar-nota')
    await pg.wait_for_timeout(2500)
    cel = linha.locator('td[data-col="dataPagamento"]')
    ck('a nota ficou paga com a data 06/10/2026', '06/10/2026' in (await cel.inner_text()), await cel.inner_text())

    for larg in LARGURAS:
        await pg.set_viewport_size({'width': larg, 'height': 1000})
        await pg.wait_for_timeout(500)
        achados = resumo(await pg.evaluate(SONDA, '#tab-frete'))
        ck(f'{larg}px: na aba inteira, nenhuma data partida ou cortada', not achados, json.dumps(achados[:4], ensure_ascii=False))
        g = await pg.evaluate("""(sel) => {
            const td = document.querySelector(sel); const selo = td && td.querySelector('.frete-selo-pago');
            if(!td || !selo) return { selo:false };
            const t = [...td.querySelector('.frete-nota-paga').childNodes].find(c => c.nodeType === 3 && /\\d{2}\\/\\d{2}/.test(c.textContent))
                   || td.querySelector('.frete-nota-paga .frete-data-txt');
            const rg = document.createRange(); rg.selectNodeContents(t.nodeType === 3 ? t : t);
            const d = rg.getBoundingClientRect(), s = selo.getBoundingClientRect(), c = td.getBoundingClientRect();
            return { selo:true, vao: Math.round(d.left - s.right), mesmaLinha: Math.abs((d.top + d.bottom) / 2 - (s.top + s.bottom) / 2) < 6 || d.top >= s.bottom - 1,
                     dentro: d.right <= c.right + 0.5 && d.left >= c.left - 0.5 };
        }""", f'#frete-tbody tr.frete-nota[data-nota="{notas[0]}"] td[data-col="dataPagamento"]')
        ck(f'{larg}px: o selo "paga" fica separado da data e a data dentro da célula',
           g.get('selo') and g['dentro'] and (g['vao'] >= 4 or not g['mesmaLinha']), str(g))
    await ctx.close()


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        await parte_a(nav)
        await parte_b(nav)
        await nav.close()
    print('\nRESULTADO:', 'OK' if not falhas else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
