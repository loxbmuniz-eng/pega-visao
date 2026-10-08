#!/usr/bin/env python3
"""Gera os PDFs de EXEMPLO da conferência de frete (05/10/2026).

PARA QUE SERVEM. A aba Pagamento de Frete lê dois PDFs por carga: o
"RELATÓRIO DE STATUS DAS ENTREGAS" do DeliveryB2B e o "WRVDA501 - Relatório
de Notas por Carga" do Atak. Os arquivos REAIS não entram no repositório
(têm nome de cliente e CNPJ). Estes imitam o desenho dos dois — o mesmo
cabeçalho, as mesmas colunas, nome de cliente quebrando em várias linhas,
tabela passando de uma página para outra — com dados INVENTADOS:
cargas 9008xx, clientes "TESTE", CNPJ de mentira.

O QUE CADA CARGA TESTA (a bateria confere estes números):
  900801  6 notas, todas Finalizadas ........................ LIBERADA
  900802  8 notas: 4 finalizadas, 1 aguardando, 1 não entregue,
          2 de outros status (Cancelado, A caminho) .......... PENDENTE
  900803  as duas contagens iguais (5 e 5), mas uma nota some do
          B2B e outra sobra nele ............................. VERIFICAR
  900805  40 notas, a tabela passa para a 2ª página .......... PENDENTE
  900806  3 notas, nenhuma finalizada ......................... VERIFICAR
  900807 + 900808  duas cargas no MESMO PDF, em cada relatório

WRVDA503 (08/10/2026) — "Relatório de Carga Por UF/Município", que a
Logística usa nas cargas de DF, Bahia e Espírito Santo. As MESMAS notas,
agrupadas por UF e município, com subtotal e "Total Geral", sem a chave de
acesso. Só os 503 (os demais PDFs ficam como estão):

    python3 backend/testes/fixtures/gerar_pagamento_frete_exemplo.py --503

Roda com o Chromium que já existe aqui. Os PDFs gerados FICAM no
repositório (a bateria não regenera):

    python3 backend/testes/fixtures/gerar_pagamento_frete_exemplo.py
"""
import html
import os
import sys
from playwright.sync_api import sync_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(AQUI, 'frete')
os.makedirs(SAIDA, exist_ok=True)

CLIENTES = [
    ('SUPERMERCADO TESTE ALFA LTDA', 'Rio de Janeiro', 'RJ'),
    ('MERCEARIA TESTE BETA LTDA EPP', 'Rio de Janeiro', 'RJ'),
    ('ATACADISTA TESTE GAMA SA', 'Niterói', 'RJ'),
    ('AVIARIO TESTE DELTA DA PAVUNA LTDA ME', 'Rio de Janeiro', 'RJ'),
    ('MERCADO TESTE EPSILON JOAO XXIII LTDA ME', 'Volta Redonda', 'RJ'),
    ('SUPERMERCADOS TESTE ZETA DO CENTRO LTDA', 'Nova Iguaçu', 'RJ'),
]


def notas(base, statuses, extra_so_b2b=(), sem_no_b2b=()):
    """Monta as notas da carga: [(nota, cliente, cidade, uf, status_b2b|None)]."""
    out = []
    for i, st in enumerate(statuses):
        c = CLIENTES[i % len(CLIENTES)]
        out.append((base + i, c[0], c[1], c[2], st))
    return out


