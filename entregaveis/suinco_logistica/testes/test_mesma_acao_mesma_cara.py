#!/usr/bin/env python3
"""A mesma etapa com a mesma cor, a mesma ação com o mesmo nome (08/10/2026, /impeccable Lote 5).

ACHADO DA AUDITORIA (ocorrência #126):
  · a pizza dos Indicadores pintava as etapas com a paleta da planilha do
    pátio: Finalizado, Faturado e Seguiu Viagem no mesmo verde, o "Pátio"
    amarelo — o mesmo status com outra cor que a etiqueta da Torre;
  · o Cadastros tinha "Remover" (vermelho, 300 vezes) e "Excluir" (neutro)
    para a mesma ação — e excluir uma transportadora era UM clique, sem
    pergunta, enquanto a Frota ao lado perguntava;
  · os botões de ação rápida do topo da Expedição e do Faturamento eram
    dourados e verde-escuros, e os mesmos botões na tabela vestem a cor da
    etapa que produzem.

O QUE ESTE TESTE TRAVA, pela tela:
  1. cada quadradinho da legenda da pizza tem a cor da etiqueta da mesma
     etapa na Torre;
  2. no Cadastros não há "Remover"; Frota, Transportadoras e Rotas excluem
     com o mesmo botão (mesma cor); a transportadora pergunta antes, e
     "Cancelar" não exclui;
  3. "Iniciar Embarque", "Finalizar Embarque" e "FATURADO" têm a mesma cor
     no topo e na linha da tabela.

    bash testes/rodar_tudo.sh test_mesma_acao_mesma_cara
"""
import asyncio
import os
import sys
from playwright.async_api import async_playwright

