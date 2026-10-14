#!/usr/bin/env python3
"""A carga inteira num lugar só (14/10/2026) — aprovado pelo dono: "marcha fio".

O PEDIDO: "conexões, relacionamentos entre os cards e informações". Ao abrir a
carga, além do pátio aparece o que os OUTROS setores sabem dela — só quando
existe, e sem contagem (o dono recusou "informações e contagens que não fazem
sentido"). Hoje é o frete; o sinistro entra quando a aba existir.

O QUE ESTE TESTE TRAVA, pela tela:
  1. Pátio ao vivo: a carga que está no controle do frete mostra, no painel do
     lado, "Frete — Para pagamento: … · Situação: …" com as MESMAS palavras da
     aba Pagamento de Frete (a grade de demonstração é a da própria aba);
  2. a linha do tempo do Histórico mostra a mesma linha;
  3. a carga que não está no controle do frete não mostra nada (nem caixa
     vazia);
  4. quem não tem a aba do Frete (Expedição) não vê a linha.

REPROVA contra o publicado (a ficha não existe):
    SUINCO_PAINEL=file://<index.html publicado> bash testes/rodar_tudo.sh carga_inteira_num_lugar

    bash testes/rodar_tudo.sh carga_inteira_num_lugar
"""
import asyncio
import json
import os
import pathlib
import sys
from playwright.async_api import async_playwright

RAIZ = pathlib.Path(__file__).resolve().parent.parent
PAINEL = os.environ.get('SUINCO_PAINEL', (RAIZ / 'index.html').as_uri())
FRETE_DEMO = json.load(open(RAIZ / 'vitrine' / 'frete_demonstracao.json', encoding='utf-8'))
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def o_que_o_frete_diz(numero):
    """A linha da carga na grade da aba (a mesma que a tela lê)."""
    ix = {c['chave']: i for i, c in enumerate(FRETE_DEMO['colunas'])}
    for l in FRETE_DEMO['linhas']:
        if str(l['carga']) == str(numero) and l['primeira']:
            return l['v'][ix['statusPagamento']], l['v'][ix['situacao']]
    return None


async def entrar(pg, setor):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(1100)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', setor)
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(900)


SEMEAR = """(numeroDoFrete) => {
  const agora = Date.now(), iso = (t) => new Date(t).toISOString();
  const st = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado'];
  DB.frota = []; DB.cargas = []; DB.movimentacoes = [];
  function mk(id, numero, placa, status, seq){
    const t0 = agora - 2 * 3600000;
    DB.frota.push({placa, transportadora:'ALFA', tipoVeiculo:'Truck', uf:'MG', capacidadeKg:14000, atualizadoEm: iso(agora)});
    DB.cargas.push({ id, numeroCarga: numero, placa, transportadora:'ALFA', tipoVeiculo:'Truck',
      motorista:'M', cliente:'C', destino:'D', peso:10000, doca:'1', sequencia: seq, observacoes:'',
      praOnde:'ENTREGA DIRETA', rota:'500', paletizada:'Não', qtdGanchos: 0, qtdEntregas: 1, status,
      aguardandoCarga:false, criadoEm: iso(t0), programadoEm: iso(t0), atualizadoEm: iso(t0), criadoPor:'Logística' });
    const ate = st.indexOf(status);
    for(let j = 0; j <= ate; j++){
      DB.movimentacoes.push({ id: 'mov_' + id + '_' + j, cargaId: id, placa,
        statusAnterior: j ? st[j-1] : null, statusNovo: st[j], operador:'Op', setor:'Portaria',
        timestamp: iso(t0 + j * 20 * 60000), numeroCarga: numero });
    }
  }
  mk('fc1', String(numeroDoFrete), 'FCA1B11', 'Embarque Iniciado', 1);
  mk('fc2', 'FC-SEM-FRETE', 'FCB2C22', 'Aguardando Embarque', 2);
  SuincoStore.save();
  renderAll();
}"""

