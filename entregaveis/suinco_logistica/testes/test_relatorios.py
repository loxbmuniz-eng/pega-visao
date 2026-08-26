import asyncio, sys
from playwright.async_api import async_playwright
PAINEL='file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas=[]
def ck(n,ok,d=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {n}" + (f" — {d}" if d else ''))
    if not ok: falhas.append(n)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await b.new_page(viewport={'width':1063,'height':750}); erros=[]
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL); await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome','Ana'); await pg.select_option('#login-setor','Logística')
        await pg.click('button:has-text("Entrar sem servidor")'); await pg.wait_for_timeout(500)

        # 3 cargas, uma percorrendo o fluxo inteiro para gerar tempos
        await pg.evaluate("""() => {
          const pl = DB.frota.slice(0,3).map(f=>f.placa);
          const ids = pl.map((p,i)=>criarCargaProgramada({placa:p, numeroCarga:'R'+i,
            peso:9000+i*1000, qtdEntregas:2, rota:'500', observacoes:'Frete '+i, operador:'Ana'}).id);
          ['Aguardando Embarque','Embarque Iniciado','Embarque Finalizado','Faturado','Seguiu Viagem']
            .forEach(st => avancarStatusCarga(ids[0], st, 'Ana', 'Logística'));
        }""")
        await pg.evaluate("()=>{ window.print = ()=>{}; }")

        print('\n=== NOME DO ARQUIVO ===')
        # O nome do PDF deixou de vir do document.title (gambiarra que o
        # window.print() exigia) e passou a vir do atributo `download` do
        # link + Content-Disposition do servidor, desde que a geração do
        # PDF virou responsabilidade do backend (09/08/2026). O que
        # importa continua igual: três relatórios, três nomes distintos,
        # todos datados — senão o gestor junta três arquivos iguais na
        # pasta de downloads e não sabe qual é qual.
        nomes = await pg.evaluate("""async () => {
          const capturados = [];
          const clickOriginal = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function(){
            if(this.download) capturados.push(this.download);
          };
          // Sem servidor configurado a exportação para antes de baixar;
          // finge o adaptador só para chegar até a montagem do nome.
          const origConfig = SuincoSharePoint.estaConfigurado;
          const origGerar = SuincoSharePoint.gerarRelatorioPdf;
          SuincoSharePoint.estaConfigurado = () => true;
          SuincoSharePoint.gerarRelatorioPdf = async () =>
            new Blob(['%PDF-1.4'], {type:'application/pdf'});
          try{
            await exportarPdfOperacional();
            await exportarPdfExecutivo();
            await exportarPdfFretes();
          } finally {
            HTMLAnchorElement.prototype.click = clickOriginal;
            SuincoSharePoint.estaConfigurado = origConfig;
            SuincoSharePoint.gerarRelatorioPdf = origGerar;
          }
          return capturados;
        }""")
        for n in nomes:
            print(f'  {n}')
        ck('os três relatórios geraram nome de arquivo', len(nomes) == 3, str(nomes))
        ck('os três nomes são diferentes', len(set(nomes)) == 3, str(nomes))
        ck('o nome tem data', any('2026-' in n for n in nomes), str(nomes))
        ck('o título da aba não é mais sequestrado',
           (await pg.title()) == 'Programação de Embarque — Suinco',
           await pg.title())

        print('\n=== EXECUTIVO: LIMPEZA ===')
        await pg.evaluate("()=>exportarPdfExecutivo()")
        await pg.wait_for_timeout(400)
        r = await pg.evaluate("""() => {
          const t = document.getElementById('print-executivo').innerText;
          return {
            legenda: !!document.querySelector('#print-executivo .legenda-status'),
            menorMaior: /Menor e maior/.test(t),
            rankingTransp: /Ranking do dia|Ranking histórico/.test(t),
            tempoMedio: /Tempo Médio de Pátio/.test(t),
            atraso: /Veículos com Maior Atraso/.test(t),
            gargalos: /Gargalos/.test(t),
            secoes: [...document.querySelectorAll('#print-executivo .print-secao-tit')].map(e=>e.innerText)
          };
        }""")
        ck('legenda de status (parecia botão) removida', not r['legenda'])
        ck('"Menor e maior tempo" removido', not r['menorMaior'])
        ck('ranking de transportadoras removido', not r['rankingTransp'])
        ck('Tempo Médio de Pátio presente', r['tempoMedio'])
        ck('Ranking de Veículos com Maior Atraso presente', r['atraso'])
        ck('Gargalos e Pontos Críticos presente', r['gargalos'])
        print('  seções:', r['secoes'])

        print('\n=== PADRÃO DE DOCUMENTO ===')
        alvos = [('exportarPdfOperacional','print-operacional','doc-denso','Operacional'),
                 ('exportarPdfExecutivo','print-executivo','doc-normal','Executivo'),
                 ('exportarPdfFretes','print-fretes','doc-amplo','Fretes')]
        for fn, cid, classe, rot in alvos:
            await pg.evaluate(f"()=>{fn}()")
            await pg.wait_for_timeout(300)
            d = await pg.evaluate(f'''() => {{
              const c = document.getElementById('{cid}');
              const pag = c.querySelector('.print-page');
              const img = c.querySelector('.doc-logo');
              // A identificação DESCEU PARA O RODAPÉ (.doc-ficha). Já foi
              // tabela abaixo do cabeçalho, depois linha corrida no mesmo
              // lugar; agora sai do caminho do título. Referência, período e
              // registros são dados de conferência — quem confere lê uma
              // vez, quem decide não lê nunca.
              const ficha = c.querySelector('.doc-ficha');
              const meta = ficha ? ficha.innerText : '';
              // O cabeçalho tem de estar LIMPO: se a ficha voltar para o
              // alto, este teste precisa acusar.
              const cab = (c.querySelector('.doc-cabecalho')||{{}}).innerText || '';
              return {{
                classe: pag ? pag.className : '',
                titulo: (c.querySelector('.doc-titulo')||{{}}).innerText || '',
                empresa: (c.querySelector('.doc-empresa')||{{}}).innerText || '',
                logo: !!img && img.complete && img.naturalWidth > 0,
                // Os rótulos saem em maiúsculas por CSS, e innerText devolve
                // o texto já transformado. Comparar sem caixa mede o
                // conteúdo, não o estilo.
                fichaNoRodape: !!(ficha && ficha.closest('.doc-rodape')),
                temPeriodo: /Período/i.test(meta),
                // "Emitido em" e "Emitido por" perderam os RÓTULOS de
                // propósito: data com hora e nome de pessoa se identificam
                // sozinhos. O que precisa continuar existindo é o DADO.
                temQuando: /\d{{2}}\/\d{{2}}\/\d{{4}}/.test(
                  (c.querySelector('.doc-ficha-quando')||{{}}).innerText || ''),
                temQuem: ((c.querySelector('.doc-ficha-quem')||{{}}).innerText || '').trim().length > 2,
                rotuloEmitidoSumiu: !/Emitido (em|por)/i.test(c.innerText),
                cabecalhoLimpo: !/Referência|Registros/i.test(cab),
                rodape: !!c.querySelector('.doc-assinatura'),
                // Peças do padrão de documento de auditoria.
                temRef: /SUI-(OPE|EXE|ADM)-\\d{{8}}-\\d{{4}}/.test(c.innerText),
                temBase: !!c.querySelector('.doc-base'),
                temLimitacoes: !!c.querySelector('.doc-limitacoes'),
                temClassificacao: !!c.querySelector('.doc-classificacao')
              }};
            }}''')
            ck(f'{rot}: densidade {classe}', classe in d['classe'], d['classe'])
            ck(f'{rot}: identificação da empresa', 'SUINCO' in d['empresa'], d['empresa'])
            ck(f'{rot}: logo carregou', d['logo'])
            ck(f'{rot}: referência citável do documento', d['temRef'],
               'sem ela, dois relatórios do mesmo dia viram "aquele relatório"')
            ck(f'{rot}: base de preparação declarada', d['temBase'],
               'diz o que exatamente foi contado')
            ck(f'{rot}: alcance e limitações no rodapé', d['temLimitacoes'])
            ck(f'{rot}: classificação de uso', d['temClassificacao'])
            ck(f'{rot}: ficha de identificação no RODAPÉ', d['fichaNoRodape'],
               'referência e período são conferência, não abertura')
            ck(f'{rot}: cabeçalho sem metadados', d['cabecalhoLimpo'],
               'no alto ficam só marca, título, subtítulo e classificação')
            ck(f'{rot}: período, data/hora e operador presentes',
               d['temPeriodo'] and d['temQuando'] and d['temQuem'],
               f"período={d['temPeriodo']} quando={d['temQuando']} quem={d['temQuem']}")
            ck(f'{rot}: sem os rótulos "Emitido em/por"', d['rotuloEmitidoSumiu'],
               'data e nome se identificam sozinhos')
            ck(f'{rot}: rodapé de identificação', d['rodape'])

        print('\n=== FRETES: FONTE LEGÍVEL ===')
        # O motivo desta bateria existir: o de Fretes dividia container com o
        # Operacional e herdava a fonte de 7,6px calibrada para 13 colunas.
        await pg.evaluate("()=>exportarPdfFretes()")
        await pg.wait_for_timeout(300)
        f = await pg.evaluate('''() => {
          const c = document.getElementById('print-fretes');
          // Escopo na tabela de DADOS. O filtro por .doc-identificacao segue
          // aqui de propósito: ela já foi tabela, e se algum dia voltar a ser
          // o teste continua medindo o relatório, não o cabeçalho.
          const dados = [...c.querySelectorAll('table')]
                          .find(t => !t.classList.contains('doc-identificacao'));
          const td = dados ? dados.querySelector('tbody td') : null;
          const ths = dados ? [...dados.querySelectorAll('thead th')].map(x=>x.innerText.trim()) : [];
          return {
            colunas: ths,
            fonteTela: td ? parseFloat(getComputedStyle(td).fontSize) : 0,
            containerProprio: !document.getElementById('print-operacional').innerHTML.includes('Administração de Fretes')
          };
        }''')
        ck('Fretes tem container próprio', f['containerProprio'],
           'compartilhar com o Operacional era a causa da fonte minúscula')
        # SEIS colunas desde 26/08/2026. A história desta linha é a de um
        # relatório que foi ganhando o que faltava para ser conferível:
        #
        #   · 25/08 — entrou a PLACA. "o relatorio de administracao de fretes
        #     precisa aparecer a placa tambem, acabei de checar aqui e esta
        #     faltando uma coluna placa". Sem ela, quem confere o frete não
        #     sabe qual caminhão fez a viagem que está cobrando;
        #   · 26/08 — entraram as DATAS. "puxamos o relatorio de administracao
        #     de fretes dos ultimos 30 dias e nao esta vindo com DATA, eu
        #     preciso da data e hora em cada linha". Trinta dias sem data não
        #     se confere de jeito nenhum.
        #
        # A regra mudou de propósito das duas vezes; o teste segue a regra
        # nova. E a ORDEM importa: data primeiro, porque é por ela que se
        # procura a linha numa folha de trinta dias.
        # Rótulos CURTOS: "Programada" e "Número da Carga" por extenso não
        # cabiam na largura das colunas e saíam cortados no cabeçalho — achado
        # pela conferência de layout logo abaixo, não pelo olho.
        ck('seis colunas — as datas entraram em 26/08',
           f['colunas'] == ['Data','Saída','Nº Carga','Placa','Rota','Observações'],
           str(f['colunas']))
        ck('fonte de leitura na tela', f['fonteTela'] >= 12, f"{f['fonteTela']}px")

        # A COLUNA EXISTIR NÃO BASTA: ela tem que trazer data de verdade.
        # Uma coluna nova que sai com "—" em toda linha passa numa conferência
        # de cabeçalho e não serve para nada na folha.
        datas = await pg.evaluate('''() => {
          const c = document.getElementById('print-fretes');
          const dados = [...c.querySelectorAll('table')]
                          .find(t => !t.classList.contains('doc-identificacao'));
          if (!dados) return [];
          return [...dados.querySelectorAll('tbody tr')]
                   .map(tr => (tr.children[0] || {}).innerText || '')
                   .map(s => s.trim());
        }''')
        comData = [d for d in datas if '/' in d]
        ck('a coluna Programada traz data de verdade',
           len(datas) == 0 or len(comData) == len(datas),
           f'{len(comData)} de {len(datas)} linhas com data')

        # ================================================================
        # A FOLHA CABE NO PAPEL — a trava que faltava (26/08/2026).
        #
        # Nesta mesma tarde eu publiquei uma marca de texto dentro da célula
        # da placa. A coluna Placa tem 7,5% da folha e não quebra linha: o
        # texto inchou a coluna para um terço da página e derrubou a tabela
        # inteira para fora do A4. O dono abriu o relatório do dia e escreveu
        # "TA TOTALMENTE ZUADO".
        #
        # E TODOS OS TESTES PASSARAM. Havia teste de coluna, de rodapé, de
        # fonte, de conteúdo — e nenhum media a única coisa que o leitor vê
        # primeiro: se a folha cabe na folha.
        #
        # Esta checagem roda em MODO IMPRESSÃO (emulate_media), porque as
        # larguras do relatório vivem dentro de @media print e não valem na
        # tela. Medir na tela é medir outro documento.
        # ================================================================
        print('\n=== A FOLHA CABE NO PAPEL ===')
        for alvo, nome in [('print-fretes', 'Fretes'), ('print-operacional', 'Operacional')]:
            await pg.evaluate(
                "(id) => { const e=document.getElementById(id);"
                "  e.dataset.medindo='1'; e.style.display='block'; }", alvo)
        await pg.emulate_media(media='print')
        await pg.wait_for_timeout(500)
        for alvo, nome in [('print-fretes', 'Fretes'), ('print-operacional', 'Operacional')]:
            m = await pg.evaluate("""(id) => {
                const c = document.getElementById(id);
                const t = c.querySelector('table');
                const pag = c.querySelector('.print-page');
                if (!t || !pag) return null;
                const vaza = [...c.querySelectorAll('td,th')]
                  .filter(x => x.scrollWidth > x.clientWidth + 1)
                  .map(x => (x.className.split(' ')[0] || 'sem-classe') + ': '
                             + x.innerText.trim().slice(0, 18));
                return {
                  tabela: Math.round(t.getBoundingClientRect().width),
                  pagina: Math.round(pag.getBoundingClientRect().width),
                  vaza,
                };
            }""", alvo)
            if not m:
                ck(f'{nome}: folha medida', False, 'não achei a tabela')
                continue
            ck(f'{nome}: a tabela cabe na página',
               m['tabela'] <= m['pagina'] + 2,
               f"tabela {m['tabela']}px, página {m['pagina']}px")
            ck(f'{nome}: nenhuma célula transborda a própria coluna',
               not m['vaza'], '; '.join(m['vaza'][:4]))
        await pg.emulate_media(media='screen')
        await pg.evaluate(
            "() => document.querySelectorAll('[data-medindo]')"
            "  .forEach(e => { e.style.display=''; delete e.dataset.medindo; })")

        print('\n=== OPERACIONAL: MESMA LIMPEZA ===')
        await pg.evaluate("()=>exportarPdfOperacional()")
        await pg.wait_for_timeout(400)
        o = await pg.evaluate('''() => {
          const cont = document.getElementById('print-operacional');
          const ths = [...cont.querySelectorAll('thead th')].map(t=>t.innerText);
          const rodape = (cont.querySelector('.doc-nota')||{}).innerText || '';
          return {
            legenda: !!cont.querySelector('.legenda-status'),
            colunas: ths,
            temDestino: ths.includes('Destino'),
            linhasRodape: rodape.split('\\n').filter(x=>x.trim()).length,
            total: !!cont.querySelector('.linha-total')
          };
        }''')
        ck('legenda de cores removida do operacional', not o['legenda'])
        ck('coluna Destino removida (o campo saiu do formulário)', not o['temDestino'],
           str(o['colunas']))
        ck('linha de totais preservada', o['total'])
        # DATA / HORA no Operacional (26/08/2026). O dono pediu para os dois
        # relatórios: "o relatorio operacional tambem precisa ter essa
        # especificacao". Aqui é UMA coluna com duas linhas dentro — o dia em
        # cima, o horário que importa para aquela linha embaixo — porque a
        # folha já tem treze colunas em A4 deitado e duas novas espremeriam o
        # Status, que é o que se lê de relance na foto do grupo.
        ck('coluna Data / Hora no Operacional', 'Data / Hora' in o['colunas'],
           str(o['colunas']))
        ck('nota de rodapé enxuta', o['linhasRodape'] <= 3, f"{o['linhasRodape']} linha(s)")
        # A tabela precisa continuar coerente: cabeçalho e células no mesmo número.
        coerente = await pg.evaluate('''() => {
          const cont = document.getElementById('print-operacional');
          // Escopo na tabela de DADOS, pelo mesmo motivo da seção anterior:
          // contar th de uma tabela e td de outra acusa desalinhamento onde
          // não há.
          const dados = [...cont.querySelectorAll('table')]
                          .find(t => !t.classList.contains('doc-identificacao'));
          const nTh = dados.querySelectorAll('thead th').length;
          const tr = dados.querySelector('tbody tr');
          const nTd = tr ? tr.children.length : nTh;
          const tot = dados.querySelector('.linha-total');
          const nTot = tot ? [...tot.children].reduce((a,c)=>a+(c.colSpan||1),0) : nTh;
          return {nTh, nTd, nTot};
        }''')
        ck('cabeçalho e linhas com o mesmo número de colunas',
           coerente['nTh'] == coerente['nTd'], str(coerente))
        ck('linha de totais alinhada com as colunas',
           coerente['nTot'] == coerente['nTh'], str(coerente))

        print('\n=== OPERACIONAL: CLAREZA NA FOLHA (foto do WhatsApp) ===')
        # Espalha as cargas pelos status para o teste ver os rótulos longos.
        await pg.evaluate('''() => {
          const abertas = DB.cargas.filter(c=>c.status==='Aguardando Veículo');
          const op = 'Teste';
          if(abertas[1]) avancarStatusCarga(abertas[1].id,'Aguardando Embarque',op,'Portaria');
          if(abertas[2]){ avancarStatusCarga(abertas[2].id,'Aguardando Embarque',op,'Portaria');
                          avancarStatusCarga(abertas[2].id,'Embarque Iniciado',op,'Expedição'); }
        }''')
        await pg.evaluate("()=>exportarPdfOperacional()")
        await pg.wait_for_timeout(300)
        await pg.emulate_media(media='print')
        await pg.wait_for_timeout(400)
        cl = await pg.evaluate('''() => {
          // Uma Range sobre o texto devolve UMA caixa por linha visual —
          // a altura da célula não serve, porque é a da linha inteira.
          const linhasDe = (el) => {
            const r = document.createRange(); r.selectNodeContents(el);
            return r.getClientRects().length;
          };
          const c = document.getElementById('print-operacional');
          const tab = c.querySelector('table');
          const st = [...c.querySelectorAll('tbody .c-status')];
          const carga = c.querySelector('tbody .c-carga');
          const placa = c.querySelector('tbody .c-placa');
          const cs = carga ? getComputedStyle(carga) : {};
          const ps = placa ? getComputedStyle(placa) : {};
          return {
            fonte: parseFloat(getComputedStyle(tab).fontSize),
            statusMaxLinhas: st.length ? Math.max(...st.map(linhasDe)) : 0,
            statusLargura: st[0] ? Math.round(st[0].getBoundingClientRect().width) : 0,
            statusTextos: st.map(x=>x.innerText.replace(/\s+/g,' ')),
            cargaPeso: cs.fontWeight, cargaCaixa: cs.textTransform, cargaTexto: carga ? carga.innerText : '',
            placaPeso: ps.fontWeight, placaCaixa: ps.textTransform, placaTexto: placa ? placa.innerText : '',
            cabe: tab.getBoundingClientRect().width <= tab.parentElement.getBoundingClientRect().width + 1
          };
        }''')
        # A folha virou A4 VERTICAL em 11/08/2026 (pedido do usuário): 198mm
        # úteis contra os 287mm da deitada. A fonte caiu de 9,8 para 8,4px
        # porque nessa largura o corpo anterior fazia Status e Rota
        # quebrarem em duas linhas em quase toda carga — e "sem quebra de
        # linha" foi exigência explícita. 8 é o piso: abaixo disso a
        # legibilidade em papel deixa de ser confiável.
        ck('fonte ainda legível em papel (>= 8px)', cl['fonte'] >= 8, f"{cl['fonte']}px")
        ck('todo status cabe em UMA linha', cl['statusMaxLinhas'] <= 1,
           f"máx {cl['statusMaxLinhas']} linha(s) em {cl['statusLargura']}px · {cl['statusTextos']}")
        ck('Nº da carga em negrito e maiúsculo',
           cl['cargaPeso'] in ('800','bold') and cl['cargaCaixa'] == 'uppercase',
           f"{cl['cargaPeso']} / {cl['cargaCaixa']} / {cl['cargaTexto']}")
        ck('placa em negrito e maiúscula',
           cl['placaPeso'] in ('800','bold') and cl['placaCaixa'] == 'uppercase',
           f"{cl['placaPeso']} / {cl['placaCaixa']} / {cl['placaTexto']}")
        ck('a tabela continua cabendo na folha', cl['cabe'])
        await pg.emulate_media(media='screen')

        print('\n=== PAINEL DE STATUS NA HORIZONTAL ===')
        await pg.evaluate("()=>exportarPdfExecutivo()")
        await pg.wait_for_timeout(400)
        ph = await pg.evaluate('''() => {
          const t = document.querySelector('#print-executivo .painel-status');
          if(!t) return {achou:false};
          const th = [...t.querySelectorAll('thead th')].map(x=>x.innerText.trim());
          const td = [...t.querySelectorAll('tbody .ps-num')].map(x=>x.innerText.trim());
          return {
            achou:true, th, td,
            colunas: th.length, celulas: td.length,
            temSeguiuViagem: th.some(x=>/SEGUIU/i.test(x)),
            temTotal: th.some(x=>/TOTAL/i.test(x)),
            cabe: t.getBoundingClientRect().width <= t.parentElement.getBoundingClientRect().width + 1
          };
        }''')
        ck('painel horizontal substituiu a tabela vertical', ph.get('achou'))
        if ph.get('achou'):
            ck('um número por coluna', ph['colunas'] == ph['celulas'],
               f"{ph['colunas']} colunas, {ph['celulas']} números")
            ck('"Seguiu Viagem" fora (nunca está em aberto)', not ph['temSeguiuViagem'],
               str(ph['th']))
            ck('coluna de Total presente', ph['temTotal'])
            ck('não estoura a largura da página', ph['cabe'])
            # A soma das colunas tem que bater com o total: painel bonito
            # com número errado é pior que tabela feia.
            nums = [int(x) for x in ph['td'] if x.isdigit()]
            ck('a soma das colunas bate com o total',
               len(nums) >= 2 and sum(nums[:-1]) == nums[-1],
               f"{nums[:-1]} soma {sum(nums[:-1])}, total {nums[-1] if nums else '?'}")

        print('\n=== CONCLUÍDAS: SEM STATUS ZERADO ===')
        z = await pg.evaluate("""() => {
          const secs = [...document.querySelectorAll('#print-executivo .print-secao-tit')];
          const alvo = secs.find(s => /Cargas concluídas/.test(s.innerText));
          if(!alvo) return {achou:false};
          let el = alvo.parentElement.nextElementSibling;
          while(el && el.tagName !== 'TABLE') el = el.nextElementSibling;
          if(!el) return {achou:true, tabela:false};
          const linhas = [...el.querySelectorAll('tbody tr')];
          return {achou:true, tabela:true, n: linhas.length,
                  zerados: linhas.filter(tr => /\\b0\\b/.test(tr.children[2].innerText)).length};
        }""")
        ck('bloco de concluídas existe', z.get('achou'))
        if z.get('tabela'):
            ck('nenhum status zerado listado', z['zerados'] == 0,
               f"{z['n']} linha(s), {z['zerados']} zerada(s)")

        print('\n=== EXECUTIVO: MENOS INFORMAÇÃO NA SEÇÃO 4 (pedido do usuário, 08/08) ===')
        # "tem muita informação ali" — a timeline carga-a-carga das CONCLUÍDAS
        # (a mesma matriz pesada de 8 colunas usada pras cargas em ABERTO,
        # onde ela decide algo) saiu do executivo. Fica só o resumo
        # (blocoDistribuicaoStatus). A das ABERTAS continua — é a seção que
        # decide a manhã do gestor.
        await pg.evaluate("() => abrirTab('relatorios')")
        await pg.fill('#rel-data-de', '2000-01-01')
        await pg.fill('#rel-data-ate', '2035-12-31')
        await pg.evaluate("()=>exportarPdfExecutivo()")
        await pg.wait_for_timeout(400)
        secoes4 = await pg.evaluate("""() => {
          const titulos = [...document.querySelectorAll('#print-executivo .print-secao-tit')]
            .map(t => t.innerText.trim());
          return {
            titulos,
            temTimelineAbertas: titulos.includes('Linha do tempo — cargas ainda em aberto'),
            temTimelineConcluidas: titulos.includes('Linha do tempo — cargas concluídas'),
            temResumoConcluidas: titulos.includes('Cargas concluídas'),
          };
        }""")
        ck('timeline carga-a-carga das ABERTAS continua (decide o dia)',
           secoes4['temTimelineAbertas'])
        ck('resumo de status das CONCLUÍDAS continua (é a "conferência")',
           secoes4['temResumoConcluidas'])
        ck('timeline carga-a-carga das CONCLUÍDAS saiu (duplicava a das abertas)',
           not secoes4['temTimelineConcluidas'], str(secoes4['titulos']))

        print('\n=== FILTRO VALE PARA O EXECUTIVO ===')
        await pg.evaluate("() => abrirTab('relatorios')")
        await pg.fill('#rel-data-de', '2020-01-01')
        await pg.fill('#rel-data-ate', '2020-01-02')
        await pg.evaluate("()=>exportarPdfExecutivo()")
        await pg.wait_for_timeout(400)
        vazio = await pg.evaluate("() => document.getElementById('print-executivo').innerText")
        ck('período sem cargas produz relatório vazio, não o de sempre',
           'Programadas de 01/01/2020' in vazio, 'o cabeçalho mostra o período')

        print('\n  erros:', erros or 'nenhum')
        if erros: falhas.append('console')
        await b.close()
    print('\n  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0
sys.exit(asyncio.run(main()))
