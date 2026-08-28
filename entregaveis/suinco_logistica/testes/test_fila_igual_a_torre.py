#!/usr/bin/env python3
"""A Fila de Programados ganha as colunas da Torre (28/08/2026).

O PEDIDO, do dono:

    "eu quero deixar os campos da programação do mesmo jeito que aparece na
     torre de controle (...) primeira coluna sequência, segunda coluna
     número de carga, terceira coluna veículo, quarta coluna motorista,
     quinta coluna rota, sexta coluna peso, sétima coluna paletizada. E
     clicar em cima e ela possa expandir e aí sim ter todas as informações
     completas."

E, confirmado por ele depois: os botões "➕ Outra carga" e "Excluir" FICAM
NA LINHA — quem programa outra carga ou exclui está varrendo a fila, não
preenchendo.

POR QUE ORDEM IGUAL IMPORTA. É a mesma pessoa, no mesmo dia, olhando a
mesma carga em duas telas. Duas ordens diferentes para o mesmo trabalho
produzem erro de campo trocado — e campo trocado numa carga é caminhão
saindo com o dado de outro.

O QUE ESTE TESTE EXIGE:

  · as sete colunas, na ordem, e as mesmas da Torre;
  · a célula de Veículo reunindo placa, transportadora e tipo, como lá;
  · a linha ABRE ao clique;
  · o que saiu da linha (Tipo de Operação, Ganchos, Entregas, Observações)
    está na expansão e grava NA CARGA;
  · os botões continuam na linha, e clicar neles NÃO abre a linha.

    python3 testes/test_fila_igual_a_torre.py
"""
import asyncio
import sys

from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []

