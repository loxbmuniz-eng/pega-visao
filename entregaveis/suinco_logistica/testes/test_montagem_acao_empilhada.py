#!/usr/bin/env python3
"""A célula de Ação da Montagem: os dois botões inteiros, dentro da coluna.

RELATO DO DONO (17/09/2026), com print do monitor grande: "botao de criar
carga precisa ficar abaixo do excluir nesa parte ele esta pequeno e
horrivel". Fechando a ordem em seguida: "criar carga acima do excluir".

A CAUSA, MEDIDA. A coluna de Ação tem 76px cravados de 821px para cima, sem
teto — a tabela é `table-layout:fixed` desde 16/09. A regra que recolhia o
rótulo do botão (`.mont-rot`) valia só ENTRE 821 e 1399px, escrita na mesma
data supondo que "acima de 1400 sobra espaço". Não sobrava. Acima de 1400 a
palavra voltava para dentro da mesma coluna, e com `justify-content:flex-end`
mais o corte da célula o primeiro botão era cortado PELA ESQUERDA.

Medido no `index.html` publicado, viewport 1920:

    botão "Colocar placa"  largura 106px   dentro da célula: NÃO

Ou seja: a ação principal da tela ficava metade fora, no lugar onde a
Programação monta o dia.

O QUE ESTE TESTE TRAVA, e por que cada item:

  1. TODO botão da célula de Ação fica DENTRO da célula, nas duas larguras
     de computador. É a conferência que reprova contra o publicado.
  2. Os botões EMPILHAM, e "Criar carga"/"Colocar placa" fica ACIMA de
     "Excluir" — ordem pedida pelo dono, e a mais segura: o botão que apaga
     deixa de ser o primeiro que o dedo encontra ao varrer a linha.
  3. O rótulo aparece por extenso. Ícone mudo troca barra de rolagem por
     adivinhação, e foi por isso que a palavra existia desde o começo.
  4. Nenhum botão corta o próprio texto (`scrollWidth > clientWidth`).
  5. A linha não engorda além do teto medido. Empilhar custou 8px por
     linha (72 -> 80). Trocar um defeito de leitura por um de navegação
     seria mudar o defeito de lugar, não corrigir: numa sexta de 42 linhas
     cada pixel a mais vira 42 de rolagem. O teto de 84px dá folga para
     fonte de sistema diferente sem deixar a regressão passar.

    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
        python3 testes/test_montagem_acao_empilhada.py
    # contra o que está no ar (tem de REPROVAR no item 1):
    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
        python3 testes/test_montagem_acao_empilhada.py --painel /tmp/publicado.html
"""
import argparse
import asyncio
import os
import pathlib
import subprocess
import sys

from playwright.async_api import async_playwright

BASE = pathlib.Path(__file__).parent.parent
CHROMIUM = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH', '/opt/pw-browsers/chromium')
SENHA = 'senha-de-teste-123'
LARGURAS = [1280, 1920]
ALTURA_MAXIMA_DA_LINHA = 84

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def sql(q):
    r = subprocess.run(['su', 'postgres', '-c', f'psql -At -d embarque_suinco -c "{q}"'],
                       capture_output=True, text=True)
    return [l for l in r.stdout.strip().split('\n') if l]


def descobrir_api():
    import urllib.request, urllib.error
    for porta in (3010, 3011, 3012, 3013, 3014, 3015):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{porta}/health', timeout=2) as r:
                if r.status == 200:
                    return f'http://127.0.0.1:{porta}'
        except (urllib.error.URLError, OSError):
            continue
    return None


MEDE = """() => {
  const tr = document.querySelector('#mont-tabela tbody tr.mont-linha');
  if (!tr) return {erro: 'nenhuma linha de montagem na tela'};
  const c = tr.querySelector('td:last-child');
  const bx = c.getBoundingClientRect();
  const botoes = [...c.querySelectorAll('.btn')].map((b) => {
    const r = b.getBoundingClientRect();
    return {
      txt: b.innerText.trim().replace(/\\s+/g, ' '),
      rotulo: b.getAttribute('aria-label') || '',
      w: Math.round(r.width), h: Math.round(r.height),
      topo: Math.round(r.y - bx.y),
      /* Meia unidade de folga: o navegador devolve fração de pixel, e
         reprovar por 0,4px seria guarda que grita lobo. */
      dentro: r.left >= bx.left - 0.5 && r.right <= bx.right + 0.5,
      corta_o_texto: b.scrollWidth > b.clientWidth + 1,
    };
  });
  return {
    coluna_w: Math.round(bx.width),
    altura_linha: Math.round(tr.getBoundingClientRect().height),
    botoes,
  };
}"""


