#!/usr/bin/env python3
"""Criar/editar carga recusado pelo servidor precisa avisar — não sumir em silêncio.

Generalização do achado #1 da auditoria "superpowers" (chegada sem
programação recusada e engolida). O caminho é o mesmo para qualquer
recusa de criação/edição, não só aquele caso: `sincronizarCarga()` chama
`SuincoSharePoint.upsert()`, que RETORNA `{recusado:true, erro}` em vez de
lançar exceção quando o servidor recusa (403/409/422). Quem chama
`sincronizarCarga()` — `sincronizarCargasAlteradas()`, disparada por
`save()` — só tem `.catch(e=>console.warn(...))`, que só pega exceção
lançada. O valor resolvido nunca era inspecionado: a recusa ficava só no
console, e a tela do operador seguia mostrando sucesso.

Compare com o caminho de exclusão (`excluirCargaUI`, app.js), que checa
`r.recusado` e avisa — criação/edição não tinha o equivalente.

    python3 testes/test_aviso_recusa_carga.py
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
        await pg.fill('#login-nome', 'Zé')
        await pg.select_option('#login-setor', 'Portaria')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(400)

        print('\n=== SERVIDOR RECUSA A CRIAÇÃO — TELA PRECISA AVISAR ===')
        d = await pg.evaluate("""async () => {
            DB.cargas = []; DB.movimentacoes = [];
            const f = DB.frota[0];

            window.fetch = async (url) => {
                const u = String(url);
                if (/\\/api\\/cargas$/.test(u)) {
                    return new Response(JSON.stringify({
                        erro: 'Placa fora da frota.', codigo: 'PLACA_FORA_DA_FROTA'
                    }), { status: 422, headers: {'content-type':'application/json'} });
                }
                return new Response(JSON.stringify({}), { status: 200,
                    headers: {'content-type':'application/json'} });
            };

            document.getElementById('notif').innerHTML = '';

            // Chegada sem programação: cria localmente e dispara a sincronia
            // que vai bater no fetch mockado e ser recusada.
            registrarChegadaPortaria(f.placa, 'Zé');
            await new Promise(r => setTimeout(r, 500));

            const avisos = [...document.getElementById('notif').children]
                .map(el => el.textContent);
            return { avisos };
        }""")

        ck('algum aviso apareceu na tela', len(d['avisos']) > 0,
           'a recusa não pode ficar só no console')
        avisoRecusa = [a for a in d['avisos'] if 'recus' in a.lower() or 'NÃO' in a]
        ck('o aviso menciona a recusa do servidor', len(avisoRecusa) > 0,
           str(d['avisos']))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
