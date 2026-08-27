#!/usr/bin/env python3
"""Ficha de Priorização do Comitê de Devoluções — HTML -> PDF A4.

PARA QUE SERVE
--------------
A ata do comitê virou 17 pontos. Esta ficha existe para UMA coisa: o
Alysson recebe, lê e MARCA a importância de cada um. Por isso cada ponto
tem campo de prioridade e campo de observação — um documento que só
informa não serviria.

Impresso ou na tela, o resultado é o mesmo: A4, tinta escura sobre papel
claro, sem fundo navy (fundo escuro em A4 gasta tinta e some no
grampeador).

USO
---
    python3 gerar_ficha.py
"""
import asyncio
import base64
import pathlib

from playwright.async_api import async_playwright

AQUI = pathlib.Path(__file__).resolve().parent
RAIZ = AQUI.parent
FONTES = RAIZ / 'tutoriais' / 'assets_guia' / 'fontes.css'
LOGO = RAIZ / 'assets' / 'logo_suinco.png'
HTML = AQUI / 'Ficha_Priorizacao_Devolucoes.html'
PDF = AQUI / 'Ficha_Priorizacao_Devolucoes.pdf'
CHROMIUM = '/opt/pw-browsers/chromium'

FACES = FONTES.read_text(encoding='utf-8') if FONTES.exists() else ''
LOGO64 = base64.b64encode(LOGO.read_bytes()).decode() if LOGO.exists() else ''

