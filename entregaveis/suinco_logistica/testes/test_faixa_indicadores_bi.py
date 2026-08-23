#!/usr/bin/env python3
"""A faixa de indicadores no formato BI — Torre de Controle e Indicadores.

Pedido do usuário (23/08/2026), depois de ver o preview do layout BI:
"aplicar essa ideia BI format na parte de indicador, tudo que for indicador
na Torre de Controle... mas sem mudar também o que já está feito".

É MISTURA, não substituição. Este teste trava os dois lados disso:

  o que MUDOU  — a caixa de número virou indicador: régua da cor do status,
                 participação no total, variação contra o período anterior e
                 a série dos últimos 14 dias;
  o que NÃO PODE mudar — o clique que filtra a Torre continua funcionando,
                 o alvo de toque continua em 44px, a esteira de Devoluções
                 (#dev-pipeline, .bento puro) continua no formato antigo, e
                 a faixa do celular continua cabendo na tela.

Três defeitos que este teste existe para não deixar voltar:

  1. Texto ilegível na caixa de alerta. "Programação anterior" pintava o
     fundo inteiro de vermelho e escrevia a nota em --text-dim por cima:
     razão de contraste 1,9. Aqui a cor virou régua e o texto voltou pra
     superfície do card.
  2. Legenda errada na variação. A mesma função escreve a variação nas duas
     telas, mas a Torre compara com ONTEM e os tempos médios comparam a
     semana com a anterior. Texto fixo dizia "igual a ontem" numa caixa de
     sete dias.
  3. Série constante desenhada na base. Com todos os valores iguais o
     mini-gráfico encostava no chão da caixa — lido como queda, quando o
     que houve foi ausência de mudança.

    python3 testes/test_faixa_indicadores_bi.py
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


# Dados de exemplo com movimento REAL no tempo: cargas nascendo ao longo de
# 14 dias e saindo em ritmos diferentes. Sem isso a série fica constante e o
# teste não consegue distinguir "subiu" de "desceu".
SEED = """(qtd) => {
  DB.operador = {nome:'Chefe', setor:'Administração'};
  const st = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
              'Embarque Finalizado','Faturado','Seguiu Viagem'];
  const tr = ['TRANSPORTES ALFA','LOG BETA','RODO GAMA','EXPRESSO DELTA'];
  DB.frota = []; DB.cargas = []; DB.movimentacoes = [];
  const agora = Date.now();
  for(let i=0;i<qtd;i++){
    const placa = 'ABC' + (1+i%9) + 'D' + String(10+(i*7)%89);
    DB.frota.push({placa, transportadora:tr[i%4], tipoVeiculo:'Truck',
                   uf:'SP', capacidadeKg:14000, atualizadoEm:new Date().toISOString()});
    const s = st[i%6];
    // Espalha o nascimento nos últimos 14 dias, com mais carga nos dias
    // recentes — assim "cargas em aberto" sobe e "seguiu viagem" varia.
    const diasAtras = 13 - Math.floor(i / (qtd/14));
    const nasce = agora - diasAtras*86400000 - (i%9)*3600000;
    const c = {
      id:'carga_'+i, numeroCarga:String(10200+i), placa,
      transportadora:tr[i%4], tipoVeiculo:'Truck', motorista:'Motorista '+i,
      cliente:'Cliente '+(i%9), destino:'Cidade '+(i%7), produto:'Suíno resfriado',
      peso:8000+(i*137)%9000, doca:String(1+i%6), sequencia:i+1,
      observacoes:'', praOnde:'Entrega', rota:'500', paletizada:'Não',
      qtdGanchos:10+i%40, qtdEntregas:1+i%4, status:s, aguardandoCarga:false,
      criadoEm:new Date(nasce).toISOString(), criadoPor:'Logística',
      programadoEm:new Date(nasce).toISOString(),
      atualizadoEm:new Date(nasce).toISOString()
    };
    DB.cargas.push(c);
    // Durações que CRESCEM com o tempo: garante variação nos tempos médios
    // (e portanto uma seta pra cima nos indicadores de duração).
    const passo = 20 + (13 - diasAtras) * 6 + (i % 5) * 3;
    st.slice(0, st.indexOf(s)+1).forEach((sx,k)=>{
      DB.movimentacoes.push({id:'mov_'+i+'_'+k, cargaId:c.id, placa,
        statusAnterior:k?st[k-1]:null, statusNovo:sx, operador:'Op '+(k%4),
        setor:['Logística','Portaria','Expedição','Expedição','Faturamento','Portaria'][k],
        timestamp:new Date(nasce + k*passo*60000).toISOString(),
        numeroCarga:c.numeroCarga});
    });
    if(s === 'Seguiu Viagem') c.concluidoEm = new Date(nasce + 5*passo*60000).toISOString();
  }
  document.getElementById('modal-operador')?.classList.remove('open');
  renderAll();
}"""


def luminancia(rgb):
    def canal(v):
        v = v / 255
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = [canal(x) for x in rgb]
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contraste(a, b):
    la, lb = luminancia(a), luminancia(b)
    claro, escuro = max(la, lb), min(la, lb)
    return (claro + 0.05) / (escuro + 0.05)


def parse_rgb(txt):
    nums = [float(x) for x in txt.replace('rgba(', '').replace('rgb(', '')
            .replace(')', '').split(',')[:3]]
    return nums


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []

        # ============ DESKTOP ============
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        await pg.evaluate(SEED, 56)
        await pg.wait_for_timeout(800)

        print('\n=== 1. A FAIXA EXISTE ONDE DEVE, E SÓ ONDE DEVE ===')
        marcadas = await pg.evaluate("""() => ({
            torre: document.getElementById('torre-stats').classList.contains('bi-faixa'),
            ind:   document.getElementById('ind-stats').classList.contains('bi-faixa'),
            devolucoes: document.getElementById('dev-pipeline')
                        ? document.getElementById('dev-pipeline').classList.contains('bi-faixa')
                        : null
        })""")
        ck('Torre de Controle usa a faixa BI', marcadas['torre'] is True)
        ck('Indicadores usa a faixa BI', marcadas['ind'] is True)
        # "sem mudar o que já está feito": a esteira de Devoluções usa a mesma
        # classe .bento e NÃO deve ter sido arrastada junto.
        ck('esteira de Devoluções continua no formato antigo',
           marcadas['devolucoes'] is False, str(marcadas['devolucoes']))

        print('\n=== 2. CONTADOR VIROU INDICADOR ===')
        # Quantas caixas SÃO de status é derivado do próprio modelo, não
        # chutado: a Torre lista os status em aberto, e "Seguiu Viagem" não é
        # um deles. Número fixo aqui viraria falha falsa no dia em que o
        # fluxo ganhar ou perder uma etapa.
        peças = await pg.evaluate("""() => {
            const f = document.getElementById('torre-stats');
            const heroi = f.querySelector('.stat-destaque');
            const nomes = new Set(STATUS_FLOW);
            const status = [...f.querySelectorAll('.stat-box')]
              .filter(e => nomes.has((e.querySelector('.stat-label')||{}).textContent));
            return {
              heroiTemDelta: !!heroi.querySelector('.stat-delta'),
              heroiTemSerie: !!heroi.querySelector('svg.stat-spark'),
              comParticipacao: status.filter(e => e.querySelector('.stat-share')).length,
              totalStatus: status.length,
              comRegua: status.filter(e => e.style.getPropertyValue('--st-cor')).length,
              // As caixas que NÃO são status (sobras, entradas sem carga) não
              // podem ganhar participação: 36 sobras "de 40 em aberto" seria
              // uma porcentagem de duas bases diferentes.
              naoStatusComParticipacao: [...f.querySelectorAll('.stat-box')]
                .filter(e => !nomes.has((e.querySelector('.stat-label')||{}).textContent))
                .filter(e => e.querySelector('.stat-share')).length
            };
        }""")
        ck('o número principal traz a variação contra ontem', peças['heroiTemDelta'])
        ck('o número principal traz a série de 14 dias', peças['heroiTemSerie'])
        ck('a Torre mostra pelo menos quatro status', peças['totalStatus'] >= 4,
           f"{peças['totalStatus']} caixa(s) de status")
        ck('todo status mostra quanto representa do pátio',
           peças['comParticipacao'] == peças['totalStatus'],
           f"{peças['comParticipacao']} de {peças['totalStatus']}")
        ck('todo status carrega a régua da própria cor',
           peças['comRegua'] == peças['totalStatus'],
           f"{peças['comRegua']} de {peças['totalStatus']}")
        ck('caixa que não é status não inventa porcentagem do pátio',
           peças['naoStatusComParticipacao'] == 0,
           f"{peças['naoStatusComParticipacao']} caixa(s)")

        print('\n=== 3. A SETA APONTA PRO LADO CERTO ===')
        # Regra: mais carga parada no pátio é PIOR; mais carga que seguiu
        # viagem é MELHOR. A mesma seta, significados opostos.
        setas = await pg.evaluate("""() => {
            const cx = (rot) => [...document.querySelectorAll('#torre-stats .stat-box')]
              .find(e => (e.querySelector('.stat-label')||{}).textContent === rot);
            const ler = (el) => {
              const d = el && el.querySelector('.stat-delta');
              if(!d) return null;
              return { sobe: d.textContent.includes('▲'),
                       pior: d.classList.contains('stat-pior'),
                       melhor: d.classList.contains('stat-melhor'),
                       igual: d.classList.contains('stat-igual') };
            };
            return { aberto: ler(cx('Cargas em aberto')), saiu: ler(cx('Seguiu Viagem hoje')) };
        }""")
        a, sv = setas['aberto'], setas['saiu']
        ck('variação do pátio existe', a is not None, str(a))
        if a and not a['igual']:
            ck('mais carga em aberto é sinalizado como piora',
               a['pior'] == a['sobe'], str(a))
        ck('variação de saídas existe', sv is not None, str(sv))
        if sv and not sv['igual']:
            ck('mais carga que seguiu viagem é sinalizado como melhora',
               sv['melhor'] == sv['sobe'], str(sv))

        print('\n=== 4. SÉRIE CONSTANTE NÃO É DESENHADA COMO QUEDA ===')
        # Defeito real: com amp forçada em 1, todos os pontos caíam no chão da
        # caixa. Aqui a série é literalmente constante — o traço tem que ficar
        # no meio, longe das duas bordas.
        meio = await pg.evaluate("""() => {
            const svg = sparklineSvg([5,5,5,5,5,5], '#e9b954', 74, 22);
            const m = svg.match(/M([\\d.]+) ([\\d.]+)/);
            return m ? Number(m[2]) : null;
        }""")
        ck('série sem variação desenha no meio da caixa, não na base',
           meio is not None and 8 <= meio <= 14, f'y={meio} (caixa de 22px)')

        print('\n=== 5. O CLIQUE QUE FILTRA A TORRE CONTINUA FUNCIONANDO ===')
        antes = await pg.evaluate("() => document.querySelectorAll('#torre-tbody tr').length")
        await pg.evaluate("""() => [...document.querySelectorAll('#torre-stats .stat-clicavel')]
            .find(e => (e.querySelector('.stat-label')||{}).textContent === 'Aguardando Veículo').click()""")
        await pg.wait_for_timeout(400)
        depois = await pg.evaluate("""() => ({
            linhas: document.querySelectorAll('#torre-tbody tr').length,
            ativo: !!document.querySelector('#torre-stats .stat-ativo')
        })""")
        ck('clicar numa caixa filtra a tabela', depois['linhas'] < antes,
           f"{antes} → {depois['linhas']}")
        ck('a caixa clicada fica marcada como ativa', depois['ativo'])
        await pg.evaluate("() => filtrarTorrePorStatus('__TODAS__')")
        await pg.wait_for_timeout(300)

        print('\n=== 6. INDICADORES: A LEGENDA DIZ O PERÍODO CERTO ===')
        await pg.evaluate("() => abrirTab('indicadores')")
        await pg.wait_for_timeout(900)
        ind = await pg.evaluate("""() => {
            const f = document.getElementById('ind-stats');
            const caixas = [...f.querySelectorAll('.stat-box')];
            return {
              qtd: caixas.length,
              comValor: caixas.filter(e => e.querySelector('.stat-num').textContent.trim() !== '—').length,
              comSerie: caixas.filter(e => e.querySelector('svg.stat-spark')).length,
              textosIgual: caixas.map(e => (e.querySelector('.stat-delta')||{}).textContent || '')
                                 .filter(t => t.includes('=')),
              temDica: caixas.filter(e => (e.getAttribute('title')||'').includes('7 dias')).length
            };
        }""")
        ck('os seis tempos médios calculam', ind['comValor'] == ind['qtd'],
           f"{ind['comValor']} de {ind['qtd']}")
        ck('cada tempo médio traz a própria série', ind['comSerie'] == ind['qtd'],
           f"{ind['comSerie']} de {ind['qtd']}")
        # O defeito #2: aqui a comparação é semana contra semana, então a
        # palavra "ontem" não pode aparecer.
        ck('nenhum tempo médio diz "ontem" (ali a comparação é de 7 dias)',
           not any('ontem' in t for t in ind['textosIgual']), str(ind['textosIgual']))
        ck('a dica explica qual período está sendo comparado', ind['temDica'] >= 1,
           f"{ind['temDica']} caixa(s)")

        print('\n=== 7. CONTRASTE DA CAIXA DE ALERTA, NOS DOIS TEMAS ===')
        for tema in ('escuro', 'claro'):
            await pg.evaluate(f"""() => {{
                if('{tema}' === 'claro') document.documentElement.setAttribute('data-tema','claro');
                else document.documentElement.removeAttribute('data-tema');
            }}""")
            await pg.evaluate("() => abrirTab('torre')")
            await pg.wait_for_timeout(500)
            cores = await pg.evaluate("""() => {
                const al = document.querySelector('#torre-stats .stat-alerta');
                if(!al) return null;
                const fundo = getComputedStyle(al.closest('.bento')).backgroundColor;
                const num = getComputedStyle(al.querySelector('.stat-num')).color;
                const lab = getComputedStyle(al.querySelector('.stat-label')).color;
                return {fundo, num, lab};
            }""")
            if not cores:
                ck(f'caixa de alerta presente ({tema})', False)
                continue
            fundo = parse_rgb(cores['fundo'])
            for peca, cor in (('número', cores['num']), ('rótulo', cores['lab'])):
                r = contraste(parse_rgb(cor), fundo)
                ck(f'alerta · {peca} legível no tema {tema} (>= 4.5:1)', r >= 4.5, f'{r:.2f}:1')

        await pg.evaluate("() => document.documentElement.removeAttribute('data-tema')")
        await pg.close()

        # ============ CELULAR ============
        print('\n=== 8. CELULAR: A FAIXA CONTINUA CABENDO NA TELA ===')
        pgm = await nav.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True)
        pgm.on('pageerror', lambda e: erros.append(str(e)))
        await pgm.goto(PAINEL)
        await pgm.wait_for_timeout(700)
        await pgm.evaluate(SEED, 56)
        await pgm.wait_for_timeout(800)
        m = await pgm.evaluate("""() => {
            const f = document.getElementById('torre-stats');
            const caixas = [...f.querySelectorAll('.stat-box')];
            return {
              alturaFaixa: Math.round(f.getBoundingClientRect().height),
              menorAlvo: Math.min(...caixas.map(e => Math.round(e.getBoundingClientRect().height))),
              participacaoVisivel: caixas.filter(e => {
                const s = e.querySelector('.stat-share');
                return s && getComputedStyle(s).display !== 'none';
              }).length,
              // A participação sai da tela mas não pode sair da informação.
              status: caixas.filter(e =>
                new Set(STATUS_FLOW).has((e.querySelector('.stat-label')||{}).textContent)).length,
              participacaoNoTitle: caixas.filter(e =>
                (e.getAttribute('title')||'').includes('cargas em aberto')).length,
              rolagemLateral: document.documentElement.scrollWidth > document.documentElement.clientWidth
            };
        }""")
        # Teto medido: a grade compacta anterior media 286px; a faixa custa
        # ~31px a mais (as réguas de cor e duas linhas de variação). 340px dá
        # margem pra isso sem deixar a faixa voltar a comer a tela.
        ck('faixa do celular abaixo de 340px', m['alturaFaixa'] <= 340, f"{m['alturaFaixa']}px")
        ck('todo alvo de toque tem 44px ou mais', m['menorAlvo'] >= 44, f"{m['menorAlvo']}px")
        ck('a participação sai da tela estreita', m['participacaoVisivel'] == 0,
           f"{m['participacaoVisivel']} visível(is)")
        ck('mas continua disponível na dica de cada caixa de status',
           m['participacaoNoTitle'] == m['status'],
           f"{m['participacaoNoTitle']} de {m['status']}")
        ck('a página não rola pro lado', not m['rolagemLateral'])
        await pgm.close()

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print(f'    - {f}')
        sys.exit(1)
    print('  Tudo verde.')


asyncio.run(main())
