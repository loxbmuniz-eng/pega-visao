#!/usr/bin/env python3
"""Cadastros deixa de ser a pior aba do celular (27/08/2026).

O PEDIDO, do dono:

    "tem que rolar muito até chegar na parte que é interessante ver, preciso
     que seja dinamico o bastante para ser intuitivo e rapido"

O QUE FOI MEDIDO ANTES, em 390x844:

    Cadastros   8.822px   10,5 telas   <- a pior do painel
    Programação 2.350px    2,8
    Portaria    1.783px    2,1
    Indicadores 1.158px    1,4

E o culpado era UM cartão: a Frota, com 7.465px — 85% da aba. Trinta
cartões de veículo, num aparelho onde quem abre a Frota já sabe a placa
que procura.

DUAS MUDANÇAS, e o porquê de cada uma:

  1. As mesmas seções recolhidas de Indicadores, aqui também. Mecanismo
     idêntico de propósito: dois lugares, um gesto, um resultado. A
     diferença é estrutural — em Cadastros parte dos cartões mora dentro
     de .grid2, então o seletor precisa das duas formas.

  2. A Frota abre pela BUSCA, não pela lista. Sem busca, ela mostra o
     total e convida a digitar. O painel já dizia "refine a busca pra ver
     outras" quando estourava o limite; agora isso é o padrão no celular,
     em vez de ser o castigo depois de rolar.

O QUE ESTE TESTE PROTEGE:

  · a rolagem da aba no celular, com teto;
  · a Frota abrindo sem lista e com o total visível;
  · a lista VOLTANDO assim que se digita algo;
  · o DESKTOP intacto — lá a tabela cabe e serve para varrer;
  · o filtro "só quem precisa de revisão", que mostra lista sem busca
    porque ali a pergunta É a lista.

    python3 testes/test_cadastros_no_celular.py
"""
import asyncio
import sys

from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
TETO_TELAS = 2.5          # antes eram 10,5
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


IR_PARA_CADASTROS = """() => {
  const b = [...document.querySelectorAll('[data-aba],[onclick*="cadastros"],a,button')]
    .find(e => (e.dataset && e.dataset.aba === 'cadastros')
            || (e.getAttribute('onclick') || '').includes("'cadastros'"));
  if (b) b.click();
}"""


