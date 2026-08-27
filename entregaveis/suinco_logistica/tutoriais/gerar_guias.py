#!/usr/bin/env python3
"""Gera os guias em PDF, um por setor, com prints REAIS do painel.

Cada passo do roteiro (tutoriais/roteiros.py) vira uma página: o print da
tela com a área da ação destacada e o resto escurecido, mais os quatro
blocos — O QUE, ONDE, POR QUE e QUANDO. Nada é desenhado à mão: o
navegador entra no painel com o usuário daquele setor e fotografa o que a
pessoa vai ver de verdade.

Exige o backend local no ar (porta 3010) e os operadores de demonstração
(cd backend && node scripts/preparar_demo_guias.js).

    python3 tutoriais/gerar_guias.py            # todos os setores
    python3 tutoriais/gerar_guias.py Portaria   # um setor só
"""
import asyncio
import base64
import datetime
import os
import re
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from roteiros import GUIAS, SENHA_DEMO   # noqa: E402
import dados_demo                        # noqa: E402

from playwright.async_api import async_playwright   # noqa: E402

RAIZ = pathlib.Path(__file__).resolve().parent.parent
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SAIDA = pathlib.Path(__file__).resolve().parent
CAPTURAS = SAIDA / 'capturas'
PDFS = SAIDA / 'pdf'
LOGO = RAIZ / 'assets' / 'logo_suinco.png'
HOJE = datetime.date.today().isoformat()
HOJE_BR = datetime.date.today().strftime('%d/%m/%Y')

# Identidade do painel (mesmos tokens do design system em uso).

# TIPOGRAFIA E MASCOTE — o mesmo padrão da apresentação institucional
# (27/08/2026, pedido do dono: "aplicar o mesmo padrão em todos os manuais").
#
# As fontes ficam EMBUTIDAS no arquivo, não apenas nomeadas. Antes o CSS
# pedia 'Inter' sem embutir nada: o PDF saía com a fonte que o sistema
# tivesse, e dois computadores geravam guias com letras diferentes.
_FONTES = pathlib.Path(__file__).resolve().parent / 'assets_guia' / 'fontes.css'
FACES = _FONTES.read_text(encoding='utf-8') if _FONTES.exists() else ''

# O Pipo oficial, recortado do material da marca. O espaço reservado que
# existia aqui ("o arquivo ainda não está no projeto") acabou.
_PIPO = pathlib.Path(__file__).resolve().parent / 'assets_guia' / 'pipo.png'
PIPO64 = base64.b64encode(_PIPO.read_bytes()).decode() if _PIPO.exists() else ''

# Cena da capa: o caminhão Suinco com o Pipo do lado, a mesma peça da
# apresentação institucional (pedido do dono, 27/08/2026: "pipo e caminhao
# suinco, nos guias"). O arquivo é extraído da apresentação, não redesenhado.
_CENA = pathlib.Path(__file__).resolve().parent / 'assets_guia' / 'cena_capa.svg'
CENA_CAPA = _CENA.read_text(encoding='utf-8') if _CENA.exists() else ''

# Ícones IDÊNTICOS aos do painel: o sprite é lido de index_suinco.html, a
# mesma fonte que a apresentação usa. Nada é redesenhado aqui.
def _sprite_do_painel():
    try:
        html = (RAIZ / 'index_suinco.html').read_text(encoding='utf-8')
    except OSError:
        return ''
    simbolos = re.findall(r'<symbol id="i-[^"]+".*?</symbol>', html, re.S)
    return '\n'.join(simbolos)

SPRITE = _sprite_do_painel()

# Cada setor com o ícone que ele já vê na barra lateral do painel.
ICONE_DO_SETOR = {
    'Portaria': 'i-portaria', 'Faturamento': 'i-faturamento',
    'Expedição': 'i-expedicao', 'Controles Internos': 'i-devolucoes',
    'Central de Notas': 'i-relatorios', 'Logística': 'i-programacao',
    'Administração': 'i-usuarios', 'Comercial': 'i-lupa',
}

