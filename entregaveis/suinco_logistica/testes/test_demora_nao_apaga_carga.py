#!/usr/bin/env python3
"""Demora do servidor NÃO é recusa: o painel pergunta antes de apagar a carga.

INCIDENTE EM PRODUÇÃO, 11/09/2026, placa RYV8G03 — relato do dono com prints:
"criamos a carga, ficou offline, voltou, ela apareceu em Aguardando Carga sem
carga, o histórico tá completamente bugado". O Histórico mostrava QUATRO cargas
criadas para a mesma placa (12:04, 12:14, 12:23, 12:31), todas "não está mais
no painel". O rodapé registrava travamentos de até 46,5 s.

A CADEIA, lida no código:
  1. a tela congela (46 s) — o medidor ⏱ gravou;
  2. o painel espera 20 s por resposta; a resposta que chega durante o
     congelamento vira "timeout";
  3. `upsert()` trata timeout igual a "sem rede" → devolve offline;
  4. `sincronizarCarga` apaga a carga nunca-confirmada e a tela diz
     "VOCÊ ESTÁ OFFLINE — NADA FOI GRAVADO e a linha saiu da tela";
  5. mas o POST TINHA CHEGADO: o servidor gravou. O operador, obedecendo ao
     aviso, relançou — e a placa multiplicou.

A REGRA: demora não é recusa. Antes de dizer "nada foi gravado" numa CRIAÇÃO,
o painel pergunta ao servidor se a carga existe. Se existe, ela fica e vira
confirmada. Se o servidor diz que não, ou não responde, aí sim vale a regra
de 31/08 (offline: a linha sai e a pessoa refaz). Recusa de verdade
(422/409/403) continua removendo, como test_carga_recusada_nao_fica_fantasma
já trava.

    python3 testes/test_demora_nao_apaga_carga.py
"""
import asyncio, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


FIXTURE = """
  window.__avisos = [];
  const _notify = window.notify;
  window.notify = (msg, ...r) => { window.__avisos.push(String(msg)); return _notify ? _notify(msg, ...r) : null; };
  window.__fetchFalso = ({ postFalha, estadoTem, estadoFalha }) => {
    window.fetch = async (url, opts) => {
      const u = String(url), m = (opts?.method || 'GET').toUpperCase();
      const json = (o, status=200) => new Response(JSON.stringify(o), { status, headers: {'content-type':'application/json'} });
      if (/\\/api\\/cargas$/.test(u) && m === 'POST') {
        if (postFalha === 'timeout') { const e = new Error('abortado'); e.name = 'AbortError'; throw e; }
        if (postFalha === 422) return json({ erro: 'Placa não está cadastrada na Frota.', codigo: 'PLACA_FORA_DA_FROTA' }, 422);
        const corpo = JSON.parse(opts.body || '{}');
        return json({ id: corpo.id, versao: 1 }, 201);
      }
      if (/\\/api\\/estado/.test(u)) {
        if (estadoFalha) throw new TypeError('Failed to fetch');
        return json({ cargas: estadoTem ? [{ id: estadoTem, placa: 'X', versao: 3, status: 'Aguardando Veículo' }] : [],
                      movimentacoes: [], log: [], marca: 'm1' });
      }
      return json({});
    };
  };
"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL); await pg.wait_for_timeout(900)
        await pg.evaluate("() => { sessionStorage.setItem('suinco_token', 'token-de-teste'); }")
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Gestor')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(400)
        await pg.evaluate("() => {" + FIXTURE + "}")

        async def criar_com(cenario, placa_idx):
            return await pg.evaluate("""async ([cen, idx]) => {
              DB.cargas = []; DB.movimentacoes = []; window.__avisos = [];
              const f = DB.frota[idx];
              window.__fetchFalso(cen);
              const carga = criarCargaProgramada({ placa: f.placa, numeroCarga: '9900' + idx, peso: 9000, rota: '500', operador: 'Gestor' });
              const id = carga.id;
              // o servidor "tem" a carga com o id que acabou de nascer
              if (cen.estadoTem === true) window.__fetchFalso(Object.assign({}, cen, { estadoTem: id }));
              await new Promise(r => setTimeout(r, 900));
              const c = DB.cargas.find(x => x.id === id);
              return { id, continua: !!c, confirmada: c ? !c._nuncaConfirmada : null, versao: c ? c.versao : null,
                       disseNadaGravado: window.__avisos.some(a => /NADA FOI GRAVADO/i.test(a)),
                       disseOffline: window.__avisos.some(a => /OFFLINE/i.test(a)),
                       estado: (typeof SuincoSharePoint.estado === 'function') ? SuincoSharePoint.estado() : null };
            }""", [cenario, placa_idx])

        print('\n=== 1. O INCIDENTE: o POST "demora", mas o servidor GRAVOU ===')
        d = await criar_com({'postFalha': 'timeout', 'estadoTem': True, 'estadoFalha': False}, 0)
        ck('a carga CONTINUA na tela', d['continua'] is True, str(d))
        ck('e vira confirmada — o servidor a tem', d['confirmada'] is True, str(d))
        ck('com a versão que o servidor devolveu', d['versao'] == 3, str(d['versao']))
        ck('NÃO diz "NADA FOI GRAVADO"', d['disseNadaGravado'] is False, str(d['disseNadaGravado']))
        ck('NÃO se declara offline por causa da demora', d['disseOffline'] is False, str(d['disseOffline']))

        print('\n=== 2. DEMORA E O SERVIDOR DIZ QUE NÃO TEM: aí sim é a regra de 31/08 ===')
        d = await criar_com({'postFalha': 'timeout', 'estadoTem': False, 'estadoFalha': False}, 1)
        ck('a linha sai da tela (nunca existiu no servidor)', d['continua'] is False, str(d))
        ck('e a pessoa é avisada para refazer', d['disseNadaGravado'] is True or d['disseOffline'] is True, str(d))

        print('\n=== 3. A PRÓPRIA CONFERÊNCIA FALHA: fica INCERTA, não some (regra corrigida) ===')
        # ESTA REGRA MUDOU DE PROPÓSITO no mesmo dia, com uma segunda volta do
        # incidente. A versão original deste bloco dizia "offline de verdade,
        # remove" — e foi exatamente essa decisão que apagou a carga de
        # verdade quando aconteceu com a RYV8G03 outra vez: a conferência do
        # #48 caiu por sua vez (servidor lento, não rede fora do ar), e "não
        # consegui perguntar" foi tratado como "a resposta é não". Diferença
        # que passou a importar: a conferência RESPONDEU e disse que não tem
        # (bloco 2, continua removendo) × a conferência NEM CONSEGUIU
        # responder (aqui — fica incerta, nunca remove).
        d = await criar_com({'postFalha': 'timeout', 'estadoTem': False, 'estadoFalha': True}, 2)
        ck('a carga CONTINUA na tela — incerteza nunca é "não existe"', d['continua'] is True, str(d))
        ck('e o painel avisa que vai tentar de novo, não que sumiu',
           d['disseNadaGravado'] is False and d['disseOffline'] is False, str(d))

        print('\n=== 4. RECUSA DE VERDADE CONTINUA REMOVENDO (guarda de 07/08) ===')
        d = await criar_com({'postFalha': 422, 'estadoTem': True, 'estadoFalha': False}, 3)
        ck('recusa 422 remove a carga sem perguntar nada', d['continua'] is False, str(d))
        ck('nenhum erro de JavaScript', not erros, str(erros[:1]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)


asyncio.run(main())
