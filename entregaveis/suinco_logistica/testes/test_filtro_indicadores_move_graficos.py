#!/usr/bin/env python3
"""O filtro dos Indicadores move a ABA INTEIRA — inclusive os gráficos.

RELATO DO DONO (28/08/2026)

  "quando usa o filtro os graficos somem voce precisa resolver isso, os
   indicadores de qual regional transportadora enfim"
  "e quando clica nos graficos e filtra por transportadora ele precisa
   interagir com aquele dado filtrado ou clicado"

O QUE ESTAVA ERRADO

A aba tinha DOIS conjuntos de filtros independentes. O de cima movia os
cartões e as tabelas; um segundo, dentro do card de Gráficos, movia só os
gráficos. Medido no código publicado: filtrar uma transportadora no filtro
de cima deixava os três gráficos com EXATAMENTE os mesmos pixels
(3.321 / 1.057 / 15.590 antes e depois). As listas também discordavam —
7 transportadoras num filtro, 1 no outro.

Duas verdades sobre o mesmo dia, na mesma tela, sem nada avisando.

POR QUE ESTE TESTE CONTA PIXELS

Um teste que só olhasse "o select mudou de valor" passaria com o defeito
intacto — era exatamente o que acontecia. O que o dono vê é o desenho, e o
desenho é a única prova de que o filtro chegou até o fim. Contar pixels
diferentes do fundo é ler a mesma coisa que o olho lê.

Cobre também o que NÃO PODE voltar: os gargalos e o tempo de pátio liam
DB.cargas cru e ignoravam o filtro, e a busca por número de carga movia a
tabela sem mover os gráficos (o filtro dos gráficos só entendia placa).

    python3 testes/test_filtro_indicadores_move_graficos.py
"""
import asyncio
import sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


# Duas transportadoras, duas rotas e duas operações bem separadas, com
# DURAÇÕES DIFERENTES entre elas: se os tempos fossem iguais, filtrar não
# mudaria o desenho e o teste não saberia distinguir "filtro não chegou" de
# "chegou e o resultado é igual".
SEED = """() => {
  DB.operador = {nome:'Chefe', setor:'Administração'};
  const st = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
              'Embarque Finalizado','Faturado','Seguiu Viagem'];
  DB.frota = []; DB.cargas = []; DB.movimentacoes = [];
  const agora = Date.now();
  const grupos = [
    {tr:'TRANSPORTES ALFA', rota:'500', op:'Entrega', passo:18, n:18},
    {tr:'LOG BETA',         rota:'901', op:'Transferência', passo:75, n:14},
  ];
  let i = 0;
  grupos.forEach((g, gi) => {
    for(let k=0;k<g.n;k++, i++){
      const placa = (gi ? 'XYZ' : 'ABC') + (1+k%9) + 'D' + String(10+(k*7)%89);
      DB.frota.push({placa, transportadora:g.tr, tipoVeiculo:'Truck', uf:'SP',
                     capacidadeKg:14000, atualizadoEm:new Date().toISOString()});
      /* SETE DIAS, NÃO DOZE — e o teste escolhe o período "Semana"
         explicitamente logo abaixo. Os dois juntos tiram o CALENDÁRIO da
         medição (02/09/2026).

         O que acontecia com doze: as cargas concluídas nasciam 5 e 11 dias
         atrás, e o gráfico usava a janela "Mês", que em data.js é o mês do
         CALENDÁRIO (`new Date(ano, mes, 1)`). Rodando dia 31, tudo cabia e
         a suíte passava. Rodando dia 2, a janela começou anteontem e as
         cargas ficaram em agosto: ZERO concluídas no período, o gráfico de
         tempo médio por etapa desenhava vazio nos dois lados do filtro, e
         os pixels davam idênticos. O teste acusava "o filtro não chega nos
         gráficos" — e o filtro chegava; o que faltava era dado.

         "Semana" é janela ROLANTE (`agora - 7 dias`), então sete dias
         cabem nela em qualquer data do ano. Com k%7 as concluídas caem em
         três dias distintos para ALFA e dois para BETA: a linha tem forma
         e filtrar muda o desenho, sempre.

         Teste que só passa em certos dias do mês não protege nada — ele
         some do radar exatamente quando reprova por engano, e aí o dia em
         que reprovar de verdade ninguém acredita. */
      const diasAtras = k % 7;
      const nasce = agora - diasAtras*86400000 - (k%9)*3600000;
      const s = st[k % 6];
      const c = {
        id:'carga_'+i, numeroCarga:String(70000 + (gi?500:0) + k), placa,
        transportadora:g.tr, tipoVeiculo:'Truck', motorista:'Motorista '+i,
        cliente:'Cliente '+k, destino:'Cidade '+k, produto:'Suíno resfriado',
        peso:9000+k*100, doca:String(1+k%6), sequencia:i+1, observacoes:'',
        praOnde:g.op, rota:g.rota, paletizada:'Não', qtdGanchos:20,
        qtdEntregas:1+k%3, status:s, aguardandoCarga:false,
        criadoEm:new Date(nasce).toISOString(), criadoPor:'Logística',
        programadoEm:new Date(nasce).toISOString(),
        atualizadoEm:new Date(nasce).toISOString()
      };
      DB.cargas.push(c);
      st.slice(0, st.indexOf(s)+1).forEach((sx,j)=>{
        DB.movimentacoes.push({id:'mov_'+i+'_'+j, cargaId:c.id, placa,
          statusAnterior:j?st[j-1]:null, statusNovo:sx, operador:'Op '+j,
          setor:['Logística','Portaria','Expedição','Expedição','Faturamento','Portaria'][j],
          timestamp:new Date(nasce + j*g.passo*60000).toISOString(),
          numeroCarga:c.numeroCarga});
      });
      if(s === 'Seguiu Viagem') c.concluidoEm = new Date(nasce + 5*g.passo*60000).toISOString();
    }
  });
  document.getElementById('modal-operador')?.classList.remove('open');
  renderAll();
}"""

