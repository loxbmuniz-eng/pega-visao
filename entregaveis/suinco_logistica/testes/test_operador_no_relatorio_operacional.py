#!/usr/bin/env python3
"""O operador logístico da rota aparece no Relatório Operacional.

   Pedido do dono (14/09/2026):

     "eu quero que apareça o nome da transportadora e do operador no
      relatório operacional, pois na parte da montagem de carga aparecem
      todas as informações necessárias da rota, operador tipo totalservice,
      montes claros, isso é pra aparecer no relatório operacional ali junto
      com a rota, essas informações são importantes para o faturamento e
      para a melhor fluidez e identificação"

   Transportadora é do CAMINHÃO e já tinha coluna própria. Operador é da
   ROTA — quem faz a distribuição na praça (Total Service, CargoFrio,
   Pantanal) — e não aparecia em lugar nenhum da folha: `rotaCurta()`
   devolve só "510 — Belo Horizonte".

   O teste lê o operador de `rotaInfo()`, não de uma constante escrita aqui.
   Assim ele mede a REGRA ("o operador da rota sai na célula da rota") e não
   um nome de empresa — que muda quando o dono troca de operador, e trocar
   de operador não pode deixar o teste vermelho."""
import asyncio, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []
def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok: falhas.append(nome)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await b.new_page(viewport={'width':1280,'height':800})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL); await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome','Ana'); await pg.select_option('#login-setor','Logística')
        await pg.click('button:has-text("Entrar sem servidor")'); await pg.wait_for_timeout(500)

        # Uma rota COM operador e uma SEM — a folha precisa acertar as duas.
        # 510 tem operador desde o cadastro inicial; 500 (Patos de Minas)
        # nunca teve. Se algum dia a 500 ganhar operador, o teste busca
        # sozinho outra rota vazia em vez de ficar medindo o caso errado.
        rotas = await pg.evaluate("""() => {
          const com = ROTAS.find(r => r.operador);
          const sem = ROTAS.find(r => !r.operador);
          return { com: com && com.codigo, comOperador: com && com.operador,
                   sem: sem && sem.codigo };
        }""")
        ck('existe rota com operador cadastrado', bool(rotas['com']), str(rotas['com']))
        ck('existe rota sem operador cadastrado', bool(rotas['sem']), str(rotas['sem']))
        if not rotas['com'] or not rotas['sem']:
            await b.close(); return 1

        await pg.evaluate("""(r) => {
          const pl = DB.frota.slice(0,2).map(f=>f.placa);
          criarCargaProgramada({placa:pl[0], numeroCarga:'OP1', peso:12000, qtdEntregas:3,
                                rota:r.com, operador:'Ana', sequencia:1});
          criarCargaProgramada({placa:pl[1], numeroCarga:'OP2', peso:9000,  qtdEntregas:1,
                                rota:r.sem, operador:'Ana', sequencia:2});
        }""", rotas)

        await pg.evaluate("() => montarRelatorioOperacional()")
        await pg.wait_for_timeout(400)

        print('\n=== A COLUNA ROTA CARREGA O OPERADOR ===')
        celulas = await pg.evaluate("""() => Array.from(
            document.querySelectorAll('#print-operacional tbody tr')
          ).map(tr => ({
            carga: (tr.querySelector('.c-carga')||{}).textContent || '',
            rota:  (tr.querySelector('.c-rota') ||{}).textContent || '',
            transp:(tr.querySelector('.c-transp')||{}).textContent || '',
          }))""")
        com = next((c for c in celulas if 'OP1' in c['carga']), None)
        sem = next((c for c in celulas if 'OP2' in c['carga']), None)
        ck('as duas cargas saíram na folha', bool(com and sem),
           f'{len(celulas)} linha(s)')
        if not (com and sem):
            print(celulas); await b.close(); return 1

        ck('a célula da rota traz o código e a praça',
           rotas['com'] in com['rota'], repr(com['rota']))
        ck('a célula da rota traz o OPERADOR da rota',
           rotas['comOperador'] in com['rota'],
           f"esperava conter {rotas['comOperador']!r}, veio {com['rota']!r}")

        print('\n=== ROTA SEM OPERADOR NÃO INVENTA NEM SUJA A CÉLULA ===')
        # Nada de "500 — Patos de Minas ()" nem separador solto no fim.
        limpo = sem['rota'].strip()
        ck('sem parêntese vazio', '()' not in limpo, repr(limpo))
        ck('sem separador pendurado no fim',
           not limpo.endswith(('·','—','-','/')), repr(limpo))

        print('\n=== A TRANSPORTADORA CONTINUA NA FOLHA ===')
        # O pedido foi "transportadora E operador". A transportadora já tinha
        # coluna; esta asserção existe para que pôr o operador não a derrube.
        cabecalhos = await pg.evaluate("""() => Array.from(
            document.querySelectorAll('#print-operacional thead th')
          ).map(t => t.textContent.trim())""")
        ck('coluna Transportadora presente', 'Transportadora' in cabecalhos,
           ' | '.join(cabecalhos))
        ck('a transportadora do caminhão veio preenchida',
           bool(com['transp'].strip()) and com['transp'].strip() != '—',
           repr(com['transp']))

        print('\n=== SEM ERRO DE JAVASCRIPT ===')
        ck('nenhum erro na página', not erros, ' | '.join(erros[:3]))
        await b.close()

    print('\n' + ('TODOS OS TESTES PASSARAM' if not falhas
                  else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas)))
    return 1 if falhas else 0

sys.exit(asyncio.run(main()))
