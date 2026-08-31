#!/usr/bin/env python3
"""A faixa vai pro rodapé, o login abre sozinho, e o aviso não empilha (31/08/2026).

TRÊS RELATOS DO DONO, no mesmo intervalo, com a operação parada:

    "a faixa ta aparecendo ainda até na parte do desktop zuando tudo, as
     pessoas nao conseguem fazer o proprio login"

    "PRECISA ARRANCAR A FAIXA OU DEIXAR ELA NO RODAPE / NAO TAMPANDO BOTOES"

    "ta vindo muitos avisos aguardando e eu nao quero isso aparecendo, sao
     todos avisos de voce esta offline"

O QUE SE MEDIU, no desktop 1440x900, com a sessão perdida:

    loginAberto: False
    quemRecebeNoBotao: 'faixa-offline'   quemRecebeNoEmail: 'faixa-offline'
    DIGITOU NO EMAIL: NAO                CLICOU NO ENTRAR: NAO

DUAS COISAS ERRADAS, e eu tratei a primeira três vezes sem enxergar a
segunda:

  1. a faixa ocupava o TOPO da tela inteira, onde ficam os botões. Baixar o
     z-index e impedir que ela nascesse com o login aberto não resolvem
     isso: uma tarja do tamanho da tela no lugar da ação é um bloqueio com
     outro nome. Ela foi para o rodapé e ganhou `pointer-events:none` — o
     clique ATRAVESSA, e só o botão de entrar de novo recebe toque;

  2. e o principal: NÃO HAVIA LOGIN NA TELA. O painel reabre com o operador
     restaurado do localStorage, monta a tela de trabalho inteira, e a caixa
     de login fica `display:none`. A pessoa olha botões que não gravam nada
     e não tem por onde entrar. Sem sessão não há o que fazer no painel —
     então o painel passa a PEDIR a sessão.

O terceiro relato é aritmético: com a sessão morta toda gravação é recusada,
e cada recusa abria seu próprio aviso de 12 a 20 segundos. A sincronia tenta
a cada 15 s e o operador continua clicando. A faixa já diz o que houve; o
aviso individual não pode empilhar.

O QUE ESTE TESTE EXIGE:

  1. sessão perdida ABRE a tela de login sozinha;
  2. com ela aberta, dá para digitar no e-mail e clicar em Entrar de
     verdade — não "o elemento existe", mas o clique chegando nele;
  3. a faixa fica no RODAPÉ, nunca no topo, e não intercepta clique;
  4. avisos de conexão não empilham: um só na tela.

Roda sem servidor.

    python3 testes/test_faixa_no_rodape_e_login_abre.py
"""
import asyncio
import sys

