#!/usr/bin/env python3
"""Mudança de status tem que CHEGAR no servidor pela rota que a valida.

O defeito, relatado da Portaria: "clico em Chegou, ele carrega e volta pro
status que tava".

A cadeia completa:

1. O clique muda o status local e chama save().
2. save() manda a carga pelo upsert, que faz POST (200, já existe) e depois
   PATCH com o corpo inteiro.
3. O servidor filtra o PATCH por setor. A Portaria só pode editar
   `motorista` e `observacoes` (CAMPOS_EDITAVEIS, dominio/fluxo.js). O
   `status_atual` é descartado — sempre, em silêncio.
4. O UPDATE roda mesmo assim (motorista/observações estão no corpo) e o
   gatilho tg_viagem_update carimba `atualizado_em = now()`.
5. A linha do servidor fica mais NOVA que a local, com o status ANTIGO.
6. Quinze segundos depois a sincronia compara os carimbos, o remoto vence
   pela regra 2 de fundirEstadoRemoto, e o status volta.

`mudarStatus()` — POST /api/cargas/:id/status, a rota que valida transição e
setor — existia desde o início e NUNCA tinha sido chamada. Escrita e não
ligada.

O teste grava todas as chamadas de rede e verifica que a rota de status é
uma delas. Um `fetch` de mentira, e não um servidor de verdade, porque o que
se mede é a DECISÃO do painel sobre para onde mandar a mudança.

    python3 testes/test_status_sobe.py
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


# Servidor de mentira: responde a tudo o que o painel pede durante um
# clique de status, e anota o que foi chamado.
ESPIAO = """
() => {
  window.__chamadas = [];
  window.fetch = async (url, opcoes = {}) => {
    const u = String(url);
    const metodo = (opcoes.method || 'GET').toUpperCase();
    window.__chamadas.push({ url: u, metodo, corpo: opcoes.body || null });

    const json = (dados, status = 200) => new Response(JSON.stringify(dados), {
      status, headers: { 'content-type': 'application/json' }
    });

    // POST /api/cargas -> 200 = "já existia" (é o ON CONFLICT DO NOTHING)
    if (/\\/api\\/cargas$/.test(u) && metodo === 'POST') return json({ id: 'x' }, 200);
    if (/\\/status$/.test(u)) return json({ id: 'x', status: 'Aguardando Embarque' });
    if (/\\/api\\/cargas\\//.test(u) && metodo === 'PATCH') return json({ id: 'x' });
    return json({});
  };
}
"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)

        # Sessão de servidor: sem ela sincronizarCarga sai antes de chamar a
        # rede e o teste não mede nada.
        await pg.evaluate("""() => {
            sessionStorage.setItem('suinco_token', 'token-de-teste');
        }""")
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Zé')
        await pg.select_option('#login-setor', 'Portaria')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(400)

        print('\n=== PORTARIA: "CHEGOU" ===')
        await pg.evaluate(ESPIAO)
        d = await pg.evaluate("""async () => {
            DB.cargas = []; DB.movimentacoes = []; SuincoStore._ultimoSync.clear();
            const f = DB.frota[0];
            criarCargaProgramada({ placa:f.placa, numeroCarga:'88001', peso:12000,
                                   rota:'500', operador:'Ana' });
            const c = DB.cargas[0];
            window.__chamadas = [];                    // ignora a criação

            registrarChegadaPortaria(f.placa, 'Zé');
            await new Promise(r => setTimeout(r, 500));  // deixa a sincronia rodar

            return {
                statusLocal: c.status,
                marcaPendente: (c._statusPendentes || []).slice(),
                protegida: !!c._pendente,
                chamadas: window.__chamadas.map(x => x.metodo + ' ' + x.url.replace(/^.*?\\/api/, '/api'))
            };
        }""")

        print('  chamadas de rede:', d['chamadas'])
        ck('o status mudou localmente', d['statusLocal'] == 'Aguardando Embarque',
           d['statusLocal'])
        ck('a rota de STATUS foi chamada',
           any('/status' in c for c in d['chamadas']),
           'sem ela o servidor nunca fica sabendo da etapa')
        ck('a fila de status esvaziou após confirmar',
           d['marcaPendente'] == [], str(d['marcaPendente']))
        # Uma transição = UMA chamada. Repetir manda o mesmo status de novo,
        # o servidor recusa por transição inválida, e a recusa desfaria na
        # tela um avanço correto — o defeito original voltando pelo avesso.
        ck('a rota de status foi chamada UMA vez',
           sum(1 for c in d['chamadas'] if '/status' in c) == 1,
           str([c for c in d['chamadas'] if '/status' in c]))
        ck('a carga saiu da proteção após tudo subir', not d['protegida'])

        print('\n=== EXPEDIÇÃO E FATURAMENTO: MESMO CAMINHO ===')
        # O avanço genérico atende os dois setores. Se ele não marcar, o
        # defeito volta pelas outras duas abas.
        for setor, origem, alvo in (('Expedição', 'Aguardando Embarque', 'Embarque Iniciado'),
                                    ('Faturamento', 'Embarque Finalizado', 'Faturado')):
            r = await pg.evaluate("""async ([origem, alvo]) => {
                DB.cargas = []; DB.movimentacoes = []; SuincoStore._ultimoSync.clear();
                const ordem = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
                               'Embarque Finalizado','Faturado','Seguiu Viagem'];
                const f = DB.frota[1];
                criarCargaProgramada({ placa:f.placa, numeroCarga:'88002', peso:9000,
                                       rota:'500', operador:'Ana' });
                const c = DB.cargas[0];
                for(let i = 1; i <= ordem.indexOf(origem); i++){
                    avancarStatusCarga(c.id, ordem[i], 'Op', 'Logística');
                }
                // Deixa a sincronia do PRÓPRIO setup terminar antes de zerar
                // o contador. Sem esta espera, os POST de status das etapas
                // de montagem chegam depois da limpeza e são contados como
                // se fossem repetição do avanço que está sendo medido.
                await new Promise(r => setTimeout(r, 600));
                window.__chamadas = [];
                avancarStatusCarga(c.id, alvo, 'Op', 'Logística');
                await new Promise(r => setTimeout(r, 500));
                return {
                    status: c.status,
                    chamadas: window.__chamadas.map(x => x.metodo + ' ' + x.url.replace(/^.*?\\/api/, '/api'))
                };
            }""", [origem, alvo])
            chamadasStatus = [c for c in r['chamadas'] if '/status' in c]
            ck(f'{setor}: {origem} → {alvo} chama a rota de status UMA vez',
               len(chamadasStatus) == 1, str(chamadasStatus))

        print('\n=== RECUSA DO SERVIDOR DESFAZ NA TELA ===')
        # Se o servidor recusa a transição, manter o status novo na tela é o
        # pior desfecho: o operador segue trabalhando sobre uma carga que,
        # para todos os outros terminais, não saiu do lugar.
        rec = await pg.evaluate("""async () => {
            DB.cargas = []; DB.movimentacoes = []; SuincoStore._ultimoSync.clear();
            const f = DB.frota[2];
            criarCargaProgramada({ placa:f.placa, numeroCarga:'88003', peso:9000,
                                   rota:'500', operador:'Ana' });
            const c = DB.cargas[0];

            window.fetch = async (url, o = {}) => {
                const json = (d, s=200) => new Response(JSON.stringify(d), {
                    status: s, headers: {'content-type':'application/json'} });
                if (/\\/status$/.test(String(url))) {
                    return json({ erro:'Transição inválida.', codigo:'FLUXO' }, 409);
                }
                if (/\\/api\\/cargas$/.test(String(url))) return json({id:'x'}, 200);
                return json({});
            };

            registrarChegadaPortaria(f.placa, 'Zé');
            await new Promise(r => setTimeout(r, 600));
            return { status: c.status, marca: (c._statusPendentes || []).slice() };
        }""")
        ck('status volta ao anterior quando o servidor recusa',
           rec['status'] == 'Aguardando Veículo', rec['status'])
        ck('a fila não fica presa repetindo para sempre',
           rec['marca'] == [], str(rec['marca']))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
