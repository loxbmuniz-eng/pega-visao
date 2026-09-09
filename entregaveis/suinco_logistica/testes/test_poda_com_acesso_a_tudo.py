#!/usr/bin/env python3
"""O navegador guarda 30 dias; o servidor guarda tudo, e a tela alcança (09/09/2026).

DECISÃO DO DONO: "pode ser de 30 dias mas se eu quiser buscar mais ele vai
aparecer né?" — e antes: "nao da pra ter acesso a tudo no navegador".

POR QUE A PODA EXISTE (auditoria de arquitetura, medido em Chromium): o
painel nunca esquecia carga concluída. Com 1.500 cargas na memória a aba
Indicadores levava 5 s a cada sincronia; com 5.000, o localStorage estourava
a cota (9,4 MB) e o `save()` falhava SÓ NO CONSOLE — a cópia local parava de
atualizar sem ninguém perceber.

O QUE ESTE TESTE PROVA
  1. Carga concluída há mais de 30 dias sai da memória local; a de 10 dias
     fica; carga ABERTA nunca é podada, mesmo antiga.
  2. O que veio de uma consulta de período NÃO é gravado no navegador e NÃO
     sobe de volta ao servidor.
  3. Pedindo um período mais antigo que a janela, o painel busca no servidor
     e a carga antiga aparece no Histórico — com aviso dizendo de onde veio.
  4. Sem servidor, a tela DIZ que só tem 30 dias, em vez de mostrar menos
     calada.

    python3 testes/test_poda_com_acesso_a_tudo.py
"""
import asyncio
import json
import os
import sys
from datetime import date, timedelta
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
PAINEL_LOCAL = 'file://' + PAINEL_ARQ
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAIL = os.environ.get('SUINCO_EMAIL', 'chefe@teste.local')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


# ANTIGA: concluída há 60 dias · RECENTE: há 10 · ABERTA: criada há 90 e ainda no pátio.
SEED = """() => {
  DB.operador = {nome:'Chefe', setor:'Administração'};
  DB.frota = []; DB.cargas = []; DB.movimentacoes = [];
  const D = 86400000, agora = Date.now(), iso = (t)=>new Date(t).toISOString();
  const st = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
              'Embarque Finalizado','Faturado','Seguiu Viagem'];
  function mk(id, numero, placa, diasAtras, concluida){
    const t0 = agora - diasAtras*D;
    DB.frota.push({placa, transportadora:'ALFA', tipoVeiculo:'Truck', uf:'MG', capacidadeKg:14000, atualizadoEm:iso(agora)});
    DB.cargas.push({ id, numeroCarga:numero, placa, transportadora:'ALFA', tipoVeiculo:'Truck',
      motorista:'M', cliente:'C', destino:'D', peso:10000, doca:'1', sequencia:1, observacoes:'',
      praOnde:'Entrega', rota:'500', paletizada:'Não', qtdGanchos:0, qtdEntregas:1,
      status: concluida ? 'Seguiu Viagem' : 'Aguardando Embarque', aguardandoCarga:false,
      criadoEm:iso(t0), programadoEm:iso(t0), atualizadoEm:iso(t0), criadoPor:'Logística' });
    const ate = concluida ? 6 : 2;
    for(let j=0;j<ate;j++){
      DB.movimentacoes.push({id:'mov_'+id+'_'+j, cargaId:id, placa, statusAnterior:j?st[j-1]:null,
        statusNovo:st[j], operador:'Op', setor:'Portaria', timestamp:iso(t0 + j*30*60000), numeroCarga:numero});
    }
  }
  mk('c_antiga',  'ANTIGA-60',  'ANT1A11', 60, true);
  mk('c_recente', 'RECENTE-10', 'REC2B22', 10, true);
  mk('c_aberta',  'ABERTA-90',  'ABE3C33', 90, false);
  document.getElementById('modal-operador')?.classList.remove('open');
  renderAll();
  return DB.cargas.length;
}"""


async def abrir_com_servidor(ctx, rotulo):
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__painel_poda_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    await pg.wait_for_timeout(1000)
    await pg.fill('#login-email', EMAIL)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    return pg


