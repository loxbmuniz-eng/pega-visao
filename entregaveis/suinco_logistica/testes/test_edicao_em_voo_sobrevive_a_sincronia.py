#!/usr/bin/env python3
"""A edição com envio ainda a caminho sobrevive à sincronia (28/09/2026).

SUSPEITA QUE ESTE TESTE RESPONDEU. `liberarPendencias()` (data.js) tira as
marcas de proteção quando a fila offline está vazia. Um envio que está EM
VOO — já saiu, ainda não voltou — não está na fila. Então a leitura seguinte
do servidor, trazendo o valor ANTIGO da carga, poderia sobrescrever a edição
que ainda não chegou, e a sincronia seguinte mandaria o antigo de volta.

MEDIDO: não acontece. A regra de fusão fica com a versão mais nova
(`atualizadoEm`), então a edição local sobrevive a duas leituras velhas
seguidas, e quando a rede solta, o servidor recebe a edição.

POR QUE O TESTE FICA, SE NÃO HAVIA DEFEITO. A proteção desse caminho não é a
marca `_pendente` (ela já foi liberada ali) — é a regra do mais novo. Quem
mexer nela sem saber disso reabre a perda de edição. Controle não pode
depender da memória de quem escreveu.

    python3 testes/test_edicao_em_voo_sobrevive_a_sincronia.py
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
PAINEL = 'file://' + os.path.join(os.path.dirname(AQUI), 'index.html')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        # Sessão de servidor: sem ela pull()/aoReceberDados não fazem nada.
        await pg.evaluate("() => { localStorage.setItem('suinco_token', 'token-de-teste'); }")
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(400)

        print('\n=== EDIÇÃO COM O ENVIO PRESO NA REDE, E DUAS LEITURAS VELHAS NO MEIO ===')
        r = await pg.evaluate("""async () => {
          DB.cargas = []; DB.movimentacoes = [];
          SuincoSharePoint.pararSincronia();
          const f = DB.frota[0];
          criarCargaProgramada({freteObservacao:'TABELA',  placa:f.placa, numeroCarga:'55001', peso:9000, rota:'500', operador:'Ana' });
          const c = DB.cargas[0];
          const criado = c.criadoEm, t0 = c.atualizadoEm;
          let segurar = false, soltar = null; const enviados = [];
          const resp = (o) => new Response(JSON.stringify(o), {status:200, headers:{'content-type':'application/json'}});
          const estadoServidor = () => ({ marca: new Date().toISOString(), completo: true, movimentacoes: [],
             cargas: [{ id: c.id, numeroCarga: '55001', placa: c.placa, status: c.status,
                        atualizadoEm: t0, criadoEm: criado, qtdEntregas: 1, peso: 9000, rota: '500', versao: 1 }] });
          window.fetch = async (url, op = {}) => {
            const u = String(url), m = (op.method || 'GET').toUpperCase();
            if (/\\/api\\/estado/.test(u)) return resp(estadoServidor());
            if (/\\/api\\/frota/.test(u)) return resp([]);
            if (m !== 'GET' && /\\/api\\/cargas/.test(u)) {
              enviados.push(JSON.parse(op.body || '{}'));
              if (segurar) await new Promise(res => { soltar = res; });
              return resp({ id: c.id, ok: true });
            }
            return resp({});
          };
          SuincoStore.sincronizarCargasAlteradas();
          await Promise.allSettled([...SuincoStore._emVoo.values()]);
          delete c._pendente; delete c._statusPendentes; delete c._nuncaConfirmada;
          // a edição local, com o envio preso na rede
          segurar = true;
          c.numeroCarga = 'EDITADO'; c.atualizadoEm = new Date(Date.now() + 1000).toISOString();
          SuincoStore.save();
          SuincoStore.sincronizarCargasAlteradas();
          await new Promise(r => setTimeout(r, 100));
          const emVoo = SuincoStore._emVoo.size, pendAntes = !!c._pendente;
          await SuincoSharePoint.pull(true); await new Promise(r => setTimeout(r, 100));
          const depois1 = { num: DB.cargas[0].numeroCarga, pend: !!DB.cargas[0]._pendente };
          await SuincoSharePoint.pull(true); await new Promise(r => setTimeout(r, 100));
          const depois2 = { num: DB.cargas[0].numeroCarga, pend: !!DB.cargas[0]._pendente };
          segurar = false; if (soltar) soltar();
          await Promise.allSettled([...SuincoStore._emVoo.values()]);
          await new Promise(r => setTimeout(r, 100));
          SuincoStore.sincronizarCargasAlteradas();
          await Promise.allSettled([...SuincoStore._emVoo.values()]);
          return { emVoo, pendAntes, depois1, depois2, final: DB.cargas[0].numeroCarga,
                   enviados: enviados.map(e => e.Numero_Carga || e.numeroCarga || JSON.stringify(e).slice(0,80)) };
        }""")
        ck('o envio da edição estava em voo (a situação da suspeita)', r['emVoo'] == 1, str(r['emVoo']))
        ck('a 1ª leitura velha não apagou a edição da tela', r['depois1']['num'] == 'EDITADO', str(r['depois1']))
        ck('a 2ª leitura velha (já sem marca de proteção) também não', r['depois2']['num'] == 'EDITADO', str(r['depois2']))
        ck('no fim, a carga local é a editada', r['final'] == 'EDITADO', r['final'])
        ck('e o último envio ao servidor levou a edição, não o valor velho',
           r['enviados'] and r['enviados'][-1] == 'EDITADO', str(r['enviados']))
        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