async def semear(pg, api):
    rotas = sql("SELECT string_agg(codigo,'|') FROM (SELECT codigo FROM dim_rotas "
                "WHERE ativa IS NOT FALSE ORDER BY codigo LIMIT 4) t")
    rotas = rotas[0].split('|') if rotas and rotas[0] else ['500']
    return await pg.evaluate("""async ([rotas]) => {
        let n = 0;
        for (let i = 0; i < 4; i++) {
          try {
            const r = await SuincoSharePoint.montagem.criar({
              rotaCodigo: rotas[i % rotas.length], numeroCarga: 'AC-' + i,
              peso: 12345 + i * 137, qtdEntregas: 3, qtdGanchos: 0,
              motorista: 'WESLEY JUNIO BORGES NOGUEIRA'});
            if (r && r.montagem) n++;
          } catch (e) {}
        }
        return n;
      }""", [rotas])


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--painel', default=str(BASE / 'index.html'),
                    help='index.html a medir. Sem isto, o build local.')
    args = ap.parse_args()

    api = descobrir_api()
    if not api:
        sys.exit('  X  a API não respondeu em 3010-3015. Suba o servidor antes.')

    sql("DELETE FROM programacao_montagem WHERE numero_carga LIKE 'AC-%'")
    html = pathlib.Path(args.painel).read_text(encoding='utf-8')
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{api}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{api}/socket.io/socket.io.js')
    url = f'{api}/__montagem_acao'

    print(f'\n  medindo: {args.painel}')
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROMIUM)
        for larg in LARGURAS:
            ctx = await nav.new_context(viewport={'width': larg, 'height': 900})
            pg = await ctx.new_page()
            await pg.route(url, lambda r: asyncio.ensure_future(
                r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
            await pg.goto(url)
            await pg.wait_for_selector('#login-email', timeout=25000)
            await pg.fill('#login-email', 'ana@teste.local')
            await pg.fill('#login-senha', SENHA)
            await pg.click('#btn-entrar')
            await pg.wait_for_timeout(3000)
            await semear(pg, api)
            await pg.evaluate("() => abrirTab('programacao')")
            await pg.wait_for_timeout(2500)
            r = await pg.evaluate(MEDE)

            print(f'\n=== {larg}px — coluna de {r.get("coluna_w")}px ===')
            if r.get('erro'):
                ck(f'{larg}: a Montagem tem linha na tela', False, r['erro'])
                await ctx.close()
                continue

            botoes = r['botoes']
            ck(f'{larg}: a célula tem os dois botões', len(botoes) == 2,
               f'{len(botoes)} botão(ões)')
            if len(botoes) != 2:
                await ctx.close()
                continue

            fora = [b for b in botoes if not b['dentro']]
            ck(f'{larg}: todo botão fica DENTRO da coluna de Ação', not fora,
               '; '.join(f"{b['rotulo']} tem {b['w']}px e sai da célula" for b in fora))

            cortando = [b for b in botoes if b['corta_o_texto']]
            ck(f'{larg}: nenhum botão corta o próprio texto', not cortando,
               '; '.join(b['rotulo'] for b in cortando))

            acao, excluir = botoes[0], botoes[1]
            ck(f'{larg}: empilham, e a ação principal fica ACIMA do Excluir',
               acao['topo'] + acao['h'] <= excluir['topo'] + 1,
               f"{acao['rotulo']} topo={acao['topo']}+{acao['h']} · "
               f"{excluir['rotulo']} topo={excluir['topo']}")

            sem_rotulo = [b for b in botoes if len(b['txt']) < 4]
            ck(f'{larg}: o rótulo aparece por extenso, não só o ícone', not sem_rotulo,
               '; '.join(repr(b['txt']) for b in sem_rotulo))

            ck(f'{larg}: a linha não engorda além de {ALTURA_MAXIMA_DA_LINHA}px',
               r['altura_linha'] <= ALTURA_MAXIMA_DA_LINHA, f"{r['altura_linha']}px")
            await ctx.close()
        await nav.close()

    sql("DELETE FROM programacao_montagem WHERE numero_carga LIKE 'AC-%'")
    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()) or 0)
