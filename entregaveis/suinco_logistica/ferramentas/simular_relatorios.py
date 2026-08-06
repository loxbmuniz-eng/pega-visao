#!/usr/bin/env python3
"""Gera os três relatórios com 20 cargas em status variados e fotografa a folha.

Serve para dois fins:

1. VER o documento como ele sai na impressora, antes de alguém imprimir. Os
   relatórios são fotografados e circulam em grupo — defeito de layout aqui
   custa credibilidade, e só aparece no papel.

2. MEDIR o que a foto não mostra: coluna estourando a folha, cabeçalho e
   linha com contagens diferentes, texto abaixo do legível.

Saída em ferramentas/saida_relatorios/.

    python3 ferramentas/simular_relatorios.py
"""
import asyncio
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE = Path(__file__).resolve().parent.parent
PAINEL = 'file://' + str(BASE / 'index.html')
SAIDA = Path(__file__).resolve().parent / 'saida_relatorios'

# 20 cargas espalhadas pelas seis etapas, na proporção de um dia real: muita
# coisa no começo do fluxo, pouca já encerrada.
DISTRIBUICAO = [
    ('Aguardando Veículo',   5),
    ('Aguardando Embarque',  4),
    ('Embarque Iniciado',    3),
    ('Embarque Finalizado',  3),
    ('Faturado',             2),
    ('Seguiu Viagem',        3),
]

RELATORIOS = [
    ('exportarPdfOperacional', 'print-operacional', 'Relatório Operacional', 'landscape'),
    ('exportarPdfExecutivo',   'print-executivo',   'Relatório Executivo',   'landscape'),
    # Fretes saía em A4 em pé, via @page nomeada. A página nomeada forçava
    # uma quebra antes do container e o PDF abria com uma folha em branco.
    # Os três relatórios usam a mesma folha agora.
    ('exportarPdfFretes',      'print-fretes',      'Administração de Fretes', 'landscape'),
]

problemas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'PROBLEMA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        problemas.append(f'{nome}: {detalhe}')


def conferir_folhas_do_pdf(caminho):
    """Nenhuma folha em branco no PDF.

    Existe porque o defeito aconteceu: o relatório de Fretes usava uma
    @page nomeada (A4 em pé) diferente da folha padrão, e o navegador
    quebra a página ANTES de trocar de página nomeada — o PDF abria com
    uma folha inteira em branco e o relatório começava na segunda.

    A prévia em PNG não mostra isso: a folha em branco só existe depois
    da paginação. Só o PDF denuncia, então a conferência é aqui.
    """
    try:
        import pypdf
    except ImportError:
        print('  [pular] conferência de folha em branco (pip install pypdf)')
        return
    paginas = pypdf.PdfReader(caminho).pages
    vazias = [i + 1 for i, p in enumerate(paginas)
              if len((p.extract_text() or '').strip()) < 40]
    ck('nenhuma folha em branco no PDF', not vazias,
       f"{len(paginas)} folha(s) · em branco: {vazias}")


