#!/usr/bin/env python3
"""`liberarPendencias()` nunca era chamada — bloqueio permanente que sobrevive a reload.

Achado da auditoria "superpowers", mesma família dos outros bugs desta
sessão: função escrita, comentário dizendo exatamente quando deveria rodar
("Chamado quando a fila sobe por completo: nenhuma carga segue protegida"),
e zero chamadas em qualquer lugar do código.

A cadeia do estrago:

1. Uma gravação cai na fila offline (rede caiu no meio do registro).
   `carga._pendente` e `carga._statusPendentes` ficam marcados — é a
   proteção que impede a sincronia de sobrescrever, com dado velho do
   servidor, uma mudança que ainda não subiu (regra 3 de
   fundirEstadoRemoto).
2. `_pendente` vai para o localStorage inteiro (`JSON.stringify(DB)`), então
   o bloqueio sobrevive a fechar a aba e abrir de novo.
3. A rede volta, a fila drena com sucesso — mas nada nunca chamava
   `liberarPendencias()`. A carga fica marcada como "ainda pendente" para
   sempre, e nenhuma atualização remota daquela carga é aceita por aquele
   terminal nunca mais.

A correção liga `liberarPendencias()` ao callback `aoReceberDados` já
existente em app.js (o mesmo ciclo de sincronia que drena a fila também
faz a leitura em seguida) — quando `SuincoSharePoint.pendentes() === 0`,
a fila subiu por completo, e é exatamente o sinal que a função já esperava.

    python3 testes/test_libera_pendencias.py
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
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)

        # Sessão de servidor: sem ela pull()/aoReceberDados não fazem nada.
        await pg.evaluate("() => { sessionStorage.setItem('suinco_token', 'token-de-teste'); }")
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(400)

        print('\n=== SIMULA CARGA QUE PASSOU PELA FILA OFFLINE E JÁ SUBIU ===')
        # window.fetch de mentira: responde ao pull() (GET /api/estado) com um
        # payload vazio — o que importa aqui não é o CONTEÚDO da leitura, é o
        # EFEITO COLATERAL dela: o callback aoReceberDados já registrado em
        # app.js deveria, ao ver a fila offline vazia, liberar as marcas de
        # pendência. Não estamos testando fundirEstadoRemoto, estamos testando
        # se liberarPendencias() é chamada de algum lugar de verdade.
        d = await pg.evaluate("""async () => {
            DB.cargas = []; DB.movimentacoes = [];
            const f = DB.frota[0];
            criarCargaProgramada({ placa:f.placa, numeroCarga:'55001', peso:9000,
                                   rota:'500', operador:'Ana' });
            const c = DB.cargas[0];

            // Simula: a gravação desta carga caiu na fila offline em algum
            // momento e já foi enviada com sucesso (a fila real está vazia —
            // não chamamos enfileirar()). O que sobrou, indevidamente, são as
            // marcas de proteção.
            c._pendente = 1;
            c._statusPendentes = ['Aguardando Embarque'];

            window.fetch = async (url) => {
                const u = String(url);
                if (/\\/api\\/estado/.test(u)) {
                    return new Response(JSON.stringify({
                        marca: new Date().toISOString(), completo: true,
                        cargas: [], movimentacoes: []
                    }), { status: 200, headers: {'content-type':'application/json'} });
                }
                if (/\\/api\\/frota/.test(u)) {
                    return new Response(JSON.stringify([]), { status: 200,
                        headers: {'content-type':'application/json'} });
                }
                return new Response(JSON.stringify({}), { status: 200,
                    headers: {'content-type':'application/json'} });
            };

            const filaVazia = SuincoSharePoint.pendentes() === 0;
            await SuincoSharePoint.pull(true);
            await new Promise(r => setTimeout(r, 200));

            return {
                filaEstavaVazia: filaVazia,
                pendenteAntes: true,
                pendenteDepois: !!c._pendente,
                statusPendentesDepois: (c._statusPendentes || []).slice()
            };
        }""")

        ck('a fila offline estava vazia (pré-condição do teste)', d['filaEstavaVazia'])
        ck('_pendente foi liberado depois da sincronia com fila vazia',
           not d['pendenteDepois'],
           'liberarPendencias() precisa rodar quando pendentes()===0')
        ck('_statusPendentes foi liberado junto',
           d['statusPendentesDepois'] == [], str(d['statusPendentesDepois']))

        print('\n=== A CARGA PASSA A ACEITAR ATUALIZAÇÃO REMOTA DEPOIS DE LIBERADA ===')
        # Prova indireta do efeito prático: com _pendente preso, a regra 3 de
        # fundirEstadoRemoto bloqueava QUALQUER atualização remota desta
        # carga. Depois de liberada, uma leitura trazendo a carga com um
        # status mais novo (vindo de outro terminal) precisa ser aceita.
        d2 = await pg.evaluate("""() => {
            const c = DB.cargas[0];
            const remoto = {
                cargas: [{
                    Carga_ID: c.id, Numero_Carga: c.numeroCarga, Placa: c.placa,
                    Status_Atual: 'Embarque Iniciado',
                    Atualizado_Em: new Date(Date.now() + 60000).toISOString(),
                    Criado_Em: c.criadoEm, Qtd_Entregas: 1
                }],
                movimentacoes: []
            };
            const r = fundirEstadoRemoto(remoto);
            return { ignoradasPorPendencia: r.ignoradasPorPendencia, statusFinal: c.status };
        }""")
        ck('a atualização remota não é mais ignorada por pendência',
           d2['ignoradasPorPendencia'] == 0, str(d2))
        ck('o status remoto foi aceito', d2['statusFinal'] == 'Embarque Iniciado',
           d2['statusFinal'])

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
