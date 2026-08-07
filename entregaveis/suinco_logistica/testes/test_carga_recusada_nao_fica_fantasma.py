#!/usr/bin/env python3
"""Carga recusada NA CRIAÇÃO precisa sumir de quem criou, não só avisar.

Segunda metade do bug relatado em produção (07/08/2026): mesmo depois do
aviso de recusa (test_aviso_recusa_carga.py), a carga continuava
"Aguardando Veículo" na Torre de Controle de quem criou — visível só ali,
em nenhum outro terminal, porque nunca existiu no servidor. O aviso sozinho
não bastava: o operador via um caminhão "programado" que não existia pra
mais ninguém, e podia agir em cima dele (sequenciar, liberar doca).

Distingue de PROPÓSITO recusa de CRIAÇÃO (carga nunca existiu no servidor —
seguro remover) de recusa de EDIÇÃO (o servidor já tinha uma versão válida
antes — remover chutaria errado e apagaria dado de verdade). Só o primeiro
caso é coberto aqui; ver `_nuncaConfirmada` em data.js.

    python3 testes/test_carga_recusada_nao_fica_fantasma.py
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

        await pg.evaluate("() => { sessionStorage.setItem('suinco_token', 'token-de-teste'); }")
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Gestor')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(400)

        print('\n=== CRIAÇÃO RECUSADA (placa cadastrada só localmente) — some da tela ===')
        d = await pg.evaluate("""async () => {
            DB.cargas = []; DB.movimentacoes = [];
            const f = DB.frota[0];

            // Simula exatamente o bug relatado: o servidor recusa a criação
            // (placa que, do lado dele, não está na Frota — mesmo efeito de
            // "cadastro de frota que nunca sincronizou").
            window.fetch = async (url, opts) => {
                const u = String(url);
                if (/\\/api\\/cargas$/.test(u) && (opts?.method||'GET').toUpperCase() === 'POST') {
                    return new Response(JSON.stringify({
                        erro: 'Placa não está cadastrada na Frota.', codigo: 'PLACA_FORA_DA_FROTA'
                    }), { status: 422, headers: {'content-type':'application/json'} });
                }
                return new Response(JSON.stringify({}), { status: 200,
                    headers: {'content-type':'application/json'} });
            };

            const carga = criarCargaProgramada({
                placa: f.placa, numeroCarga: '77001', peso: 9000, rota: '500', operador: 'Gestor'
            });
            const idCriado = carga.id;
            const apareceuLogoApos = !!DB.cargas.find(c => c.id === idCriado);

            await new Promise(r => setTimeout(r, 600));

            return {
                idCriado,
                apareceuLogoApos,
                continuaDepoisDaRecusa: !!DB.cargas.find(c => c.id === idCriado),
                totalCargas: DB.cargas.length
            };
        }""")
        ck('a carga apareceu na tela imediatamente (local-first)', d['apareceuLogoApos'])
        ck('a carga SUMIU depois que o servidor recusou — não pode ficar fantasma',
           not d['continuaDepoisDaRecusa'],
           'DB.cargas ainda tem ' + str(d['totalCargas']) + ' carga(s)')

        print('\n=== EDIÇÃO recusada de carga JÁ CONFIRMADA continua na tela (não remove) ===')
        d2 = await pg.evaluate("""async () => {
            DB.cargas = []; DB.movimentacoes = [];
            const f = DB.frota[1];

            // Primeira sincronia: sucesso — a carga fica "confirmada".
            window.fetch = async () => new Response(JSON.stringify({ id: 'x' }), { status: 200,
                headers: {'content-type':'application/json'} });
            const carga = criarCargaProgramada({
                placa: f.placa, numeroCarga: '77002', peso: 8000, rota: '500', operador: 'Gestor'
            });
            await new Promise(r => setTimeout(r, 400));
            const confirmadaAntes = !carga._nuncaConfirmada;

            // Agora uma EDIÇÃO é recusada (ex.: setor sem permissão pro campo).
            window.fetch = async (url, opts) => {
                const u = String(url);
                if ((opts?.method||'GET').toUpperCase() === 'PATCH') {
                    return new Response(JSON.stringify({ erro: 'Recusado.', codigo: 'X' }),
                        { status: 422, headers: {'content-type':'application/json'} });
                }
                if ((opts?.method||'GET').toUpperCase() === 'POST') {
                    return new Response(JSON.stringify({}), { status: 200,
                        headers: {'content-type':'application/json'} });
                }
                return new Response(JSON.stringify({}), { status: 200,
                    headers: {'content-type':'application/json'} });
            };
            carga.observacoes = 'edição de teste';
            carga.atualizadoEm = new Date().toISOString();
            SuincoStore.save();
            await new Promise(r => setTimeout(r, 500));

            return { confirmadaAntes, continuaDepoisDaRecusaDeEdicao: !!DB.cargas.find(c => c.id === carga.id) };
        }""")
        ck('a carga estava confirmada antes da edição', d2['confirmadaAntes'])
        ck('edição recusada NÃO remove a carga (só a criação remove)',
           d2['continuaDepoisDaRecusaDeEdicao'])

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