async def entrar(pg):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(1100)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(1000)
    await pg.evaluate(IR_PARA_CADASTROS)
    await pg.wait_for_timeout(900)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        erros = []

        # ---------------- CELULAR ----------------
        pg = await nav.new_page(viewport={'width': 390, 'height': 844})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)

        print('\n=== 1. A ABA CABE NO CELULAR ===')
        d = await pg.evaluate("""() => {
              const aba = document.getElementById('tab-cadastros');
              const cards = [...aba.querySelectorAll(':scope > .card, :scope > .grid2 > .card')];
              return { total: aba.scrollHeight, cards: cards.length,
                       abertas: cards.filter(c => c.classList.contains('sec-aberta')).length,
                       linhas: document.querySelectorAll('#frota-tbody tr').length,
                       contagem: (document.getElementById('frota-contagem') || {}).textContent || '' };
            }""")
        telas = d['total'] / 844
        ck(f'a rolagem cabe em {TETO_TELAS} telas', telas <= TETO_TELAS,
           f"{d['total']}px = {telas:.1f} telas")
        ck('os cartões viram seções, e nem todas abertas',
           d['cards'] >= 2 and d['abertas'] < d['cards'],
           f"{d['abertas']} aberta(s) de {d['cards']}")

        print('\n=== 2. A FROTA ABRE PELA BUSCA, NÃO PELA LISTA ===')
        ck('nenhuma linha de veículo sem busca', d['linhas'] == 0, f"{d['linhas']} linha(s)")
        ck('mas o total aparece, e ensina o caminho',
           'placa(s) cadastrada(s)' in d['contagem'] and 'Digite' in d['contagem'],
           d['contagem'])

        print('\n=== 3. DIGITOU, A LISTA VOLTA ===')
        d2 = await pg.evaluate("""() => {
              const placa = (DB.frota && DB.frota[0] && DB.frota[0].placa) || '';
              const busca = document.getElementById('frota-busca');
              busca.value = placa;
              renderFrotaTabela();
              return { placa, linhas: document.querySelectorAll('#frota-tbody tr').length };
            }""")
        ck('a placa buscada aparece', d2['linhas'] >= 1,
           f"{d2['linhas']} linha(s) para {d2['placa']}")

        print('\n=== 4. "SÓ QUEM PRECISA DE REVISÃO" NÃO EXIGE BUSCA ===')
        d3 = await pg.evaluate("""() => {
              document.getElementById('frota-busca').value = '';
              const cx = document.getElementById('frota-so-revisao');
              if (!cx) return { pulado: true };
              cx.checked = true;
              renderFrotaTabela();
              const linhas = document.querySelectorAll('#frota-tbody tr').length;
              const precisam = DB.frota.filter(f => f.precisaRevisao).length;
              cx.checked = false; renderFrotaTabela();
              return { linhas, precisam };
            }""")
        if d3.get('pulado'):
            print('  (não há caixa de revisão nesta tela — nada a medir)')
        else:
            ck('o filtro de revisão mostra lista sem busca',
               d3['precisam'] == 0 or d3['linhas'] >= 1, str(d3))

        print('\n=== 4b. A TABELA DE FRETE ABRE E DÁ PARA TOCAR NO "EDITAR" ===')
        # POR QUE ESTE BLOCO EXISTE (10/09/2026), e ele guarda uma MEDIÇÃO, não
        # só um comportamento.
        #
        # A auditoria de paridade mobile relatou que o rodapé fixo de conexão
        # cobria o botão "✎ Editar" da tabela de destinos. Eu reproduzi e
        # confirmei — `elementFromPoint` no centro do botão devolvia
        # `rodape-conexao`. Depois, rolando até o fim real da página, o botão
        # aparecia LIVRE, e num terceiro teste ele aparecia FORA da tela.
        #
        # Três medições, três respostas. A causa: nesta aba, no celular, TODO
        # CARD NASCE FECHADO (acordeão: `max-height:0`, abre ao toque no
        # título). Medir o retângulo de um botão dentro de um container
        # recortado a zero não mede nada — é a causa nº 2 das quatro do
        # vermelho, o atalho que mudou de forma.
        #
        # Com o acordeão ABERTO, que é o estado em que um dedo de verdade
        # está, o toque cai no botão nos dois aparelhos e também com os 23
        # destinos da tabela oficial. Não havia defeito.
        #
        # A guarda, então, não é de CSS: é de MÉTODO. Se alguém medir esta aba
        # fechada de novo, este bloco reprova e diz por quê.
        # E ESTE BLOCO NÃO PODE HERDAR O ESTADO DOS ANTERIORES.
        #
        # Na primeira versão ele herdou: os blocos 1 a 4 mexem nesta aba, o card
        # chegou aqui ABERTO, e meu clique no título o FECHOU — medi 1768px
        # "fechado" e um botão de 40px. Três execuções, três respostas, e a
        # errada era a minha.
        #
        # Acordeão tem DOIS estados, então o teste declara em qual está antes de
        # medir. Fecha todos, confere que fechou, e só então abre o que interessa.
        r = await pg.evaluate("""() => {
            // Semeia a tabela de frete com os 23 destinos, como em produção.
            const dest = [];
            for (let i = 0; i < 23; i++) dest.push({destino:'DESTINO '+i, km:100+i, operador:'PDF'});
            receberTabelaDeFrete({tarifas:[{tipoVeiculo:'Truck', valorPorKm:7.75, operador:'PDF'}],
                                  destinos:dest});
            renderCadastros();
            const card = document.getElementById('card-tabela-frete');
            if (!card || card.hidden) return {semCard:true};
            // Estado conhecido: nenhum card aberto.
            document.querySelectorAll('#tab-cadastros .card.sec-aberta')
              .forEach(c => c.classList.remove('sec-aberta'));
            const fechado = card.getBoundingClientRect().height;
            const recolhido = getComputedStyle(card.querySelector('.table-wrap')).maxHeight;
            // O dedo abre tocando no TÍTULO — é assim que esta aba funciona.
            card.querySelector('.card-title').click();
            return {fechado: Math.round(fechado), recolhido};
        }""")
        ck('o card da Tabela de Frete existe para a Logística', not r.get('semCard'), str(r))
        if not r.get('semCard'):
            ck('ele NASCE FECHADO no celular — e é por isso que medir fechado não vale',
               r['fechado'] < 120 and r['recolhido'] == '0px',
               f"altura fechado = {r['fechado']}px · max-height da tabela = {r['recolhido']}")
            await pg.wait_for_timeout(700)
            await pg.evaluate("() => { const e = document.scrollingElement; e.scrollTop = e.scrollHeight; }")
            await pg.wait_for_timeout(400)
            m = await pg.evaluate("""() => {
                const card = document.getElementById('card-tabela-frete');
                const bs = [...document.querySelectorAll('#frete-destinos-tbody button')];
                const b = bs[bs.length - 1];
                if (!b) return {semBotao:true};
                const rb = b.getBoundingClientRect();
                const rod = document.getElementById('rodape-conexao').getBoundingClientRect();
                const quem = document.elementFromPoint(rb.left + rb.width/2, rb.top + rb.height/2);
                return { aberto: card.classList.contains('sec-aberta'),
                         botoes: bs.length,
                         altura: Math.round(rb.height),
                         recebeOToque: quem ? (quem.id || quem.tagName) : 'fora da tela',
                         rodapeTop: Math.round(rod.top), botaoBottom: Math.round(rb.bottom) };
            }""")
            ck('tocar no título ABRE o card', m.get('aberto') is True, str(m))
            ck('os 23 destinos têm botão de editar', m.get('botoes') == 23, f"{m.get('botoes')} botões")
            ck('o botão tem 44px de alvo de toque', m.get('altura') == 44, f"{m.get('altura')}px")
            # A asserção que o fantasma violava: o toque tem de chegar no BOTÃO.
            ck('o toque no botão chega no BOTÃO, não no rodapé fixo',
               m.get('recebeOToque') == 'BUTTON',
               f"quem recebe: {m.get('recebeOToque')} · rodapé em {m.get('rodapeTop')}, "
               f"botão termina em {m.get('botaoBottom')}")


        # ---------------- DESKTOP ----------------
        await pg.close()
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)
        print('\n=== 5. NO COMPUTADOR NADA MUDA ===')
        d4 = await pg.evaluate("""() => ({
              linhas: document.querySelectorAll('#frota-tbody tr').length,
              recolhido: getComputedStyle(
                document.querySelector('#tab-cadastros > .card > *:not(.card-title)')
              ).maxHeight
            })""")
        ck('a tabela da Frota continua listando', d4['linhas'] > 1, f"{d4['linhas']} linha(s)")
        ck('e nada fica recolhido', d4['recolhido'] != '0px', str(d4['recolhido']))
        await pg.close()

        print('\n=== 6. SEM ERRO DE JAVASCRIPT ===')
        ck('console limpo', not erros, str(erros))
        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print(f'    · {f}')
        sys.exit(1)
    print('  Tudo verde.')


asyncio.run(main())