NAVY = '#0B1B2B'
NAVY_2 = '#12293F'
OURO = '#E8B34B'
CREME = '#F6F1E7'
TINTA = '#16202B'

JS_DESTACAR = r"""
(args) => {
  const {sel, rotulo} = args;
  document.querySelectorAll('.__guia-hl,.__guia-badge').forEach((e) => e.remove());
  if (!sel) return false;
  let el = null;
  for (const s of sel.split(',')) { el = document.querySelector(s.trim()); if (el) break; }
  if (!el) return false;
  el.scrollIntoView({block: 'center'});
  const r = el.getBoundingClientRect();
  const box = document.createElement('div');
  box.className = '__guia-hl';
  Object.assign(box.style, {
    position: 'fixed', left: (r.left - 8) + 'px', top: (r.top - 8) + 'px',
    width: (r.width + 16) + 'px', height: (r.height + 16) + 'px',
    border: '3px solid #E8B34B', borderRadius: '12px',
    boxShadow: '0 0 0 9999px rgba(3,8,15,.62)', zIndex: '2147483000',
    pointerEvents: 'none',
  });
  document.body.appendChild(box);
  if (rotulo) {
    const b = document.createElement('div');
    b.className = '__guia-badge';
    b.textContent = rotulo;
    const acima = r.top > 46;
    Object.assign(b.style, {
      /* Alinhado à DIREITA da área destacada: os rótulos dos cartões do
         painel ficam à esquerda, e o selo em cima deles escondia
         justamente o nome do bloco que o guia manda procurar. */
      position: 'fixed', left: Math.min(window.innerWidth - 120, r.right - 92) + 'px',
      top: (acima ? r.top - 40 : r.bottom + 12) + 'px',
      background: '#E8B34B', color: '#0B1B2B',
      font: '700 14px/1.2 system-ui, sans-serif', padding: '8px 12px',
      borderRadius: '8px', zIndex: '2147483001', pointerEvents: 'none',
      boxShadow: '0 6px 18px rgba(0,0,0,.45)',
    });
    document.body.appendChild(b);
  }
  return true;
}
"""


JS_RECORTE = r"""
(args) => {
  const {sel, largura, altura} = args;
  const vw = window.innerWidth, vh = window.innerHeight;
  let el = null;
  for (const s of (sel || '').split(',')) { el = document.querySelector(s.trim()); if (el) break; }
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const w = Math.min(Math.max(largura, r.width + 160), vw);
  const h = Math.min(Math.max(altura, r.height + 160), vh);
  let x = Math.round(Math.min(Math.max(0, cx - w / 2), vw - w));
  let y = Math.round(Math.min(Math.max(0, cy - h / 2), vh - h));
  return {x, y, width: Math.round(w), height: Math.round(h)};
}
"""


def slug(texto):
    import unicodedata
    base = unicodedata.normalize('NFKD', str(texto))
    base = ''.join(c for c in base if not unicodedata.combining(c))
    return ''.join(c if c.isalnum() else '_' for c in base.lower())


def esc(t):
    return (str(t or '').replace('&', '&amp;').replace('<', '&lt;')
            .replace('>', '&gt;').replace('"', '&quot;'))


async def abrir_painel(nav, rotulo):
    ctx = await nav.new_context(viewport={'width': 1440, 'height': 900},
                                device_scale_factor=2, accept_downloads=True)
    pg = await ctx.new_page()
    html = (RAIZ / 'index.html').read_text(encoding='utf-8')
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__guia_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url)
    # A tela de entrada é o sinal de que o painel subiu. Aparelho lento (ou
    # é o sinal de que o painel subiu; esperar por ela evita fotografar
    # uma tela pela metade quando a base de frota demora a carregar.
    try:
        await pg.wait_for_selector('#login-email', timeout=25000)
    except Exception:
        await pg.reload()
        await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.wait_for_timeout(800)
    return ctx, pg