CARGAS = {
    '900801': dict(sist=notas(810001, ['Finalizado'] * 6)),
    '900802': dict(sist=notas(810101, ['Finalizado'] * 4 + ['Aguardando', 'Não entregue', 'Cancelado', 'A caminho'])),
    '900805': dict(sist=notas(810501, ['Finalizado'] * 36 + ['Aguardando'] * 3 + ['Não entregue'])),
    '900806': dict(sist=notas(810601, ['Aguardando'] * 3)),
    '900807': dict(sist=notas(810701, ['Finalizado'] * 3)),
    '900808': dict(sist=notas(810801, ['Finalizado', 'Aguardando'])),
    # #112 (05/10/2026): o B2B repete o cabeçalho a cada grupo de entregas e
    # preenche CARGA EXTERNA — tem de dar UMA carga, com o número certo.
    '900809': dict(sist=notas(810901, ['Finalizado'] * 3 + ['Aguardando']), externa='103001', blocos=[2, 1, 1]),
    # #112: o B2B escreve a carga como filial-operação-carga ("103-001-900810"),
    # como no relatório real da 118771 — o número da carga é o último trecho.
    '900810': dict(sist=notas(811001, ['Finalizado'] * 3), exibido='103-001-900810', blocos=[2, 1]),
}
# 900803: cinco no sistema; o B2B perde a 5ª e ganha uma que o sistema não tem
s903 = notas(810301, ['Finalizado'] * 5)
CARGAS['900803'] = dict(
    sist=s903,
    b2b_ajuste=lambda b2b: [r for r in b2b if r[0] != 810305] + [(810399, 'CLIENTE TESTE SOBRANDO LTDA', 'Rio de Janeiro', 'RJ', 'Finalizado')],
)


def b2b_da_carga(numero):
    c = CARGAS[numero]
    b2b = list(c['sist'])
    if 'b2b_ajuste' in c:
        b2b = c['b2b_ajuste'](b2b)
    return b2b


def esc(s):
    return html.escape(str(s))


def peso_b2b(n):
    kg = 120 + (n % 17) * 61.3
    return f'{kg/1000:.2f} t'.replace('.', ',') if kg >= 1000 else f'{kg:.2f} kg'.replace('.', ',')


def html_b2b(cargas):
    blocos = []
    for numero in cargas:
        c = CARGAS[numero]
        todas = b2b_da_carga(numero)
        partes = c.get('blocos') or [len(todas)]
        grupos, k = [], 0
        for n in partes:
            grupos.append(todas[k:k + n]); k += n
        if k < len(todas):
            grupos.append(todas[k:])
        seq0 = 0
        for grupo in grupos:
            linhas = []
            for seq, (nota, cliente, cidade, uf, st) in enumerate(grupo, seq0 + 1):
                linhas.append(linha_b2b(seq, nota, cliente, st))
            seq0 += len(grupo)
            blocos.append(bloco_b2b(c.get('exibido', numero), c.get('externa', ''), linhas))
    return pagina_b2b(blocos)


def linha_b2b(seq, nota, cliente, st):
    if True:
        if True:
            finalizado = st == 'Finalizado'
            ini = '22/09/2026<br>09:%02d:11' % (seq % 60) if finalizado else ''
            chk = '<b class="r">NAO<br>REALIZADO</b>' if finalizado else ''
            fim = ini
            km = '<b class="r">NAO<br>REGISTRADO</b>' if finalizado else ''
            tv = '00:00:00' if finalizado else ''
            return (
                f'<tr><td>{seq}</td><td>{esc(st)}</td><td>NF</td><td>{nota}-3</td>'
                f'<td class="cli">{esc(cliente)}</td><td>NAO</td><td>{ini}</td><td>{chk}</td><td>{fim}</td>'
                f'<td></td><td></td><td></td><td>{tv}</td><td>{km}</td><td>{peso_b2b(nota)}</td><td></td></tr>'
            )


def bloco_b2b(numero_exibido, externa, linhas):
    return f'''
<table class="cab"><tr><th>MOTORISTA</th><th>PLACA</th><th>CARGA</th><th>CARGA EXTERNA</th><th>EMBARQUE</th><th>INICIO VIAGEM</th><th>KM PERCORRIDOS</th><th>PESO TOTAL</th></tr>
<tr><td>-</td><td></td><td>{numero_exibido}</td><td>{externa}</td><td>19/09/2026</td><td>22/09/2026 09:43:31</td><td>Nao registrado</td><td>18,49 t</td></tr></table>
<table class="notas"><thead><tr><th>SEQ</th><th>STATUS</th><th>TIPO</th><th>NUMERO</th><th>CLIENTE</th><th>REENTREGA</th><th>INICIO</th><th>CHECK-IN</th><th>FIM</th>
<th>DIST. CHECK-<br>IN/CLIENTE</th><th>DIST.<br>FIM/CLIENTE</th><th>TEMPO<br>CHECK-IN/FIM</th><th>TEMPO<br>VIAGEM</th><th>KM<br>PERCORRIDO</th><th>PESO</th><th>OBS.</th></tr></thead>
<tbody>{''.join(linhas)}</tbody></table><div class="quebra"></div>'''


