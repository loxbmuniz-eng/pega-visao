#!/usr/bin/env python3
"""A Visão do Pátio dentro da aba de cada setor.

Quem opera um posto só precisava trocar de aba para ver o pátio e voltar
para agir — duas abas para uma tarefa, dezenas de vezes por turno. A Torre
saiu da navegação desses setores e a visão passou para dentro da aba deles,
em linha do tempo, com filtro de período.

Este teste cobra as três promessas dessa mudança:

1. o setor restrito tem a visão na própria aba e não perdeu acesso a nada;
2. a linha do tempo diz onde a carga está E por onde ela passou, com hora;
3. o filtro de período alcança carga encerrada — é para isso que ele existe.

Roda sem backend: o painel abre em modo local.
"""
import asyncio
import sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SETORES = ['portaria', 'expedicao', 'faturamento']

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def entrar(pagina, setor):
    await pagina.evaluate("""(setor) => {
        DB.operador = {nome:'Teste', setor, turno:'Manhã'};
        aplicarPermissoesSetor();
        document.getElementById('modal-operador').classList.remove('open');
        renderAll();
    }""", setor)
    await pagina.wait_for_timeout(300)


async def main():
    async with async_playwright() as p:
        navegador = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                            headless=True)
        pagina = await (await navegador.new_context()).new_page()
        erros = []
        pagina.on('pageerror', lambda e: erros.append(str(e)))
        await pagina.goto(PAINEL)
        await pagina.wait_for_timeout(1200)
        await entrar(pagina, 'Logística')

        print('\n=== 1. UMA CARGA PERCORRE O FLUXO ===')
        dados = await pagina.evaluate("""() => {
            const placa = DB.frota[5].placa;
            criarCargaProgramada({placa, numeroCarga:'VP001', peso:14000, rota:'500',
                praOnde:'FROTA PROPRIA', paletizada:'Sim', qtdGanchos:20,
                qtdEntregas:1, operador:'Logística Teste'});
            registrarChegadaPortaria(placa, 'Porteiro');
            const c = DB.cargas.find(x => x.numeroCarga === 'VP001');
            avancarStatusCarga(c.id, 'Embarque Iniciado', 'Expedição Teste', 'Expedição');
            return {placa, id: c.id, status: getCarga(c.id).status};
        }""")
        ck('carga chegou a Embarque Iniciado', dados['status'] == 'Embarque Iniciado',
           str(dados))

        print('\n=== 2. CADA SETOR TEM A VISÃO NA PRÓPRIA ABA ===')
        for setor, aba in [('Portaria', 'portaria'), ('Expedição', 'expedicao'),
                           ('Faturamento', 'faturamento')]:
            await entrar(pagina, setor)
            abas = await pagina.evaluate(
                "() => [...document.querySelectorAll('.nav-tab')].filter(t=>!t.hidden).map(t=>t.dataset.tab)")
            ck(f'{setor} não tem mais a aba Torre', 'torre' not in abas, str(abas))
            ck(f'{setor} tem a própria aba', aba in abas, str(abas))

            await pagina.evaluate("a => { abrirTab(a); renderAll(); }", aba)
            await pagina.wait_for_timeout(300)
            linhas = await pagina.evaluate(
                "p => document.querySelectorAll(`#${p}-vp-tbody tr`).length", aba)
            ck(f'{setor} enxerga a carga na Visão do Pátio', linhas >= 1, f'{linhas} linha(s)')

        print('\n=== 3. A LINHA DO TEMPO MOSTRA O PERCURSO, NÃO SÓ O AGORA ===')
        await entrar(pagina, 'Expedição')
        await pagina.evaluate("() => { abrirTab('expedicao'); renderAll(); }")
        await pagina.wait_for_timeout(300)

        etapas = await pagina.evaluate("""() => {
            const tr = document.querySelector('#expedicao-vp-tbody tr');
            return [...tr.querySelectorAll('td.et')].map(td => ({
                classe: td.className,
                marca: (td.querySelector('.et-marca')||{}).textContent || '',
                hora:  (td.querySelector('.et-hora') ||{}).textContent || ''
            }));
        }""")
        ck('seis colunas de etapa', len(etapas) == 6, str(len(etapas)))
        ck('Programada aparece cumprida', 'et-ok' in etapas[0]['classe'], str(etapas[0]))
        ck('Chegou aparece cumprida', 'et-ok' in etapas[1]['classe'], str(etapas[1]))
        ck('Iniciou é a etapa ATUAL', 'et-atual' in etapas[2]['classe'], str(etapas[2]))
        ck('Finalizou ainda pendente', 'et-pendente' in etapas[3]['classe'], str(etapas[3]))
        # A hora é o que transforma "está em Embarque Iniciado" em "chegou
        # 07:12 e começou 09:40" — é onde o tempo perdido fica visível.
        ck('etapa cumprida mostra a hora', ':' in etapas[1]['hora'], str(etapas[1]))

        print('\n=== 4. O RESUMO CONTA O QUE A TABELA MOSTRA ===')
        resumo = await pagina.inner_text('#expedicao-vp-resumo')
        ck('resumo traz a contagem', 'carga(s)' in resumo, resumo.replace('\n', ' · '))
        # O chip sai em maiúsculas por CSS; inner_text devolve o texto já
        # transformado. Comparar sem caixa mede o conteúdo, não o estilo.
        ck('resumo mostra o status atual',
           'embarque iniciado' in resumo.lower(), resumo.replace('\n', ' · '))

        print('\n=== 5. FILTRO DE PERÍODO ALCANÇA CARGA ENCERRADA ===')
        # Sem período, a visão mostra o pátio de agora. É para revisitar o
        # que já saiu que o filtro existe — sem ele, o operador teria que
        # pedir para a Logística olhar.
        await pagina.evaluate("""() => {
            const c = DB.cargas.find(x => x.numeroCarga === 'VP001');
            avancarStatusCarga(c.id, 'Embarque Finalizado', 'Exp', 'Expedição');
            avancarStatusCarga(c.id, 'Faturado', 'Fat', 'Faturamento');
            avancarStatusCarga(c.id, 'Seguiu Viagem', 'Port', 'Portaria');
            renderAll();
        }""")
        await pagina.wait_for_timeout(300)
        sumiu = await pagina.evaluate(
            "() => document.querySelectorAll('#expedicao-vp-tbody tr').length")
        ck('carga encerrada sai da visão de agora', sumiu == 0, f'{sumiu} linha(s)')

        hoje = await pagina.evaluate("() => new Date().toISOString().slice(0,10)")
        await pagina.fill('#expedicao-vp-de', hoje)
        await pagina.fill('#expedicao-vp-ate', hoje)
        await pagina.wait_for_timeout(400)
        voltou = await pagina.evaluate(
            "() => document.querySelectorAll('#expedicao-vp-tbody tr').length")
        ck('com período, a carga encerrada reaparece', voltou >= 1, f'{voltou} linha(s)')

        todas_ok = await pagina.evaluate("""() => {
            const tr = document.querySelector('#expedicao-vp-tbody tr');
            return [...tr.querySelectorAll('td.et')].every(td => td.className.includes('et-ok')
                    || td.className.includes('et-atual'));
        }""")
        ck('carga encerrada mostra as seis etapas percorridas', todas_ok)

        print('\n=== 6. BUSCA POR PLACA E POR Nº DE CARGA ===')
        await pagina.fill('#expedicao-vp-busca', 'VP001')
        await pagina.wait_for_timeout(300)
        ck('acha pelo número da carga',
           await pagina.evaluate("() => document.querySelectorAll('#expedicao-vp-tbody tr').length") >= 1)
        await pagina.fill('#expedicao-vp-busca', dados['placa'])
        await pagina.wait_for_timeout(300)
        ck('acha pela placa',
           await pagina.evaluate("() => document.querySelectorAll('#expedicao-vp-tbody tr').length") >= 1)
        await pagina.fill('#expedicao-vp-busca', 'ZZZZZZ')
        await pagina.wait_for_timeout(300)
        vazio = await pagina.evaluate(
            "() => document.getElementById('expedicao-vp-empty').hidden === false")
        ck('busca sem resultado mostra o aviso de vazio', vazio)

        print('\n=== 7. O BOTÃO "HOJE" LIMPA OS FILTROS ===')
        await pagina.click("#tab-expedicao .filtro-acoes .btn")
        await pagina.wait_for_timeout(300)
        limpos = await pagina.evaluate("""() => ['de','ate','busca']
            .every(c => document.getElementById('expedicao-vp-' + c).value === '')""")
        ck('todos os campos voltaram ao vazio', limpos)

        print('\n=== 8. NADA ROLA DE LADO NO CELULAR ===')
        await pagina.set_viewport_size({'width': 390, 'height': 844})
        await pagina.wait_for_timeout(400)
        rolagem = await pagina.evaluate(
            "() => document.documentElement.scrollWidth <= window.innerWidth + 1")
        ck('a página não rola horizontalmente', rolagem)

        print('\n=== 9. CONSOLE ===')
        ck('sem erros de página', not erros, str(erros))

        await navegador.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