async def entrar(pg, email):
    if await pg.evaluate("() => !!(DB && DB.operador)"):
        return
    await pg.wait_for_selector('#login-email', timeout=25000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA_DEMO)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(2600)


# ------------------------------------------------------------------ cenário

async def preparar_cenario(pg):
    """Cria, pelo próprio painel, uma devolução em CADA estado do fluxo —
    para todo setor encontrar trabalho na própria fila no momento do print.
    Devolve {chave: id}."""
    return await pg.evaluate(
        """async (dados) => {
             const criados = {};
             const fazer = async (chave, ateStatus) => {
               const d = await SuincoSharePoint.devolucoes.criar(dados.checklist);
               const passos = [
                 ['Recebida na Portaria', {chegouLacrado: true, lacre1: '133476',
                   placa: 'RRP5F95', motorista: 'GILMAR SOUZA', cargaNumero: '2484'}],
                 ['Conferida no Faturamento', {pesoFinal: 47}],
                 ['Descarga Conferida', {}],
                 ['Destinada', {obsControles: 'Romaneio conferido', gerouRdc: true}],
               ];
               for (const [para, extra] of passos) {
                 if (ateStatus === null) break;
                 await SuincoSharePoint.devolucoes.etapa(d.id, {para, ...extra});
                 if (para === ateStatus) break;
               }
               criados[chave] = d.id;
             };
             await fazer('devolucao_lancada', null);
             await fazer('devolucao_recebida', 'Recebida na Portaria');
             await fazer('devolucao_faturada', 'Conferida no Faturamento');
             await fazer('devolucao_conferida', 'Descarga Conferida');
             await fazer('devolucao_destinada', 'Destinada');
             return criados;
           }""",
        {'checklist': dados_demo.checklist_demo(HOJE)})


async def limpar_cenario(pg, ids):
    await pg.evaluate(
        """async (ids) => { for (const id of Object.values(ids)) {
             try { await SuincoSharePoint.devolucoes.excluir(id); } catch (e) {} } }""",
        ids)


# ------------------------------------------------------------------ capturas

async def capturar(pg, passo, destino, numero):
    """Abre a aba, executa as ações do passo, destaca o alvo e fotografa."""
    if passo.get('tab'):
        await pg.evaluate("(t) => abrirTab(t)", passo['tab'])
        await pg.wait_for_timeout(900)
    if passo.get('cenario') and passo.get('_devId'):
        await pg.evaluate(
            """async (id) => { _devExpandida = id;
                 if (typeof carregarDevolucoes === 'function') await carregarDevolucoes();
                 else renderDevolucoes(); }""", passo['_devId'])
        await pg.wait_for_timeout(1200)
    # Notificações flutuantes poluem o print e não fazem parte do passo.
    await pg.evaluate(
        "() => { document.querySelectorAll('.notif-item, #notificacoes > *')"
        ".forEach((e) => e.remove()); }")
    for acao in passo.get('antes', []):
        tipo, sel, valor = acao
        try:
            if tipo == 'fill':
                await pg.fill(sel, valor, timeout=4000)
            elif tipo == 'click':
                await pg.click(sel, timeout=4000)
        except Exception as e:
            print(f'      · ação {tipo} {sel} não aplicada ({type(e).__name__})')
    await pg.wait_for_timeout(400)
    achou = await pg.evaluate(JS_DESTACAR,
                              {'sel': passo.get('destaque'), 'rotulo': f'PASSO {numero}'})
    await pg.wait_for_timeout(250)
    # Recorte com contexto: a tela inteira em A4 deixa o texto do painel
    # pequeno demais para quem está aprendendo. Enquadra-se o alvo com
    # folga, mantendo o suficiente da tela em volta para a pessoa se achar.
    clip = await pg.evaluate(JS_RECORTE, {'sel': passo.get('destaque'),
                                          'largura': 1180, 'altura': 660})
    if clip:
        await pg.screenshot(path=str(destino), clip=clip)
    else:
        await pg.screenshot(path=str(destino))
    await pg.evaluate("() => document.querySelectorAll('.__guia-hl,.__guia-badge')"
                      ".forEach((e) => e.remove())")
    return achou


