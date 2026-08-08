#!/usr/bin/env python3
"""Número da carga programada agora é editável na Fila de Programados.

Pedido direto do usuário (07/08/2026): "preciso que seja possível alterar
também o número da carga programada". Até aqui, numeroCarga só era
gravável na criação (`criarCargaProgramada`) — depois de criada, a célula
da Fila de Programados era texto solto, sem `<input>`, sem função de
alteração. O backend já aceitava a edição (`numero_carga` está em
CAMPOS_EDITAVEIS['Logística'], backend/src/dominio/fluxo.js) — faltava só
o caminho no frontend, espelhando o padrão já existente de
`atualizarPlacaUI`.

    python3 testes/test_editar_numero_carga.py
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

        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Ana')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(400)

        idc = await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = [];
            const c = criarCargaProgramada({ placa: DB.frota[0].placa, numeroCarga: 'R1',
              peso: 9000, rota: '500', operador: 'Ana' });
            renderTorre(); abrirTab('programacao'); renderProgFila();
            return c.id;
        }""")

        print('\n=== CAMPO EDITÁVEL APARECE NA FILA ===')
        input_existe = await pg.evaluate(
            "() => !!document.querySelector('#prog-fila-tbody .numero-carga-input')")
        ck('a célula de número virou um campo editável', input_existe)
        valor_inicial = await pg.evaluate(
            "() => document.querySelector('#prog-fila-tbody .numero-carga-input').value")
        ck('o campo nasce com o número atual', valor_inicial == 'R1', valor_inicial)

        print('\n=== EDIÇÃO GRAVA E ATUALIZA A TELA ===')
        await pg.fill('#prog-fila-tbody .numero-carga-input', 'R1-CORRIGIDA')
        await pg.evaluate("() => document.querySelector('#prog-fila-tbody .numero-carga-input')"
                           ".dispatchEvent(new Event('change'))")
        await pg.wait_for_timeout(200)
        d = await pg.evaluate("""(id) => ({
            numeroCarga: (DB.cargas.find(c=>c.id===id)||{}).numeroCarga,
            campoNaTela: document.querySelector('#prog-fila-tbody .numero-carga-input') ?
              document.querySelector('#prog-fila-tbody .numero-carga-input').value : null,
        })""", idc)
        ck('DB.cargas foi atualizado', d['numeroCarga'] == 'R1-CORRIGIDA', str(d))
        ck('a fila continua mostrando o novo número', d['campoNaTela'] == 'R1-CORRIGIDA', str(d))

        print('\n=== ALTERAÇÃO FICA REGISTRADA NO LOG DE AUDITORIA ===')
        log_ok = await pg.evaluate("""() => {
            const l = (DB.alteracoes || []).find(x => x.campo === 'Número da Carga');
            return l ? { de: l.de, para: l.para, operador: l.operador } : null;
        }""")
        ck('log tem o campo "Número da Carga" com de/para corretos',
           log_ok and log_ok['de'] == 'R1' and log_ok['para'] == 'R1-CORRIGIDA', str(log_ok))

        print('\n=== CAMPO EM BRANCO É RECUSADO (não apaga o número) ===')
        await pg.fill('#prog-fila-tbody .numero-carga-input', '')
        await pg.evaluate("() => document.querySelector('#prog-fila-tbody .numero-carga-input')"
                           ".dispatchEvent(new Event('change'))")
        await pg.wait_for_timeout(200)
        d2 = await pg.evaluate("""(id) => ({
            numeroCarga: (DB.cargas.find(c=>c.id===id)||{}).numeroCarga,
            avisou: !!document.querySelector('.notif-item, .notificacao, .toast'),
        })""", idc)
        ck('número não fica em branco no DB', d2['numeroCarga'] == 'R1-CORRIGIDA', str(d2))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
