#!/usr/bin/env python3
"""O Relatório Operacional sai na sequência de carregamento, como a planilha.

PEDIDO DO GESTOR (15/08/2026), com a planilha dele na mão: "o relatório
operacional precisa seguir a sequência de carga colocada no painel".

O QUE MUDOU
A folha era ordenada pela ETAPA do processo — todos os "Aguardando
Embarque" juntos, depois os "Faturado" — e a sequência só desempatava
dentro de cada etapa. Serve para acompanhar andamento, mas não para MONTAR
a fila: a carga 3 podia aparecer dez linhas abaixo da 30 só porque avançou
de status antes, e a folha deixava de bater com a planilha que a operação
já usava.

Agora a ordem é a sequência, do 1 em diante — a mesma da tela e a mesma da
planilha. O status continua na folha, com a cor; o que mudou foi só a ordem
das linhas.

Os dados deste teste são os primeiros da planilha real que o gestor mandou
(sequência 1 a 8 com os números de carga dele), de propósito: se a ordem
quebrar, a falha aparece com os números que ele reconhece.

    python3 testes/test_relatorio_na_sequencia.py
"""
import asyncio
import re
import sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'

# Trecho da planilha do gestor: (sequência, número da carga).
PLANILHA = [
    (1, '118186'), (2, '118192'), (3, '118159'), (4, '118160'),
    (5, '118187'), (6, '118189'), (7, '118191'), (8, '118190'),
]
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
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

        print('\n=== CARGAS CRIADAS FORA DE ORDEM, EM ETAPAS DIFERENTES ===')
        # Criadas embaralhadas e com status variados de propósito: é a
        # situação real do pátio, e é o que fazia a ordem antiga divergir.
        await pg.evaluate("""(planilha) => {
            const embaralhada = planilha.slice().reverse();
            embaralhada.forEach(([seq, num], i) => {
                const c = criarCargaProgramada({
                    placa: DB.frota[40 + i].placa, numeroCarga: num,
                    peso: 9000 + i*100, rota: '500', sequencia: seq,
                    operador: 'Alysson',
                });
                // Avança algumas de etapa, para a ordem por status divergir
                // da ordem por sequência.
                if(seq % 3 === 0){
                    avancarStatusCarga(c.id, 'Aguardando Embarque', 'Ana', 'Portaria');
                    avancarStatusCarga(c.id, 'Embarque Iniciado', 'Ana', 'Expedição');
                }
            });
            SuincoStore.save();
        }""", PLANILHA)
        await pg.wait_for_timeout(500)

        print('\n=== O RELATÓRIO SAI NA ORDEM DA PLANILHA ===')
        await pg.evaluate("() => abrirTab('relatorios')")
        await pg.wait_for_timeout(400)
        await pg.evaluate("""() => {
            document.getElementById('rel-data-de').value = '';
            document.getElementById('rel-data-ate').value = '';
            SuincoSharePoint.estaConfigurado = () => true;
            SuincoSharePoint.gerarRelatorioPdf = async () => new Blob(['x']);
            HTMLAnchorElement.prototype.click = function(){};
            exportarPdfOperacional();
        }""")
        await pg.wait_for_timeout(700)

        linhas = await pg.evaluate("""() => {
            const el = document.getElementById('print-operacional');
            return [...el.querySelectorAll('tbody tr')].map(tr => {
                const td = tr.querySelectorAll('td');
                return {seq: (td[0]||{}).textContent?.trim(),
                        num: (td[1]||{}).textContent?.trim()};
            });
        }""")

        # Só as cargas da planilha (o painel pode ter outras do seed).
        nums = {n for _, n in PLANILHA}
        so_planilha = [l for l in linhas if l['num'] in nums]

        ck('todas as 8 cargas da planilha estão na folha',
           len(so_planilha) == len(PLANILHA), f'{len(so_planilha)} de {len(PLANILHA)}')

        esperada = [n for _, n in PLANILHA]
        obtida = [l['num'] for l in so_planilha]
        ck('a ordem é a da sequência (1,2,3…), não a do status',
           obtida == esperada, f'saiu {obtida}')

        seqs = [l['seq'] for l in so_planilha]
        ck('a coluna Seq. sai em ordem crescente',
           seqs == [str(s) for s, _ in PLANILHA], f'saiu {seqs}')

        print('\n=== CARGA SEM SEQUÊNCIA VAI PARA O FIM ===')
        # Não pode empurrar a numeração de quem já está na fila.
        await pg.evaluate("""() => {
            criarCargaProgramada({placa: DB.frota[60].placa, numeroCarga:'SEM-SEQ',
                peso:5000, rota:'500', operador:'Alysson'});
            SuincoStore.save();
            exportarPdfOperacional();
        }""")
        await pg.wait_for_timeout(700)
        depois = await pg.evaluate("""() => {
            const el = document.getElementById('print-operacional');
            return [...el.querySelectorAll('tbody tr')].map(
                tr => (tr.querySelectorAll('td')[1]||{}).textContent?.trim());
        }""")
        pos_sem = depois.index('SEM-SEQ') if 'SEM-SEQ' in depois else -1
        pos_ultima = max(depois.index(n) for n in esperada if n in depois)
        ck('carga sem sequência fica depois das que têm',
           pos_sem > pos_ultima, f'sem-seq na {pos_sem}, última da planilha na {pos_ultima}')

        print('\n=== O RODAPÉ EXPLICA A ORDEM CERTA ===')
        # Se a nota continuar dizendo "ordenadas pela etapa", ela mente.
        texto = await pg.evaluate(
            "() => document.getElementById('print-operacional').innerText")
        ck('a nota fala em sequência de carregamento',
           'SEQU' in texto.upper() and 'CARREGAMENTO' in texto.upper())
        ck('a nota não diz mais que ordena por etapa',
           'ordenadas pela etapa' not in texto)

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
