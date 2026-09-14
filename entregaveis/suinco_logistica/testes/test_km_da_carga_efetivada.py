#!/usr/bin/env python3
"""O KM de uma carga já efetivada pode ser corrigido (14/09/2026).

Pedido do dono, palavra por palavra:

  "queremos poder alterar a quilometragem quando ela é inserida e calculada
   automaticamente pelo sistema. Precisamos editar esse número exato, pois
   costuma haver variações, como 450 km ou 44 (...) sem que o valor fique
   travado. Como o valor do destino nunca será exatamente o esperado,
   sempre haverá um ajuste a mais ou a menos."

O QUE ESTAVA ERRADO. Na Montagem do Dia, assim que a linha virava carga
efetivada, o KM deixava de ser campo e virava texto. O servidor SEMPRE
aceitou a correção — `km_deslocamento` está em ENTRADAS_DO_FRETE e recalcula
`frete_valor` na hora — e a própria linha de montagem congela dizendo "quem
quiser mudar mexe na CARGA, que tem log de revisões". Só que nenhuma tela
oferecia esse "mexer na carga". O caminho foi projetado e não foi
construído; para quem usa, o valor ficava travado.

O que este teste trava:

  1. A Logística vê CAMPO de KM na carga efetivada, não texto.
  2. Corrigir grava, e o número novo fica.
  3. A correção entra no Histórico com o número velho e o novo.
  4. KM inválido (zero, vazio, letra) é recusado com mensagem que explica.
  5. Mudança grande PERGUNTA antes — o frete é KM × tarifa.
  6. Quem não é Logística nem Administração continua vendo o número em
     texto: é conferência, não campo.

Roda sem servidor (modo local): o que se mede aqui é a tela e o registro.

    python3 testes/test_km_da_carga_efetivada.py
"""
import asyncio, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []

def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok: falhas.append(nome)

async def entrar(nav, nome, setor):
    ctx = await nav.new_context()
    pg = await ctx.new_page()
    await pg.goto(PAINEL); await pg.wait_for_timeout(900)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', nome)
    await pg.select_option('#login-setor', setor)
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(600)
    return ctx, pg

async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctx, pg = await entrar(nav, 'Ana', 'Logística')

        # Uma carga com destino e KM, como sai da Montagem efetivada.
        cid = await pg.evaluate("""() => {
          const pl = DB.frota[0].placa;
          const c = criarCargaProgramada({placa: pl, numeroCarga:'KM1', peso:12000,
            rota:'510', freteDestino:'GOIANIA', kmDeslocamento:583, operador:'Ana'});
          return c.id;
        }""")

        print('\n=== 1. A LOGÍSTICA VÊ CAMPO, NÃO TEXTO ===')
        pode = await pg.evaluate("() => podeCorrigirKmDaCargaUI()")
        ck('a Logística pode corrigir o KM da carga', pode is True, str(pode))

        print('\n=== 2. CORRIGIR GRAVA O NÚMERO NOVO ===')
        await pg.evaluate("""async (id) => {
          const orig = window.confirm; window.confirm = () => true;
          try { await corrigirKmDaCargaUI(id, '640'); } finally { window.confirm = orig; }
        }""", cid)
        await pg.wait_for_timeout(400)
        km = await pg.evaluate("(id) => getCarga(id).kmDeslocamento", cid)
        ck('583 virou 640', km == 640, str(km))

        print('\n=== 3. A CORREÇÃO ENTRA NO HISTÓRICO ===')
        alt = await pg.evaluate("""(id) => (DB.alteracoes||[])
            .filter(a => a.cargaId === id && /KM/i.test(a.campo))
            .map(a => ({campo:a.campo, de:a.de, para:a.para, setor:a.setor}))""", cid)
        ck('há registro da mudança', len(alt) == 1, str(alt))
        if alt:
            ck('guarda o número VELHO', alt[0]['de'] == '583', str(alt[0]['de']))
            ck('guarda o número NOVO', alt[0]['para'] == '640', str(alt[0]['para']))
            ck('guarda o setor de quem mudou', alt[0]['setor'] == 'Logística', str(alt[0]['setor']))

        print('\n=== 4. KM INVÁLIDO É RECUSADO, E A RECUSA EXPLICA ===')
        for ruim in ['0', '', 'abc', '-40']:
            r = await pg.evaluate("""async ([id, v]) => {
              let aviso = null;
              const orig = window.notify;
              window.notify = (m) => { aviso = m; };
              try { await corrigirKmDaCargaUI(id, v); } finally { window.notify = orig; }
              return { aviso, km: getCarga(id).kmDeslocamento };
            }""", [cid, ruim])
            ck(f'"{ruim}" não vira KM', r['km'] == 640, str(r['km']))
            ck(f'"{ruim}" avisa por quê',
               bool(r['aviso']) and 'multiplica a tarifa' in (r['aviso'] or ''),
               str(r['aviso'])[:70])

        print('\n=== 5. MUDANÇA GRANDE PERGUNTA ANTES ===')
        perg = await pg.evaluate("""async (id) => {
          let texto = null;
          const orig = window.confirm;
          window.confirm = (t) => { texto = t; return false; };   // recusa
          try { await corrigirKmDaCargaUI(id, '58'); } finally { window.confirm = orig; }
          return { texto, km: getCarga(id).kmDeslocamento };
        }""", cid)
        ck('640 → 58 pergunta antes', bool(perg['texto']), str(perg['texto'])[:80])
        if perg['texto']:
            ck('a pergunta mostra os dois números',
               '640' in perg['texto'] and '58' in perg['texto'])
        ck('responder NÃO mantém o KM', perg['km'] == 640, str(perg['km']))

        print('\n=== 6. AJUSTE PEQUENO NÃO ATRAPALHA ===')
        # "como 450 km ou 44" — variação normal não pode pedir confirmação.
        sem_perg = await pg.evaluate("""async (id) => {
          let perguntou = false;
          const orig = window.confirm;
          window.confirm = () => { perguntou = true; return true; };
          try { await corrigirKmDaCargaUI(id, '660'); } finally { window.confirm = orig; }
          return { perguntou, km: getCarga(id).kmDeslocamento };
        }""", cid)
        ck('640 → 660 grava direto, sem pergunta',
           sem_perg['perguntou'] is False and sem_perg['km'] == 660, str(sem_perg))

        print('\n=== 7. QUEM NÃO CORRIGE VÊ O NÚMERO, EM TEXTO ===')
        await ctx.close()
        for setor in ['Portaria', 'Expedição', 'Faturamento']:
            c2, p2 = await entrar(nav, 'Fulano', setor)
            pode = await p2.evaluate("() => podeCorrigirKmDaCargaUI()")
            ck(f'{setor} não corrige o KM', pode is False, str(pode))
            await c2.close()
        c3, p3 = await entrar(nav, 'Chefe', 'Administração')
        ck('Administração corrige', await p3.evaluate("() => podeCorrigirKmDaCargaUI()") is True)
        await c3.close()
        await nav.close()

    print('\n' + ('TODOS OS TESTES PASSARAM' if not falhas
                  else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas)))
    return 1 if falhas else 0

sys.exit(asyncio.run(main()))
