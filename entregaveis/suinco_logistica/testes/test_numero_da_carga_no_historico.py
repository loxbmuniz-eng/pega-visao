#!/usr/bin/env python3
"""O Histórico mostra o Nº da Carga, e o número leva à linha do tempo (25/09/2026).

PEDIDO DO DONO: "eu quero que apareca o numero da carga em uma coluna do
historico e fique mais facil".

O BURACO, E ELE CONVIVIA COM A BUSCA DO LADO. O campo de procura do
Histórico aceita número de carga desde sempre — o rótulo dele diz
"Ex: ABC1D23 ou 10245". Mas NENHUMA coluna mostrava o número. A pessoa
procurava, vinham as linhas, e não dava para confirmar qual carga era
cada uma. Procurar sem poder conferir é pior que não procurar: dá a
resposta sem dar a prova.

POR QUE O NÚMERO NÃO É GUARDADO NA MOVIMENTAÇÃO. Ela guarda `cargaId`, e
está certo: o número pode ser corrigido depois, e um registro de
auditoria com uma CÓPIA dele passaria a mentir no dia da correção. O
número se resolve pela carga, sempre — é o que `numeroDaCargaDaMovimentacao`
faz, num lugar só.

O QUE ESTE TESTE TRAVA

  1. a coluna existe no cabeçalho, entre Placa e Status Anterior;
  2. a linha mostra o número da carga daquela movimentação — o número
     CERTO, não o de outra linha;
  3. clicar no número abre a linha do tempo daquela carga, sem digitar
     nada (o "fique mais fácil" do pedido);
  4. o clique no número NÃO abre o detalhe da linha junto — são duas
     ações diferentes no mesmo lugar, e uma não pode disparar a outra;
  5. a linha de detalhe continua cobrindo a tabela inteira. Uma coluna a
     mais sem acertar o `colspan` desalinha a tabela toda, e é o tipo de
     defeito que só aparece quando alguém abre uma linha;
  6. carga fora do período carregado DIZ isso, em vez de um traço mudo —
     traço faz concluir que a carga não tinha número.

    python3 testes/test_numero_da_carga_no_historico.py
"""
import asyncio
import re
import sys
from pathlib import Path

from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    print('\n=== 1. NO CÓDIGO ===')
    html = (RAIZ / 'index_suinco.html').read_text(encoding='utf-8')
    cab = re.search(r'<thead><tr>(<th>.*?</th>)+</tr></thead>', html)
    colunas = re.findall(r'<th>([^<]*)</th>',
                         html[html.index('Data/Hora') - 40: html.index('Data/Hora') + 320])
    ck('a coluna Nº da Carga está no cabeçalho', 'Nº da Carga' in colunas, str(colunas))
    if 'Nº da Carga' in colunas and 'Placa' in colunas:
        ck('e vem logo depois da Placa',
           colunas.index('Nº da Carga') == colunas.index('Placa') + 1, str(colunas))

    app = (RAIZ / 'app.js').read_text(encoding='utf-8')
    ck('a resolução do número mora numa função só',
       'function numeroDaCargaDaMovimentacao(' in app)
    ck('e o detalhe da linha acompanha a coluna nova (colspan)',
       'colspan="7"' in app, 'colspan errado desalinha a tabela inteira')

    print('\n=== 2. NA TELA, COM MOVIMENTO DE VERDADE ===')
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        pg = await (await nav.new_context(viewport={'width':1500,'height':950})).new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        # A vitrine: modo local, com base de demonstração — sem depender do servidor.
        corpo = (RAIZ / 'vitrine' / 'vitrine.html').read_text(encoding='utf-8')
        url = 'https://hist.local/h'
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=corpo)))
        await pg.goto(url)
        await pg.wait_for_function('typeof renderHistorico === "function"', timeout=25000)
        await pg.evaluate("() => abrirTab('historico')")
        await pg.wait_for_timeout(1800)

        r = await pg.evaluate("""() => {
            const linhas = [...document.querySelectorAll('#hist-tbody tr.hist-linha')];
            if(!linhas.length) return { semLinha:true };
            const celula = (tr, i) => tr.children[i] ? tr.children[i].innerText.trim() : null;
            /* A CONFERÊNCIA QUE IMPORTA: o número na tela tem de ser o da
               carga DAQUELA movimentação, não o de outra linha. Bater só
               "tem algum número" passaria com a coluna toda errada. */
            const amostra = linhas.slice(0, 6).map(tr => {
              const id = (tr.getAttribute('onclick')||'').match(/'([^']+)'/);
              const mov = id ? DB.movimentacoes.find(m => m.id === id[1]) : null;
              const c = mov ? getCarga(mov.cargaId) : null;
              return { naTela: celula(tr, 2),
                       esperado: c ? String(c.numeroCarga||'').trim() : null };
            });
            return { total: linhas.length, amostra,
                     colunasDaLinha: linhas[0].children.length };
        }""")
        ck('o Histórico tem linhas para conferir', not r.get('semLinha'), str(r)[:120])
        if not r.get('semLinha'):
            ck('a linha tem 7 colunas', r['colunasDaLinha'] == 7, str(r['colunasDaLinha']))
            confere = [a for a in r['amostra'] if a['esperado']]
            ck('há carga resolvível na amostra', bool(confere), str(r['amostra'])[:140])
            erradas = [a for a in confere if a['naTela'] != a['esperado']]
            ck('cada linha mostra o número da SUA carga', not erradas, str(erradas[:2]))

        print('\n=== 3. O CLIQUE NO NÚMERO ===')
        clique = await pg.evaluate("""() => {
            const b = document.querySelector('#hist-tbody .hist-carga-btn');
            if(!b) return { semBotao:true };
            const tr = b.closest('tr');
            const det = tr.nextElementSibling;
            const numero = b.textContent.trim();
            b.click();
            return { numero,
                     buscaPreenchida: (document.getElementById('hist-busca-carga')||{}).value,
                     detalheAbriu: det ? !det.hidden : null };
        }""")
        ck('o número é clicável', not clique.get('semBotao'), str(clique))
        if not clique.get('semBotao'):
            ck('clicar preenche a busca com aquele número sozinho',
               clique['buscaPreenchida'] == clique['numero'], str(clique))
            ck('e NÃO abre o detalhe da linha junto',
               clique['detalheAbriu'] is False, str(clique))
        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    print('\n' + '=' * 51)
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print(f'    · {f}')
        return 1
    print('  tudo verde.')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