def pagina_b2b(blocos):
    return f'''<!doctype html><meta charset="utf-8"><style>
body{{font-family:'DejaVu Sans',sans-serif;font-size:8pt;margin:0}} h1{{text-align:center;font-size:11pt;margin:18px 0 4px}}
h2{{text-align:center;font-size:10pt;margin:0 0 14px}} table{{border-collapse:collapse;width:100%;table-layout:fixed}}
th,td{{border:1px solid #333;padding:2px 3px;text-align:center;vertical-align:middle;overflow:hidden}}
.cab{{margin-bottom:6px}} .r{{color:#d00}} thead{{display:table-header-group}} tr{{page-break-inside:avoid}}
.notas th:nth-child(1){{width:3.5%}} .notas th:nth-child(2){{width:7%}} .notas th:nth-child(3){{width:4%}} .notas th:nth-child(4){{width:7%}}
.notas th:nth-child(5){{width:12%}} .notas th:nth-child(6){{width:7%}} .notas th:nth-child(7){{width:7.5%}} .notas th:nth-child(8){{width:7%}} .notas th:nth-child(9){{width:7.5%}}
.notas th:nth-child(10){{width:7%}} .notas th:nth-child(11){{width:7%}} .notas th:nth-child(12){{width:7%}} .notas th:nth-child(13){{width:5.5%}} .notas th:nth-child(14){{width:7%}} .notas th:nth-child(15){{width:5.5%}} .notas th:nth-child(16){{width:4%}}
.quebra{{height:18px}}
</style><h1>RELATÓRIO DE STATUS DAS ENTREGAS</h1><h2>SUINCO COOPERATIVA DE SUINOCULTORES LTDA</h2>{''.join(blocos)}'''


def chave(nota):
    return '31' + '2610' + '11111111000191' + '55' + '003' + str(nota).zfill(9) + '6' + '00000001' + '0'


def valor_sist(n):
    v = 400 + (n % 23) * 311.17
    return f'{v:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')


def html_sist(cargas):
    blocos = []
    for numero in cargas:
        linhas = []
        for (nota, cliente, cidade, uf, st) in CARGAS[numero]['sist']:
            pl = 100 + (nota % 29) * 53.7
            pl_t = f'{pl:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
            linhas.append(
                f'<tr><td>19/09/2026</td><td>{nota}</td><td>{30000 + nota % 977} - {esc(cliente.title())}</td>'
                f'<td>11111111{(nota % 9000) + 1000}</td><td>{esc(cidade)}</td><td>{uf}</td><td>{chave(nota)}</td>'
                f'<td class="n">{valor_sist(nota)}</td><td class="n">{pl_t}</td><td class="n">{pl_t}</td></tr>'
            )
        blocos.append(f'''<div class="carga">Número Carga: {numero}</div>
<table><thead><tr><th>Data</th><th>NE</th><th>Cliente</th><th>CNPJ/CPF</th><th>Cidade</th><th>UF</th><th>Chave_de_Acesso</th><th class="n">Valor NE</th><th class="n">Peso_Liquido</th><th class="n">Peso_Bruto</th></tr></thead>
<tbody>{''.join(linhas)}</tbody></table>''')
    ult = cargas[-1]
    return f'''<!doctype html><meta charset="utf-8"><style>
body{{font-family:'DejaVu Sans Mono',monospace;font-size:6.6pt;margin:0}} .t{{text-align:center;font-size:12pt;margin:14px 0 4px}}
.d{{text-align:right;margin-bottom:8px}} .carga{{text-align:center;font-weight:bold;margin:10px 0 6px;font-size:8pt}}
table{{border-collapse:collapse;width:100%;table-layout:fixed}} th{{text-align:left;text-decoration:underline;padding:1px 2px}}
td{{padding:3px 2px;white-space:nowrap;overflow:hidden}} .n{{text-align:right}}
th:nth-child(1){{width:6.5%}} th:nth-child(2){{width:5%}} th:nth-child(3){{width:19%}} th:nth-child(4){{width:10%}} th:nth-child(5){{width:10%}}
th:nth-child(6){{width:3%}} th:nth-child(7){{width:30%}} th:nth-child(8){{width:6%}} th:nth-child(9){{width:5.5%}} th:nth-child(10){{width:5%}}
.f{{margin-top:40px;font-style:italic}} .f td{{padding:1px 2px}}
</style><div class="t">WRVDA501 - Relatório de Notas por Carga</div><div class="d">05/10/2026 &nbsp; 09:30:00</div>{''.join(blocos)}
<div class="f"><b>Filtros utilizados:</b><br>Filial: *<br>Carga Inicial: {cargas[0]}<br>Carga Final: {ult}<br>Data Inicial: 01/01/2026<br>Data Final: 05/10/2026</div>
<div class="f">TIC - SUINCO &nbsp;&nbsp;&nbsp; Página 1 de 1</div>'''


