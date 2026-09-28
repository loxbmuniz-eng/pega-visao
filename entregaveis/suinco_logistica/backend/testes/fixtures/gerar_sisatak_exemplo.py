#!/usr/bin/env python3
"""Gera as planilhas de EXEMPLO do relatório WRMVE790 do Sisatak (28/09/2026).

Tudo aqui é INVENTADO e marcado como tal: nenhum cliente, nota, supervisor ou
representante real. O arquivo que o dono mandou tem nome de cliente e de
representante e NÃO entra no repositório (LGPD) — estas planilhas imitam o
FORMATO dele, que é o que o leitor precisa provar.

Duas planilhas, os dois formatos que existem na operação:
  sisatak_limpo_exemplo.xls     — as 7 colunas que o operador vai trazer
  sisatak_completo_exemplo.xls  — o relatório completo, com o tipo de devolução

As duas carregam o que já quebrou ou quase quebrou um leitor de .xls:
acento (Ã, Ç), travessão fora do Latin-1 (–, grava em UTF-16), linhas "Não
Possui", o rodapé de filtros, e texto bastante para a tabela de strings
atravessar um registro CONTINUE.

    pip install xlwt && python3 testes/fixtures/gerar_sisatak_exemplo.py
"""
import os
import xlwt

AQUI = os.path.dirname(os.path.abspath(__file__))
LIMPO = ['Documento_NF', 'Cliente', 'Supervisor', 'Representante', 'Documento_DEN-DEV',
         'Produto', 'Motivo_Devolucao']
COMPLETO = ['TMV_NF', 'Documento_NF', 'Data_NF', 'Cliente', 'Supervisor', 'Representante',
            'Valor_Total_NF', 'Valor_Liquido_NF', 'TMV_DEN-DEV', 'Documento_DEN-DEV',
            'Data_DEN-DEV', 'Produto', 'Valor_Total_DEN-DEV', 'Valor_Liquido_DEN-DEV',
            'Tipo_Devolucao', 'Motivo_Devolucao', 'Tipo_Desconto']

# (nf, cliente, doc, produto, motivo, tipo, valorNf, valorDev)
LINHAS = [
    ('103-003-900101-NE', '900001-CLIENTE TESTE AÇOUGUE UM', '103-001-990001-DEV',
     '900501-PRODUTO TESTE PERNIL', '05 - TRANSPORTE/FALTA DE MERCADORIA', '01 - DEVOLUÇÃO FÍSICA', 500.0, 500.0),
    ('103-003-900102-NE', '900002-CLIENTE TESTE MERCADO DOIS', '103-001-990002-DEV',
     '900502-PRODUTO TESTE LOMBO', '06 - COMERCIAL/ERRO DE PEDIDO', '01 - DEVOLUÇÃO FÍSICA', 800.0, 200.0),
    ('103-003-900103-NE', '900003-CLIENTE TESTE TRÊS', '103-001-880003-DEN',
     '900503-PRODUTO TESTE BACON', '08 - QUALIDADE/QUEBRA DE PESO', '03 - DEVOLUÇÃO QUEBRA DE PESO', 300.0, 3.1),
    ('103-003-900104-NE', '900004-CLIENTE TESTE QUATRO', '103-001-880004-DEN',
     '900504-PRODUTO TESTE COSTELA', '06 - COMERCIAL/ERRO DE PEDIDO', '02 - DEVOLUÇÃO REFATURAMENTO', 900.0, 900.0),
]


def gravar(nome, cab, linha_para_celulas):
    wb = xlwt.Workbook(encoding='utf-8')
    sh = wb.add_sheet('Sheet1')
    for c, v in enumerate(cab):
        sh.write(0, c, v)
    r = 1
    for l in LINHAS:
        for c, v in enumerate(linha_para_celulas(l)):
            sh.write(r, c, v)
        r += 1
    # Duas linhas sem documento de devolução (DDO) — ficam fora.
    for k in range(2):
        cel = linha_para_celulas(('103-003-90020%d-NE' % k, '90010%d-CLIENTE TESTE SEM DEV' % k,
                                  'Não Possui', 'Não Possui', 'Não Informado', 'Não Informado', 0.0, 0.0))
        for c, v in enumerate(cel):
            sh.write(r, c, v)
        r += 1
    # Texto longo e único bastante para a tabela de strings passar de 8 KB e
    # atravessar CONTINUE — fica numa coluna que o leitor não usa.
    for k in range(260):
        sh.write(r + 3 + k, len(cab) + 2, 'LINHA DE ENCHIMENTO TESTE Nº %04d – ÇÃO' % k)
    sh.write(r + 1, 0, 'Filial:')
    sh.write(r + 1, 1, 'Num. Docto. (DEN/DEV):')
    sh.write(r + 1, 4, 'Cod. Representante:')
    sh.write(r + 2, 0, 'Página -1 de 1')
    wb.save(os.path.join(AQUI, nome))


gravar('sisatak_limpo_exemplo.xls', LIMPO,
       lambda l: [l[0], l[1], '900900-SUPERVISOR TESTE', '900800-REPRESENTANTE TESTE (REGIÃO)',
                  l[2], l[3], l[4]])
gravar('sisatak_completo_exemplo.xls', COMPLETO,
       lambda l: ['520', l[0], '20/09/2026', l[1], '900900-SUPERVISOR TESTE',
                  '900800-REPRESENTANTE TESTE (REGIÃO)', l[6], l[6], '5005', l[2], '28/09/2026',
                  l[3], l[7], l[7], l[5], l[4], '03 – NÃO DESCONTAR'])
print('ok')