# ---------------------------------------------------------------------
# OS 17 PONTOS. A citação é o texto ORIGINAL da ata, sem correção — é o
# que permite ao Alysson conferir que nada foi distorcido na tradução.
# ---------------------------------------------------------------------
PONTOS = [
    ('A', 'Faço agora — não depende de ninguém',
     'Ajustes fechados. Cada um sai em um dia, com prova. O Alysson decide a ORDEM.', [
        ('Destaque nas rotas que precisam de termógrafo',
         'é preciso adicionar um destaque para nas rotas que precisam de termógrafo',
         'Sinal visual na rota, na Programação e na Torre, para ninguém despachar sem o aparelho.',
         'O termógrafo é atributo fixo da ROTA ou depende do produto/cliente da carga?'),
        ('Destino na visão da Expedição',
         'na visão da expedição precisa aparecer o destino também na tela e na visão',
         'A Expedição vê placa e carga, mas não vê para onde aquilo vai. O destino entra na tela e no cartão.',
         ''),
        ('Filtro por data nos Indicadores',
         'colocar filtro por data nos indicadores',
         'O mesmo filtro de período que já existe nos Relatórios, aplicado aos gráficos.',
         ''),
        ('Soma por produto no total do relatório de devoluções',
         'na linha total do relatório de devoluções fazer a soma da quantidade de cada produto seguindo o formato dos outros relatórios SUM',
         'A linha de total passa a somar a quantidade de cada produto, no formato dos outros relatórios.',
         ''),
        ('Data e motivo desconfigurados nas devoluções',
         'corrigir formato e tamanho da parte das devoluções, data motivo esta desconfigurado ainda e confuso',
         'Formato e tamanho dos campos que hoje quebram a leitura da lista.',
         ''),
        ('A janela com barra de rolagem',
         'uma janela com barra de rolagem ta atrapalhando tambem a visualizacao de tudo que precisa ser visto',
         'Rolagem dentro de rolagem esconde conteúdo. Sai a janela interna; o conteúdo cabe na página.',
         ''),
     ]),
    ('B', 'Mudam o fluxo — desenhar antes de codar',
     'Cada um muda o que uma pessoa faz no dia dela. Fazer direto é como nasce retrabalho.', [
        ('Pesagem final depois de descarregar',
         'adicionar pesagem final a parte da devolucao apos descarregar',
         'Etapa nova de peso, registrada depois da descarga — a que fecha a conta do que voltou.',
         'Quem pesa e em qual balança? Peso da devolução inteira ou por produto? Se der diferença, o sistema avisa, trava ou só registra?'),
        ('Expedição recebe a devolução em um clique',
         'RESOLVER EXPEDICAO DEVOLUCOES SO UM CLIQUE, RECEBEU SIM? COM AS OPCOES PRE CADASTRADAS PARA MELHOR FLUXO',
         'A Expedição responde "recebeu?" e escolhe entre opções já cadastradas, em vez de digitar.',
         ''),
        ('Destinação igual à da Central de Notas',
         'TROCAR E DEIXAR IGUAL DA CENTRAL DE NOTAS DAR OK NA DESTINACAO',
         'A destinação passa a funcionar como a Central de Notas: dar OK, e pronto. Um jeito só.',
         ''),
        ('Reentrega ganha etapa própria',
         'acontece as vezes chega devolucao descarregam a devolucao e a reentrega fica, e depois é registrada como sobra',
         'Enquanto a reentrega não tiver etapa, dono e prazo na tela, vai continuar caindo na sobra.',
         ''),
     ]),
    ('C', 'Travados em conversa — não em código',
     'A própria ata reconhece: sem estas conversas, qualquer implementação é chute.', [
        ('O fluxo completo: devolução, reentrega e sobra — com a BRUNA',
         'entender melhor com a Bruna como funciona esse fluxo por completo pra poder implementar',
         'É a conversa que destrava os pontos 7 e 10. Sem ela, a tela sai errada.',
         ''),
        ('A planilha modelo da Expedição — com a THAÍS',
         'receber a planilha modelo da Thais da expedicao, nao faz relatorio fisico, processo de falta produto nao foi bipado quer dizer que o produto nao veio, e ai feita a destinacao',
         'A Expedição não faz relatório em papel; falta de bipagem É a falta do produto; a destinação vem depois.',
         'A planilha vira importação no painel, ou vira só o desenho da tela?'),
     ]),
    ('D', 'Monitoramento de Devoluções — módulo novo',
     'O maior item da ata, e o mais valioso. Não é ajuste: é uma aba que não existe.', [
        ('O representante é avisado automaticamente',
         'o maior problema hoje na devolucao e os representantes nao conseguem a informacao de que a devolucao esta acontecendo, entao é percebido pelo comercial que so pelo grupo no whatsapp nao resolve',
         'O painel avisa o representante na hora, com o motivo e o que fazer. O aviso no celular passou a funcionar em 27/08 — a peça técnica já existe.',
         ''),
        ('Refatura: para quem foi e se mudou o preço',
         'teria que permitir enxergar se virou refatura e pra quem que foi, se gerou alteracao de preco ou nao',
         'Cada devolução mostra o desfecho: virou refatura, para qual cliente, com ou sem alteração de preço.',
         ''),
        ('Percentual de devolução por representante',
         'computar na hora o tanto de vendas, porcentagem de devolucao e poder gerar indicadores e tomada de decisao, analisar com alysson e bruna',
         'Vendas e devoluções do mesmo representante, lado a lado. É o número que vira decisão.',
         'De onde vem o total de vendas por representante? O painel hoje não tem faturamento por representante.'),
     ]),
    ('E', 'Relatório novo — independente de tudo',
     'Não depende de nenhum ponto acima. Pode andar em paralelo.', [
        ('Tempos desde a entrada na Suinco',
         'fazer um relatorio dos tempos desde a entrada na suinco',
         'Quanto tempo cada caminhão levou em cada etapa. O painel já grava os carimbos; falta reuni-los.',
         'Vale para carga normal, devolução, ou as duas? O relógio para na saída ou na destinação?'),
     ]),
    ('F', 'Decisão de futuro — fora do escopo agora',
     'Registrado porque muda o desenho do que for construído antes.', [
        ('Autorização de devolução sai do Comercial e vai para o SAC',
         'se a gente consegue com o passo de abrir uma ocorrencia com autorizacao do sac por fora de qualidade, vai passar o comercial e autorizacoes de devolucao para o sac',
         'Confirmado pelo Luis como decisão de FUTURO. Até lá, quem autoriza continua sendo o Comercial. O ponto 13 não pode amarrar a autorização de um jeito difícil de mover depois.',
         ''),
     ]),
]


