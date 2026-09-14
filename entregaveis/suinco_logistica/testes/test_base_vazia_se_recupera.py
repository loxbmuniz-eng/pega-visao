#!/usr/bin/env python3
"""Marca de sincronia sem base local = leitura COMPLETA (14/09/2026).

RELATO DO DONO, em duas partes:
  "a torre ta aparecendo zerada pra mim e na verdade tem 4 cargas em Barretos"
  "quando eu abro no computador da suinco ta aparecendo zerada a torre de
   controle mas aqui do meu mac quando entro no painel ta funcionando direito"

Mesma base, mesmo servidor, máquinas diferentes — logo, estado LOCAL.

O MECANISMO: a marca de sincronia e os dados do pátio moram em chaves
SEPARADAS do navegador, e `guardarMarca` engole erro. A marca é um carimbo; os
dados são megabytes. Quando a cota do navegador estoura, os dados falham ao
salvar (data.js já documentava: "o save() falhava SÓ NO CONSOLE") e a marca
salva do mesmo jeito. Na abertura seguinte a base está vazia e a marca
presente, então toda leitura pede `?desde=<marca>` — só o que mudou — e a base
NUNCA se enche. A Torre desenha a partir dela: zero.

E NÃO HAVIA RECUPERAÇÃO. login() -> iniciar() -> sincronizarAgora() ->
pull(true), incremental. Sair e entrar não resolvia. Só limpar os dados do
site. O terminal ficava cego, calado.

O QUE ESTE TESTE TRAVA:
  1. base vazia + marca presente -> a leitura vai SEM `?desde=` (completa);
  2. depois de recuperar, volta a ser incremental — um painel legitimamente
     sem carga não pode virar leitura completa a cada 15s, que seria trocar um
     terminal cego por uma rajada em todos;
  3. base cheia + marca -> incremental, como sempre foi.
"""
import asyncio, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []
def ck(nome, ok, extra=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {extra}" if extra else ''))
    if not ok: falhas.append(nome)

# Observa as URLs pedidas e responde estado vazio — o que interessa é a URL.
PREPARO = """() => {
  window.__urls = [];
  localStorage.setItem('suinco_token', 'token-de-teste');
  localStorage.setItem('suinco_marca_sync', '2026-09-14T10:00:00.000Z');
  SuincoSharePoint.SP_CONFIG.ativo = true;
  SuincoSharePoint.SP_CONFIG.api = 'https://api.embarquesuinco.com.br';
  window.fetch = async (url, opc) => {
    const u = String(url); window.__urls.push(u);
    const corpo = u.includes('/api/estado')
      ? { marca: '2026-09-14T11:00:00.000Z', completo: !u.includes('desde='),
          cargas: [], movimentacoes: [] }
      : {};
    return { ok: true, status: 200, json: async () => corpo,
             text: async () => JSON.stringify(corpo) };
  };
}"""

async def main():
    print('\n=== MARCA SEM BASE: A LEITURA TEM QUE SER COMPLETA ===')
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL); await pg.wait_for_timeout(1300)
        await pg.evaluate(PREPARO)

        # A marca existe; a base está vazia. É o computador da Suinco.
        r1 = await pg.evaluate("""async () => {
            DB.cargas = [];
            window.__urls = [];
            await SuincoSharePoint.pull(true);
            return window.__urls.filter(u => u.includes('/api/estado'));
        }""")
        completa = any('desde=' not in u for u in r1)
        ck('com a base vazia, a leitura vai SEM "desde" — o pátio inteiro',
           completa, str(r1))

        # Uma vez por abertura: com a base ainda vazia (operação parada de
        # verdade), a leitura seguinte NÃO pode virar completa de novo.
        r2 = await pg.evaluate("""async () => {
            DB.cargas = [];
            window.__urls = [];
            await SuincoSharePoint.pull(true);
            return window.__urls.filter(u => u.includes('/api/estado'));
        }""")
        ck('e a leitura SEGUINTE volta a ser incremental — não vira rajada',
           all('desde=' in u for u in r2), str(r2))

        ck('nenhum erro de JavaScript', not erros, str(erros[:1]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)

asyncio.run(main())
