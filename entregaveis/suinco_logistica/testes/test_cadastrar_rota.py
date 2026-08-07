#!/usr/bin/env python3
"""Cadastrar Rota — só Administração, e aparece na hora no seletor.

Pedido direto do usuário (07/08/2026): "adicione pra mim por favor, somente
para administrador, na aba cadastro, cadastrar rota, e que essa rota quando
for cadastrada entre instataneamente para o a lista de rotas".

O backend (POST/GET /api/rotas, backend/src/rotas/cadastros.js) já existia
e já tinha cobertura de teste (backend/testes/api.test.js, bloco 9) — só não
tinha NENHUM caminho no frontend até aqui. Este teste cobre a parte nova:

1. O card só aparece para Administração (Logística, mesmo podendo gravar no
   backend via exigirSetor, não vê o formulário — pedido explícito).
2. Cadastrar uma rota nova aparece IMEDIATAMENTE no <select> de Rota da
   Programação, sem reload — o requisito central do pedido.
   (achado no caminho: preencherSelectsRota() só preenchia o <select> uma
   vez, num guard `dataset.preenchido`; corrigido para sempre reconstruir,
   preservando o valor já selecionado.)
3. Atualizar uma rota existente (mesmo código) sobrescreve nome/detalhe,
   não duplica.

Roda em modo local (sem backend) — o que se prova aqui é o comportamento do
frontend; a integração real com POST /api/rotas já está coberta pelo bloco
9 de backend/testes/api.test.js.

    python3 testes/test_cadastrar_rota.py
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


async def entrar(pg, setor):
    # O login local de teste ("Entrar sem servidor") só lista os 4 setores
    # operacionais — Administração é conta real, autenticada pelo servidor.
    # Mesmo padrão já usado em test_auditoria_refino.py/test_contraste.py:
    # loga como Logística e troca o setor direto em DB.operador.
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(400)
    if setor != 'Logística':
        await pg.evaluate("(s) => { DB.operador.setor = s; aplicarPermissoesSetor(); }", setor)
        await pg.wait_for_timeout(150)
    await pg.evaluate("() => abrirTab('cadastros')")
    await pg.wait_for_timeout(200)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []

        print('\n=== 1. LOGÍSTICA NÃO VÊ O CARD ===')
        pg1 = await nav.new_page(viewport={'width': 1280, 'height': 900})
        pg1.on('pageerror', lambda e: erros.append(str(e)))
        await pg1.goto(PAINEL)
        await pg1.wait_for_timeout(900)
        await entrar(pg1, 'Logística')
        visivel_logistica = await pg1.evaluate(
            "() => !document.getElementById('card-cadastrar-rota').hidden")
        ck('card escondido para Logística', not visivel_logistica)

        print('\n=== 2. ADMINISTRAÇÃO VÊ O CARD ===')
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await entrar(pg, 'Administração')
        visivel_admin = await pg.evaluate(
            "() => !document.getElementById('card-cadastrar-rota').hidden")
        ck('card visível para Administração', visivel_admin)

        print('\n=== 3. CADASTRAR ROTA NOVA: APARECE NA HORA NO SELETOR ===')
        antes = await pg.evaluate("() => ROTAS.length")
        await pg.fill('#rota-codigo', '999')
        await pg.fill('#rota-nome', 'Rota de Teste')
        await pg.fill('#rota-detalhe', 'Cidade Teste')
        await pg.fill('#rota-operador', 'Operador Teste')
        await pg.click("button:has-text('Cadastrar / Atualizar Rota')")
        await pg.wait_for_timeout(200)

        depois = await pg.evaluate("() => ROTAS.length")
        ck('ROTAS ganhou 1 rota', depois == antes + 1, f'{antes} -> {depois}')

        na_tabela = await pg.evaluate(
            "() => document.getElementById('rotas-tbody').textContent.includes('Rota de Teste')")
        ck('a rota nova aparece na tabela do card', na_tabela)

        # O requisito central: sem reload, sem re-chamar init — o <select>
        # de Rota da Programação já mostra a rota recém-cadastrada.
        await pg.evaluate("() => abrirTab('programacao')")
        await pg.wait_for_timeout(200)
        no_select = await pg.evaluate("""() => {
            const opt = [...document.getElementById('prog-rota').options]
                .find(o => o.value === '999');
            return opt ? opt.textContent : null;
        }""")
        ck('rota nova já está no seletor de Rota da Programação', no_select and 'Rota de Teste' in no_select, no_select)

        print('\n=== 4. PERSISTE EM DB.rotasExtras (sobrevive a reload) ===')
        salva = await pg.evaluate("""() => (DB.rotasExtras||[]).find(r => r.codigo === '999')""")
        ck('rota gravada em DB.rotasExtras', salva and salva['nome'] == 'Rota de Teste', str(salva))

        print('\n=== 5. CADASTRAR DE NOVO COM O MESMO CÓDIGO ATUALIZA, NÃO DUPLICA ===')
        await pg.evaluate("() => abrirTab('cadastros')")
        await pg.wait_for_timeout(200)
        await pg.fill('#rota-codigo', '999')
        await pg.fill('#rota-nome', 'Rota de Teste — Renomeada')
        await pg.click("button:has-text('Cadastrar / Atualizar Rota')")
        await pg.wait_for_timeout(200)
        contagem_999 = await pg.evaluate("() => ROTAS.filter(r=>r.codigo==='999').length")
        nome_atual = await pg.evaluate("() => rotaInfo('999').nome")
        ck('não duplicou a rota (continua 1 só)', contagem_999 == 1, contagem_999)
        ck('nome foi atualizado no lugar', nome_atual == 'Rota de Teste — Renomeada', nome_atual)

        print('\n=== 6. CÓDIGO OU NOME EM BRANCO SÃO RECUSADOS ===')
        antes2 = await pg.evaluate("() => ROTAS.length")
        await pg.fill('#rota-codigo', '')
        await pg.fill('#rota-nome', 'Sem Código')
        await pg.click("button:has-text('Cadastrar / Atualizar Rota')")
        await pg.wait_for_timeout(150)
        depois2 = await pg.evaluate("() => ROTAS.length")
        ck('código em branco não cria rota', depois2 == antes2, f'{antes2} -> {depois2}')

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
