#!/usr/bin/env python3
"""No celular, o Histórico é uma LISTA. (25/08/2026)

Relato do dono: "o histórico no celular ainda está saindo muito grande o
card de cada atualização, não está como uma lista".

Medido antes de mexer: 132px por movimento, e mais da metade era moldura.
O tratamento genérico de cartão — certo para a Torre e a Portaria, onde
cada linha é uma CARGA que a pessoa opera — carimbava em CADA registro os
rótulos DATA/HORA, PLACA, STATUS ANTERIOR, STATUS NOVO e o rodapé "toque
para abrir o registro completo". Quarenta registros na tela viravam
quarenta repetições do mesmo texto, e os badges ainda saíam cortados.

Log não é cartão: ninguém OPERA uma linha de auditoria, a pessoa VARRE
procurando um horário, uma placa ou um nome.

Este teste mede em vez de confiar no olho — foi medindo que apareceram três
defeitos que a tela escondia: a seta entre os status apagada pela minha
própria regra que removia os rótulos, a mesma seta empurrando o badge para
a linha de baixo, e o badge mais longo da escala 1px mais largo que a
coluna.

O que fica guardado:

  1. a linha cabe no orçamento de altura de uma lista;
  2. nenhum status sai cortado — "EMBARQUE ..." não diz se foi iniciado ou
     finalizado, que é a pergunta que o log responde;
  3. os rótulos por campo e o rodapé repetido não voltam;
  4. a linha continua abrindo o registro completo ao toque;
  5. no desktop nada disso muda — lá a tabela é tabela.

    python3 testes/test_historico_lista_mobile.py
"""
import asyncio
import sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'

# Orçamento de altura por linha. O ponto de partida era 132px; três linhas
# de conteúdo em 390px pedem ~80. Folga de 10px para variação de fonte
# entre sistemas — apertar mais que isso transforma o teste num alarme
# falso a cada ajuste de espaçamento.
TETO_ALTURA = 90

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


MONTAR = """() => {
    DB.cargas = []; DB.movimentacoes = [];
    const O = ['Aguardando Embarque','Embarque Iniciado','Embarque Finalizado',
               'Faturado','Seguiu Viagem'];
    DB.frota.slice(0, 5).forEach((f, i) => {
      const c = criarCargaProgramada({placa: f.placa, numeroCarga: 'HL' + i,
        peso: 9000, rota: '500', operador: 'Ana'});
      O.forEach(s => avancarStatusCarga(c.id, s, 'Ana', 'Logística'));
    });
    abrirTab('historico'); renderAll();
  }"""


