#!/usr/bin/env python3
"""O "➕ Outra carga" não pode sumir junto com a linha da fila.

Relato do Programador de Embarque (18/08/2026): "A opção de criar uma
segunda carga pra mesma placa não tá aparecendo". Não era regressão — era
um beco sem saída de desenho:

  - o botão "➕ Outra carga" só existia na linha da Fila de Programados;
  - a Fila só mostra cargas de HOJE em "Aguardando Veículo" (decisão de
    11/08: a fila é a lista de trabalho do dia);
  - logo, carga programada ONTEM, ou caminhão que JÁ CHEGOU (status
    avançou), não tem linha na fila — e o formulário de criação bloqueia a
    placa duplicada mandando usar um botão que não está em lugar nenhum.

O que se prova aqui:

1. Carga programada ONTEM (sem linha na fila de hoje): a Torre de Controle
   oferece "➕ Outra carga" na linha dela, o clique leva à Programação com
   o veículo preenchido e a segunda carga é criada sem bloqueio.
2. Caminhão que JÁ CHEGOU (Aguardando Embarque): mesmo caminho pela Torre.
3. O aviso de placa duplicada aponta para um lugar que EXISTE sempre
   (cita a Torre de Controle, não só a linha da fila).
4. Setor sem permissão de edição não vê o botão na Torre.

    python3 testes/test_outra_carga_sempre_acessivel.py
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


async def entrar(pg, nome, setor):
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', nome)
    await pg.select_option('#login-setor', setor)
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(500)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await entrar(pg, 'Ana', 'Logística')

        placa = await pg.evaluate("""() => {
            DB.cargas = []; DB.movimentacoes = []; SuincoStore.save();
            return DB.frota[0].placa;
        }""")
        print(f'\n=== PLACA DE TESTE: {placa} ===')

        print('\n=== 1. CARGA PROGRAMADA ONTEM: O BOTÃO CONTINUA ACESSÍVEL ===')
        # Cria a carga e envelhece a data de programação para ontem — o caso
        # real do relato: a fila do dia não mostra a linha (comportamento
        # correto e mantido), mas a opção de segunda carga não pode ir junto.
        await pg.evaluate("""(placa) => {
            criarCargaProgramada({placa, numeroCarga:'80001', peso:15000,
                rota:'500', motorista:'José da Silva', operador:'Ana'});
            const c = DB.cargas[0];
            const ontem = new Date(Date.now() - 24*3600*1000);
            c.criadoEm = ontem.toISOString();
            SuincoStore.save();
            renderAll();
        }""", placa)
        await pg.evaluate("() => abrirTab('programacao')")
        await pg.wait_for_timeout(300)

        fila = await pg.evaluate(
            "() => document.querySelectorAll('#prog-fila-tbody tr').length")
        ck('a fila de hoje não mostra a carga de ontem (regra mantida)',
           fila == 0, f'{fila} linha(s)')

        await pg.evaluate("() => abrirTab('torre')")
        await pg.wait_for_timeout(300)
        botao_torre = pg.locator('#torre-tbody button:has-text("Outra carga")')
        ck('a Torre oferece "➕ Outra carga" na linha da carga de ontem',
           await botao_torre.count() == 1, f'{await botao_torre.count()} botão(ões)')
        if await botao_torre.count() == 0:
            print('\n  (sem o botão na Torre, o resto do cenário 1 não tem como rodar)')
        else:
            await botao_torre.first.click()
            await pg.wait_for_timeout(400)
            f = await pg.evaluate("""() => ({
                tab: TAB_ATUAL,
                placa: document.getElementById('prog-placa').value,
                numero: document.getElementById('prog-numero-carga').value,
            })""")
            ck('o clique leva à aba Programação', f['tab'] == 'programacao', f['tab'])
            ck('o veículo vem preenchido', f['placa'] == placa, f['placa'])
            ck('o número da carga vem vazio', f['numero'] == '')

            await pg.fill('#prog-numero-carga', '80002')
            await pg.fill('#prog-peso', '9000')
            await pg.click('button:has-text("Criar Carga")')
            await pg.wait_for_timeout(400)
            total = await pg.evaluate("() => DB.cargas.length")
            ck('a segunda carga é criada sem bloqueio de placa duplicada',
               total == 2, f'{total} carga(s)')

        print('\n=== 2. CAMINHÃO JÁ CHEGOU: O CAMINHO PELA TORRE FUNCIONA ===')
        await pg.evaluate("""(placa) => {
            DB.cargas = []; DB.movimentacoes = []; SuincoStore.save();
            criarCargaProgramada({placa, numeroCarga:'80010', peso:12000,
                rota:'500', operador:'Ana'});
            registrarChegadaPortaria(placa, 'Porteiro');
            renderAll();
        }""", placa)
        await pg.evaluate("() => abrirTab('torre')")
        await pg.wait_for_timeout(300)
        st = await pg.evaluate("() => DB.cargas[0].status")
        ck('a carga avançou de status (saiu da fila)', st == 'Aguardando Embarque', st)
        botao2 = pg.locator('#torre-tbody button:has-text("Outra carga")')
        ck('a Torre oferece "➕ Outra carga" para carga que já chegou',
           await botao2.count() == 1, f'{await botao2.count()} botão(ões)')
        if await botao2.count() == 1:
            await botao2.first.click()
            await pg.wait_for_timeout(400)
            await pg.fill('#prog-numero-carga', '80011')
            await pg.fill('#prog-peso', '7000')
            await pg.click('button:has-text("Criar Carga")')
            await pg.wait_for_timeout(400)
            total = await pg.evaluate("() => DB.cargas.length")
            ck('a segunda carga nasce mesmo com o caminhão já no pátio',
               total == 2, f'{total} carga(s)')

        print('\n=== 3. O AVISO DE PLACA DUPLICADA APONTA PRA ONDE EXISTE ===')
        # Sem autorização prévia, digitar a placa de novo é bloqueado — e a
        # mensagem precisa mandar o operador para um botão que ele ENCONTRA.
        aviso = await pg.evaluate("""(placa) => {
            const capturados = [];
            const original = window.notify;
            window.notify = (msg, tipo, ms) => { capturados.push(String(msg)); original(msg, tipo, ms); };
            abrirTab('programacao');
            document.getElementById('prog-placa').value = placa;
            document.getElementById('prog-numero-carga').value = '80099';
            criarCargaProgramadaUI();
            window.notify = original;
            return capturados.join(' | ');
        }""", placa)
        ck('o bloqueio continua avisando', 'Outra carga' in aviso, repr(aviso[:120]))
        ck('o aviso cita a Torre de Controle', 'Torre de Controle' in aviso,
           repr(aviso[:160]))

        print('\n=== 4. SETOR SEM PERMISSÃO NÃO VÊ O BOTÃO ===')
        await pg.evaluate("() => { DB.operador = {nome:'Beto', setor:'Expedição'}; renderAll(); abrirTab('torre'); }")
        await pg.wait_for_timeout(300)
        botao3 = await pg.locator('#torre-tbody button:has-text("Outra carga")').count()
        ck('Expedição não vê "➕ Outra carga" na Torre', botao3 == 0, f'{botao3} botão(ões)')

        print('\n=== 5. CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