def html_sist503(cargas):
    """WRVDA503: uma linha por nota, agrupada por UF e município; números à
    direita; subtotal do município (recuado), da UF (na coluna do município)
    e Total Geral — as linhas que o leitor NÃO pode tomar por nota."""
    notas = []
    for numero in cargas:
        for (nota, cliente, cidade, uf, st) in CARGAS[numero]['sist']:
            notas.append((uf, cidade, numero, nota, cliente))
    notas.sort(key=lambda n: (n[0], n[1], n[3]))   # o Atak agrupa por UF e município

    def br(v):
        return f'{v:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    linhas, uf_atual, mun_atual = [], None, None
    cont = {'mun': [0, 0.0, 0.0], 'uf': [0, 0.0, 0.0], 'geral': [0, 0.0, 0.0]}

    def fecha(nivel, rotulo, classe):
        n, p, v = cont[nivel]
        linhas.append(f'<tr class="{classe}"><td></td><td colspan="2">{esc(rotulo)}</td><td class="n">{n}</td>'
                      f'<td class="n">{br(p)}</td><td class="n">{br(v)}</td><td colspan="4"></td></tr>')
        cont[nivel] = [0, 0.0, 0.0]
    for (uf, cidade, numero, nota, cliente) in notas:
        if (uf, cidade) != (uf_atual, mun_atual) and mun_atual is not None:
            fecha('mun', mun_atual, 'sub')
        if uf != uf_atual:
            if uf_atual is not None:
                fecha('uf', uf_atual, 'subuf')
            linhas.append(f'<tr><td colspan="10" class="g">{uf}</td></tr>')
        if (uf, cidade) != (uf_atual, mun_atual):
            linhas.append(f'<tr><td></td><td colspan="3" class="g">{esc(cidade)}</td><td class="n">Entregas</td><td colspan="5"></td></tr>')
        uf_atual, mun_atual = uf, cidade
        peso = 100 + (nota % 29) * 53.7
        valor = 400 + (nota % 23) * 311.17
        for k in cont:
            cont[k][0] += 1; cont[k][1] += peso; cont[k][2] += valor
        linhas.append(
            f'<tr><td>{uf}</td><td>{esc(cidade)}</td><td class="n">{numero}</td><td class="n">{br(peso)}</td>'
            f'<td class="n">{nota}</td><td class="n">{br(valor)}</td><td>{30000 + nota % 977} - {esc(cliente.title())}</td>'
            f'<td>SUPERVISOR TESTE</td><td>REPRESENTANTE TESTE</td><td>Centro</td></tr>')
    fecha('mun', mun_atual, 'sub')
    fecha('uf', uf_atual, 'subuf')
    fecha('geral', 'Total Geral:', 'sub')
    return f'''<!doctype html><meta charset="utf-8"><style>
body{{font-family:Arial,sans-serif;font-size:6.6pt;margin:0}} .t{{text-align:center;font-size:11pt;font-weight:bold;margin:14px 0 4px}}
.d{{text-align:right;margin-bottom:14px}} table{{border-collapse:collapse;width:100%;table-layout:fixed}}
th{{text-align:left;text-decoration:underline;font-weight:normal;padding:1px 6px}} td{{padding:2px 6px;white-space:nowrap;overflow:hidden}}
.n{{text-align:right;padding-right:14px}} .g{{font-weight:bold;padding-top:8px}} .sub td,.subuf td{{font-weight:bold;padding-top:6px}}
th:nth-child(1){{width:3%}} th:nth-child(2){{width:11%}} th:nth-child(3){{width:8%}} th:nth-child(4){{width:7%}} th:nth-child(5){{width:8%}}
th:nth-child(6){{width:7%}} th:nth-child(7){{width:22%}} th:nth-child(8){{width:12%}} th:nth-child(9){{width:12%}} th:nth-child(10){{width:10%}}
</style><div class="t">WRVDA503 - Relatório de Carga Por UF/Município</div><div class="d">08/10/2026 &nbsp; 14:48:15</div>
<table><thead><tr><th>Uf</th><th>Municipio</th><th class="n">Numero_Carga</th><th class="n">Peso_Bruto</th><th class="n">Numero_Nota</th>
<th class="n">Valor_NE</th><th>Cliente</th><th>Supervisor</th><th>Representante</th><th>Bairro</th></tr></thead>
<tbody>{''.join(linhas)}</tbody></table>'''


