"""Cenário de demonstração para os guias — cargas e devoluções em cada
estado do fluxo, para que cada setor apareça no print com trabalho na
PRÓPRIA fila.

Não é banco de produção: roda contra o backend local descartável. Tudo é
criado pelo próprio painel (as mesmas funções que o operador usa), então o
que o guia mostra é o sistema de verdade, não uma maquete.
"""

PLACAS_DEMO = ['RRP5F95', 'QMV8B12', 'PWA4C30']

CARGAS = [
    # (placa, numero, cliente, destino, rota, peso, status desejado)
    ('RRP5F95', '2484', 'SUPERMERCADO CENTRO OESTE', 'BELO HORIZONTE - MG', '500', 12500, 'Aguardando Veículo'),
    ('QMV8B12', '2485', 'REDE AREAL', 'PATOS DE MINAS - MG', '501', 9800, 'Aguardando Embarque'),
    ('PWA4C30', '2486', 'DISTRIBUIDORA JAPÃO', 'UBERLÂNDIA - MG', '502', 14200, 'Faturado'),
]

def checklist_demo(dia, regiao='BELO HORIZONTE', rotas=('500',), operador='98942'):
    """Um checklist realista: duas parciais da MESMA nota (o caso da
    linguiça de pernil) + uma linha comum."""
    return {
        'dataDev': dia,
        'regiao': regiao,
        'rotas': list(rotas),
        'operadorCodigo': operador,
        'notaTransferencia': '171218',
        'itens': [
            {'nota': '678283', 'parcial': True, 'parcialDesc': '118274', 'supervisor': 'FABIO',
             'vendedor': 'R&B', 'codCliente': 'AREAL', 'cx': 1, 'peso': 8.5,
             'codProduto': '10719', 'produtoNome': 'LINGUICA DE PERNIL C/ PIMENTA',
             'numDev': '52140', 'dataItem': dia, 'motivo': 'TEMPERATURA'},
            {'nota': '678283', 'parcial': True, 'parcialDesc': '383303', 'supervisor': 'FABIO',
             'vendedor': 'R&B', 'codCliente': 'AREAL', 'cx': 1, 'peso': 8.5,
             'codProduto': '10719', 'produtoNome': 'LINGUICA DE PERNIL C/ PIMENTA',
             'numDev': '52111', 'dataItem': dia, 'motivo': 'AVARIA'},
            {'nota': '672123', 'parcial': False, 'supervisor': 'EDSON VERONESE',
             'vendedor': 'ANL', 'codCliente': 'CENTRO OESTE', 'cx': 4, 'peso': 30,
             'codProduto': '01189', 'produtoNome': 'COSTELINHA SUINA',
             'numDev': '52098', 'dataItem': dia, 'motivo': 'DATA PROXIMA'},
        ],
    }