FICHA = """(sel) => { const el = document.querySelector(sel);
  return el ? { visivel: !el.hidden && !!el.offsetParent, texto: el.innerText.replace(/\\s+/g, ' ').trim() } : null; }"""


async def main():
    numero = FRETE_DEMO['linhas'][0]['carga']
    sp, sit = o_que_o_frete_diz(numero)
    async with async_playwright() as p:
        nav = await p.chromium.launch(
            executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_PATH', '/opt/pw-browsers/chromium'), headless=True)
        erros = []

        async def abrir(setor):
            pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
            pg.on('pageerror', lambda e: erros.append(str(e)))
            await pg.add_init_script("window.FRETE_DEMONSTRACAO = %s;" % json.dumps(FRETE_DEMO))
            await entrar(pg, setor)
            await pg.evaluate(SEMEAR, numero)
            return pg

        print(f'\n=== 1. PÁTIO AO VIVO: A CARGA {numero} MOSTRA O QUE O FRETE SABE ===')
        pg = await abrir('Administração')
        await pg.click('.nav-tab[data-tab="patio"]')
        await pg.wait_for_timeout(900)
        await pg.click('.pv-card[data-id="fc1"]')
        await pg.wait_for_timeout(700)
        f = await pg.evaluate(FICHA, '#gv-miolo .ficha-setores')
        esperado = f'Para pagamento: {sp} · Situação: {sit}'
        ck('o painel do lado mostra a linha do Frete', bool(f and f['visivel']), str(f))
        ck('com as mesmas palavras da aba Pagamento de Frete', bool(f) and esperado in f['texto'] and f['texto'].startswith('FRETE'),
           f"esperado '{esperado}' · visto '{(f or {}).get('texto')}'")

        print('\n=== 2. A LINHA DO TEMPO DO HISTÓRICO MOSTRA O MESMO ===')
        await pg.click('#gv-miolo .acao-carga[data-destino="linha"]')
        await pg.wait_for_timeout(700)
        f2 = await pg.evaluate(FICHA, '#hist-timeline-wrap .ficha-setores')
        ck('a linha do tempo mostra a mesma linha do Frete', bool(f2 and f2['visivel']) and esperado in f2['texto'],
           str(f2))

        print('\n=== 3. CARGA FORA DO CONTROLE DO FRETE: NADA (NEM CAIXA VAZIA) ===')
        await pg.click('.nav-tab[data-tab="patio"]')
        await pg.wait_for_timeout(700)
        await pg.click('.pv-card[data-id="fc2"]')
        await pg.wait_for_timeout(700)
        f3 = await pg.evaluate(FICHA, '#gv-miolo .ficha-setores')
        ck('a carga sem frete não mostra a caixa', not f3 or not f3['visivel'], str(f3))
        await pg.close()

        print('\n=== 4. QUEM NÃO TEM A ABA DO FRETE NÃO VÊ A LINHA ===')
        pg = await abrir('Expedição')
        # O caminho da Expedição até a carga: aba Histórico e a busca pelo
        # número — com um resultado só, a busca já abre a linha do tempo.
        await pg.click('.nav-tab[data-tab="historico"]')
        await pg.wait_for_timeout(600)
        await pg.fill('#hist-busca-carga', str(numero))
        await pg.wait_for_timeout(800)
        aba = await pg.evaluate("() => document.querySelector('.tab-page.active').id")
        f4 = await pg.evaluate(FICHA, '#hist-timeline-wrap .ficha-setores')
        aberta = await pg.evaluate("() => _timelineCargaAtual === 'fc1' && !!document.querySelector('#hist-timeline-wrap .timeline-card')")
        ck('a Expedição abre a linha do tempo da carga', aba == 'tab-historico' and aberta, f'{aba} {aberta}')
        ck('e não vê a linha do Frete', not f4 or not f4['visivel'], str(f4))
        await pg.close()

        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    print('\n=======================================================')
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for x in falhas:
            print('   -', x)
        return 1
    print('  Tudo verde: a carga mostra o que os outros setores sabem dela, só quando existe.')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
