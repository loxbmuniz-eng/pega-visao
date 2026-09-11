#!/usr/bin/env python3
"""Incerteza de rede não apaga carga — só recusa de verdade apaga.

INCIDENTE EM PRODUÇÃO, 11/09/2026, placa RYV8G03 — segunda volta do mesmo
defeito da ocorrência #48. A correção anterior fez upsert() conferir com o
servidor ANTES de dizer "não gravou" numa criação — mas essa ÚNICA
conferência também pode falhar (servidor lento, rede ruim no instante
exato). Quando falhava, `r.offline` chegava `true` sem o servidor ter
recusado nada — era "não sei", não "não" — e a carga era apagada da tela
mesmo assim. Relato do dono: "ela não entra na fila de programados, ela
some".

A REGRA NOVA: só remove por RECUSA DE VERDADE (422/409/403 — a placa está
fora da Frota, o setor não pode criar). Incerteza de rede NUNCA remove: a
carga fica, marcada como não confirmada, e a PRÓPRIA sincronia periódica
tenta de novo sozinha — sem isso a mensagem "vou tentar de novo" seria
mentira, porque o motor de sincronia marcava a carga como "já tentei" antes
de saber se deu certo, e nunca mais reenviava.

O QUE ESTE TESTE TRAVA
  1. incerteza de rede (offline) numa criação NÃO remove a carga;
  2. a mensagem diz a verdade — "continua na tela", não "saiu da tela";
  3. recusa de verdade (422 placa fora da Frota) continua removendo, como
     sempre foi;
  4. a sincronia SEGUINTE, com o servidor respondendo bem, confirma a carga
     sozinha — sem o operador precisar relançar nada.

    python3 testes/test_incerteza_nao_apaga_carga.py
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
  window.__cenario = null;
  window.fetch = async (url, opts) => {
    const u = String(url), m = (opts?.method || 'GET').toUpperCase();
    const json = (o, status=200) => new Response(JSON.stringify(o), { status, headers: {'content-type':'application/json'} });
    if (/\\/api\\/cargas$/.test(u) && m === 'POST') {
      const c = window.__cenario;
      if (c === 'timeout-depois-incerto') { const e = new Error('abortado'); e.name = 'AbortError'; throw e; }
      if (c === 'recusa-de-verdade') return json({ erro: 'Placa não está cadastrada na Frota.', codigo: 'PLACA_FORA_DA_FROTA' }, 422);
      const corpo = JSON.parse(opts.body || '{}');
      return json({ id: corpo.id, versao: 1 }, 201);
    }
    if (/\\/api\\/estado/.test(u)) {
      // a conferência do #48 TAMBÉM falha — é o caso exato do incidente
      const e = new Error('abortado'); e.name = 'AbortError'; throw e;
    }
    return json({});
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

        print('\n=== 1. A CONFERÊNCIA TAMBÉM FALHA — INCERTEZA, NÃO REMOVE ===')
        d = await pg.evaluate("""async () => {
          DB.cargas = []; DB.movimentacoes = []; window.__avisos = [];
          const f = DB.frota[0];
          window.__cenario = 'timeout-depois-incerto';
          const carga = criarCargaProgramada({ placa: f.placa, numeroCarga: '99001', peso: 9000, rota: '500', operador: 'Gestor' });
          const id = carga.id;
          await new Promise(r => setTimeout(r, 900));
          const c = DB.cargas.find(x => x.id === id);
          return { id, continua: !!c, nuncaConfirmada: c ? !!c._nuncaConfirmada : null,
                   disseSaiuDaTela: window.__avisos.some(a => /saiu da tela/i.test(a)),
                   disseContinuaTela: window.__avisos.some(a => /CONTINUA na tela/i.test(a)),
                   disseNaoConsegui: window.__avisos.some(a => /NÃO CONSEGUI CONFIRMAR/i.test(a)) };
        }""")
        ck('a carga CONTINUA na tela', d['continua'] is True, str(d))
        ck('segue marcada como não confirmada (pra sincronia retomar)', d['nuncaConfirmada'] is True, str(d))
        ck('a mensagem NÃO diz "saiu da tela" (seria mentira)', d['disseSaiuDaTela'] is False, str(d))
        ck('a mensagem diz que continua na tela', d['disseContinuaTela'] is True, str(d))
        ck('e que não conseguiu confirmar (não que o servidor recusou)', d['disseNaoConsegui'] is True, str(d))

        print('\n=== 2. A SINCRONIA SEGUINTE CONFIRMA SOZINHA (sem o operador relançar) ===')
        e = await pg.evaluate("""async () => {
          window.__cenario = 'sucesso'; // agora o servidor responde bem
          window.fetch = async (url, opts) => {
            const u = String(url), m = (opts?.method || 'GET').toUpperCase();
            const json = (o, status=200) => new Response(JSON.stringify(o), { status, headers: {'content-type':'application/json'} });
            if (/\\/api\\/cargas\\/[^/]+$/.test(u) && m === 'PATCH') return json({ id: u.split('/').pop(), versao: 3 });
            if (/\\/api\\/cargas$/.test(u) && m === 'POST') { const corpo = JSON.parse(opts.body||'{}'); return json({ id: corpo.id, versao: 3 }, 200); }
            return json({});
          };
          // O gatilho real: fundirEstadoRemoto chama SuincoStore.save() toda vez
          // que chega QUALQUER dado novo do servidor — o que acontece o tempo
          // todo num pátio ativo (outro operador mexendo em algo, o pull de
          // 15s). Simula exatamente esse gatilho, não uma chamada direta.
          //
          // O RECUO ENTRE TENTATIVAS (11/09/2026, achado no mesmo dia — a
          // carga "118684" virando aviso repetindo sem parar) segura a
          // PRIMEIRA retentativa por alguns segundos de propósito. Adiantar
          // o relógio da carga é a forma correta de testar "depois que o
          // recuo passar", sem esperar de verdade.
          const alvo = DB.cargas[0];
          if(alvo) alvo._proximaTentativaEm = Date.now() - 1;
          SuincoStore.save();
          await new Promise(r => setTimeout(r, 400));
          const c = DB.cargas[0];
          return { nuncaConfirmada: c ? !!c._nuncaConfirmada : null, versao: c ? c.versao : null };
        }""")
        ck('confirmou sozinha na sincronia seguinte — sem ação do operador',
           e['nuncaConfirmada'] is False, str(e))

        print('\n=== 3. RECUSA DE VERDADE CONTINUA REMOVENDO (guarda de 07/08) ===')
        d3 = await pg.evaluate("""async () => {
          DB.cargas = []; DB.movimentacoes = []; window.__avisos = [];
          const f = DB.frota[1];
          window.__cenario = 'recusa-de-verdade';
          window.fetch = async (url, opts) => {
            const u = String(url), m = (opts?.method || 'GET').toUpperCase();
            const json = (o, status=200) => new Response(JSON.stringify(o), { status, headers: {'content-type':'application/json'} });
            if (/\\/api\\/cargas$/.test(u) && m === 'POST') return json({ erro: 'Placa não está cadastrada na Frota.', codigo: 'PLACA_FORA_DA_FROTA' }, 422);
            return json({});
          };
          const carga = criarCargaProgramada({ placa: f.placa, numeroCarga: '99002', peso: 9000, rota: '500', operador: 'Gestor' });
          const id = carga.id;
          await new Promise(r => setTimeout(r, 500));
          return { continua: !!DB.cargas.find(x => x.id === id),
                   disseRemovida: window.__avisos.some(a => /removida da tela/i.test(a)) };
        }""")
        ck('recusa de verdade REMOVE a carga, como sempre', d3['continua'] is False, str(d3))
        ck('e avisa que foi removida por recusa (não por incerteza)', d3['disseRemovida'] is True, str(d3))
        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)


asyncio.run(main())
