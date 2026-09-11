#!/usr/bin/env python3
"""No celular, tocar a linha da Montagem e da Fila mostra a coluna Seq. — e o ⏱ tem 44px.

ACHADO DA AUDITORIA DE PARIDADE MOBILE DE 11/09/2026, medido com toque real:

    Montagem do Dia · td[data-rotulo="Seq."] → display:none ANTES e DEPOIS do toque
    Fila de Programados · idem — e o formulário aberto não tem campo de sequência
    Torre de Controle · funciona (display:flex depois do toque)

O MECANISMO: no cartão do celular os campos secundários (`data-sec`) só
aparecem quando a linha tem a classe `cartao-aberto`, que um ouvinte no
`document` liga e desliga a cada toque. Na Montagem e na Fila a própria linha
tem `onclick` que REDESENHA o tbody inteiro (`alternarLinha…UI`) — ele roda
antes do ouvinte do document, que então liga a classe num <tr> que já foi
destacado do DOM. A Torre não redesenha ao abrir, por isso lá funciona.

O QUE ISSO CUSTAVA: "digite ou arraste para reordenar, os dois precisam
funcionar" (pedido do dono, 09/09) valia só no computador. No pátio, de
celular, a Logística não conseguia dar posição a caminhão nenhum — e a recusa
nova de hoje ("digite o número na coluna Seq.") apontava para um campo
invisível. E o botão ⏱ do rodapé tinha 18px de altura: o único jeito de
alguém reportar um travamento não cabia num dedo.

A CORREÇÃO É "O ESTADO DESENHA A CLASSE": a linha aberta nasce com
`cartao-aberto` no redesenho, em vez de depender de um toggle que chega
depois. Mesma decisão nos dois lugares.

    python3 testes/test_sequencia_no_celular.py
"""
import asyncio, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def tocar_no_rodape_da_linha(pg, seletor):
    """Toque REAL (touchscreen) na faixa 'toque para ver tudo' da linha —
    fora de qualquer campo, como o polegar faz. `.click()` mascara o
    defeito porque não reproduz a ordem dos eventos do toque físico."""
    linha = pg.locator(seletor).first
    await linha.scroll_into_view_if_needed()     # fora da tela o toque cai no vazio
    await pg.wait_for_timeout(150)
    caixa = await linha.bounding_box()
    if not caixa:
        return False
    await pg.touchscreen.tap(caixa['x'] + caixa['width'] / 2, caixa['y'] + caixa['height'] - 6)
    await pg.wait_for_timeout(250)
    return True


