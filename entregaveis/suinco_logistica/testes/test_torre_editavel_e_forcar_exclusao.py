#!/usr/bin/env python3
"""Torre de Controle editável + exclusão forçada de carga já finalizada.

Pedido direto do usuário (08/08/2026), depois de ver o DJF8527 (dado de
teste que passou pelo fluxo inteiro até "Seguiu Viagem") preso na Torre
sem nenhuma ação disponível: "eu quero conseguir excluir ou alterar
qualquer coisa direto da torre de controle como administrador ou
logistica".

Cobre:
  1. Logística/Administração veem campos editáveis na Torre (mesmas
     funções já testadas da Fila de Programados — Seq., Nº Carga, Placa,
     Tipo de Operação, Ganchos); outros setores continuam só leitura.
  2. Editar o Nº da Carga direto na Torre atualiza o dado de verdade.
  3. Carga "Seguiu Viagem" ganha um botão Excluir na Torre (antes era um
     traço sem ação nenhuma) — mas só sai depois de digitar a placa
     corretamente na confirmação. Placa errada não apaga nada.

    python3 testes/test_torre_editavel_e_forcar_exclusao.py
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

        await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = [];
            const f = DB.frota;
            window.__c1 = criarCargaProgramada({ placa: f[0].placa, numeroCarga: 'TE1', peso: 9000, rota: '500', operador: 'Ana' });
            window.__c2 = criarCargaProgramada({ placa: f[1].placa, numeroCarga: 'DJF8527', peso: 9000, rota: '500', operador: 'Ana' });
            ['Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado','Seguiu Viagem']
                .forEach(st => avancarStatusCarga(window.__c2.id, st, 'Ana', 'Logística'));
            abrirTab('torre'); renderAll();
        }""")
        await pg.wait_for_timeout(300)

        print('\n=== 1. LOGÍSTICA VÊ CAMPOS EDITÁVEIS NA TORRE (carga aberta) ===')
        editaveis = await pg.evaluate("""() => {
            const tr = document.querySelector('#torre-tbody tr');
            return {
                temSeqInput: !!tr.querySelector('.seq-input'),
                temNumeroInput: !!tr.querySelector('.numero-carga-input'),
                temPlacaInput: !!tr.querySelector('.placa-input'),
                temPraOndeSelect: !!tr.querySelector('.praonde-inline'),
                temGanchosInput: !!tr.querySelector('.ganchos-input'),
            };
        }""")
        for campo, ok in editaveis.items():
            ck(f'Torre (Logística) tem {campo}', ok, str(editaveis))

        print('\n=== 2. EDITAR Nº DA CARGA DIRETO NA TORRE ATUALIZA O DADO ===')
        await pg.fill('#torre-tbody tr .numero-carga-input', 'TE1-CORRIGIDO')
        await pg.dispatch_event('#torre-tbody tr .numero-carga-input', 'change')
        await pg.wait_for_timeout(200)
        novoNumero = await pg.evaluate("() => getCarga(window.__c1.id).numeroCarga")
        ck('numeroCarga foi atualizado de verdade (não só na tela)',
           novoNumero == 'TE1-CORRIGIDO', novoNumero)

        print('\n=== 3. OUTRO SETOR (Portaria) NÃO VÊ CAMPOS EDITÁVEIS ===')
        await pg.evaluate("(s) => { DB.operador.setor = s; renderAll(); }", 'Portaria')
        await pg.wait_for_timeout(200)
        semEdicao = await pg.evaluate("""() => {
            const tr = document.querySelector('#torre-tbody tr');
            return !tr.querySelector('input') && !tr.querySelector('select.praonde-inline');
        }""")
        ck('Portaria vê a Torre só como leitura', semEdicao)
        await pg.evaluate("(s) => { DB.operador.setor = s; renderAll(); }", 'Logística')
        await pg.wait_for_timeout(200)

        print('\n=== 4. CARGA "SEGUIU VIAGEM" GANHA BOTÃO EXCLUIR (antes era só um traço) ===')
        await pg.evaluate("() => filtrarTorrePorStatus('__SEGUIU_HOJE__')")
        await pg.wait_for_timeout(200)
        temBotao = await pg.evaluate("""() => {
            // O Nº da Carga agora pode estar dentro de um <input> (Torre
            // editável) — textContent não pega valor de input, tem que
            // olhar o value do campo também.
            const tr = [...document.querySelectorAll('#torre-tbody tr')].find(r => {
                const inp = r.querySelector('.numero-carga-input');
                return r.textContent.includes('DJF8527') || (inp && inp.value === 'DJF8527');
            });
            const btn = tr ? tr.querySelector('button.btn-danger') : null;
            return { achou: !!tr, temBotao: !!btn, textoBotao: btn ? btn.textContent.trim() : null };
        }""")
        ck('a carga Seguiu Viagem aparece no filtro', temBotao['achou'], str(temBotao))
        ck('tem botão Excluir (não é mais um traço sem ação)',
           temBotao['temBotao'] and temBotao['textoBotao'] == 'Excluir', str(temBotao))

        print('\n=== 5. PLACA ERRADA NA CONFIRMAÇÃO NÃO APAGA NADA ===')
        pg.once('dialog', lambda d: asyncio.ensure_future(d.accept('ZZZ9Z99')))
        await pg.evaluate("(id) => excluirCargaSeguiuViagemUI(id)", (await pg.evaluate("() => window.__c2.id")))
        await pg.wait_for_timeout(200)
        aindaExiste1 = await pg.evaluate("(id) => !!getCarga(id)", (await pg.evaluate("() => window.__c2.id")))
        ck('placa errada digitada — carga NÃO foi excluída', aindaExiste1)

        print('\n=== 6. PLACA CERTA NA CONFIRMAÇÃO EXCLUI DE VERDADE ===')
        placaCerta = await pg.evaluate("() => getCarga(window.__c2.id).placa")
        pg.once('dialog', lambda d: asyncio.ensure_future(d.accept(placaCerta)))
        await pg.evaluate("(id) => excluirCargaSeguiuViagemUI(id)", (await pg.evaluate("() => window.__c2.id")))
        await pg.wait_for_timeout(200)
        aindaExiste2 = await pg.evaluate("(id) => !!getCarga(id)", (await pg.evaluate("() => window.__c2.id")))
        ck('placa certa digitada — carga foi excluída', not aindaExiste2)

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
