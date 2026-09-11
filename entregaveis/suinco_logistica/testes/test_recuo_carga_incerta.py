#!/usr/bin/env python3
"""Carga incerta tenta de novo com recuo — não em rajada, e o aviso não repete a cada tentativa.

RELATO DO DONO, minutos depois de publicada a correção #53: "118684 sistema
offline". 118684 é o número da carga do INCIDENTE ORIGINAL desta manhã — uma
carga presa como `_nuncaConfirmada` desde antes de qualquer correção de hoje
existir. A correção #53 fez a sincronia tentar de novo enquanto não confirmar
(certo), mas sem limite de frequência: `fundirEstadoRemoto` chama `save()`
toda vez que chega dado novo do servidor — o tempo todo num pátio ativo — e
cada `save()` disparava outra tentativa. Uma carga velha, presa e sem jeito
de confirmar, virou aviso repetindo sem parar.

O QUE ESTE TESTE TRAVA
  1. logo após uma tentativa falhar (incerta), a PRÓXIMA sincronia (outro
     save() imediato) NÃO tenta de novo — o recuo está de pé;
  2. passado o tempo do recuo, ela tenta de novo;
  3. o recuo CRESCE a cada tentativa nova (não fica preso em 5s pra sempre);
  4. o aviso NÃO aparece a cada tentativa — só na primeira e depois de
     longe em longe, com o texto mudando de tom depois de muitas tentativas;
  5. confirmando com sucesso, os contadores somem e ela volta a sincronizar
     normalmente (sem recuo pendurado).

    python3 testes/test_recuo_carga_incerta.py
"""
import asyncio, sys
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
        await pg.fill('#login-nome', 'Gestor')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(400)

        print('\n=== 1. UMA CARGA VELHA E PRESA (o caso "118684") ===')
        r = await pg.evaluate("""async () => {
          window.__avisos = [];
          const _notify = window.notify;
          window.notify = (msg, ...r) => { window.__avisos.push(String(msg)); return _notify ? _notify(msg, ...r) : null; };
          window.fetch = async (url) => { const e = new Error('abortado'); e.name = 'AbortError'; throw e; };

          const f = DB.frota[0];
          const carga = { id: 'carga_antiga_118684', numeroCarga: '118684', placa: f.placa,
            transportadora: f.transportadora, tipoVeiculo: f.tipoVeiculo, status: 'Aguardando Veículo',
            aguardandoCarga: false, criadoEm: '2026-09-11T12:00:00.000Z', programadoEm: '2026-09-11T12:00:00.000Z',
            atualizadoEm: '2026-09-11T12:00:00.000Z', criadoPor: 'Gestor', _nuncaConfirmada: true,
            rota: '500', peso: 9000, qtdEntregas: 1, paletizada: 'Não', qtdGanchos: 0 };
          DB.cargas = [carga];

          const t0 = Date.now();
          SuincoStore.save();
          await new Promise(r => setTimeout(r, 600));
          const antes = { proxima: carga._proximaTentativaEm, tentativas: carga._tentativasIncerta, avisos: window.__avisos.length };

          // Uma SEGUNDA sincronia, imediatamente — simula outro save() chegando
          // logo em seguida (o caso real: fundirEstadoRemoto disparando toda hora).
          SuincoStore.save();
          await new Promise(r => setTimeout(r, 300));
          const depoisImediato = { tentativas: carga._tentativasIncerta, avisos: window.__avisos.length };

          return { antes, depoisImediato, agora: Date.now() - t0 };
        }""")
        ck('a primeira tentativa marcou o recuo', r['antes']['proxima'] is not None, str(r['antes']))
        ck('e contou uma tentativa', r['antes']['tentativas'] == 1, str(r['antes']))
        ck('avisou UMA vez', r['antes']['avisos'] == 1, str(r['antes']))
        ck('uma sincronia LOGO EM SEGUIDA NÃO tenta de novo (o recuo segura)',
           r['depoisImediato']['tentativas'] == 1, str(r['depoisImediato']))
        ck('e não avisa de novo por isso', r['depoisImediato']['avisos'] == 1, str(r['depoisImediato']))

        print('\n=== 2. PASSADO O RECUO, TENTA DE NOVO — E O RECUO CRESCE ===')
        r2 = await pg.evaluate("""async () => {
          const carga = DB.cargas[0];
          carga._proximaTentativaEm = Date.now() - 1;   // como se o recuo já tivesse passado
          const recuoAntes = 5000; // primeiro recuo, calculado no código: 5000 * 2^0
          SuincoStore.save();
          await new Promise(r => setTimeout(r, 300));
          const recuoNovo = carga._proximaTentativaEm - Date.now();
          return { tentativas: carga._tentativasIncerta, recuoNovo, avisos: window.__avisos.length };
        }""")
        ck('a segunda tentativa aconteceu', r2['tentativas'] == 2, str(r2))
        ck('e o recuo cresceu (não ficou travado em 5s)', r2['recuoNovo'] > 8000, str(r2))
        ck('mas o aviso NÃO repetiu (só a cada 6ª tentativa)', r2['avisos'] == 1, str(r2))

        print('\n=== 3. DEPOIS DE VÁRIAS TENTATIVAS, O AVISO MUDA DE TOM ===')
        r3 = await pg.evaluate("""async () => {
          const carga = DB.cargas[0];
          for (let i = 0; i < 4; i++) {   // chega em 6 tentativas no total
            carga._proximaTentativaEm = Date.now() - 1;
            SuincoStore.save();
            await new Promise(r => setTimeout(r, 150));
          }
          return { tentativas: carga._tentativasIncerta, avisos: window.__avisos.slice() };
        }""")
        ck('chegou a 6 tentativas', r3['tentativas'] == 6, str(r3['tentativas']))
        ck('e o segundo aviso finalmente apareceu, com o tom mais forte',
           len(r3['avisos']) == 2 and 'depois de 6 tentativas' in r3['avisos'][-1],
           str(r3['avisos']))
        ck('e ainda diz para conferir à mão', 'confira à mão' in r3['avisos'][-1], str(r3['avisos'][-1])[:200])

        print('\n=== 4. CONFIRMANDO, OS CONTADORES SOMEM ===')
        r4 = await pg.evaluate("""async () => {
          window.fetch = async (url, opts) => {
            const json = (o, status=200) => new Response(JSON.stringify(o), { status, headers: {'content-type':'application/json'} });
            const m = (opts?.method || 'GET').toUpperCase();
            if (/\\/api\\/cargas$/.test(String(url)) && m === 'POST') return json({ id: 'carga_antiga_118684', versao: 5 }, 200);
            if (/\\/api\\/cargas\\/[^/]+$/.test(String(url)) && m === 'PATCH') return json({ id: 'carga_antiga_118684', versao: 5 });
            return json({});
          };
          const carga = DB.cargas[0];
          carga._proximaTentativaEm = Date.now() - 1;
          SuincoStore.save();
          await new Promise(r => setTimeout(r, 400));
          return { nuncaConfirmada: !!carga._nuncaConfirmada, tentativas: carga._tentativasIncerta,
                   proxima: carga._proximaTentativaEm };
        }""")
        ck('confirmou (nunca-confirmada some)', r4['nuncaConfirmada'] is False, str(r4))
        ck('e os contadores de recuo somem junto', r4['tentativas'] is None and r4['proxima'] is None, str(r4))
        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)


asyncio.run(main())