from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
TELAS = [(1440, 900, 'desktop'), (740, 360, 'celular deitado'),
         (390, 844, 'celular em pé')]

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        erros = []

        for larg, alt, nome in TELAS:
            print(f'\n=== {nome.upper()} ({larg}x{alt}) ===')
            ctx = await nav.new_context(viewport={'width': larg, 'height': alt})
            pg = await ctx.new_page()
            pg.on('pageerror', lambda e: erros.append(str(e)))
            await pg.goto(PAINEL)
            await pg.wait_for_timeout(1000)
            # O ESTADO DE QUEM JÁ USOU O PAINEL e perdeu a sessão: operador
            # salvo no aparelho, marca de entrada pelo servidor, sem token.
            await pg.evaluate("""() => {
                DB.operador = { id:'u1', nome:'Rene', setor:'Expedição',
                                email:'rene@suinco.com.br' };
                SuincoStore.save();
                localStorage.setItem('suinco_entrou_pelo_servidor', '1');
            }""")
            await pg.reload()
            await pg.wait_for_timeout(1400)
            # É por aqui que a sincronia avisa o painel — o caminho de verdade.
            await pg.evaluate("() => atualizarRodapeConexao('local')")
            await pg.wait_for_timeout(500)

            estado = await pg.evaluate("""() => {
                const m = document.getElementById('modal-operador');
                const b = document.getElementById('btn-entrar');
                const e = document.getElementById('login-email');
                const q = b.getBoundingClientRect(), eq = e.getBoundingClientRect();
                const em = (x, y) => {
                    const n = document.elementFromPoint(Math.round(x), Math.round(y));
                    return n ? (n.id || n.className || n.tagName) : null;
                };
                return { loginAberto: m.classList.contains('open'),
                         noBotao: em(q.left + q.width/2, q.top + q.height/2),
                         noEmail: em(eq.left + eq.width/2, eq.top + eq.height/2) };
            }""")
            ck(f'{nome}: a sessão perdida ABRE a tela de login sozinha',
               estado['loginAberto'], str(estado))
            ck(f'{nome}: o clique no e-mail chega no e-mail',
               estado['noEmail'] == 'login-email', str(estado))
            ck(f'{nome}: o clique no Entrar chega no Entrar',
               estado['noBotao'] == 'btn-entrar', str(estado))

            # Não basta o elemento existir: tem que dar para USAR.
            try:
                await pg.fill('#login-email', 'teste@suinco.com.br', timeout=4000)
                digitou = True
            except Exception:
                digitou = False
            ck(f'{nome}: dá para digitar o e-mail de verdade', digitou)
            try:
                await pg.click('#btn-entrar', timeout=4000)
                clicou = True
            except Exception:
                clicou = False
            ck(f'{nome}: dá para clicar em Entrar de verdade', clicou)

            # O BOTÃO PRECISA ESTAR DENTRO DA TELA, não só existir.
            #
            # Medido em 31/08/2026 no celular deitado (740x360), que é como
            # o pátio segura o aparelho: o bloco da marca ocupava 161px dos
            # 360 — 45% da tela —, o formulário virava uma fresta de 91px e
            # o botão "Entrar" caía em 388–440, ABAIXO do fim da tela.
            # `elementFromPoint` devolvia None: fora da área visível.
            #
            # Existir e ser alcançável são coisas diferentes, e foi a
            # diferença entre as duas que travou a operação.
            fold = await pg.evaluate("""() => {
                const b = document.getElementById('btn-entrar');
                const q = b.getBoundingClientRect();
                return { topo: Math.round(q.top), fundo: Math.round(q.bottom),
                         tela: window.innerHeight,
                         dentro: q.top >= 0 && q.bottom <= window.innerHeight };
            }""")
            ck(f'{nome}: o botão Entrar está DENTRO da tela, sem precisar rolar',
               fold['dentro'], f"botão em {fold['topo']}–{fold['fundo']} de {fold['tela']}px")
            await ctx.close()

        print('\n=== A FAIXA FICA NO RODAPÉ, E NÃO INTERCEPTA CLIQUE ===')
        ctx = await nav.new_context(viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(1000)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Rene')
        await pg.select_option('#login-setor', 'Expedição')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(600)
        pos = await pg.evaluate("""() => {
            atualizarFaixaOffline('offline');
            const f = document.getElementById('faixa-offline');
            if(!f) return { semFaixa: true };
            const q = f.getBoundingClientRect();
            const cs = getComputedStyle(f);
            return { topo: Math.round(q.top), fundo: Math.round(q.bottom),
                     altura: window.innerHeight, posicao: cs.position,
                     cliqueAtravessa: cs.pointerEvents === 'none' };
        }""")
        ck('a faixa existe quando está offline', not pos.get('semFaixa'), str(pos))
        if not pos.get('semFaixa'):
            ck('ela fica na METADE DE BAIXO da tela, longe dos botões',
               pos['topo'] > pos['altura'] / 2,
               f"topo em {pos['topo']}px de {pos['altura']}px")
            ck('o clique ATRAVESSA a faixa (pointer-events:none)',
               pos['cliqueAtravessa'], str(pos))

        print('\n=== AVISO DE CONEXÃO NÃO EMPILHA ===')
        # Vinte recusas seguidas é o que acontece de verdade quando a
        # sincronia insiste a cada 15 s e o operador continua clicando.
        empilhou = await pg.evaluate("""() => {
            for(let i = 0; i < 20; i++){
              notify('⛔ CARGA-' + i + ': VOCÊ ESTÁ OFFLINE — SISTEMA INDISPONÍVEL. '
                     + 'NADA FOI GRAVADO.', 'danger', 20000);
            }
            return { deConexao: document.querySelectorAll('.notif-item.aviso-de-conexao').length,
                     total: document.querySelectorAll('.notif-item').length };
        }""")
        ck('vinte recusas seguidas deixam UM aviso na tela, não vinte',
           empilhou['deConexao'] == 1, str(empilhou))

        # E o aviso que NÃO é de conexão continua aparecendo normalmente —
        # calar tudo seria trocar um defeito por outro pior.
        outros = await pg.evaluate("""() => {
            notify('Carga 118495 programada.', 'success', 4000);
            notify('Placa AAA1A11 cadastrada.', 'success', 4000);
            return { total: document.querySelectorAll('.notif-item').length };
        }""")
        ck('aviso comum continua aparecendo (não calamos a tela inteira)',
           outros['total'] >= 3, str(outros))

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


sys.exit(asyncio.run(main()))
