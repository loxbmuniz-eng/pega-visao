#!/usr/bin/env python3
"""Auditoria do refino: as telas que tratam da MESMA carga têm que combinar.

Motivo: Cliente e Destino saíram da aba Programação a pedido do gestor, mas
continuaram no modal que a Portaria abre quando um caminhão chega sem carga
programada. Duas telas para o mesmo trabalho, com campos diferentes — a
pessoa preenche em uma e não encontra na outra, ou digita no campo trocado.

Este teste existe para essa divergência não voltar. Ele não confere
aparência: confere que os campos, a ordem e as colunas são os mesmos, e que
nada que foi retirado voltou por descuido em outra tela.

Roda sem backend: o painel abre em modo local e as telas são inspecionadas
direto no DOM.
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


# Campos que o gestor pediu para SUMIR da tela. Continuam existindo como
# campo oculto — registro antigo tem valor gravado, e apagar do modelo
# destruiria dado. O que não pode é voltar a aparecer para digitação.
RETIRADOS = ['cliente', 'destino']

# A ordem em que a Programação pede os dados. O modal de completar tem que
# pedir na mesma ordem: é a mesma pessoa, preenchendo a mesma carga.
ORDEM = [
    'transportadora', 'tipoveiculo', 'numero-carga', 'motorista', 'rota',
    'praonde', 'peso', 'sequencia', 'paletizada', 'ganchos', 'entregas', 'obs',
]


async def main():
    async with async_playwright() as p:
        navegador = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                            headless=True)
        pagina = await (await navegador.new_context()).new_page()
        erros = []
        pagina.on('pageerror', lambda e: erros.append(str(e)))
        await pagina.goto(PAINEL)
        await pagina.wait_for_timeout(1200)

        # Entra em modo local para as abas ficarem acessíveis.
        await pagina.evaluate("""() => {
            DB.operador = {nome:'Auditor', setor:'Administração', turno:'Manhã'};
            aplicarPermissoesSetor();
            document.getElementById('modal-operador').classList.remove('open');
            renderAll();
        }""")
        await pagina.wait_for_timeout(400)

        print('\n=== 1. CAMPOS RETIRADOS NÃO APARECEM PARA DIGITAÇÃO ===')
        for campo in RETIRADOS:
            for tela, prefixo in [('Programação', 'prog'), ('Completar carga', 'completar')]:
                tipo = await pagina.evaluate(
                    "id => { const e = document.getElementById(id); return e ? e.type : 'ausente'; }",
                    f'{prefixo}-{campo}')
                ck(f'{tela}: {campo} não é campo visível', tipo in ('hidden', 'ausente'),
                   f'type={tipo}')

        print('\n=== 2. O MODAL PEDE OS MESMOS DADOS, NA MESMA ORDEM ===')
        # Compara a sequência dos campos realmente digitáveis nas duas telas.
        async def ordem_visivel(prefixo, raiz):
            return await pagina.evaluate("""([prefixo, raiz]) => {
                const el = document.querySelector(raiz);
                if (!el) return ['(tela não encontrada)'];
                return [...el.querySelectorAll('input, select, textarea')]
                    .filter(c => c.type !== 'hidden' && c.id && c.id.startsWith(prefixo + '-'))
                    .map(c => c.id.slice(prefixo.length + 1));
            }""", [prefixo, raiz])

        prog = await ordem_visivel('prog', '#tab-programacao .card')
        comp = await ordem_visivel('completar', '#modal-completar')

        # A Programação tem a placa; o modal não, porque a carga já existe e a
        # placa foi digitada pela Portaria na chegada. É a única diferença
        # legítima entre as duas telas.
        prog_sem_placa = [c for c in prog if c not in ('placa', 'frota-hint')]

        ck('Programação pede os campos esperados', prog_sem_placa == ORDEM,
           f'obtido: {prog_sem_placa}')
        ck('modal de completar pede exatamente os mesmos, na mesma ordem',
           comp == ORDEM, f'programação={prog_sem_placa} · modal={comp}')

        print('\n=== 3. A FILA MOSTRA O QUE O FORMULÁRIO PREENCHE ===')
        # Coluna que nunca é preenchida vira uma fileira de traços — é a
        # poluição visual que o gestor pediu para tirar.
        cabecalhos = await pagina.evaluate("""() => {
            const t = document.querySelector('#prog-fila-tbody');
            return [...t.closest('table').querySelectorAll('thead th')].map(h => h.textContent.trim());
        }""")
        ck('fila não mostra Cliente', 'Cliente' not in cabecalhos, str(cabecalhos))
        ck('fila não mostra Destino', 'Destino' not in cabecalhos, str(cabecalhos))
        for esperada in ['Rota', 'Peso (kg)', 'Palet.', 'Ganchos', 'Entregas']:
            ck(f'fila mostra {esperada}', esperada in cabecalhos, str(cabecalhos))

        print('\n=== 4. A TORRE SEGUE A MESMA REGRA ===')
        torre = await pagina.evaluate("""() => {
            const t = document.querySelector('#torre-tbody');
            return [...t.closest('table').querySelectorAll('thead th')].map(h => h.textContent.trim());
        }""")
        ck('torre não mostra Cliente', 'Cliente' not in torre, str(torre))
        ck('torre não mostra Destino', 'Destino' not in torre, str(torre))

        print('\n=== 5. CABEÇALHO E LINHAS TÊM O MESMO NÚMERO DE COLUNAS ===')
        # Erro clássico ao mexer em tabela: tirar <th> e esquecer o <td>.
        # O navegador não reclama — só desalinha tudo em silêncio.
        await pagina.evaluate("""() => {
            const placa = (DB.frota[0] || {}).placa || 'AAA0A00';
            criarCargaProgramada({
                placa, numeroCarga:'AUD1', peso:12000, rota:'500',
                praOnde:'ENTREGA DIRETA', paletizada:'Sim', qtdGanchos:30,
                qtdEntregas:2, operador:'Auditor'
            });
            // renderAll() desenha só a aba ativa. Sem abrir a Programação, a
            // fila fica vazia e a comparação de colunas mediria uma tabela
            // sem linhas — passando por engano.
            abrirTab('programacao');
            renderAll();
        }""")
        await pagina.wait_for_timeout(300)

        for nome, aba, seletor in [('fila de programados', 'programacao', '#prog-fila-tbody'),
                                   ('torre de controle', 'torre', '#torre-tbody')]:
            # Cada tabela vive numa aba, e só a aba aberta é desenhada.
            await pagina.evaluate("t => { abrirTab(t); renderAll(); }", aba)
            await pagina.wait_for_timeout(200)
            r = await pagina.evaluate("""(sel) => {
                const tb = document.querySelector(sel);
                const tab = tb.closest('table');
                const th = tab.querySelectorAll('thead th').length;
                const tr = tb.querySelector('tr');
                return { th, td: tr ? tr.children.length : -1 };
            }""", seletor)
            ck(f'{nome}: {r["th"]} colunas no cabeçalho e {r["td"]} nas linhas',
               r['th'] == r['td'], str(r))

        print('\n=== 6. O MODAL SALVA O QUE MOSTRA ===')
        # Campo na tela que a função de salvar ignora é pior que campo
        # ausente: a pessoa digita, salva, e o dado some sem aviso.
        await pagina.evaluate("""() => {
            const placa = (DB.frota[1] || {}).placa || 'AAA0A00';
            registrarChegadaPortaria(placa, 'Portaria Teste');
            renderAll();
            const c = DB.cargas.find(x => x.aguardandoCarga);
            if (c) abrirCompletar(c.id);
        }""")
        await pagina.wait_for_timeout(300)
        aberto = await pagina.evaluate(
            "() => document.getElementById('modal-completar').classList.contains('open')")
        ck('modal abre a partir de carga sem programação', aberto)

        if aberto:
            await pagina.fill('#completar-numero-carga', 'AUD2')
            await pagina.fill('#completar-peso', '9000')
            await pagina.fill('#completar-motorista', 'Motorista Auditoria')
            await pagina.select_option('#completar-rota', '500')
            await pagina.select_option('#completar-paletizada', 'Sim')
            await pagina.fill('#completar-ganchos', '18')
            await pagina.fill('#completar-entregas', '3')
            await pagina.click('#modal-completar .btn-primary')
            await pagina.wait_for_timeout(500)

            g = await pagina.evaluate("""() => {
                const c = DB.cargas.find(x => x.numeroCarga === 'AUD2');
                return c ? {peso:c.peso, motorista:c.motorista, rota:c.rota,
                            palet:c.paletizada, ganchos:c.qtdGanchos,
                            entregas:c.qtdEntregas, aguardando:c.aguardandoCarga} : null;
            }""")
            ck('salvou a carga', g is not None, str(g))
            if g:
                ck('peso gravado',      g['peso'] == 9000, str(g))
                ck('motorista gravado', g['motorista'] == 'Motorista Auditoria', str(g))
                ck('rota gravada',      g['rota'] == '500', str(g))
                ck('paletizada gravada', g['palet'] == 'Sim', str(g))
                ck('ganchos gravados',  g['ganchos'] == 18, str(g))
                ck('entregas gravadas', g['entregas'] == 3, str(g))
                ck('saiu de "Aguardando Carga"', g['aguardando'] is False, str(g))

        print('\n=== 7. CONSOLE ===')
        ck('sem erros de página', not erros, str(erros))

        await navegador.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