# Conta pixels que não são o fundo do canvas. É a leitura mais próxima do
# olho: se o desenho mudou, este número muda; se o filtro não chegou, ele
# fica idêntico até a unidade.
TINTA = """(id) => {
  const cv = document.getElementById(id);
  if(!cv) return null;
  const ctx = cv.getContext('2d');
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  for(let i=0;i<d.length;i+=4){ if(d[i+3] > 8) n++; }
  return n;
}"""

GRAFICOS = ['grafico-barras', 'grafico-linha', 'grafico-pizza']


async def tinta(pg):
    return {g: await pg.evaluate(TINTA, g) for g in GRAFICOS}


async def texto(pg, sel):
    el = await pg.query_selector(sel)
    return (await el.inner_text()).strip() if el else ''


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(SEED)
        await pg.wait_for_timeout(400)
        await pg.evaluate("abrirTab('indicadores')")
        await pg.wait_for_timeout(700)

        print('\n=== 1. EXISTE UM FILTRO SÓ NA ABA ===')
        # O segundo conjunto de filtros é a origem do defeito: enquanto ele
        # existir, alguém pode mexer nele e obter uma tela que discorda de
        # si mesma. A checagem é pela AUSÊNCIA.
        sobrou = await pg.evaluate(
            "() => [...document.querySelectorAll('[id^=\\\"graf-filtro\\\"]')].map(e=>e.id)")
        ck('não existe um segundo conjunto de filtros nos gráficos',
           sobrou == [], f"ainda existe: {sobrou}")

        campos = await pg.evaluate("""() => ['ind-f-transp','ind-f-rota','ind-f-operacao',
            'ind-f-periodo','ind-f-busca'].filter(id => !document.getElementById(id))""")
        ck('o filtro do topo tem transportadora, rota, operação, período e busca',
           campos == [], f"faltando: {campos}")

        # As duas listas discordavam (7 opções x 1). Com um filtro só, a
        # pergunta deixa de existir — mas a lista precisa cobrir os dados.
        opcoes = await pg.evaluate(
            "() => document.getElementById('ind-f-transp').options.length")
        ck('a lista de transportadoras traz as duas dos dados', opcoes == 3,
           f"{opcoes} opções (1 'Todas' + 2)")

        print('\n=== 2. FILTRAR TRANSPORTADORA REDESENHA OS TRÊS GRÁFICOS ===')
        # PERÍODO ESCOLHIDO NA MÃO, e não o padrão da tela. O padrão é
        # "Todo o histórico" (value=""), mas os gráficos fazem
        # `FILTRO_IND.periodo || 'mes'` — o vazio vira "Mês" no caminho. Não
        # é o que este arquivo mede, e deixar implícito foi o que fez a
        # suíte depender do dia do mês. Ver o comentário grande no SEED.
        await pg.select_option('#ind-f-periodo', 'semana')
        await pg.wait_for_timeout(600)
        antes = await tinta(pg)
        ck('os três gráficos desenharam alguma coisa antes de filtrar',
           all(v and v > 100 for v in antes.values()), str(antes))

        await pg.select_option('#ind-f-transp', 'LOG BETA')
        await pg.wait_for_timeout(600)
        depois = await tinta(pg)
        for g in GRAFICOS:
            ck(f'{g} mudou ao filtrar transportadora',
               antes[g] != depois[g], f"{antes[g]} → {depois[g]} pixels")

        print('\n=== 3. O RESTO DA ABA CONCORDA COM OS GRÁFICOS ===')
        # Gargalos e tempo de pátio liam DB.cargas cru: mostravam o pátio
        # inteiro ao lado de gráficos já recortados.
        gargalos = await texto(pg, '#ind-gargalos')
        ck('os gargalos não citam a transportadora que foi filtrada fora',
           'TRANSPORTES ALFA' not in gargalos,
           'ALFA ainda aparece nos gargalos')
        ck('os gargalos continuam mostrando a transportadora filtrada',
           'LOG BETA' in gargalos)

        nota = await texto(pg, '#ind-filtro-nota')
        ck('a tela diz em texto qual recorte está no ar', 'LOG BETA' in nota, nota)

        print('\n=== 4. ROTA E OPERAÇÃO TAMBÉM CHEGAM AOS GRÁFICOS ===')
        # Eram as duas chaves que o filtro dos gráficos simplesmente
        # ignorava: passavam no objeto e ninguém lia.
        await pg.select_option('#ind-f-transp', '')
        await pg.wait_for_timeout(500)
        base = await tinta(pg)

        await pg.select_option('#ind-f-rota', '901')
        await pg.wait_for_timeout(600)
        porRota = await tinta(pg)
        ck('filtrar por ROTA muda os gráficos',
           any(base[g] != porRota[g] for g in GRAFICOS),
           f"{base} → {porRota}")

        await pg.select_option('#ind-f-rota', '')
        await pg.select_option('#ind-f-operacao', 'Transferência')
        await pg.wait_for_timeout(600)
        porOp = await tinta(pg)
        ck('filtrar por OPERAÇÃO muda os gráficos',
           any(base[g] != porOp[g] for g in GRAFICOS),
           f"{base} → {porOp}")

        print('\n=== 5. BUSCAR POR NÚMERO DA CARGA MOVE OS DOIS LADOS ===')
        # A tabela procurava por placa OU número de carga; os gráficos só
        # por placa. Digitar um número movia a tabela e deixava o gráfico
        # parado — a mesma discordância, por outra porta.
        await pg.select_option('#ind-f-operacao', '')
        await pg.wait_for_timeout(400)
        base2 = await tinta(pg)
        await pg.fill('#ind-f-busca', '70500')
        await pg.wait_for_timeout(600)
        porNumero = await tinta(pg)
        ck('buscar por número da carga muda os gráficos',
           any(base2[g] != porNumero[g] for g in GRAFICOS),
           f"{base2} → {porNumero}")
        await pg.fill('#ind-f-busca', '')
        await pg.wait_for_timeout(400)

        print('\n=== 6. CLICAR NO DADO APLICA O FILTRO (E O CLIQUE DE NOVO TIRA) ===')
        alvo = await pg.query_selector('#ind-gargalos .cel-filtro')
        ck('as tabelas de gargalos têm dados clicáveis', alvo is not None)
        if alvo:
            rotulo = (await alvo.inner_text()).strip().replace(' ✕', '')
            caixa = await alvo.bounding_box()
            antesClique = await tinta(pg)
            await alvo.click()
            await pg.wait_for_timeout(600)
            notaClique = await texto(pg, '#ind-filtro-nota')
            ck('clicar no dado escreve o recorte na nota do topo',
               rotulo.split(' ')[0] in notaClique or rotulo in notaClique,
               f"cliquei em '{rotulo}', nota diz '{notaClique}'")
            depoisClique = await tinta(pg)
            ck('clicar no dado redesenha os gráficos',
               any(antesClique[g] != depoisClique[g] for g in GRAFICOS),
               f"{antesClique} → {depoisClique}")

            # Sem o clique-de-novo, quem clica errado fica preso.
            de_novo = await pg.query_selector('#ind-gargalos .cel-filtro-ativa')
            ck('o dado filtrado fica marcado como ativo', de_novo is not None)
            if de_novo:
                await de_novo.click()
                await pg.wait_for_timeout(600)
                limpo = await texto(pg, '#ind-filtro-nota')
                ck('clicar de novo no mesmo dado limpa o filtro',
                   rotulo.split(' ')[0] not in limpo, f"nota: '{limpo}'")

        print('\n=== 7. CELULAR: ALVO DE TOQUE E SEM ROLAGEM LATERAL ===')
        pgm = await nav.new_page(viewport={'width': 390, 'height': 844})
        pgm.on('pageerror', lambda e: erros.append(str(e)))
        await pgm.goto(PAINEL)
        await pgm.wait_for_timeout(700)
        await pgm.evaluate(SEED)
        await pgm.wait_for_timeout(400)
        await pgm.evaluate("abrirTab('indicadores')")
        await pgm.wait_for_timeout(800)
        # No celular a tabela vira cartão e 'Transportadora' é um campo
        # secundário: fica escondido até o toque abrir o cartão. É o
        # desenho do painel inteiro, não uma exceção daqui — então o teste
        # abre o cartão, como a pessoa abre, e SÓ ENTÃO mede o alvo.
        await pgm.evaluate("""() => {
            const tr = document.querySelector('#ind-gargalos table.mobile-cartao tbody tr');
            if(tr) tr.classList.add('cartao-aberto');
        }""")
        await pgm.wait_for_timeout(300)
        alt = await pgm.evaluate("""() => {
            const e = document.querySelector('#ind-gargalos .cel-filtro');
            return e ? Math.round(e.getBoundingClientRect().height) : null;
        }""")
        ck('no celular o dado clicável tem alvo de toque de 44px',
           alt is not None and alt >= 44, f"{alt}px")

        # No celular o toque precisa FILTRAR. O handler que abre o cartão
        # mora no document e pega qualquer toque na linha; as células que
        # filtram são <td role="button"> e por isso foram excluídas dele
        # (app.js) — sem essa exclusão, um toque fazia as duas coisas.
        #
        # Não dá para observar aqui se o cartão "alternou": aplicar o
        # filtro redesenha a tabela inteira, e a linha nova nasce fechada
        # de qualquer jeito. O que se observa — e o que importa para quem
        # está com o celular na mão — é se o filtro pegou.
        await pgm.evaluate("() => { document.getElementById('ind-f-operacao').value=''; aplicarFiltroIndicadores(); }")
        await pgm.wait_for_timeout(500)
        cel = await pgm.query_selector('#ind-gargalos .cel-filtro')
        if cel:
            rotuloM = (await cel.inner_text()).strip().replace(' ✕', '')
            # el.click() em vez do clique de mouse: no celular o rodapé de
            # conexão é fixo no pé da tela e intercepta o ponteiro. O
            # evento sobe pelo document igual — que é onde mora o handler
            # do cartão. O alvo de toque em si já foi medido acima.
            await cel.evaluate("el => el.click()")
            await pgm.wait_for_timeout(700)
            notaM = await texto(pgm, '#ind-filtro-nota')
            ck('no celular, tocar no dado aplica o filtro',
               rotuloM.split(' ')[0] in notaM, f"toquei em '{rotuloM}', nota: '{notaM}'")

        largura = await pgm.evaluate(
            "() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        ck('a aba não ganhou rolagem lateral no celular', largura <= 1, f"{largura}px sobrando")

        ck('nenhum erro de JavaScript na página', not erros, ' | '.join(erros[:3]))
        await nav.close()

    print('\n' + '='*55)
    if falhas:
        print(f"  {len(falhas)} FALHA(S):")
        for f in falhas:
            print(f"    - {f}")
        sys.exit(1)
    print('  Tudo verde.')


asyncio.run(main())