async def main():
    hoje = date.today()
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []

        print('\n=== 1. A PODA: 30 DIAS, E NUNCA CARGA ABERTA ===')
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL_LOCAL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(SEED)
        janela = await pg.evaluate("() => typeof JANELA_LOCAL_DIAS !== 'undefined' ? JANELA_LOCAL_DIAS : null")
        ck('a janela local é de 30 dias', janela == 30, f"JANELA_LOCAL_DIAS={janela}")
        podadas = await pg.evaluate("() => typeof podarLocal === 'function' ? podarLocal() : 'funcao-nao-existe'")
        ids = await pg.evaluate("() => DB.cargas.map(c=>c.id).sort()")
        ck('a concluída há 60 dias saiu da memória local', podadas == 1 and 'c_antiga' not in ids, f"podadas={podadas} · {ids}")
        ck('a concluída há 10 dias ficou', 'c_recente' in ids, str(ids))
        ck('a carga ABERTA de 90 dias NUNCA é podada', 'c_aberta' in ids, str(ids))
        movs = await pg.evaluate("() => DB.movimentacoes.filter(m=>m.cargaId==='c_antiga').length")
        ck('as movimentações da carga podada saíram junto', movs == 0, f"{movs} sobraram")

        print('\n=== 2. SEM SERVIDOR, A TELA DIZ QUE SÓ TEM 30 DIAS ===')
        await pg.evaluate("abrirTab('historico')")
        await pg.fill('#hist-data-de', (hoje - timedelta(days=60)).isoformat())
        await pg.wait_for_timeout(1200)
        aviso = await pg.evaluate("() => { const e=document.getElementById('hist-aviso-periodo'); return e && !e.hidden ? e.textContent.trim() : ''; }")
        ck('avisa que sem servidor só há os últimos 30 dias',
           'Sem servidor' in aviso and '30' in aviso, aviso[:120])
        await pg.close()

        print('\n=== 3. COM SERVIDOR: O PERÍODO ANTIGO VEM E APARECE ===')
        ctx = await nav.new_context()
        pgs = await abrir_com_servidor(ctx, 'a')
        pgs.on('pageerror', lambda e: erros.append(str(e)))
        num = await pgs.evaluate("""async () => {
            const n = 'PODA' + Date.now().toString().slice(-6);
            criarCargaProgramada({placa: DB.frota[30].placa, numeroCarga:n, peso:9000, rota:'500',
                                  sequencia:1, qtdGanchos:0, operador:'Ana'});
            SuincoStore.save();
            return n;
        }""")
        await pgs.wait_for_timeout(4000)
        cid = await pgs.evaluate("(n) => (DB.cargas.find(c=>c.numeroCarga===n)||{}).id", num)
        ck('a carga de teste foi criada no servidor', bool(cid), str(cid))
        # leva até Seguiu Viagem e empurra a saída para 45 dias atrás, no banco
        for setor, status in [('Portaria', 'Aguardando Embarque'), ('Expedição', 'Embarque Iniciado'),
                              ('Expedição', 'Embarque Finalizado'), ('Faturamento', 'Faturado'),
                              ('Portaria', 'Seguiu Viagem')]:
            await pgs.evaluate("""async ([id, st]) => { await SuincoSharePoint.mudarStatus(id, st); }""", [cid, status])
            await pgs.wait_for_timeout(400)
        import subprocess
        env = dict(os.environ)
        subprocess.run(['sudo', '-u', 'postgres', 'psql', '-q', '-d', 'embarque_suinco', '-c',
                        "UPDATE fact_statusfrota SET data_evento = now() - interval '45 days' "
                        f"WHERE carga_id = '{cid}'"], capture_output=True, env=env)
        subprocess.run(['sudo', '-u', 'postgres', 'psql', '-q', '-d', 'embarque_suinco', '-c',
                        f"UPDATE fact_viagens SET criado_em = now() - interval '45 days', programado_em = now() - interval '45 days' WHERE carga_id = '{cid}'"],
                       capture_output=True, env=env)
        # tira da memória local, como a poda faria
        await pgs.evaluate("""(id) => { DB.cargas = DB.cargas.filter(c=>c.id!==id);
            DB.movimentacoes = DB.movimentacoes.filter(m=>m.cargaId!==id);
            if(typeof invalidarIndiceMovimentacoes==='function') invalidarIndiceMovimentacoes();
            SuincoStore.save(); }""", cid)
        sumiu = await pgs.evaluate("(id) => !DB.cargas.some(c=>c.id===id)", cid)
        ck('a carga antiga não está mais na memória local', sumiu)

        r = await pgs.evaluate("""async ([de, ate]) => await buscarHistoricoNoServidor(de, ate)""",
                               [(hoje - timedelta(days=60)).isoformat(), (hoje - timedelta(days=30)).isoformat()])
        ck('a busca no servidor respondeu', r.get('ok') is True, str(r)[:160])
        voltou = await pgs.evaluate("(id) => { const c = DB.cargas.find(x=>x.id===id); return c ? {tem:true, doServidor: !!c._doServidor, status: c.status} : {tem:false}; }", cid)
        ck('a carga antiga voltou para a tela', voltou.get('tem') is True, str(voltou))
        ck('e vem marcada como vinda do servidor', voltou.get('doServidor') is True, str(voltou))
        temMov = await pgs.evaluate("(id) => historicoDaCarga(id).length", cid)
        ck('a linha do tempo dela veio junto', temMov >= 5, f"{temMov} movimentações")

        print('\n=== 4. O QUE VEIO DO SERVIDOR NÃO É GRAVADO NEM REENVIADO ===')
        gravado = await pgs.evaluate("""(id) => { SuincoStore.save();
            const bruto = localStorage.getItem('suinco_painel_v1');
            return bruto ? bruto.includes(id) : 'sem-chave'; }""", cid)
        ck('a carga do servidor NÃO foi para o armazenamento local', gravado is False, str(gravado))
        patches = []
        pgs.on('request', lambda rq: patches.append(rq.url) if rq.method in ('PATCH', 'POST') and '/api/cargas' in rq.url else None)
        await pgs.evaluate("() => SuincoStore.sincronizarCargasAlteradas()")
        await pgs.wait_for_timeout(2500)
        ck('e NÃO subiu de volta para o servidor', not any(cid in u for u in patches), str(patches[:3]))

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros)[:300])
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