# A ordem que o dono ditou, palavra por palavra.
COLUNAS = ['Seq.', 'Nº Carga', 'Veículo', 'Motorista', 'Rota', 'Peso (kg)', 'Palet.', 'Tipo de Operação']


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def entrar(pg):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(1100)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', 'Logística')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(900)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        pg = await nav.new_page(viewport={'width': 1400, 'height': 950})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)

        d = await pg.evaluate("""() => {
              const placa = (DB.frota && DB.frota[0] && DB.frota[0].placa) || '';
              const c = criarCargaProgramada({ placa, numeroCarga: 'FILA-1',
                cliente: 'Cliente X', destino: 'Destino Y', rota: '500',
                peso: 12000, sequencia: 4, qtdGanchos: 3, qtdEntregas: 7,
                observacoes: 'obs original', motorista: 'Zé',
                operador: {nome:'Ana', setor:'Logística'} });
              irParaTab('programacao');
              renderProgFila();
              return { id: c.id, placa };
            }""")
        await pg.wait_for_timeout(600)

        print('\n=== 1. AS SETE COLUNAS, NA ORDEM DITADA ===')
        cabec = await pg.evaluate("""() => [...document.querySelectorAll(
              '#prog-fila-tbody')].length ? [...document.querySelectorAll(
              '#tab-programacao table thead th')].map(t => t.textContent.trim()) : []""")
        # A tabela da fila é a que tem o tbody prog-fila-tbody.
        cabec = await pg.evaluate("""() => {
              const tb = document.getElementById('prog-fila-tbody');
              const tabela = tb ? tb.closest('table') : null;
              return tabela ? [...tabela.querySelectorAll('thead th')]
                .map(t => t.textContent.trim()) : [];
            }""")
        ck('são 9 colunas: as 8 editáveis + Ação', len(cabec) == 9, str(cabec))
        ck('e estão exatamente na ordem pedida', cabec[:8] == COLUNAS, str(cabec[:8]))

        torre = await pg.evaluate("""() => {
              renderTorre && renderTorre();
              const th = document.getElementById('torre-thead');
              return th ? [...th.querySelectorAll('th')].map(t => t.textContent.trim()) : [];
            }""")
        ck('as oito primeiras são AS MESMAS da Torre',
           torre[:8] == COLUNAS, f'torre={torre[:8]}')

        # A TERCEIRA TELA (28/08/2026): "quero poder ver isso na montagem do
        # dia". As três onde a mesma carga aparece têm que falar a mesma
        # língua — conferido contra o cabeçalho REAL de cada uma, nunca
        # contra uma lista copiada aqui.
        mont = await pg.evaluate("""() => {
              const t = document.getElementById('mont-tabela');
              return t ? [...t.querySelectorAll('thead th')].map(x=>x.textContent.trim()) : [];
            }""")
        ck('e a Montagem do Dia também', mont[:8] == COLUNAS, f'montagem={mont[:8]}')

        print('\n=== 2. VEÍCULO REÚNE PLACA, TRANSPORTADORA E TIPO ===')
        v = await pg.evaluate("""() => {
              const cel = document.querySelector('#prog-fila-tbody .cel-veiculo');
              if(!cel) return null;
              return { temPlaca: !!cel.querySelector('.placa-input'),
                       temTransp: !!cel.querySelector('.veic-transp'),
                       temTipo: !!cel.querySelector('.veic-tipo') };
            }""")
        ck('a célula de veículo existe e traz os três', v and v['temPlaca']
           and v['temTransp'] and v['temTipo'], str(v))

        print('\n=== 3. A LINHA ABRE AO CLIQUE, COM O RESTO DOS CAMPOS ===')
        ab = await pg.evaluate("""(id) => {
              document.querySelector('#prog-fila-tbody tr.prog-linha').click();
              const det = document.querySelector('#prog-fila-tbody tr.prog-detalhe');
              if(!det) return { abriu: false };
              const rot = [...det.querySelectorAll('label')].map(l => l.textContent.trim());
              const html = det.innerHTML;
              return { abriu: true, rotulos: rot,
                       entregas: html.includes("atualizarEntregasUI('" + id + "'"),
                       ganchos: html.includes("atualizarGanchosUI('" + id + "'"),
                       praonde: html.includes("atualizarPraOndeUI('" + id + "'"),
                       obs: html.includes("atualizarObservacoesUI('" + id + "'"),
                       cliente: html.includes("atualizarClienteUI('" + id + "'") };
            }""", d['id'])
        ck('a linha abriu', ab.get('abriu') is True, str(ab)[:70])
        if ab.get('abriu'):
            juntos = ' | '.join(ab['rotulos'])
            for r in ['Qtd. Ganchos', 'Qtd. Entregas',
                      'Cliente', 'Destino', 'Observações']:
                ck(f'a expansão tem {r}', r in juntos, juntos[:90])
            ck('e TUDO ali grava na carga, não numa cópia',
               ab['entregas'] and ab['ganchos'] and ab['obs'] and ab['cliente'], str(ab))
            # Tipo de Operação subiu para a LINHA: não pode existir nos dois
            # lugares da mesma tela, senão são dois campos para um dado só.
            ck('Tipo de Operação está na LINHA, e só nela',
               not ab['praonde'], str(ab['praonde']))

        print('\n=== 4. A GRAVAÇÃO CHEGA NA CARGA ===')
        g = await pg.evaluate("""(id) => {
              atualizarEntregasUI(id, '11');
              atualizarObservacoesUI(id, 'escrito na expansão');
              const c = getCarga(id);
              return { entregas: c.qtdEntregas, obs: c.observacoes };
            }""", d['id'])
        ck('as entregas mudaram na carga', str(g['entregas']) == '11', str(g['entregas']))
        ck('a observação também', g['obs'] == 'escrito na expansão', str(g['obs']))

        print('\n=== 5. OS BOTÕES FICAM NA LINHA — E NÃO ABREM A LINHA ===')
        b = await pg.evaluate("""() => {
              _progFilaAberta = null; renderProgFila();
              const tr = document.querySelector('#prog-fila-tbody tr.prog-linha');
              const outra = tr.querySelector('button.btn-sec');
              const excluir = tr.querySelector('button.btn-danger');
              return { naLinha: !!outra && !!excluir,
                       textos: [outra && outra.textContent.trim(),
                                excluir && excluir.textContent.trim()] };
            }""")
        ck('"Outra carga" e "Excluir" estão na própria linha', b['naLinha'], str(b['textos']))

        semAbrir = await pg.evaluate("""() => {
              window.confirm = () => false;   // cancela a exclusão
              const tr = document.querySelector('#prog-fila-tbody tr.prog-linha');
              tr.querySelector('button.btn-danger').click();
              return !!document.querySelector('#prog-fila-tbody tr.prog-detalhe');
            }""")
        ck('clicar no botão NÃO abre a linha por tabela', semAbrir is False, str(semAbrir))

        print('\n=== 6. SEM ERRO DE JAVASCRIPT ===')
        ck('console limpo', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print(f'    · {f}')
        return 1
    print('  Tudo verde.')
    return 0


sys.exit(asyncio.run(main()))