ESTADO_SEQ = """(sel) => {
  const tr = document.querySelector(sel);
  if(!tr) return { erro: 'sem linha' };
  const td = tr.querySelector('td[data-rotulo="Seq."]');
  const input = td ? td.querySelector('input') : null;
  return {
    cartaoAberto: tr.classList.contains('cartao-aberto'),
    seqVisivel: td ? getComputedStyle(td).display !== 'none' : null,
    inputAlcancavel: !!(input && input.getBoundingClientRect().height > 0),
    rodape: getComputedStyle(tr, '::after').content,
    classes: tr.className,
  };
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        ctx = await nav.new_context(viewport={'width': 390, 'height': 844},
                                    is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(1200)

        print('\n=== 1. MONTAGEM DO DIA — tocar a linha mostra a Seq. ===')
        await pg.evaluate("""() => {
          DB.operador = {nome:'Wemerson', setor:'Logística'};
          document.getElementById('modal-operador')?.classList.remove('open');
          _montagemDia = { dia:'2026-09-14', diaSemana:1, modelo:[], montagens:[{
            montagem_id:'m1', data_prog:'2026-09-14', rota_codigo:'500', rota_nome:'R',
            apelido_rota:'Brasília - Versatto',
            sequencia:3, numero_carga:'', peso:null, qtd_entregas:1, qtd_ganchos:0,
            paletizada:'Não', tipo_operacao:'', motorista:'', observacoes:'',
            placa:'', transportadora:'', frete_destino:null, km_destino:null,
            km_deslocamento:null, frete_valor:null }] };
          renderAll(); abrirTab('programacao');
          const card = document.getElementById('card-montagem'); if(card) card.hidden = false;
          renderMontagem();
          if(typeof prepararTabelasMobile === 'function') prepararTabelasMobile(document);
          if(typeof marcarCartoesExpansiveis === 'function') marcarCartoesExpansiveis(document);
        }""")
        await pg.wait_for_timeout(300)
        antes = await pg.evaluate(ESTADO_SEQ, '#mont-tbody tr.mont-linha')
        ck('a tela é de celular e a Seq. começa escondida (cartão fechado)',
           antes.get('seqVisivel') is False, str(antes))
        ok = await tocar_no_rodape_da_linha(pg, '#mont-tbody tr.mont-linha')
        ck('consegui tocar a linha', ok)
        depois = await pg.evaluate(ESTADO_SEQ, '#mont-tbody tr.mont-linha')
        ck('a linha abriu o detalhe', 'mont-linha-aberta' in (depois.get('classes') or ''), str(depois.get('classes')))
        ck('e a coluna Seq. APARECEU', depois.get('seqVisivel') is True, str(depois))
        ck('com o campo de digitar alcançável pelo dedo', depois.get('inputAlcancavel') is True, str(depois))
        ck('o rodapé do cartão diz "toque para fechar", não mente',
           'fechar' in str(depois.get('rodape')), str(depois.get('rodape')))
        ok = await tocar_no_rodape_da_linha(pg, '#mont-tbody tr.mont-linha')
        fechou = await pg.evaluate(ESTADO_SEQ, '#mont-tbody tr.mont-linha')
        ck('segundo toque fecha de novo', fechou.get('seqVisivel') is False
           and 'mont-linha-aberta' not in (fechou.get('classes') or ''), str(fechou))

        print('\n=== 2. FILA DE PROGRAMADOS — mesma coisa ===')
        await pg.evaluate("""() => {
          const q = new Date(); q.setHours(8,0,0,0);
          DB.cargas = [{ id:'c_hoje', numeroCarga:'HOJE', placa:'FIL1A11', transportadora:'ALFA',
            tipoVeiculo:'Truck', motorista:'', cliente:'C', destino:'D', peso:12000, doca:'',
            sequencia:2, observacoes:'', praOnde:'Entrega', rota:'500', paletizada:'Não',
            qtdGanchos:0, qtdEntregas:1, status:'Aguardando Veículo', aguardandoCarga:false,
            criadoEm:q.toISOString(), programadoEm:q.toISOString(), atualizadoEm:q.toISOString(),
            criadoPor:'Logística' }];
          DB.movimentacoes = [];
          renderAll(); abrirTab('programacao');
          if(typeof prepararTabelasMobile === 'function') prepararTabelasMobile(document);
          if(typeof marcarCartoesExpansiveis === 'function') marcarCartoesExpansiveis(document);
        }""")
        await pg.wait_for_timeout(300)
        antes = await pg.evaluate(ESTADO_SEQ, '#prog-fila-tbody tr.prog-linha')
        ck('a Fila tem a linha e a Seq. começa escondida', antes.get('seqVisivel') is False, str(antes))
        ok = await tocar_no_rodape_da_linha(pg, '#prog-fila-tbody tr.prog-linha')
        depois = await pg.evaluate(ESTADO_SEQ, '#prog-fila-tbody tr.prog-linha')
        ck('tocar abre a linha', 'prog-linha-aberta' in (depois.get('classes') or ''), str(depois.get('classes')))
        ck('e a Seq. aparece — dá para reordenar de celular', depois.get('seqVisivel') is True, str(depois))
        ck('campo alcançável', depois.get('inputAlcancavel') is True)

        print('\n=== 3. O BOTÃO ⏱ DO RODAPÉ CABE NUM DEDO (44px) ===')
        r = await pg.evaluate("""() => {
          localStorage.setItem('suinco_travamentos', JSON.stringify([{ em:new Date().toISOString(), ms:900,
            aba:'programacao', desenho:'renderMontagem', volume:{cargas:1}, versao:'teste' }]));
          if(typeof _travamentos !== 'undefined') _travamentos = JSON.parse(localStorage.getItem('suinco_travamentos'));
          atualizarRodapeConexao();
          const b = document.querySelector('.rodape-travas');
          if(!b) return { erro:'sem botão ⏱' };
          const cx = b.getBoundingClientRect();
          return { h: Math.round(cx.height), w: Math.round(cx.width), coarse: matchMedia('(pointer:coarse)').matches };
        }""")
        ck('o botão existe quando há travamento registrado', 'erro' not in r, str(r))
        ck('a tela se declara de toque (pointer:coarse)', r.get('coarse') is True, str(r))
        ck('altura mínima de 44px', (r.get('h') or 0) >= 44, f"{r.get('h')}px")
        ck('nenhum erro de JavaScript', not erros, str(erros[:1]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)


asyncio.run(main())
