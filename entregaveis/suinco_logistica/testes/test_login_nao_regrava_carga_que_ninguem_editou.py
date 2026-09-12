#!/usr/bin/env python3
"""Login (ou qualquer leitura remota) dispara gravação espontânea em TODA carga.

CAUSA RAIZ PROVADA, em `data.js`, dentro de `fundirEstadoRemoto`:

  1. (linhas 1321-1338) mescla `dados.frota` chamando `upsertFrota(...)` por
     placa — isso acontece em TODO login/reconexão completa (a frota só vem
     na carga inicial).
  2. (linha 1606), dentro de `upsertFrota`, chama `SuincoStore.save()` SEM
     CONDIÇÃO, inclusive quando a origem é o servidor. A exceção
     `origem==='sharepoint'` (linhas 1619-1631) só evita REENVIAR a FROTA —
     não protege as CARGAS de nada.
  3. Esse `save()` dispara `sincronizarCargasAlteradas()` (linha 741). No
     guard da linha 756 (`if(!c._nuncaConfirmada && this._ultimoSync.get(c.id)
     === marca) return;`), `_ultimoSync` AINDA ESTÁ VAZIO para as cargas que
     o PRÓPRIO `fundirEstadoRemoto` acabou de empurrar (`!local` → `DB.cargas
     .push(carga)`, linha 1212) — porque o bloco que estampa `_ultimoSync`
     (linhas 1372-1384) só roda DEPOIS de mesclar frota e rotas.
  4. Resultado: TODA carga que chegou nesta leitura parece "nunca
     sincronizada" e leva um `PATCH /api/cargas/:id` espontâneo — sem
     ninguém ter editado nada.
  5. `upsertRota` (linha 224, chamada na linha 1348) tem o MESMO defeito, e
     roda em toda carga de página (`ultimaBuscaDeRotas` zera a cada load —
     suinco-api.js:1218-1219).
  6. No servidor, `tg_viagem_update` (migrations/001_schema.sql:181-191)
     incrementa `versao` em TODO UPDATE, mesmo gravando valor idêntico — o
     PATCH espontâneo bumpa a versão de verdade.
  7. Qualquer outro terminal que leu a carga ANTES do eco recebe 409
     CONFLITO_DE_VERSAO (cargas.js:898-912) ao gravar uma edição LEGÍTIMA.

NÚMEROS MEDIDOS (reprodução real, não hipótese, pela frente que investigou):
  · 20 cargas, Faturamento faz login sem editar nada → 20 PATCH enviados,
    versão no servidor passou de 1 para 2 em todas;
  · cenário fiel ao relato: {200:69, 429:157, 409:45}, `_notifFila.length`
    43 — o print do dono mostrava "+41";
  · Expedição gravando em cargas RECÉM-CRIADAS que ninguém tinha tocado
    levou 409 em 45 de 45 tentativas, só por causa do eco do login do
    Faturamento segundos antes.

ATENÇÃO — MESMO BLOCO DO "DEFEITO 2" (perda de dado calada), ÂNGULO
DIFERENTE: este teste trava O MOMENTO em que o bloco de `fundirEstadoRemoto`
estampa `_ultimoSync` (tarde demais — depois das mesclagens de frota e
rotas). `test_pendencia_local_nao_e_dada_por_sincronizada.py` trava QUAIS
cargas ele estampa (todas, inclusive as com `_pendente`). Uma correção que
resolva só um dos dois ângulos tem que continuar reprovando no OUTRO
arquivo — por isso os dois ficam em testes separados, e nenhum dos dois
verifica a ordem das linhas em si: os dois medem o RESULTADO observável
(chamada de rede / marca de sincronia), que é o que sobrevive a qualquer
jeito de reescrever o bloco.

O QUE ESTE TESTE TRAVA (e hoje reprova)
  1. receber frota + rotas + cargas numa leitura completa (login,
     reconexão) SEM nenhuma edição do operador tem que resultar em ZERO
     chamadas de gravação (`POST`/`PATCH /api/cargas`) — hoje resulta em
     uma POR CARGA nova;
  2. a MARCA de sincronia (`SuincoStore._ultimoSync`) tem que refletir que
     essas cargas JÁ estão em dia assim que chegam — não pode sobrar uma
     janela em que elas parecem "nunca sincronizadas".

    python3 testes/test_login_nao_regrava_carga_que_ninguem_editou.py
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


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL); await pg.wait_for_timeout(900)
        await pg.evaluate("() => { sessionStorage.setItem('suinco_token', 'token-de-teste'); }")
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Diego')
        await pg.select_option('#login-setor', 'Faturamento')
        await pg.click('button:has-text(\"Entrar sem servidor\")')
        await pg.wait_for_timeout(400)

        print('\n=== 1. LEITURA COMPLETA (LOGIN) TRAZ 5 CARGAS + FROTA + ROTAS — NINGUÉM EDITOU NADA ===')
        d = await pg.evaluate("""async () => {
          DB.cargas = [];
          SuincoStore._ultimoSync = new Map();
          DB._sincronizado = {};
          SuincoStore._emVoo = new Map();
          SuincoStore._refazer = new Set();

          window.__chamadas = [];
          window.fetch = async (url, opts) => {
            const corpo = opts && opts.body ? JSON.parse(opts.body) : {};
            const metodo = (opts && (opts.method || opts.metodo)) || 'GET';
            window.__chamadas.push({ url: String(url), metodo, id: corpo.id });
            const json = (o, status=200) => new Response(JSON.stringify(o), { status, headers: {'content-type':'application/json'} });
            // Toda carga que chega nesta leitura JÁ existe no servidor —
            // é de lá que ela veio. O POST devolve 200 ("já existia"), que é
            // o que faz upsert() seguir para o PATCH — o PATCH é o eco.
            if (/\\/api\\/cargas$/.test(String(url)) && metodo.toUpperCase() === 'POST') {
              return json({ id: corpo.id }, 200);
            }
            if (/\\/api\\/cargas\\//.test(String(url))) {
              return json({ id: corpo.id, versao: 2 });
            }
            return json({});
          };

          const agora = new Date().toISOString();
          const cargasRemotas = [0, 1, 2, 3, 4].map(i => ({
            Carga_ID: 'login_carga_' + i, Numero_Carga: 'LOGIN-' + i,
            Placa: 'AAA' + i + 'A11', Status_Atual: 'Aguardando Veículo',
            Criado_Em: agora, Atualizado_Em: agora,
          }));

          fundirEstadoRemoto({
            cargas: cargasRemotas,
            movimentacoes: [],
            // A frota é o GATILHO: ela chega em toda leitura COMPLETA
            // (login) e dispara o save() espontâneo dentro de upsertFrota.
            frota: [{ Placa: 'ZZZ9Z99', Transportadora: 'Transportadora Teste', Tipo_Veiculo: 'Truck' }],
            rotas: [{ Codigo: '500', Nome: 'Rota Teste', Detalhe: '', Operador: '' }],
          });

          await new Promise(r => setTimeout(r, 1200));

          const chamadasDeCarga = window.__chamadas.filter(c => /\\/api\\/cargas/.test(c.url));
          return {
            qtdCargasChegaram: DB.cargas.length,
            chamadasDeCarga,
            marcasJaEstampadas: cargasRemotas.map(c => SuincoStore._ultimoSync.get(c.Carga_ID)),
          };
        }""")
        ck('as 5 cargas da leitura completa chegaram ao painel', d['qtdCargasChegaram'] == 5, str(d['qtdCargasChegaram']))
        ck('ZERO chamadas de gravação (POST/PATCH) para cargas que ninguém editou — só leu',
           len(d['chamadasDeCarga']) == 0, str(d['chamadasDeCarga']))
        ck('a marca de sincronia já reflete "em dia" assim que a carga chega (sem janela de eco)',
           all(m is not None for m in d['marcasJaEstampadas']), str(d['marcasJaEstampadas']))

        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)


asyncio.run(main())
