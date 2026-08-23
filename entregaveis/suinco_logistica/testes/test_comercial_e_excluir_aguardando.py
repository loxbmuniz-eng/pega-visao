#!/usr/bin/env python3
"""Comercial só Visão de Pátio + Histórico; excluir no Aguardando Carga.

Pedidos do usuário (11/08/2026):
  - "ah, a visão do comercial, só visão de pátio e histórico"
  - "ADICIONAR UM BOTAO DE EXCLUIR NO AGUARDANDO CARGA"

A Visão do Pátio mora dentro da Torre de Controle, por isso 'torre'
continua liberada — é o caminho até ela, não poder a mais: a Torre é
leitura pura e seus campos editáveis só existem para quem pode cancelar
carga (Logística/Administração), o que o Comercial nunca é.

'usuarios' entrou na lista em 22/08/2026 pelo mesmo raciocínio, ao
contrário: com o segundo fator, a aba deixou de ser só a tela de
administrar gente e passou a ser onde CADA PESSOA protege a própria conta.
O Comercial tem login e senha como todo mundo. Por isso o teste não pergunta
mais "ele vê a aba?" e sim "o que ele encontra dentro dela?" — a lista de
operadores e os pedidos de aprovação continuam fora do alcance dele, e é
isso que precisa ser garantido.

    python3 testes/test_comercial_e_excluir_aguardando.py
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


TROCAR_SETOR = """(s) => {
    DB.operador.setor = s;
    SuincoStore.save();
    aplicarPermissoesSetor();
    renderAll();
}"""


async def entrar(pg, setor):
    """Entra pelo modo local e ajusta o setor.

    O seletor do login SEM servidor lista só os quatro setores
    operacionais — Comercial e Administração existem apenas no login real,
    contra o servidor. Para testar a visão do Comercial sem subir backend,
    o setor é trocado direto e as permissões reaplicadas: é o mesmo estado
    a que o login real chegaria.
    """
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(900)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Teste')
    await pg.select_option('#login-setor', 'Logística')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(600)
    if setor != 'Logística':
        await pg.evaluate(TROCAR_SETOR, setor)
        await pg.wait_for_timeout(500)


async def abas_visiveis(pg):
    return await pg.evaluate(
        "() => Array.from(document.querySelectorAll('.nav-tab'))"
        ".filter(e=>!e.hidden).map(e=>e.dataset.tab)")


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []

        print('\n=== 1. COMERCIAL: PÁTIO, HISTÓRICO E A PRÓPRIA SEGURANÇA ===')
        pg = await nav.new_page()
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg, 'Comercial')

        abas = await abas_visiveis(pg)
        print(f'  abas visíveis: {abas}')
        # "usuarios" entrou na lista em 22/08/2026, com o segundo fator: a aba
        # deixou de ser a tela de ADMINISTRAR gente e passou a ser também onde
        # cada pessoa protege a própria conta. O Comercial tem login e senha
        # como todo mundo, então precisa poder ativar o dele — o que não muda
        # é que ele não administra ninguém, e isso é conferido logo abaixo,
        # olhando o CONTEÚDO da aba e não só o nome dela.
        ck('Comercial vê pátio, histórico e a própria segurança',
           sorted(abas) == ['historico', 'torre', 'usuarios'], str(abas))
        ck('Relatórios saiu da visão do Comercial', 'relatorios' not in abas, str(abas))
        for proibida in ['programacao', 'portaria', 'expedicao', 'faturamento',
                         'cadastros', 'indicadores']:
            ck(f'Comercial NÃO vê {proibida}', proibida not in abas)

        # A parte que importa: dentro de Usuários ele só encontra a própria
        # segurança. Aba visível não pode virar porta de entrada para a lista
        # de operadores nem para as aprovações de ação crítica.
        await pg.evaluate("()=>abrirTab('usuarios')")
        await pg.wait_for_timeout(1500)
        dentro = await pg.evaluate("""()=>{
          const vis = el => !!el && el.offsetParent !== null;
          const aba = document.getElementById('tab-usuarios');
          return {
            cards: [...aba.querySelectorAll('.card')].filter(vis).map(c=>c.id||'(sem id)'),
            listaOperadores: vis(document.getElementById('usr-tbody')),
            aprovacoes: vis(document.getElementById('card-aprovacoes')),
            minhaSeguranca: vis(document.getElementById('card-minha-seguranca')),
          };
        }""")
        ck('na aba Usuários ele vê só "Minha segurança"',
           dentro['cards'] == ['card-minha-seguranca'], str(dentro['cards']))
        ck('Comercial NÃO vê a lista de operadores', not dentro['listaOperadores'])
        ck('Comercial NÃO vê os pedidos de aprovação', not dentro['aprovacoes'])
        ck('mas PODE ativar o próprio segundo fator', dentro['minhaSeguranca'])

        print('\n=== 2. COMERCIAL NÃO GANHA CAMPO EDITÁVEL NA TORRE ===')
        await pg.evaluate("""() => {
            DB.operador.setor = 'Logística';
            criarCargaProgramada({placa:DB.frota[0].placa, numeroCarga:'COM1',
                peso:9000, rota:'500', operador:'Teste'});
            DB.operador.setor = 'Comercial';
            SuincoStore.save();
            aplicarPermissoesSetor();
            renderAll();
        }""")
        await pg.wait_for_timeout(600)
        await pg.evaluate("() => irParaTab('torre')")
        await pg.wait_for_timeout(500)
        ck('sem campo de peso editável', not await pg.is_visible('#torre-tbody .peso-input'))
        ck('sem campo de rota editável', not await pg.is_visible('#torre-tbody .rota-inline'))
        ck('sem botão de cancelar/excluir', not await pg.is_visible('#torre-tbody .btn-danger'))
        ck('mas a carga APARECE (é leitura, não cegueira)',
           'COM1' in (await pg.eval_on_selector_all(
               '#torre-tbody td', 'els => els.map(e=>e.textContent).join(" ")')))
        await pg.close()

        print('\n=== 3. EXCLUIR NO AGUARDANDO CARGA (Logística) ===')
        pg2 = await nav.new_page()
        pg2.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg2, 'Logística')
        await pg2.evaluate("""() => {
            registrarChegadaPortaria(DB.frota[3].placa, 'Teste', 'Portaria');
            renderAll();
        }""")
        await pg2.wait_for_timeout(700)
        await pg2.evaluate("() => irParaTab('programacao')")
        await pg2.wait_for_timeout(500)

        antes = await pg2.evaluate("() => DB.cargas.filter(c=>c.aguardandoCarga).length")
        ck('existe carga em Aguardando Carga pra testar', antes > 0, str(antes))
        ck('botão Excluir aparece na lista',
           await pg2.is_visible('#prog-aguardando-tbody .btn-danger'))

        # A carga registrada pela Portaria já está em "Aguardando Embarque"
        # — ou seja, JÁ ANDOU — e o painel exige motivo por prompt() antes
        # de cancelar. Aceitar em branco equivale a desistir, então o
        # diálogo precisa vir preenchido.
        pg2.on('dialog', lambda d: asyncio.ensure_future(
            d.accept('lançada por engano — teste')))
        await pg2.click('#prog-aguardando-tbody .btn-danger')
        await pg2.wait_for_timeout(1200)
        depois = await pg2.evaluate("() => DB.cargas.filter(c=>c.aguardandoCarga).length")
        ck('a carga saiu da lista depois de excluir', depois == antes - 1, f'{antes} -> {depois}')

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