async def main():
    SAIDA.mkdir(exist_ok=True)
    async with async_playwright() as p:
        navegador = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                            headless=True)
        # Largura de A4 deitado a 96dpi, para a prévia bater com a folha.
        ctx = await navegador.new_context(viewport={'width': 1122, 'height': 794})
        pagina = await ctx.new_page()
        erros = []
        pagina.on('pageerror', lambda e: erros.append(str(e)))
        await pagina.goto(PAINEL)
        await pagina.wait_for_timeout(1500)

        print('\n=== CRIANDO 20 CARGAS EM STATUS VARIADOS ===')
        criadas = await pagina.evaluate("""(dist) => {
            DB.operador = {nome:'Ana Souza', setor:'Logística', turno:'Manhã'};
            aplicarPermissoesSetor();
            document.getElementById('modal-operador').classList.remove('open');
            DB.cargas = []; DB.movimentacoes = [];

            const ROTAS = ['500','501','502','503','504'];
            const OBS = [
                'Frete negociado R$ 2.850,00 — pagamento 28 dias',
                '', 'Cliente exige descarga até 16h', '',
                'Reentrega — custo por conta da transportadora', '',
            ];
            const ordem = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
                           'Embarque Finalizado','Faturado','Seguiu Viagem'];
            let n = 0;

            dist.forEach(([alvo, quantas]) => {
                for (let i = 0; i < quantas; i++) {
                    const f = DB.frota[n];
                    criarCargaProgramada({
                        placa: f.placa, numeroCarga: String(10240 + n),
                        peso: 12000 + (n * 437) % 9000,
                        rota: ROTAS[n % ROTAS.length],
                        motorista: ['José da Silva','Antônio P. Ferreira','Marcos A. Lima',
                                    'Paulo Roberto S.','Carlos Eduardo M.'][n % 5],
                        praOnde: ['FROTA PROPRIA','CROSS-DOCKING','DEDICADA','RET FRIGO'][n % 4],
                        paletizada: n % 3 ? 'Sim' : 'Não',
                        qtdGanchos: n % 3 ? 0 : 28 + (n % 7),
                        qtdEntregas: 1 + (n % 3),
                        observacoes: OBS[n % OBS.length],
                        operador: 'Ana Souza'
                    });
                    const c = DB.cargas.find(x => x.numeroCarga === String(10240 + n));
                    const ate = ordem.indexOf(alvo);
                    for (let p = 1; p <= ate; p++) {
                        avancarStatusCarga(c.id, ordem[p], 'Operador ' + p,
                                           ['Logística','Portaria','Expedição','Expedição',
                                            'Faturamento','Portaria'][p]);
                    }
                    n++;
                }
            });
            SuincoStore.save();
            return { total: DB.cargas.length,
                     porStatus: DB.cargas.reduce((a,c)=>(a[c.status]=(a[c.status]||0)+1,a),{}) };
        }""", DISTRIBUICAO)
        print(f"  {criadas['total']} cargas criadas")
        for st, n in criadas['porStatus'].items():
            print(f"    {st}: {n}")

        for fn, cid, nome, orientacao in RELATORIOS:
            print(f'\n=== {nome.upper()} ===')
            # window.print é neutralizado: queremos montar o container e
            # medir, não abrir a caixa de impressão do navegador.
            await pagina.evaluate(f"() => {{ window.print = () => {{}}; {fn}(); }}")
            await pagina.wait_for_timeout(600)

            # Emula a MÍDIA DE IMPRESSÃO. Forçar display:block com o painel
            # ainda na tela mediria a prévia com cabeçalho e navegação por
            # cima — defeito da captura, não do documento.
            await pagina.emulate_media(media='print')
            await pagina.wait_for_timeout(300)

            med = await pagina.evaluate("""(cid) => {
                const c = document.getElementById(cid);
                const antes = c.style.cssText;
                const dados = [...c.querySelectorAll('table')]
                                .filter(t => !t.classList.contains('doc-identificacao'));
                const larguraPagina = (c.querySelector('.print-page')||c).clientWidth;

                const tabelas = dados.map(t => {
                    const th = t.querySelectorAll('thead th').length;
                    const tr = t.querySelector('tbody tr');
                    const td = tr ? tr.children.length : th;
                    return { th, td, larg: Math.round(t.scrollWidth),
                             estoura: t.scrollWidth > larguraPagina + 2,
                             linhas: t.querySelectorAll('tbody tr').length };
                });

                const miudo = [...c.querySelectorAll('td, th')]
                    .map(e => parseFloat(getComputedStyle(e).fontSize))
                    .filter(f => f > 0 && f < 8);

                const vazias = [...c.querySelectorAll('tbody td')]
                    .filter(td => !td.textContent.trim()).length;

                return { larguraPagina, tabelas, miudo: miudo.length,
                         menorFonte: Math.min(...[...c.querySelectorAll('td')]
                             .map(e => parseFloat(getComputedStyle(e).fontSize))
                             .filter(f => f > 0), 99),
                         vazias, restaurar: antes };
            }""", cid)

            for i, t in enumerate(med['tabelas']):
                ck(f'tabela {i+1}: cabeçalho e linha com o mesmo nº de colunas',
                   t['th'] == t['td'], f"th={t['th']} td={t['td']}")
                ck(f'tabela {i+1}: cabe na largura da folha',
                   not t['estoura'], f"tabela {t['larg']}px · folha {med['larguraPagina']}px")
            ck('nenhuma fonte abaixo de 8px', med['miudo'] == 0,
               f"{med['miudo']} célula(s) · menor fonte {med['menorFonte']}px")

            arq = SAIDA / f"{nome.replace(' ','_')}.png"
            await pagina.locator(f'#{cid}').screenshot(path=str(arq))
            print(f'  imagem: {arq.name}')

            pdf = SAIDA / f"{nome.replace(' ','_')}.pdf"
            await pagina.pdf(path=str(pdf), format='A4',
                             landscape=(orientacao == 'landscape'),
                             print_background=True,
                             margin={'top':'8mm','bottom':'8mm','left':'8mm','right':'8mm'})
            print(f'  pdf: {pdf.name}')
            conferir_folhas_do_pdf(pdf)

            await pagina.emulate_media(media='screen')
            await pagina.evaluate("(cid) => { document.getElementById(cid).style.cssText = ''; }", cid)

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))

        await navegador.close()

    print('\n=== RESULTADO ===')
    if problemas:
        print('  PROBLEMAS:')
        for p_ in problemas:
            print('   -', p_)
    else:
        print('  Nenhum problema de layout encontrado.')
    print(f'\n  Arquivos em: {SAIDA}')
    return 1 if problemas else 0


sys.exit(asyncio.run(main()))
