#!/usr/bin/env python3
"""Limite que disparou ATRASADO não é o servidor — é a página. O painel repete em vez de se declarar offline.

INCIDENTE DE 11/09/2026 (ocorrência #48): o painel alternava "Modo Offline" e
"Conectado" com internet e servidor de pé. Medido em prova própria: uma caixa
de diálogo do navegador (`confirm`) ou um congelamento param o relógio da
página; a resposta do servidor que chegou em 0,3 s só é processada quando a
página volta — DEPOIS do temporizador de 20 s, que dispara junto. O painel lia
isso como "o servidor não respondeu" e se declarava offline.

A REGRA: o temporizador sabe a que hora devia disparar. Se disparou 2 s ou mais
depois da hora, quem travou foi a PÁGINA, não o servidor — e a leitura é
repetida uma vez, agora, em vez de virar offline. Se disparou na hora certa, o
servidor demorou mesmo, e vale o de sempre.

    python3 testes/test_limite_atrasado_nao_e_offline.py
"""
import asyncio, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


CENARIO = """async (travaAPagina) => {
  SuincoSharePoint.SP_CONFIG.ativo = true;
  SuincoSharePoint.SP_CONFIG.api = 'http://servidor.falso';
  SuincoSharePoint.SP_CONFIG.timeoutMs = 300;
  sessionStorage.setItem('suinco_token', 'token-de-teste');
  DB.operador = {nome:'Gestor', setor:'Logística'};
  let chamadasEstado = 0;
  window.fetch = async (url, opts) => {
    const u = String(url);
    const json = (o) => new Response(JSON.stringify(o), { status: 200, headers: {'content-type':'application/json'} });
    if (/\\/api\\/estado/.test(u)) {
      chamadasEstado++;
      if (chamadasEstado === 1) {
        if (travaAPagina) { const t0 = Date.now(); while (Date.now() - t0 < 2600) {} }   // diálogo / congelamento
        return new Promise((_, rej) => opts.signal.addEventListener('abort', () => {
          const e = new Error('abortado'); e.name = 'AbortError'; rej(e); }));
      }
      return json({ cargas: [], movimentacoes: [], log: [], marca: 'm-ok', completo: true });
    }
    return json({});
  };
  SuincoSharePoint.mudarEstado && SuincoSharePoint.mudarEstado('online');
  await SuincoSharePoint.sincronizarAgora();
  await new Promise(r => setTimeout(r, 200));
  return { chamadasEstado, estado: SuincoSharePoint.estado(), faixaOffline: !!document.querySelector('.faixa-offline:not([hidden])') };
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL); await pg.wait_for_timeout(900)

        print('\n=== 1. A PÁGINA TRAVOU 2,6 s COM A LEITURA EM VOO — o limite disparou atrasado ===')
        r = await pg.evaluate(CENARIO, True)
        ck('o painel repetiu a leitura uma vez', r['chamadasEstado'] == 2, str(r))
        ck('e NÃO se declarou offline', r['estado'] != 'offline', str(r['estado']))

        print('\n=== 2. O SERVIDOR DEMOROU MESMO — o limite disparou na hora ===')
        r = await pg.evaluate(CENARIO, False)
        ck('sem repetição cega', r['chamadasEstado'] == 1, str(r))
        ck('offline, como sempre foi', r['estado'] == 'offline', str(r['estado']))
        ck('nenhum erro de JavaScript', not erros, str(erros[:1]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)


asyncio.run(main())