def html_outro():
    return '<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif"><h1>Relatório de Estoque de Embalagens</h1><p>Produto 1 ... 120 un</p><p>Produto 2 ... 80 un</p>'


def gerar(pagina, nome, conteudo, landscape=True, cabecalho=''):
    pagina.set_content(conteudo)
    pagina.pdf(
        path=os.path.join(SAIDA, nome), format='A4', landscape=landscape, print_background=True,
        margin={'top': '55px', 'bottom': '50px', 'left': '25px', 'right': '25px'},
        display_header_footer=True,
        header_template=f'<div style="font-size:7px;width:100%;text-align:right;padding-right:25px"><i>{cabecalho}</i></div>',
        footer_template='<div style="font-size:8px;width:100%;text-align:right;padding-right:25px"><span class="pageNumber"></span></div>',
    )
    print('gerado', nome)


def main():
    with sync_playwright() as p:
        nav = p.chromium.launch(executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_PATH') or '/opt/pw-browsers/chromium')
        pg = nav.new_page()
        if '--503' in sys.argv:
            # o WRVDA503: as mesmas notas do 501, no desenho por UF/município
            for numero in ['900801', '900805']:
                gerar(pg, f'sist503_{numero}.pdf', html_sist503([numero]), cabecalho='08/10/2026 14:48:15')
            gerar(pg, 'sist503_varias.pdf', html_sist503(['900807', '900808']), cabecalho='08/10/2026 14:48:15')
            nav.close()
            return
        so = set(sys.argv[1:])   # gerar só estas cargas (ex.: 900809 900810); sem argumento, tudo
        for numero in ['900801', '900802', '900803', '900805', '900806', '900809', '900810']:
            if so and numero not in so:
                continue
            gerar(pg, f'b2b_{numero}.pdf', html_b2b([numero]),
                  cabecalho='DeliveryB2B - Plataforma de controle de entregas e recebimentos - Gerado em 05/10/2026 09:30')
            # o Atak repete a data e hora de emissão no topo de cada página — o leitor não pode tomá-la por nota
            gerar(pg, f'sist_{numero}.pdf', html_sist([numero]), landscape=True, cabecalho='05/10/2026 09:30:00')
        if so:
            nav.close()
            return
        gerar(pg, 'b2b_varias.pdf', html_b2b(['900807', '900808']),
              cabecalho='DeliveryB2B - Plataforma de controle de entregas e recebimentos - Gerado em 05/10/2026 09:30')
        gerar(pg, 'sist_varias.pdf', html_sist(['900807', '900808']), cabecalho='05/10/2026 09:30:00')
        gerar(pg, 'outro_relatorio.pdf', html_outro(), landscape=False)
        nav.close()


if __name__ == '__main__':
    main()
