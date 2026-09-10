#!/usr/bin/env python3
"""O painel registra sozinho quando a tela congela.

RELATO DO DONO, 10/09/2026, com print do "Page Unresponsive": o painel
trava. Depois: "travou no meu também" — duas máquinas.

MEDIDO AQUI COM O VOLUME REAL DELE E NÃO REPRODUZIDO. Com os números da
própria tela dele (18 cargas em aberto, 5 de programação anterior) a Torre
desenha em menos de 1 s; com 80 linhas de montagem, 80 rotas e todos os
selects, a Montagem desenha em 439 ms. Também foram descartados, no código:
vazamento de escuta (as 12 são delegadas e criadas uma vez só), lista de
sugestão por linha (são únicas na página), redesenho ao arrastar (o dragover
só marca o destino) e redesenho a cada tique (só se algo mudou).

Corrigir sem enxergar seria chute. Então o painel passa a medir.

O que este teste trava:
  · uma tarefa longa de verdade fica REGISTRADA, com duração e aba;
  · o registro sobrevive a recarregar a página (é ele que a pessoa vai
    mostrar no dia seguinte);
  · o aviso NÃO aparece quando não há travamento — alarme que sempre
    aparece deixa de ser alarme;
  · medir nunca derruba a tela: com o armazenamento local quebrado, o
    painel continua desenhando.

    python3 testes/test_medidor_de_travamento.py
"""
import asyncio, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def entrar(pg):
    # Depois de recarregar, o operador volta do armazenamento local e a
    # tela JÁ ESTÁ logada — insistir no formulário aqui é esperar por um
    # campo que o painel não vai mostrar, e foi o que travou a primeira
    # versão deste teste por 30 s.
    ja = await pg.evaluate(
        "() => !document.body.classList.contains('pre-login') && !!DB.operador")
    if ja:
        return
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Luis')
    await pg.select_option('#login-setor', 'Administração')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(500)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        # O diálogo do navegador precisa ser respondido, senão o teste trava
        # de verdade — ironia que já custou uma bateria noutra suíte.
        vistos = []
        pg.on('dialog', lambda d: (vistos.append(d.message), asyncio.ensure_future(d.dismiss())))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(1200)
        await entrar(pg)

        print('\n=== 1. SEM TRAVAMENTO, SEM ALARME ===')
        d = await pg.evaluate("""() => {
              limparTravamentosUI();
              atualizarRodapeConexao('local');
              return { botao: !!document.querySelector('.rodape-travas'),
                       registrados: _travamentos.length };
            }""")
        ck('nada registrado num painel recém-aberto', d['registrados'] == 0, str(d))
        ck('e o rodapé não mostra alarme nenhum', d['botao'] is False,
           'alarme que sempre aparece deixa de ser alarme')

        print('\n=== 2. UMA TAREFA LONGA DE VERDADE FICA REGISTRADA ===')
        # Não é simulação: o laço abaixo segura a linha de execução mesmo,
        # e é o navegador que decide chamar aquilo de "longtask".
        await pg.evaluate("""() => {
              abrirTab('torre');
              const fim = performance.now() + 900;
              while(performance.now() < fim) { /* segura a tela de propósito */ }
            }""")
        await pg.wait_for_timeout(800)
        d = await pg.evaluate("""() => ({
              registrados: _travamentos.length,
              ultimo: _travamentos[_travamentos.length - 1] || null,
              botao: !!document.querySelector('.rodape-travas'),
            })""")
        ck('o travamento foi registrado', d['registrados'] >= 1, str(d['registrados']))
        if d['ultimo']:
            ck('com a duração medida, não estimada', d['ultimo']['ms'] >= 500,
               f"{d['ultimo']['ms']} ms")
            ck('e diz em qual aba a pessoa estava', d['ultimo']['aba'] == 'torre',
               str(d['ultimo']['aba']))
            ck('e o volume do momento, que é o que explica o peso',
               isinstance(d['ultimo'].get('volume'), dict)
               and 'abertas' in d['ultimo']['volume'], str(d['ultimo'].get('volume')))
            ck('e a versão do painel — travamento de versão antiga engana',
               bool(d['ultimo'].get('versao')), str(d['ultimo'].get('versao')))
        else:
            ck('com a duração medida, não estimada', False, 'nenhum registro')
        ck('e o rodapé passa a mostrar o alarme', d['botao'] is True, str(d['botao']))

        print('\n=== 3. O REGISTRO SOBREVIVE A RECARREGAR ===')
        # É o ponto todo: a pessoa fecha a aba assustada e só mostra a tela
        # no dia seguinte. Registro que morre no reload não serve para nada.
        await pg.reload()
        await pg.wait_for_timeout(1200)
        await entrar(pg)
        d = await pg.evaluate("""() => ({
              registrados: _travamentos.length,
              botao: !!document.querySelector('.rodape-travas'),
            })""")
        ck('o que foi registrado continua lá depois de recarregar',
           d['registrados'] >= 1, str(d['registrados']))
        ck('e o alarme volta a aparecer sozinho', d['botao'] is True, str(d['botao']))

        print('\n=== 4. O RELATO SAI EM TEXTO QUE DÁ PARA MANDAR ===')
        await pg.evaluate("() => mostrarTravamentosUI()")
        await pg.wait_for_timeout(300)
        texto = vistos[-1] if vistos else ''
        ck('o diálogo abre com o registro', bool(texto), repr(texto[:60]))
        ck('e traz a versão do painel', 'versão' in texto or 'vers' in texto,
           repr(texto[:80]))
        ck('e a contagem de cargas em aberto', 'em aberto' in texto, repr(texto[:120]))

        print('\n=== 5. MEDIR NUNCA DERRUBA A TELA ===')
        # O medidor grava no armazenamento local. Se ele estiver cheio ou
        # bloqueado (navegador em janela anônima, política de empresa), o
        # painel não pode parar de desenhar por causa disso.
        d = await pg.evaluate("""() => {
              const original = localStorage.setItem;
              localStorage.setItem = () => { throw new Error('cofre cheio'); };
              let quebrou = false;
              try { registrarTravamento(1200, performance.now()); }
              catch(e){ quebrou = true; }
              localStorage.setItem = original;
              renderAll();
              return { quebrou, telaViva: !!document.getElementById('rodape-conexao') };
            }""")
        ck('gravar impossível não lança erro na tela', d['quebrou'] is False)
        ck('e o painel continua desenhando', d['telaViva'] is True)
        ck('nenhum erro de JavaScript em todo o percurso', not erros, str(erros[:1]))

        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)


asyncio.run(main())