def esc(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;'))


def campo_prioridade(n):
    return f"""
      <div class="prio">
        <span class="prio-rot">Prioridade</span>
        <label class="cx"><span class="q"></span>Alta</label>
        <label class="cx"><span class="q"></span>Média</label>
        <label class="cx"><span class="q"></span>Baixa</label>
        <span class="ordem"><span class="ordem-rot">Ordem</span><span class="ordem-cx"></span></span>
      </div>"""


def bloco_html(letra, titulo, sub, itens, inicio):
    linhas = []
    for i, (tit, cit, oq, duv) in enumerate(itens):
        n = inicio + i
        duvida = (f'<p class="duv"><b>A confirmar:</b> {esc(duv)}</p>' if duv else '')
        linhas.append(f"""
      <article class="pt">
        <div class="pt-cab"><span class="pt-n">{n:02d}</span>
          <h3>{esc(tit)}</h3></div>
        <blockquote>"{esc(cit)}"</blockquote>
        <p class="oq">{esc(oq)}</p>
        {duvida}
        {campo_prioridade(n)}
        <div class="obs"><span>Observação do Alysson</span><i></i></div>
      </article>""")
    return f"""
    <section class="bloco">
      <div class="bl-cab"><span class="bl-l">{letra}</span>
        <div><h2>{esc(titulo)}</h2><p>{esc(sub)}</p></div></div>
      {''.join(linhas)}
    </section>"""


def montar():
    blocos, n = [], 1
    for letra, titulo, sub, itens in PONTOS:
        blocos.append(bloco_html(letra, titulo, sub, itens, n))
        n += len(itens)
    logo = (f'<img class="logo" src="data:image/png;base64,{LOGO64}" alt="Suinco">'
            if LOGO64 else '')
    return f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Ficha de Priorização — Comitê de Devoluções</title>
<style>
@page {{ size: A4; margin: 14mm 15mm 16mm; }}
* {{ box-sizing: border-box; }}
{FACES}
:root {{
  --navy:#1e2a52; --navy-esc:#101625; --ouro:#b9903f; --ouro-claro:#e9b954;
  --tinta:#161a22; --dim:#5a6474; --linha:#d5dae4; --papel:#ffffff;
  --grade:#f4f6fa;
}}
body {{ margin:0; background:var(--papel); color:var(--tinta);
  font-family:'Roboto',system-ui,Arial,sans-serif; font-size:9.6pt; line-height:1.5; }}
h1,h2,h3 {{ font-family:'Poppins',system-ui,sans-serif; margin:0; }}

/* ---------- capa ---------- */
.capa {{ height:265mm; display:flex; flex-direction:column; justify-content:space-between;
  page-break-after:always; }}
.capa-topo {{ display:flex; align-items:flex-start; justify-content:space-between; gap:10mm; }}
.logo {{ width:26mm; }}
.selo {{ font-family:'Poppins',sans-serif; font-size:8pt; font-weight:600; letter-spacing:.16em;
  text-transform:uppercase; color:var(--ouro); text-align:right; }}
.capa h1 {{ font-size:30pt; font-weight:800; line-height:1.08; margin:0 0 4mm;
  color:var(--navy); max-width:150mm; }}
.capa .lead {{ font-size:11pt; color:var(--dim); max-width:140mm; }}
.capa .mesa {{ font-size:9pt; color:var(--tinta); margin-top:3mm; }}
.capa .mesa b {{ color:var(--navy); }}

.instr {{ border:.35mm solid var(--navy); border-radius:2mm; padding:6mm 7mm; background:var(--grade); }}
.instr h2 {{ font-size:12pt; font-weight:700; color:var(--navy); margin-bottom:2.5mm; }}
.instr p {{ margin:0 0 2.5mm; font-size:9.4pt; }}
.instr ol {{ margin:0; padding-left:5mm; font-size:9.4pt; }}
.instr li {{ margin-bottom:1.5mm; }}

.placar {{ display:grid; grid-template-columns:repeat(3,1fr); gap:4mm; }}
.pc {{ border:.3mm solid var(--linha); border-top:1.2mm solid var(--ouro); border-radius:1.5mm;
  padding:4mm; }}
.pc b {{ display:block; font-family:'Poppins',sans-serif; font-size:20pt; font-weight:800;
  color:var(--navy); line-height:1; }}
.pc span {{ font-size:8.4pt; color:var(--dim); }}

.regras {{ display:grid; grid-template-columns:1fr 1fr; gap:5mm; }}
.rg {{ border-left:1mm solid var(--ouro); padding-left:4mm; }}
.rg h3 {{ font-size:10.5pt; font-weight:700; color:var(--navy); }}
.rg p {{ margin:1mm 0 0; font-size:9pt; color:var(--dim); }}

.rodape-capa {{ font-size:8pt; color:var(--dim); border-top:.3mm solid var(--linha);
  padding-top:3mm; }}

/* ---------- blocos ---------- */
.bloco {{ margin-bottom:7mm; }}
.bl-cab {{ display:flex; gap:4mm; align-items:flex-start; border-bottom:.5mm solid var(--navy);
  padding-bottom:2.5mm; margin-bottom:4mm; page-break-after:avoid; }}
.bl-l {{ font-family:'Poppins',sans-serif; font-size:15pt; font-weight:800; color:var(--ouro);
  line-height:1; flex:none; }}
.bl-cab h2 {{ font-size:13pt; font-weight:700; color:var(--navy); }}
.bl-cab p {{ margin:.8mm 0 0; font-size:8.8pt; color:var(--dim); }}

.pt {{ border:.3mm solid var(--linha); border-radius:2mm; padding:4mm 5mm; margin-bottom:3.5mm;
  page-break-inside:avoid; }}
.pt-cab {{ display:flex; gap:3mm; align-items:baseline; }}
.pt-n {{ font-family:'Poppins',sans-serif; font-weight:800; font-size:10pt; color:var(--ouro);
  flex:none; }}
.pt h3 {{ font-size:11pt; font-weight:600; color:var(--navy); }}
blockquote {{ margin:2mm 0 2mm; padding-left:3.5mm; border-left:.6mm solid var(--linha);
  font-size:8.6pt; font-style:italic; color:var(--dim); }}
.oq {{ margin:0; font-size:9.4pt; }}
.duv {{ margin:2mm 0 0; font-size:8.8pt; color:var(--tinta); background:var(--grade);
  border:.25mm dashed var(--ouro); border-radius:1.5mm; padding:2.5mm 3mm; }}
.duv b {{ color:var(--ouro); }}

/* ---------- campos que o Alysson preenche ---------- */
.prio {{ display:flex; align-items:center; gap:4mm; flex-wrap:wrap; margin-top:3.5mm;
  padding-top:3mm; border-top:.25mm dashed var(--linha); }}
.prio-rot {{ font-family:'Poppins',sans-serif; font-size:7.6pt; font-weight:600;
  letter-spacing:.1em; text-transform:uppercase; color:var(--dim); }}
.cx {{ display:inline-flex; align-items:center; gap:1.6mm; font-size:9pt; }}
.q {{ width:4mm; height:4mm; border:.4mm solid var(--navy); border-radius:.8mm; display:inline-block; }}
.ordem {{ margin-left:auto; display:inline-flex; align-items:center; gap:2mm; }}
.ordem-rot {{ font-family:'Poppins',sans-serif; font-size:7.6pt; font-weight:600;
  letter-spacing:.1em; text-transform:uppercase; color:var(--dim); }}
.ordem-cx {{ width:9mm; height:6mm; border:.4mm solid var(--navy); border-radius:.8mm;
  display:inline-block; }}
.obs {{ margin-top:2.5mm; }}
.obs span {{ font-family:'Poppins',sans-serif; font-size:7.6pt; font-weight:600;
  letter-spacing:.1em; text-transform:uppercase; color:var(--dim); }}
.obs i {{ display:block; height:8mm; border-bottom:.25mm dotted var(--linha);
  border-top:.25mm dotted var(--linha); margin-top:1.2mm; }}

/* ---------- fechamento ---------- */
.fim {{ page-break-before:always; }}
.fim h2 {{ font-size:15pt; font-weight:800; color:var(--navy); margin-bottom:2mm; }}
.fim > p {{ color:var(--dim); font-size:9.4pt; margin:0 0 5mm; }}
table {{ width:100%; border-collapse:collapse; font-size:9.4pt; }}
th {{ text-align:left; font-family:'Poppins',sans-serif; font-size:8pt; font-weight:600;
  letter-spacing:.08em; text-transform:uppercase; color:var(--dim);
  border-bottom:.5mm solid var(--navy); padding:2.5mm 2mm; }}
td {{ border-bottom:.25mm solid var(--linha); padding:4.5mm 2mm; }}
td.num {{ width:14mm; font-family:'Poppins',sans-serif; font-weight:800; color:var(--ouro); }}
.assin {{ margin-top:14mm; display:grid; grid-template-columns:1fr 1fr; gap:14mm; }}
.assin div {{ border-top:.3mm solid var(--tinta); padding-top:2mm; font-size:8.6pt; color:var(--dim); }}
</style></head><body>

<section class="capa">
  <div>
    <div class="capa-topo">{logo}
      <div class="selo">Comitê de Devoluções<br>Ata de 27/08/2026</div></div>
    <div style="margin-top:14mm">
      <h1>Ficha de Priorização</h1>
      <p class="lead">Dezessete pontos saíram da reunião. Estão separados por
        quem destrava cada um — não por assunto. O que falta é a ordem em que
        eles valem mais para a operação.</p>
      <p class="mesa"><b>Na mesa:</b> Comercial · Expedição · Devoluções &nbsp;·&nbsp;
        <b>Para priorização de:</b> Alysson</p>
    </div>
  </div>

  <div class="instr">
    <h2>Como preencher</h2>
    <p>Cada ponto traz a frase original da ata, sem correção, para conferência.</p>
    <ol>
      <li>Marque <b>Alta</b>, <b>Média</b> ou <b>Baixa</b> em cada ponto.</li>
      <li>No quadro <b>Ordem</b>, numere apenas os que forem Alta — 1 é o primeiro a ser feito.</li>
      <li>Onde houver <b>A confirmar</b>, a ata não respondia. A resposta muda o que será construído.</li>
      <li>A última página tem o quadro de fechamento com os cinco primeiros.</li>
    </ol>
  </div>

  <div class="placar">
    <div class="pc"><b>6</b><span>saem sem depender de ninguém</span></div>
    <div class="pc"><b>4</b><span>mudam o fluxo de trabalho</span></div>
    <div class="pc"><b>2</b><span>travados em conversa</span></div>
    <div class="pc"><b>3</b><span>módulo novo de monitoramento</span></div>
    <div class="pc"><b>1</b><span>relatório de tempos</span></div>
    <div class="pc"><b>1</b><span>decisão de futuro</span></div>
  </div>

  <div class="regras">
    <div class="rg"><h3>Sobra é exceção</h3>
      <p>Hoje a sobra virou o destino do que ninguém resolveu. Se uma reentrega acaba
        registrada como sobra, o processo falhou antes — e é esse antes que precisa aparecer.</p></div>
    <div class="rg"><h3>Fidelidade ao momento exato</h3>
      <p>O sistema registra quando cada coisa aconteceu de verdade, não quando alguém
        teve tempo de digitar. Vale para chegada, descarga, pesagem, destinação e reentrega.</p></div>
  </div>

  <p class="rodape-capa">Suinco Cooperativa Agroindustrial · Patos de Minas — MG ·
    Programação de Embarque · Uso interno</p>
</section>

{''.join(blocos)}

<section class="fim">
  <h2>Fechamento</h2>
  <p>Os cinco primeiros, na ordem em que devem ser feitos. É por esta página que eu começo.</p>
  <table>
    <thead><tr><th>Ordem</th><th>Ponto</th><th>Por que este vem antes</th></tr></thead>
    <tbody>
      <tr><td class="num">1</td><td></td><td></td></tr>
      <tr><td class="num">2</td><td></td><td></td></tr>
      <tr><td class="num">3</td><td></td><td></td></tr>
      <tr><td class="num">4</td><td></td><td></td></tr>
      <tr><td class="num">5</td><td></td><td></td></tr>
    </tbody>
  </table>
  <div class="assin">
    <div>Alysson — prioridade definida em ___/___/______</div>
    <div>Luis — recebido em ___/___/______</div>
  </div>
</section>

</body></html>"""


async def principal():
    HTML.write_text(montar(), encoding='utf-8')
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path=CHROMIUM, headless=True)
        pag = await nav.new_page()
        erros = []
        pag.on('pageerror', lambda e: erros.append(str(e)))
        await pag.goto(HTML.as_uri())
        await pag.wait_for_timeout(1200)
        await pag.pdf(path=str(PDF), format='A4', print_background=True)
        await nav.close()
    print(f'{PDF.name}: {PDF.stat().st_size/1024:.0f} KB')
    if erros:
        print('ERROS:', erros)


asyncio.run(principal())