async def entrar(pg):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(1100)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(800)
    await pg.evaluate(MONTAR)
    await pg.wait_for_timeout(700)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        erros = []

        print('\n=== 1. NO CELULAR: LISTA, NÃO CARTÃO ===')
        ctx = await nav.new_context(viewport={'width': 390, 'height': 844},
                                    is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)

        d = await pg.evaluate("""() => {
              const trs = [...document.querySelectorAll('#hist-tbody tr.hist-linha')];
              const alturas = trs.map(t => t.getBoundingClientRect().height);
              return { linhas: trs.length,
                       maior: Math.round(Math.max(...alturas)),
                       media: Math.round(alturas.reduce((a, b) => a + b, 0) / alturas.length) };
            }""")
        ck('o histórico tem movimentos para medir', d['linhas'] >= 10, str(d))
        ck(f'a linha cabe no orçamento de lista (≤ {TETO_ALTURA}px)',
           d['maior'] <= TETO_ALTURA, f"maior {d['maior']}px · média {d['media']}px")

        print('\n=== 2. NENHUM STATUS SAI CORTADO ===')
        # O defeito que este bloco existe para não deixar voltar: badge mais
        # largo que a coluna. "EMBARQUE ..." não diz se foi iniciado ou
        # finalizado — status cortado é pior que status ausente.
        d = await pg.evaluate("""() => {
              const ruins = [];
              document.querySelectorAll('#hist-tbody tr.hist-linha').forEach(tr => {
                const linha = tr.getBoundingClientRect();
                tr.querySelectorAll('.badge').forEach(b => {
                  const cx = b.parentElement.getBoundingClientRect();
                  const r = b.getBoundingClientRect();
                  // Cortado pela própria célula, ou passando do fim da linha.
                  if (b.scrollWidth > b.clientWidth + 1 || r.right > linha.right + 1) {
                    ruins.push(b.textContent.trim() + ' ('
                      + Math.round(r.width) + 'px em ' + Math.round(cx.width) + 'px)');
                  }
                });
              });
              return ruins;
            }""")
        ck('todo status aparece inteiro', not d, '; '.join(d[:3]))

        maisLongo = await pg.evaluate("""() => {
              const b = [...document.querySelectorAll('#hist-tbody .badge')]
                .sort((x, y) => y.textContent.length - x.textContent.length)[0];
              return b ? b.textContent.trim() : '';
            }""")
        # O que importa é a amostra exercitar o COMPRIMENTO máximo da escala
        # (19 caracteres: "Aguardando Embarque", "Embarque Finalizado"), não
        # um rótulo específico — qualquer um dos dois prova o mesmo aperto.
        ck('e a amostra exercita o rótulo mais longo da escala',
           len(maisLongo) >= 19, f'{maisLongo!r} ({len(maisLongo)} caracteres)')

        print('\n=== 3. O QUE ENCHIA A TELA NÃO VOLTA ===')
        d = await pg.evaluate("""() => {
              const tr = document.querySelector('#hist-tbody tr.hist-linha');
              // DISPLAY, não `content`: getComputedStyle devolve o texto
              // declarado mesmo quando o pseudo-elemento não é desenhado.
              // Conferir `content` diria que os rótulos estão lá — mesma
              // armadilha do textContent, que também lê o que não aparece.
              const rot = [...tr.children]
                .map((td, i) => [i, getComputedStyle(td, '::before').display])
                .filter(([i, d]) => d !== 'none' && i !== 3)
                .map(([i]) => 'célula ' + (i + 1));
              const rodape = getComputedStyle(tr, '::after');
              const seta = getComputedStyle(tr.children[3], '::before');
              return { pseudoNasCelulas: rot,
                       rodapeConteudo: rodape.content, rodapeDisplay: rodape.display,
                       setaConteudo: seta.content, setaDisplay: seta.display,
                       texto: tr.innerText };
            }""")
        ck('nenhum rótulo de campo é desenhado na linha',
           not d['pseudoNasCelulas'], str(d['pseudoNasCelulas']))
        ck('o rodapé "toque para abrir" não aparece em cada registro',
           d['rodapeDisplay'] == 'none', f"{d['rodapeConteudo']} / {d['rodapeDisplay']}")
        ck('a seta entre os status aparece',
           '→' in d['setaConteudo'] and d['setaDisplay'] != 'none', str(d['setaConteudo']))
        for palavra in ('DATA/HORA', 'STATUS ANTERIOR', 'STATUS NOVO', 'TOQUE PARA ABRIR'):
            ck(f'a linha não repete "{palavra}"',
               palavra not in d['texto'].upper(), d['texto'].replace('\n', ' ')[:70])

        print('\n=== 4. E CONTINUA ABRINDO O REGISTRO COMPLETO ===')
        # Enxugar não pode custar a função: o detalhe é o que essa tela ganhou
        # em 20/08 e é onde moram peso, cliente, lacre e observação.
        d = await pg.evaluate("""() => {
              const tr = document.querySelector('#hist-tbody tr.hist-linha');
              tr.click();
              const det = tr.nextElementSibling;
              return { abriu: det && det.classList.contains('hist-detalhe') && !det.hidden,
                       altura: det ? Math.round(det.getBoundingClientRect().height) : 0 };
            }""")
        await pg.wait_for_timeout(300)
        ck('tocar na linha abre o detalhe', d['abriu'], str(d))
        ck('e o detalhe tem conteúdo de verdade', d['altura'] > 60, f"{d['altura']}px")
        await ctx.close()

        print('\n=== 5. NO DESKTOP CONTINUA TABELA ===')
        ctx2 = await nav.new_context(viewport={'width': 1360, 'height': 900})
        pg2 = await ctx2.new_page()
        pg2.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg2)
        d = await pg2.evaluate("""() => {
              const tr = document.querySelector('#hist-tbody tr.hist-linha');
              return { display: getComputedStyle(tr).display,
                       colunas: [...tr.children].length,
                       altura: Math.round(tr.getBoundingClientRect().height) };
            }""")
        ck('a linha continua sendo linha de tabela',
           d['display'].startswith('table-row'), str(d))
        ck('com as seis colunas', d['colunas'] == 6, str(d))
        ck('e altura de linha, não de cartão', d['altura'] < 60, f"{d['altura']}px")
        await ctx2.close()

        print('\n=== 6. SEM ERRO DE JAVASCRIPT ===')
        ck('console limpo', not erros, '; '.join(erros[:3]))

        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('  Tudo verde.')
    return 0


sys.exit(asyncio.run(main()))