# ------------------------------------------------------------------ documento

def bloco(rotulo, texto):
    return f"""
      <div class="q">
        <div class="q-rot">{rotulo}</div>
        <div class="q-txt">{esc(texto)}</div>
      </div>"""


def pagina_passo(n, total, passo, img_rel, setor):
    atencao = (f'<div class="atencao"><span>ATENÇÃO</span>{esc(passo["atencao"])}</div>'
               if passo.get('atencao') else '')
    return f"""
    <section class="pagina passo">
      <header class="topo">
        <div class="topo-setor">{esc(setor)}</div>
        <div class="topo-doc">Guia do Painel · Suinco</div>
      </header>
      <div class="passo-cab">
        <div class="passo-num">{n:02d}</div>
        <div>
          <h2>{esc(passo['titulo'])}</h2>
          <div class="passo-de">Passo {n} de {total}</div>
        </div>
      </div>
      <figure class="print">
        <img src="{img_rel}" alt="Tela do passo {n}">
        <figcaption>A área destacada em dourado é onde você age neste passo.</figcaption>
      </figure>
      <div class="quadro">
        {bloco('O QUE FAZER', passo['oque'])}
        {bloco('ONDE FICA', passo['onde'])}
        {bloco('POR QUE EXISTE', passo['porque'])}
        {bloco('QUANDO FAZER', passo['quando'])}
      </div>
      {atencao}
      <footer class="rodape"><span>Uso interno · Suinco Cooperativa Agroindustrial</span>
        <span>{HOJE_BR}</span></footer>
    </section>"""


def documento(setor, guia, imagens):
    logo64 = base64.b64encode(LOGO.read_bytes()).decode() if LOGO.exists() else ''
    total = len(guia['passos'])
    resumo = ''.join(f'<li>{esc(x)}</li>' for x in guia['resumo'])
    indice = ''.join(
        f'<li><span class="i-num">{i:02d}</span><span>{esc(p["titulo"])}</span></li>'
        for i, p in enumerate(guia['passos'], 1))
    paginas = ''.join(
        pagina_passo(i, total, p, img, setor)
        for i, (p, img) in enumerate(zip(guia['passos'], imagens), 1))

    # Ícone do painel para este setor (o mesmo da barra lateral). Sem
    # correspondência, o guia sai sem ícone em vez de sair com um errado.
    ico = ICONE_DO_SETOR.get(setor)
    icone_svg = (f'<svg class="ico-setor" aria-hidden="true"><use href="#{ico}"/></svg>'
                 if ico and SPRITE else '')
    # A cena inteira (caminhão + Pipo) quando os dois materiais existem;
    # só o Pipo se a cena faltar; nada se nem o Pipo houver.
    if CENA_CAPA and PIPO64 and logo64:
        cena = (CENA_CAPA
                .replace('__PIPO__', f'data:image/png;base64,{PIPO64}')
                .replace('__LOGO__', f'data:image/png;base64,{logo64}'))
        pipo_img = f'<div class="capa-cena">{cena}</div>'
    elif PIPO64:
        pipo_img = (f'<img class="capa-pipo" src="data:image/png;base64,{PIPO64}"'
                    ' alt="Pipo, o mascote da Suinco">')
    else:
        pipo_img = ''

    return f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Guia do Painel — {esc(setor)}</title>
