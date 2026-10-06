#!/usr/bin/env python3
"""Administração de Fretes: a sequência é POR DIA, e o relatório mostra as duas datas (05/10/2026).

O RELATO, do dono, com o filtro de período na aba Relatórios:

    "as cargas estão sendo duplicadas: em vez de aparecerem na sequência 1,
     2, 3, 4, 5, …, elas aparecem como 1, 1, 1, 2, 2, etc. O processo
     deveria gerar, no dia 1, a sequência 1 a 30; no dia 2, a sequência
     1 a 10."

A CAUSA. `dadosPlanilhaDeFretes()` ordenava só por sequência. Mas a sequência
de carregamento é POR DIA (cada programação do dia recomeça no 1), então um
período de vários dias embaralhava os dias: todos os "1" juntos, depois todos
os "2". Nenhuma carga duplicou — o que parecia duplicata eram dias diferentes
sem nenhuma data na planilha para distingui-los.

O PEDIDO QUE VEIO JUNTO, e vale só para este relatório: a planilha e o PDF da
Administração de Fretes trazem a DATA DA PROGRAMAÇÃO e a DATA DO FATURAMENTO.

O QUE ESTE TESTE EXIGE (reprova contra o painel publicado):
  1. a planilha sai por dia e, dentro do dia, por sequência (1-3 e depois 1-2);
  2. carga sem sequência vai para o fim DO DIA, não para o fim do relatório;
  2b. cada dia começa com um CABEÇALHO ("Dia 28/09/2026 — segunda-feira · 4
      cargas"), na planilha e no PDF, seguido da lista dele; um dia só não leva
      cabeçalho (sai como sempre saiu);
  3. o dia é o do FUSO de quem olha: programada às 22h30 de 28/09 (já 29/09 em
     UTC) fica no dia 28 — a mesma lição da ocorrência #100;
  4. a planilha tem as colunas "Data da Programação" e "Data do Faturamento";
  5. o PDF tem "Programação" e "Faturamento" (e continua com "Saída");
  6. a data do faturamento é a do carimbo "Faturado", e vazia para quem não
     foi faturado — nunca a data de outro evento.

    python3 testes/test_fretes_ordem_por_dia_e_datas.py
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


# (dia, hora, minuto, sequência, número da carga). Criadas EMBARALHADAS.
CARGAS = [
    (29, 9, 0, 2, 'B2'), (28, 22, 30, 3, 'A3'), (29, 9, 5, 1, 'B1'),
    (28, 8, 0, 1, 'A1'), (28, 8, 5, 2, 'A2'), (28, 9, 0, None, 'A-SEM-SEQ'),
]


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page(viewport={'width': 1400, 'height': 1000})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Alysson')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text("Entrar sem servidor")')
        await pg.wait_for_timeout(500)

        print('\n=== DOIS DIAS, CADA UM COM A SUA SEQUÊNCIA ===')
        await pg.evaluate("""(cargas) => {
            cargas.forEach(([dia, h, m, seq, num], i) => {
                const c = criarCargaProgramada({freteObservacao:'TABELA', 
                    placa: DB.frota[40 + i].placa, numeroCarga: num, peso: 9000 + i * 100,
                    rota: '500', sequencia: seq === null ? undefined : seq, operador: 'Alysson',
                });
                // Hora LOCAL do pátio: 22h30 de 28/09 já é 29/09 em UTC.
                c.programadoEm = new Date(2026, 8, dia, h, m).toISOString();
                if(num === 'A1'){   // só a A1 é faturada
                    avancarStatusCarga(c.id, 'Aguardando Embarque', 'Ana', 'Portaria');
                    avancarStatusCarga(c.id, 'Embarque Iniciado', 'Ana', 'Expedição');
                    avancarStatusCarga(c.id, 'Embarque Finalizado', 'Ana', 'Expedição');
                    avancarStatusCarga(c.id, 'Faturado', 'Ana', 'Faturamento');
                }
            });
            SuincoStore.save();
        }""", CARGAS)
        await pg.wait_for_timeout(400)

        await pg.evaluate("() => abrirTab('relatorios')")
        await pg.wait_for_timeout(300)
        await pg.evaluate("""() => {
            document.getElementById('rel-data-de').value = '2026-09-28';
            document.getElementById('rel-data-ate').value = '2026-09-29';
            window.__csv = null;
            window.baixarCsvDoDia = (nome, cab, linhas, texto) => { window.__csv = { nome, cab, linhas }; };
            exportarPlanilhaFretes();
        }""")
        await pg.wait_for_timeout(600)
        csv = await pg.evaluate("() => window.__csv")
        ck('a planilha foi gerada', bool(csv), 'baixarCsvDoDia não foi chamado' if not csv else '')
        if not csv:
            await nav.close()
            sys.exit(1)

        cab, linhas = csv['cab'], csv['linhas']
        i_seq, i_num = cab.index('Sequência'), cab.index('Nº da Carga')
        mine = {n for *_, n in CARGAS}
        # Linha de CABEÇALHO DE DIA = só a primeira célula preenchida.
        so_nossas = [l for l in linhas if len(l) > i_num and l[i_num] in mine]
        ck('as 6 cargas do teste estão na planilha', len(so_nossas) == 6, f'{len(so_nossas)} de 6')

        print('\n=== UM CABEÇALHO NO INÍCIO DE CADA DIA ===')
        faixa = [('DIA', l[0]) if len(l) == 1 else ('CARGA', l[i_num]) for l in linhas]
        faixa = [f for f in faixa if f[0] == 'DIA' or f[1] in mine]
        ck('cabeçalho do dia 28, as 4 cargas dele, cabeçalho do dia 29, as 2 dele',
           faixa == [('DIA', 'Dia 28/09/2026 — segunda-feira · 4 cargas'), ('CARGA', 'A1'), ('CARGA', 'A2'),
                     ('CARGA', 'A3'), ('CARGA', 'A-SEM-SEQ'),
                     ('DIA', 'Dia 29/09/2026 — terça-feira · 2 cargas'), ('CARGA', 'B1'), ('CARGA', 'B2')],
           f'saiu {faixa}')

        print('\n=== A ORDEM: DIA, E DENTRO DO DIA A SEQUÊNCIA ===')
        obtida = [l[i_num] for l in so_nossas]
        esperada = ['A1', 'A2', 'A3', 'A-SEM-SEQ', 'B1', 'B2']
        ck('dia 28 (1, 2, 3 e a sem sequência no fim DO DIA), depois dia 29 (1, 2)',
           obtida == esperada, f'saiu {obtida}')
        seqs = [str(l[i_seq]) for l in so_nossas]
        ck('a coluna Sequência NÃO sai 1,1,2,2,3 (dias embaralhados)',
           seqs == ['1', '2', '3', '', '1', '2'], f'saiu {seqs}')

        print('\n=== AS DUAS DATAS NA PLANILHA ===')
        ck('tem "Data da Programação"', 'Data da Programação' in cab, str(cab))
        ck('tem "Data do Faturamento"', 'Data do Faturamento' in cab)
        if 'Data da Programação' in cab and 'Data do Faturamento' in cab:
            ip, ifat = cab.index('Data da Programação'), cab.index('Data do Faturamento')
            ck('as duas datas ficam lado a lado', ifat == ip + 1, f'programação na {ip}, faturamento na {ifat}')
            dia = {l[i_num]: l[ip] for l in so_nossas}
            ck('dia da programação certo, no fuso do pátio (22h30 do dia 28 continua dia 28)',
               dia == {'A1': '28/09/2026', 'A2': '28/09/2026', 'A3': '28/09/2026', 'A-SEM-SEQ': '28/09/2026',
                       'B1': '29/09/2026', 'B2': '29/09/2026'}, str(dia))
            fat = {l[i_num]: l[ifat] for l in so_nossas}
            hoje = await pg.evaluate("() => dataCurtaLocal(primeiroTimestamp(DB.cargas.find(c=>c.numeroCarga==='A1').id,'Faturado'))")
            ck('faturamento: só a carga faturada tem data, e é a do carimbo "Faturado"',
               fat['A1'] == hoje and all(fat[n] == '' for n in ['A2', 'A3', 'A-SEM-SEQ', 'B1', 'B2']), str(fat))

        print('\n=== AS DUAS DATAS NO PDF ===')
        await pg.evaluate("""() => {
            window.__pdf = null;
            window.exportarViaServidor = async (el) => { window.__pdf = el.innerHTML; };
            exportarPdfFretes();
        }""")
        await pg.wait_for_timeout(600)
        pdf = await pg.evaluate("""() => {
            if(!window.__pdf) return null;
            const d = document.createElement('div'); d.innerHTML = window.__pdf;
            const cab = [...d.querySelectorAll('.tab-fretes thead th')].map(t => t.textContent.trim());
            const todas = [...d.querySelectorAll('.tab-fretes tbody tr')];
            const linhas = todas.filter(tr => !tr.classList.contains('linha-dia')).map(tr =>
                [...tr.querySelectorAll('td')].map(t => t.textContent.trim()));
            const dias = todas.filter(tr => tr.classList.contains('linha-dia')).map(tr => tr.textContent.trim());
            const ordem = todas.map(tr => tr.classList.contains('linha-dia') ? 'DIA' : tr.querySelector('td.col-carga').textContent.trim());
            return { cab, linhas, dias, ordem };
        }""")
        ck('o PDF foi gerado', bool(pdf))
        if pdf:
            pc = pdf['cab']
            ck('PDF tem "Programação"', 'Programação' in pc, str(pc))
            ck('PDF tem "Faturamento"', 'Faturamento' in pc)
            ck('PDF continua com "Saída", Nº Carga, Placa, Rota e Observações',
               all(c in pc for c in ['Saída', 'Nº Carga', 'Placa', 'Rota', 'Observações']))
            ck('PDF: um cabeçalho por dia, no início do dia',
               pdf['dias'] == ['Dia 28/09/2026 — segunda-feira · 4 cargas', 'Dia 29/09/2026 — terça-feira · 2 cargas'],
               str(pdf['dias']))
            mias = [o for o in pdf['ordem'] if o == 'DIA' or o in mine]
            ck('PDF: dia 28 (4 cargas) e depois dia 29 (2 cargas), cada um sob o seu cabeçalho',
               sorted(mias[1:5]) == ['A-SEM-SEQ', 'A1', 'A2', 'A3'] and mias[0] == 'DIA' and mias[5] == 'DIA'
               and sorted(mias[6:]) == ['B1', 'B2'], str(mias))
            if 'Programação' in pc and 'Faturamento' in pc:
                ip, ifa, inum = pc.index('Programação'), pc.index('Faturamento'), pc.index('Nº Carga')
                por = {l[inum]: l for l in pdf['linhas'] if len(l) > inum}
                ck('PDF: programação de A3 (22h30) é 28/09/2026', por.get('A3', [''] * 9)[ip] == '28/09/2026',
                   str(por.get('A3')))
                ck('PDF: faturamento da A1 é o da carimbo; as outras ficam em branco/traço',
                   por['A1'][ifa] == hoje and por['B1'][ifa] in ('', '—'), f"A1={por['A1'][ifa]} B1={por['B1'][ifa]}")

        print('\n=== UM DIA SÓ NÃO LEVA CABEÇALHO ===')
        await pg.evaluate("""() => {
            document.getElementById('rel-data-de').value = '2026-09-29';
            document.getElementById('rel-data-ate').value = '2026-09-29';
            window.__csv = null; window.__pdf = null;
            exportarPlanilhaFretes(); exportarPdfFretes();
        }""")
        await pg.wait_for_timeout(600)
        um = await pg.evaluate("""() => ({ csv: window.__csv, pdf: window.__pdf })""")
        ck('planilha de um dia: só as linhas de carga (B1, B2), sem cabeçalho de dia',
           um['csv'] and [l[1] for l in um['csv']['linhas']] == ['B1', 'B2'], str(um['csv'] and um['csv']['linhas'][:3]))
        ck('PDF de um dia: nenhuma faixa de dia', um['pdf'] is not None and 'linha-dia' not in um['pdf'])

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n' + ('FALHAS: ' + '; '.join(falhas) if falhas else 'TUDO OK'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