PAINEL = os.environ.get('SUINCO_PAINEL', 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


SEMEAR = """() => {
  DB.cargas = []; DB.movimentacoes = [];
  const ordem = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado'];
  // uma carga parada em cada etapa de 1 a 4 (Aguardando Embarque … Faturado)
  [1, 2, 3, 4].forEach((ate, n) => {
    const f = DB.frota[n];
    criarCargaProgramada({freteObservacao:'TABELA', placa:f.placa, numeroCarga:String(40500+n), peso:12000,
      rota:'50'+n, motorista:'José da Silva', qtdEntregas:1, operador:'Ana' });
    const c = DB.cargas[DB.cargas.length-1];
    for(let s = 1; s <= ate; s++) avancarStatusCarga(c.id, ordem[s], 'Operador '+s, 'Logística');
  });
  SuincoStore.save();
  renderAll();
}"""

COR = "(el) => el ? getComputedStyle(el).backgroundColor : null"


async def entrar(pg, setor='Administração'):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(900)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', setor)
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(500)


async def aba(pg, nome):
    await pg.click(f'.nav-tab[data-tab="{nome}"]')
    await pg.wait_for_timeout(600)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        ctx = await nav.new_context(viewport={'width': 1440, 'height': 900})
        pg = await ctx.new_page()
        # O quadro "Transportadoras" mostra as da Frota desde 09/10 (#128) e não
        # cadastra mais nome solto; o "Excluir" com pergunta ficou para os nomes
        # antigos que só existem no navegador. Este navegador tem um, como o
        # quadro antigo gravava (chave suinco_painel_v1).
        await pg.add_init_script(
            "try{ if(!localStorage.getItem('suinco_painel_v1')) localStorage.setItem('suinco_painel_v1', "
            "JSON.stringify({transportadoras:[{id:'transp-legado-1', nome:'Transportadora do Teste'}]})); }catch(e){}")
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)
        await pg.evaluate(SEMEAR)

        # ---- 1. a pizza pinta cada etapa com o PREENCHIMENTO dela -----------
        # A etiqueta da Torre é contornada (texto e borda em --st-*-txt); a
        # fatia é preenchimento, e o preenchimento da etapa é --st-*-bg — o
        # mesmo do botão de avanço (A Regra do Preenchimento, DESIGN.md).
        await aba(pg, 'indicadores')
        legenda = await pg.evaluate("""() => [...document.querySelectorAll('#grafico-pizza-legenda .legenda-item')].map(i => {
            const status = i.textContent.split(':')[0].trim();
            const slug = statusSlug(status);
            const ref = document.createElement('span');
            ref.style.background = `var(--st-${slug}-bg)`; document.body.appendChild(ref);
            const esperado = getComputedStyle(ref).backgroundColor; ref.remove();
            return { status, cor: getComputedStyle(i.querySelector('.legenda-chip')).backgroundColor, esperado }; })""")
        ck('1. (a pizza mostra as etapas semeadas)', len(legenda) >= 3, str(legenda))
        erradas = [l for l in legenda if l['cor'] != l['esperado']]
        ck('1. cada fatia tem o preenchimento da própria etapa', legenda and not erradas, str(erradas or legenda)[:300])
        cores = {l['status']: l['cor'] for l in legenda}
        ck('1. Embarque Finalizado e Faturado não são mais o mesmo verde',
           'Embarque Finalizado' in cores and 'Faturado' in cores and cores['Embarque Finalizado'] != cores['Faturado'], str(cores))

        # ---- 2. Cadastros: "Excluir", vermelho, e a transportadora pergunta --
        await aba(pg, 'cadastros')
        remover = await pg.evaluate("""() => [...document.querySelectorAll('#tab-cadastros button')]
            .filter(b => b.textContent.trim() === 'Remover').length""")
        ck('2. o Cadastros não tem "Remover"', remover == 0, f'{remover} botão(ões)')
        nome = 'Transportadora do Teste'   # o nome antigo, só deste navegador
        # a Frota abre sem lista (a busca é a porta): procura uma placa
        placa = await pg.evaluate("() => DB.frota[0].placa")
        await pg.fill('#frota-busca', placa)
        await pg.wait_for_timeout(500)
        cores = await pg.evaluate("""() => {
          const cor = s => { const b = document.querySelector(s); return b ? getComputedStyle(b).backgroundColor : null; };
          const excluir = sel => [...document.querySelectorAll(sel + ' button')].find(b => b.textContent.trim() === 'Excluir');
          const c = el => el ? getComputedStyle(el).backgroundColor : null;
          return { frota: c(excluir('#card-frota')), transp: c(excluir('#card-transportadoras')),
                   rota: c(excluir('#card-cadastrar-rota')) }; }""")
        ck('2. Frota, Transportadoras e Rotas têm "Excluir"', all(cores.values()), str(cores))
        ck('2. com a mesma cor nos três', len(set(cores.values())) == 1, str(cores))
        await pg.evaluate("""() => { const b = [...document.querySelectorAll('#card-transportadoras .modal-list-item button')][0];
            if(b) b.scrollIntoView({block:'center'}); }""")
        await pg.click(f'#card-transportadoras .modal-list-item:has-text("{nome}") button')
        await pg.wait_for_timeout(400)
        titulo = await pg.evaluate("() => (document.getElementById('pergunta-titulo')||{}).textContent || ''")
        ck('2. excluir uma transportadora PERGUNTA antes', 'Excluir a transportadora' in titulo and nome in titulo, titulo)
        if titulo:
            await pg.click('#pergunta-cancelar')
            await pg.wait_for_timeout(300)
        ainda = await pg.evaluate("(n) => listarTransportadoras().some(t => t.nome === n)", nome)
        ck('2. e "Cancelar" não exclui', ainda)

        # ---- 3. o botão do topo tem a cor do botão da tabela ---------------
        pares = [('expedicao', 'Iniciar Embarque'), ('expedicao', 'Finalizar Embarque'), ('faturamento', 'FATURADO')]
        for nome_aba, rotulo in pares:
            await aba(pg, nome_aba)
            r = await pg.evaluate("""([aba, rotulo]) => {
              const todos = [...document.querySelectorAll('#tab-' + aba + ' button')].filter(b => b.textContent.trim() === rotulo && b.offsetParent);
              const tabela = todos.find(b => b.closest('table'));
              const topo = todos.find(b => !b.closest('table'));
              const c = el => el ? getComputedStyle(el).backgroundColor : null;
              return { topo: c(topo), tabela: c(tabela) }; }""", [nome_aba, rotulo])
            ck(f'3. "{rotulo}" tem a mesma cor no topo e na tabela', r['topo'] and r['tabela'] and r['topo'] == r['tabela'], str(r))

        # ---- 4. textos que dizem a verdade (Lote 5c) -------------------------
        await aba(pg, 'torre')
        sub = await pg.evaluate("() => document.querySelector('#tab-torre .card-sub').innerText")
        ck('4. a Torre não diz mais "visão de leitura" (Logística e Administração editam)',
           'leitura para todos' not in sub and 'editam' in sub, sub[:120])
        await aba(pg, 'relatorios')
        rel = await pg.evaluate("() => document.getElementById('tab-relatorios').innerText")
        ck('4. os Relatórios não mostram caminho do repositório ao usuário', 'docs/' not in rel and '.md' not in rel)
        tema = await pg.evaluate("() => { const b = document.getElementById('btn-tema'); return [b.title, b.getAttribute('aria-label'), b.innerText.trim()]; }")
        ck('4. o botão de tema diz o tema atual E o que o toque faz', 'tocar troca para' in tema[0] and tema[0] == tema[1]
           and tema[2] in ('Escuro', 'Claro') and tema[2].lower() in tema[0].lower(), str(tema))
        await pg.click('#btn-tema')
        await pg.wait_for_timeout(300)
        tema2 = await pg.evaluate("() => { const b = document.getElementById('btn-tema'); return [b.title, b.innerText.trim()]; }")
        ck('4. depois do toque, o título acompanha o tema novo', tema2[1] != tema[2] and tema2[1].lower() in tema2[0].lower(), str(tema2))

        ck('sem erro de JavaScript', not erros, ' | '.join(erros[:3]))
        await nav.close()

    print(f"\n{len(falhas)} FALHA(S)" + (': ' + ', '.join(falhas) if falhas else ''))
    return 1 if falhas else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