<style>
  @page {{ size: A4; margin: 0; }}
  * {{ box-sizing: border-box; }}
  {FACES}
  body {{ margin: 0; background: #fff; color: {TINTA};
    font-family: 'Roboto', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif;
    line-height: 1.55; }}
  h1, h2, .passo-num, .q-rot, .i-num, .capa .setor, .capa .capa-frase, .topo {{
    font-family: 'Poppins', system-ui, Arial, sans-serif; }}
  h1, .passo-num, .i-num {{ font-weight: 800; }}
  h2, .capa .setor {{ font-weight: 600; }}
  .ico-setor {{ width: 1.5em; height: 1.5em; vertical-align: -.35em;
    margin-right: .4em; color: {OURO}; }}
  .pagina {{ width: 210mm; min-height: 297mm; padding: 14mm 15mm 12mm;
    page-break-after: always; position: relative; display: flex; flex-direction: column; }}
  .pagina:last-child {{ page-break-after: auto; }}

  /* ---------- capa ---------- */
  /* Capa no mesmo tratamento dos slides: cetim navy com textura fina,
     brilho dourado e moldura dupla. Mesma peça, dois formatos. */
  .capa {{ background:
      repeating-linear-gradient(45deg, rgba(255,255,255,.016) 0 1px, transparent 1px 8px),
      radial-gradient(120mm 90mm at 80% 8%, rgba(233,185,84,.10), transparent 60%),
      linear-gradient(160deg, {NAVY} 0%, {NAVY_2} 62%, #0A1622 100%);
    color: {CREME}; justify-content: space-between; padding: 20mm 18mm;
    position: relative; }}
  .capa::after {{ content: ''; position: absolute; inset: 8mm; pointer-events: none;
    border: .4mm solid rgba(233,185,84,.35); }}
  .capa > * {{ position: relative; z-index: 1; }}
  .capa-cena {{ margin: 0 0 6mm; }}
  .capa-cena svg {{ width: 100%; max-width: 152mm; height: auto; display: block;
    filter: drop-shadow(0 5mm 10mm rgba(0,0,0,.42)); }}
  .capa-pipo {{ width: 52mm; display: block; margin: 0 0 6mm auto;
    filter: drop-shadow(0 6mm 12mm rgba(0,0,0,.45)); }}
  .capa-logo {{ width: 44mm; background: #fff; padding: 4mm; border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,.35); }}
  .capa-tarja {{ height: 4px; width: 40mm; background: {OURO}; margin: 10mm 0 6mm; }}
  .capa h1 {{ font-size: 34pt; line-height: 1.08; margin: 0 0 4mm; letter-spacing: -.5pt; }}
  .capa .setor {{ font-size: 15pt; color: {OURO}; font-weight: 700; letter-spacing: .8pt;
    text-transform: uppercase; }}
  .capa .capa-frase {{ font-size: 10.5pt; color: #E8B34B; font-weight: 700;
    letter-spacing: .06em; text-transform: uppercase; margin: 2mm 0 4mm; }}
  .capa .missao {{ font-size: 12.5pt; line-height: 1.5; max-width: 130mm; opacity: .93; }}
  .capa .meta {{ font-size: 9.5pt; opacity: .78; border-top: 1px solid rgba(246,241,231,.22);
    padding-top: 5mm; display: flex; justify-content: space-between; }}
  .mascote {{ border: 1px dashed rgba(232,179,75,.5); border-radius: 10px; padding: 5mm;
    font-size: 8.5pt; color: {OURO}; max-width: 78mm; line-height: 1.45; }}

  /* ---------- página de abertura ---------- */
  .abertura h2 {{ font-size: 20pt; margin: 0 0 5mm; color: {NAVY}; }}
  .abertura ul.resumo {{ margin: 0 0 9mm; padding: 0; list-style: none; }}
  .abertura ul.resumo li {{ font-size: 12pt; line-height: 1.55; padding: 3.5mm 0 3.5mm 9mm;
    border-bottom: 1px solid #E7E2D8; position: relative; }}
  .abertura ul.resumo li::before {{ content: '▍'; position: absolute; left: 0; color: {OURO}; }}
  .indice {{ list-style: none; margin: 0; padding: 0; }}
  .indice li {{ display: flex; gap: 5mm; align-items: baseline; font-size: 11.5pt;
    padding: 2.6mm 0; border-bottom: 1px dotted #D8D2C6; }}
  .i-num {{ color: {OURO}; font-weight: 800; font-variant-numeric: tabular-nums; }}

  /* ---------- passos ---------- */
  .topo {{ display: flex; justify-content: space-between; font-size: 8.5pt;
    letter-spacing: .6pt; text-transform: uppercase; color: #746C5F;
    border-bottom: 2px solid {OURO}; padding-bottom: 2.5mm; margin-bottom: 6mm; }}
  .topo-setor {{ color: {NAVY}; font-weight: 800; }}
  .passo-cab {{ display: flex; gap: 5mm; align-items: center; margin-bottom: 5mm; }}
  .passo-num {{ background: {NAVY}; color: {OURO}; font-size: 17pt; font-weight: 800;
    width: 15mm; height: 15mm; border-radius: 10px; display: flex; align-items: center;
    justify-content: center; }}
  .passo-cab h2 {{ margin: 0; font-size: 17pt; color: {NAVY}; line-height: 1.2; }}
  .passo-de {{ font-size: 9pt; color: #746C5F; margin-top: 1mm; }}
  figure.print {{ margin: 0 0 6mm; }}
  figure.print img {{ width: 100%; border: 1px solid #C9C2B4; border-radius: 8px; display: block; }}
  figure.print figcaption {{ font-size: 8.5pt; color: #746C5F; margin-top: 2mm; }}
  .quadro {{ display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }}
  .q {{ background: #FAF7F1; border-left: 3px solid {OURO}; border-radius: 6px; padding: 4mm 4.5mm; }}
  .q-rot {{ font-size: 8pt; font-weight: 800; letter-spacing: .9pt; color: {NAVY}; margin-bottom: 1.5mm; }}
  .q-txt {{ font-size: 10.5pt; line-height: 1.45; }}
  .atencao {{ margin-top: 5mm; background: #FFF6E2; border: 1px solid {OURO}; border-radius: 6px;
    padding: 4mm 4.5mm; font-size: 10.5pt; line-height: 1.45; }}
  .atencao span {{ display: block; font-size: 8pt; font-weight: 800; letter-spacing: .9pt;
    color: #8A5A00; margin-bottom: 1.5mm; }}
  .rodape {{ margin-top: auto; padding-top: 5mm; border-top: 1px solid #E7E2D8;
    display: flex; justify-content: space-between; font-size: 8pt; color: #726C60; }}
</style></head><body>
<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">{SPRITE}</svg>

  <section class="pagina capa">
    <div>
      {'<img class="capa-logo" src="data:image/png;base64,' + logo64 + '" alt="Suinco">' if logo64 else ''}
      <div class="capa-tarja"></div>
      <div class="setor">{icone_svg}{esc(setor)}</div>
      <!-- "Devoluções" saiu do título — pedido do dono na véspera da
           apresentação (26/08/2026): "tire do título principal a palavra
           DEVOLUÇÕES... aqui indicamos a posição de embarque dos carros".
           A devolução continua DENTRO dos guias de quem participa dela;
           o que muda é a identidade: o painel se apresenta pelo que é
           para todos — o embarque. -->
      <h1>Guia do Painel<br>de Embarque</h1>
      <p class="capa-frase">Aqui indicamos a posição de embarque dos carros.</p>
      <p class="missao">{esc(guia['missao'])}</p>
    </div>
    <div>
      {pipo_img}
      <div class="meta" style="margin-top:8mm">
        <span>Suinco Cooperativa Agroindustrial · Patos de Minas — MG</span>
        <span>Emitido em {HOJE_BR} · Uso interno</span>
      </div>
    </div>
  </section>

  <section class="pagina abertura">
    <header class="topo"><div class="topo-setor">{esc(setor)}</div>
      <div class="topo-doc">Guia do Painel · Suinco</div></header>
    <h2>O seu papel em três frases</h2>
    <ul class="resumo">{resumo}</ul>
    <h2>O que você vai aprender</h2>
    <ol class="indice">{indice}</ol>
    <footer class="rodape"><span>Uso interno · Suinco Cooperativa Agroindustrial</span>
      <span>{HOJE_BR}</span></footer>
  </section>

  {paginas}

  <section class="pagina abertura">
    <header class="topo"><div class="topo-setor">{esc(setor)}</div>
      <div class="topo-doc">Guia do Painel · Suinco</div></header>
    <h2>Se algo der errado</h2>
    <ul class="resumo">
      <li>A tela não atualizou? Puxe a página para baixo (F5). O painel se atualiza sozinho, mas o F5 força na hora.</li>
      <li>O botão da etapa não aparece? Aquele passo é de outro setor — o painel mostra quem faz e você não precisa esperar ninguém avisar.</li>
      <li>Registrou errado? Fale com a Administração: toda alteração guarda o estado anterior e pode ser restaurada.</li>
      <li>Sem internet no aparelho? O registro das devoluções exige conexão, porque o checklist é do servidor e todos precisam ver o mesmo.</li>
    </ul>
    <h2>Quem procurar</h2>
    <ul class="resumo">
      <li>Dúvida de processo: Logística (Bruna / Carol).</li>
      <li>Dúvida de acesso, usuário ou senha: Administração.</li>
      <li>Problema no sistema: Administração abre o chamado.</li>
    </ul>
    <footer class="rodape"><span>Uso interno · Suinco Cooperativa Agroindustrial</span>
      <span>{HOJE_BR}</span></footer>
  </section>
</body></html>"""


# ------------------------------------------------------------------ execução

async def gerar(nav, setor, guia, ids_cenario, pg_admin):
    print(f'\n=== {setor} ===')
    pasta = CAPTURAS / slug(setor)
    pasta.mkdir(parents=True, exist_ok=True)
    ctx, pg = await abrir_painel(nav, slug(setor))
    imagens = []
    for n, passo in enumerate(guia['passos'], 1):
        if n == 2:   # o passo 1 é a tela de login; a partir do 2 já está logado
            await entrar(pg, guia['email'])
        passo = dict(passo)
        if passo.get('cenario'):
            passo['_devId'] = ids_cenario.get(passo['cenario'])
        arq = pasta / f'{n:02d}.png'
        achou = await capturar(pg, passo, arq, n)
        print(f'  {n:02d}. {passo["titulo"][:58]:60s} {"✓" if achou else "· sem destaque"}')
        imagens.append(f'capturas/{pasta.name}/{arq.name}')
    await ctx.close()

    html = documento(setor, guia, imagens)
    caminho_html = SAIDA / f'_guia_{pasta.name}.html'
    caminho_html.write_text(html, encoding='utf-8')

    ctx2 = await nav.new_context()
    pg2 = await ctx2.new_page()
    await pg2.goto(f'file://{caminho_html}')
    await pg2.wait_for_timeout(1200)
    PDFS.mkdir(parents=True, exist_ok=True)
    nome = f'Suinco_Guia_{slug(setor).title()}.pdf'
    await pg2.pdf(path=str(PDFS / nome), format='A4', print_background=True,
                  margin={'top': '0', 'right': '0', 'bottom': '0', 'left': '0'})
    await ctx2.close()
    tam = (PDFS / nome).stat().st_size / 1024
    print(f'  → {nome} ({tam:.0f} KB)')
    return PDFS / nome


async def main():
    alvo = sys.argv[1:] or list(GUIAS)
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        # Cenário criado uma vez, pela Logística, e reaproveitado por todos.
        ctx, pg = await abrir_painel(nav, 'cenario')
        await entrar(pg, GUIAS['Logística']['email'])
        print('Preparando o cenário de demonstração…')
        ids = await preparar_cenario(pg)
        print('  ', ', '.join(f'{k}' for k in ids))

        gerados = []
        for setor in alvo:
            if setor not in GUIAS:
                print(f'setor desconhecido: {setor}')
                continue
            gerados.append(await gerar(nav, setor, GUIAS[setor], ids, pg))

        await limpar_cenario(pg, ids)
        await ctx.close()
        await nav.close()

    print('\n=== PRONTO ===')
    for g in gerados:
        print(' ', g)
    return 0

raise SystemExit(asyncio.run(main()))
