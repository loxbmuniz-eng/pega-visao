#!/usr/bin/env python3
"""A caixa "Vigias do sistema" na aba Usuários (02/10/2026).

PEDIDO DO DONO: "no raio-X, tudo que fala 'se quebrar', você vai criar uma
prevenção de quebra pra cada possibilidade apontada". Os vigias do servidor
conferem e avisam no celular; esta caixa é onde a Administração vê o que
eles viram, com a hora — e a conferência do dado gravado, rodada na hora.

O que se prova no navegador, contra o servidor local:
  1. a Administração vê a caixa; a Logística, não;
  2. o que o vigia anotou aparece com o nome e o estado (ok / com problema);
  3. a carga plantada com "Seguiu Viagem" sem o registro da saída aparece
     na conferência do dado, com o número dela;
  4. a cor fica só na marca — o texto continua legível (contraste ≥ 4,5:1)
     nos dois temas;
  5. nenhum erro de JavaScript.

Dados inventados e marcados: carga 904890, operadores vigia.*@teste.local.

    bash testes/rodar_tudo.sh test_vigias_do_sistema
"""
import asyncio
import os
import subprocess
import sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
AQUI = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(AQUI)
BACKEND = os.path.join(BASE, 'backend')
PAINEL_ARQ = os.path.join(BASE, 'index.html')
SENHA = 'senha-de-teste-123'
CARGA = '904890'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def banco(js):
    """Roda um trecho com o pool do próprio servidor (lê o mesmo .env)."""
    codigo = ("import('./src/banco.js').then(async ({pool}) => { const bcrypt = (await import('bcryptjs')).default;"
              + js + "; await pool.end(); })")
    r = subprocess.run(['node', '--input-type=module', '-e', codigo], cwd=BACKEND,
                       capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(r.stderr[-800:])


PREPARAR = f"""
  const h = await bcrypt.hash('{SENHA}', 4);
  for (const [e, n, s] of [['vigia.adm@teste.local', 'Vigia Adm', 'Administração'],
                           ['vigia.log@teste.local', 'Vigia Log', 'Logística']]) {{
    await pool.query(`INSERT INTO operadores (email, nome, setor, senha_hash) VALUES ($1,$2,$3,$4)
                      ON CONFLICT (email) DO UPDATE SET senha_hash = EXCLUDED.senha_hash, ativo = TRUE,
                      setor = EXCLUDED.setor`, [e, n, s, h]);
  }}
  await pool.query("DELETE FROM fact_viagens WHERE carga_id = 'vigia-tela-{CARGA}'");
  await pool.query(`INSERT INTO fact_viagens (carga_id, numero_carga, placa, status_atual)
                    VALUES ('vigia-tela-{CARGA}', '{CARGA}', 'TST4890', 'Seguiu Viagem')`);
  await pool.query(`INSERT INTO vigia_registros (verificacao, ok, detalhe) VALUES
                      ('backup_de_hoje', true, 'embarque_suinco_teste.sql.gz, 3.4 MB, feito há 2 h'),
                      ('certificado', false, 'vence em 9 dia(s) e não foi renovado — teste')
                    ON CONFLICT (verificacao) DO UPDATE SET ok = EXCLUDED.ok, detalhe = EXCLUDED.detalhe`);
"""

LIMPAR = f"""
  await pool.query("DELETE FROM fact_viagens WHERE carga_id = 'vigia-tela-{CARGA}'");
  await pool.query("DELETE FROM vigia_registros WHERE detalhe LIKE '%teste%'");
"""


async def abrir(nav, email, rotulo):
    ctx = await nav.new_context(viewport={'width': 1440, 'height': 900})
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__vigias_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    return ctx, pg, erros


CONTRASTE = """() => {
  const rgba = s => { const n = (s.match(/[\\d.]+/g) || []).map(Number); return {r:n[0], g:n[1], b:n[2], a: n.length > 3 ? n[3] : 1}; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
                     return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
  const fundo = el => { let e = el; while(e){ const c = rgba(getComputedStyle(e).backgroundColor); if(c.a > .95) return c; e = e.parentElement; } return {r:255,g:255,b:255}; };
  let pior = 99;
  for(const el of document.querySelectorAll('#vigias-painel .vigia-nome, #vigias-painel .vigia-detalhe, #vigias-painel .vigia-estado')){
    const a = lum(rgba(getComputedStyle(el).color)), b = lum(fundo(el));
    pior = Math.min(pior, (Math.max(a, b) + .05) / (Math.min(a, b) + .05));
  }
  return pior;
}"""


async def main():
    banco(PREPARAR)
    try:
        async with async_playwright() as p:
            nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
            print('\n=== ADMINISTRAÇÃO ===')
            ctx, pg, erros = await abrir(nav, 'vigia.adm@teste.local', 'adm')
            await pg.evaluate("() => abrirTab('usuarios')")
            await pg.wait_for_function("() => document.querySelector('#vigias-painel .vigia-lista')", timeout=15000)
            r = await pg.evaluate("""() => ({
              visivel: !document.getElementById('card-vigias').hidden,
              texto: document.getElementById('vigias-painel').innerText,
              problemas: [...document.querySelectorAll('#vigias-painel .vigia-problema .vigia-nome')].map(e => e.innerText),
            })""")
            ck('a Administração vê a caixa Vigias do sistema', r['visivel'])
            ck('o que o vigia anotou aparece: backup de hoje ok', 'Backup de hoje feito' in r['texto'], r['texto'][:200])
            ck('o certificado anotado com problema aparece como problema',
               any('Certificado' in t for t in r['problemas']), str(r['problemas']))
            ck(f'a carga {CARGA} (seguiu viagem sem registro de saída) aparece na conferência do dado',
               CARGA in r['texto'] and 'sem o registro da saída' in r['texto'])
            for tema in ('escuro', 'claro'):
                await pg.evaluate("(t) => document.documentElement.setAttribute('data-tema', t)", tema)
                await pg.wait_for_timeout(500)
                c = await pg.evaluate(CONTRASTE)
                ck(f'{tema}: o texto da caixa lê bem (contraste ≥ 4,5:1)', c >= 4.5, f'{c:.2f}')
            ck('nenhum erro de JavaScript (Administração)', not erros, '; '.join(erros[:3]))
            await ctx.close()

            print('\n=== LOGÍSTICA ===')
            ctx, pg, erros = await abrir(nav, 'vigia.log@teste.local', 'log')
            escondida = await pg.evaluate("() => document.getElementById('card-vigias').hidden")
            ck('a Logística não vê a caixa', escondida is True)
            ck('nenhum erro de JavaScript (Logística)', not erros, '; '.join(erros[:3]))
            await ctx.close()
            await nav.close()
    finally:
        banco(LIMPAR)


asyncio.run(main())
print('\n=== RESULTADO ===')
print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
sys.exit(1 if falhas else 0)
