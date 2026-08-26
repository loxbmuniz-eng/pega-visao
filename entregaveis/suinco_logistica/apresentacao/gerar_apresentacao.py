#!/usr/bin/env python3
"""Monta a apresentação institucional em UM arquivo HTML.

Um slide por tela, navegação por seta/clique/toque, identidade do próprio
painel (navy + dourado). Os prints entram embutidos em base64 (JPEG ~82%,
1920px) para o arquivo abrir em qualquer máquina sem depender de pasta.

    python3 apresentacao/capturar_telas.py     # primeiro, os prints
    python3 apresentacao/gerar_apresentacao.py # depois, o arquivo final
"""
import base64
import datetime
import io
import pathlib

from PIL import Image

AQUI = pathlib.Path(__file__).resolve().parent
PRINTS = AQUI / 'prints'
LOGO = AQUI.parent / 'assets' / 'logo_suinco.png'
SAIDA = AQUI / 'Suinco_Apresentacao_Painel.html'
HOJE = datetime.date.today().strftime('%d/%m/%Y')

NAVY = '#0B1B2B'; NAVY2 = '#12293F'; OURO = '#E8B34B'; CREME = '#F6F1E7'


def jpeg_b64(caminho, largura=1920, qualidade=82):
    img = Image.open(caminho).convert('RGB')
    if img.width > largura:
        img = img.resize((largura, int(img.height * largura / img.width)),
                         Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, 'JPEG', quality=qualidade, optimize=True)
    return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()


def png_b64(caminho):
    return 'data:image/png;base64,' + base64.b64encode(caminho.read_bytes()).decode()


LOGO64 = png_b64(LOGO)

# ---------------------------------------------------------------------
# O ROTEIRO. Cada slide de tela: título, quem usa, a frase que apresenta,
# e três pontos — sempre na língua de quem opera, nunca na do sistema.
# ---------------------------------------------------------------------
TELAS = [
    ('05_portaria', 'Portaria', '🚧',
     'O primeiro e o último carimbo de toda carga.',
     ['Digitou a placa, apertou "Chegou" — a empresa inteira fica sabendo na hora que o caminhão entrou.',
      'Na saída, o número do lacre fica gravado junto: prova de que a carga saiu fechada.',
      'Se a placa não tem programação, o registro nasce como "aguardando carga" e a Logística resolve depois — o caminhão nunca fica invisível.']),
    ('03_programacao', 'Programação — Logística', '📋',
     'Onde o dia é desenhado: cada carga, cada caminhão, cada rota.',
     ['A placa puxa sozinha a transportadora e o tipo de veículo do cadastro — ninguém redigita, ninguém erra.',
      'Placa fora do cadastro não vira carga: a base de Frota é quem manda.',
      'A fila mostra só os programados do dia, na sequência de carregamento que a Logística definiu.']),
    ('04_montagem', 'Montagem do dia', '🗓️',
     'A semana vira programação com um clique.',
     ['O modelo semanal (107 destinos) preenche o dia sozinho — sobra para a equipe só o que muda.',
      'Cada linha recebe placa e vira carga programada na hora.',
      'O que não rodou fica registrado: o dia seguinte começa do que ficou, não do zero.']),
    ('06_expedicao', 'Expedição', '🚛',
     'As duas etapas mais longas do pátio, nas mãos de quem pode encurtá-las.',
     ['"Embarque Iniciado" e "Embarque Finalizado" com um toque — e todo o resto da empresa vê.',
      'A visão do pátio vive dentro da própria aba: agir e conferir sem trocar de tela.',
      'É o único posto operacional com Indicadores: quem opera o tempo é quem pode melhorá-lo.']),
    ('07_faturamento', 'Faturamento', '🧾',
     'A carga pronta vira nota — e nada sai sem faturar.',
     ['Um clique em "Faturar", com confirmação — a etapa fica assinada com nome e hora.',
      'A Portaria só consegue dar saída no que está Faturado: a ordem do fluxo é garantida pelo sistema.',
      'Peso e conferência das devoluções passam pela mesma tela.']),
    ('02_torre', 'Torre de Controle', '🗼',
     'O pátio inteiro numa tela só — para Logística, Administração e Comercial.',
     ['Cada carga em aberto com etapa, hora e responsável — atualiza sozinha quando qualquer setor registra.',
      'As caixas do topo respondem de relance: quantos aguardando, quantos carregando, quantos saíram.',
      'Campos editáveis na própria linha para quem tem permissão — sem abrir formulário.']),
    ('08_devolucoes', 'Devoluções', '📦',
     'O caminho de volta com a mesma disciplina do caminho de ida.',
     ['Uma esteira com etapas: Logística lança, Portaria recebe, Faturamento pesa, Expedição confere, Controles destina, Central de Notas fecha.',
      'Cada setor vê "SUA VEZ" quando o checklist chega na etapa dele — ninguém precisa perguntar.',
      'Comprovante do motorista em PDF na hora, e relatório do dia com autoria discriminada.']),
    ('09_indicadores', 'Indicadores', '📈',
     'O tempo do pátio medido de verdade — etapa por etapa.',
     ['Quanto tempo cada carga esperou, carregou, faturou e aguardou saída — e a média de tudo.',
      'Raio-X por rota, transportadora ou placa: clique e veja onde o tempo é gasto.',
      'O Pulso do Pátio mostra o padrão de congestionamento dos últimos 30 dias, hora a hora.']),
    ('10_relatorios', 'Relatórios', '📄',
     'Os documentos oficiais do dia, direto do sistema — em PDF A4, iguais em qualquer aparelho.',
     ['Relatório Operacional: todas as cargas na sequência de carregamento, com status colorido — o retrato do dia.',
      'Administração de Fretes: data, saída, placa e observações de negociação, por período.',
      'O PDF é gerado no servidor: sai idêntico no computador, no tablet e no celular.']),
    ('11_historico', 'Histórico e auditoria', '🕓',
     'Quem fez, o quê, quando — para sempre.',
     ['Toda movimentação com nome, setor, data e hora. Nada se apaga: correção vira registro novo, com motivo.',
      'A Linha do Tempo de uma carga conta a jornada inteira: da programação à saída.',
      'Busca por placa ou número, com filtro de período.']),
    ('12_cadastros', 'Cadastros', '🗂️',
     'A base que sustenta tudo: frota, rotas, produtos, supervisores.',
     ['749 veículos com transportadora e motorista — a placa é o vínculo, e é ela que preenche o resto.',
      'Rotas oficiais com código e nome — o que não está na base não entra na operação.',
      'Quem mantém: Logística e Administração, com registro de quem alterou.']),
    ('13_usuarios', 'Usuários e segurança', '🔐',
     'Cada pessoa com a sua conta, cada setor com o seu alcance.',
     ['Login individual: toda ação fica assinada — ninguém responde pelo que não fez.',
      'Permissão por setor validada no servidor: esconder botão não é segurança, recusar no servidor é.',
      'Segundo fator disponível para todos, sessões revogáveis, bloqueio e exclusão pela Administração.']),
    ('14_comercial', 'Visão do Comercial', '👁️',
     'Tudo que a Logística vê — sem poder alterar nada.',
     ['Torre e Histórico em modo leitura: a resposta para "onde está a carga do meu cliente?" sem telefonema.',
      'Menos interrupção para o pátio, mais autonomia para quem vende.',
      'O servidor recusa qualquer escrita vinda deste perfil — não é só a tela que impede.']),
]


def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def slide_tela(num, arquivo, titulo, icone, frase, pontos):
    img = jpeg_b64(PRINTS / f'{arquivo}.png')
    lis = ''.join(f'<li>{esc(p)}</li>' for p in pontos)
    return f'''
<section class="slide s-tela">
  <header><span class="mini">{icone} {esc(titulo)}</span><span class="num">{num:02d}</span></header>
  <div class="tela-grid">
    <div class="tela-txt">
      <h2>{esc(titulo)}</h2>
      <p class="frase">{esc(frase)}</p>
      <ul>{lis}</ul>
    </div>
    <div class="tela-img"><img src="{img}" alt="Tela: {esc(titulo)}"></div>
  </div>
</section>'''


partes = []

# ---- capa ----
partes.append(f'''
<section class="slide s-capa">
  <img class="logo" src="{LOGO64}" alt="Suinco">
  <p class="eyebrow">SUINCO — COOPERATIVA AGROINDUSTRIAL</p>
  <h1>Programação de Embarque</h1>
  <p class="sub">O sistema que mostra, em tempo real, onde está cada caminhão,
  quem registrou cada movimento e a que horas.</p>
  <p class="data">Apresentação para todos os setores · {HOJE}</p>
  <p class="dica">use as setas do teclado, clique ou toque para avançar</p>
</section>''')

# ---- o problema ----
partes.append('''
<section class="slide s-texto">
  <header><span class="mini">De onde viemos</span><span class="num">01</span></header>
  <h2>Antes, a resposta morava no telefone</h2>
  <div class="cols">
    <div class="col antes">
      <h3>Como era</h3>
      <ul>
        <li>Planilha de Excel, uma cópia em cada máquina — e nenhuma igual à outra.</li>
        <li>"Onde está o caminhão?" era uma ligação para o pátio, várias vezes por dia.</li>
        <li>Relatório montado à mão, no fim do dia, do jeito que desse.</li>
        <li>Quando algo saía errado, não havia como saber quem registrou o quê, nem quando.</li>
      </ul>
    </div>
    <div class="col depois">
      <h3>Como é hoje</h3>
      <ul>
        <li>Uma única fonte: o que um setor registra, todos veem <strong>no mesmo segundo</strong>.</li>
        <li>A Torre de Controle responde "onde está?" sem ninguém atender telefone.</li>
        <li>Relatório oficial em PDF, com um clique, idêntico em qualquer aparelho.</li>
        <li>Toda ação assinada: nome, setor, data e hora — para sempre.</li>
      </ul>
    </div>
  </div>
</section>''')

# ---- números ----
partes.append('''
<section class="slide s-numeros">
  <header><span class="mini">O sistema em números</span><span class="num">02</span></header>
  <h2>Um sistema, oito setores, uma verdade</h2>
  <div class="nums">
    <div class="n"><b>8</b><span>setores trabalhando<br>na mesma tela</span></div>
    <div class="n"><b>6</b><span>etapas no caminho<br>de cada carga</span></div>
    <div class="n"><b>749</b><span>veículos<br>cadastrados</span></div>
    <div class="n"><b>100%</b><span>das ações assinadas<br>com nome e hora</span></div>
  </div>
  <div class="nums linha2">
    <div class="n"><b>456</b><span>verificações automáticas<br>antes de cada atualização</span></div>
    <div class="n"><b>24h</b><span>backup diário do banco,<br>com restauração testada</span></div>
    <div class="n"><b>0</b><span>papel, planilha solta<br>ou versão divergente</span></div>
  </div>
</section>''')

# ---- fluxo ----
etapas = [
    ('1', 'Aguardando Veículo', 'Logística', 'a carga existe no papel'),
    ('2', 'Aguardando Embarque', 'Portaria', 'o caminhão entrou no pátio'),
    ('3', 'Embarque Iniciado', 'Expedição', 'começou a carregar'),
    ('4', 'Embarque Finalizado', 'Expedição', 'terminou de carregar'),
    ('5', 'Faturado', 'Faturamento', 'a nota foi emitida'),
    ('6', 'Seguiu Viagem', 'Portaria', 'o caminhão saiu, com lacre'),
]
fluxo = ''.join(f'''<div class="etapa e{n}">
  <span class="bola">{n}</span>
  <b>{esc(nome)}</b><i>{esc(setor)}</i><small>{esc(desc)}</small>
</div>''' for n, nome, setor, desc in etapas)
partes.append(f'''
<section class="slide s-fluxo">
  <header><span class="mini">Como funciona</span><span class="num">03</span></header>
  <h2>O caminho de uma carga</h2>
  <p class="frase">Seis etapas, cada uma pertence a um setor — e o sistema não deixa
  pular nem voltar. Corrigir existe, mas exige motivo e fica registrado.</p>
  <div class="fluxo">{fluxo}</div>
  <p class="nota">O relógio de pátio (meta de 3 horas) começa quando o caminhão
  <strong>entra de verdade</strong> — etapa 2 — e para quando ele sai.</p>
</section>''')

# ---- login ----
img_login = jpeg_b64(PRINTS / '01_login.png')
partes.append(f'''
<section class="slide s-tela">
  <header><span class="mini">🔑 Entrada</span><span class="num">04</span></header>
  <div class="tela-grid">
    <div class="tela-txt">
      <h2>Cada pessoa entra como ela mesma</h2>
      <p class="frase">E-mail e senha individuais — nada de conta compartilhada.</p>
      <ul>
        <li>Tudo o que a pessoa registra fica assinado com o nome dela.</li>
        <li>O painel lembra do operador no mesmo aparelho: uma entrada por turno.</li>
        <li>Perfis por setor: cada um vê as abas do próprio trabalho.</li>
      </ul>
    </div>
    <div class="tela-img"><img src="{img_login}" alt="Tela de entrada"></div>
  </div>
</section>''')

# ---- telas ----
for i, (arq, titulo, icone, frase, pontos) in enumerate(TELAS):
    partes.append(slide_tela(i + 5, arq, titulo, icone, frase, pontos))

n = len(TELAS) + 5

# ---- confiança ----
partes.append(f'''
<section class="slide s-texto">
  <header><span class="mini">Por que dá para confiar</span><span class="num">{n:02d}</span></header>
  <h2>O que segura o sistema de pé</h2>
  <div class="cols">
    <div class="col">
      <h3>Antes de qualquer atualização</h3>
      <ul>
        <li><strong>456 verificações automáticas</strong> — 346 no servidor e 110 nas telas — precisam passar. Uma falha, e nada é publicado.</li>
        <li>Um "portão de publicação" confere tudo e imprime o que ficou pendente: esquecer deixou de ser possível.</li>
      </ul>
    </div>
    <div class="col">
      <h3>Todo dia, sozinho</h3>
      <ul>
        <li>Backup diário do banco, com <strong>teste de restauração</strong> — backup que nunca foi restaurado não é backup.</li>
        <li>Histórico permanente: correção não apaga nada, cria registro novo com motivo e autor.</li>
        <li>Servidor próprio, HTTPS, senha criptografada, permissão validada no servidor.</li>
      </ul>
    </div>
  </div>
</section>''')

# ---- próximos passos ----
partes.append(f'''
<section class="slide s-texto">
  <header><span class="mini">O que vem agora</span><span class="num">{n+1:02d}</span></header>
  <h2>Próximos passos</h2>
  <div class="cols">
    <div class="col">
      <ul>
        <li><strong>Aviso no celular</strong> — entrada, saída e fim da programação chegando como notificação, para quem ativar o sino.</li>
        <li><strong>Resumo no WhatsApp</strong> — o robô manda os números do dia no grupo, de 3 em 3 horas, com o PDF junto.</li>
      </ul>
    </div>
    <div class="col">
      <ul>
        <li><strong>Cargas sem placa</strong> — programar antes de contratar a transportadora; ao preencher a placa, a carga entra na Torre sozinha.</li>
        <li><strong>Manuais por setor</strong> — um guia em PDF para cada posto, com fotos reais das telas, já disponíveis.</li>
      </ul>
    </div>
  </div>
</section>''')

# ---- encerramento ----
partes.append(f'''
<section class="slide s-capa s-fim">
  <img class="logo" src="{LOGO64}" alt="Suinco">
  <h1>Uma fonte. Oito setores.<br>Zero telefonema para saber onde está o caminhão.</h1>
  <p class="sub">embarquesuinco.com.br</p>
  <p class="data">Programação de Embarque · Suinco · {HOJE}</p>
</section>''')

slides = ''.join(partes)

HTML = f'''<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Programação de Embarque — Suinco</title>
<style>
  :root {{
    --navy: {NAVY}; --navy2: {NAVY2}; --ouro: {OURO}; --creme: {CREME};
    --tinta: #16202B; --suave: rgba(246,241,231,.72);
  }}
  * {{ margin: 0; padding: 0; box-sizing: border-box; }}
  html, body {{ height: 100%; background: var(--navy); color: var(--creme);
    font: 400 clamp(15px, 1.35vw, 21px)/1.55 Georgia, 'Times New Roman', serif; }}
  body {{ overflow: hidden; }}

  .slide {{ position: absolute; inset: 0; padding: 4.5vh 5vw; display: none;
    flex-direction: column;
    background: radial-gradient(1200px 700px at 78% -10%, rgba(232,179,75,.10), transparent 60%),
                linear-gradient(150deg, var(--navy) 0%, var(--navy2) 100%); }}
  .slide.ativa {{ display: flex; animation: entra .45s ease; }}
  @keyframes entra {{ from {{ opacity: 0; transform: translateY(10px); }}
                      to   {{ opacity: 1; transform: none; }} }}

  header {{ display: flex; justify-content: space-between; align-items: baseline;
    border-bottom: 1px solid rgba(232,179,75,.35); padding-bottom: 1.2vh; margin-bottom: 3vh; }}
  .mini {{ font-family: Arial, Helvetica, sans-serif; font-size: .72em; letter-spacing: .18em;
    text-transform: uppercase; color: var(--ouro); font-weight: 700; }}
  .num {{ font-family: Arial, sans-serif; font-size: .7em; color: var(--suave); }}

  h1 {{ font-size: 2.6em; line-height: 1.12; text-wrap: balance; }}
  h2 {{ font-size: 1.9em; line-height: 1.15; margin-bottom: 1.2vh; color: #fff; text-wrap: balance; }}
  h3 {{ font-family: Arial, sans-serif; font-size: .8em; letter-spacing: .14em;
    text-transform: uppercase; color: var(--ouro); margin-bottom: 1.4vh; }}
  .frase {{ font-style: italic; color: var(--ouro); font-size: 1.12em; margin-bottom: 2.2vh; }}

  /* capa */
  .s-capa {{ justify-content: center; align-items: flex-start; gap: 1.6vh; }}
  .s-capa .logo {{ width: clamp(90px, 9vw, 150px); border-radius: 14px;
    box-shadow: 0 8px 40px rgba(0,0,0,.5); margin-bottom: 1vh; }}
  .eyebrow {{ font-family: Arial, sans-serif; letter-spacing: .22em; font-size: .7em;
    color: var(--ouro); font-weight: 700; }}
  .s-capa h1 {{ font-size: 3.4em; max-width: 22ch; }}
  .s-capa .sub {{ font-size: 1.15em; color: var(--suave); max-width: 52ch; }}
  .s-capa .data {{ font-family: Arial, sans-serif; font-size: .8em; color: var(--suave); }}
  .s-capa .dica {{ font-family: Arial, sans-serif; font-size: .72em; color: rgba(246,241,231,.45);
    margin-top: 3vh; }}
  .s-fim {{ align-items: center; text-align: center; }}
  .s-fim h1 {{ font-size: 2.4em; }}

  /* texto em duas colunas */
  .cols {{ display: grid; grid-template-columns: 1fr 1fr; gap: 3vw; flex: 1; align-content: start; }}
  .col ul {{ list-style: none; }}
  .col li {{ padding: 1.3vh 0 1.3vh 1.6em; position: relative;
    border-bottom: 1px solid rgba(246,241,231,.08); color: var(--suave); }}
  .col li::before {{ content: '›'; position: absolute; left: .3em; color: var(--ouro);
    font-weight: 700; }}
  .col li strong {{ color: var(--creme); }}
  .antes h3 {{ color: #c97b6d; }}
  .antes li::before {{ color: #c97b6d; }}

  /* números */
  .nums {{ display: grid; grid-template-columns: repeat(4, 1fr); gap: 2vw; margin-top: 3vh; }}
  .nums.linha2 {{ grid-template-columns: repeat(3, 1fr); margin-top: 2vw; }}
  .n {{ background: rgba(246,241,231,.05); border: 1px solid rgba(232,179,75,.25);
    border-radius: 14px; padding: 3.2vh 1.6vw; text-align: center; }}
  .n b {{ display: block; font-family: Arial, sans-serif; font-size: 2.6em; color: var(--ouro);
    font-weight: 800; line-height: 1; margin-bottom: 1vh; }}
  .n span {{ font-size: .82em; color: var(--suave); }}

  /* fluxo */
  .fluxo {{ display: grid; grid-template-columns: repeat(6, 1fr); gap: 1vw; flex: 1;
    align-content: center; }}
  .etapa {{ background: rgba(246,241,231,.05); border-radius: 14px; padding: 2.4vh 1vw;
    text-align: center; border-top: 4px solid var(--ouro); position: relative; }}
  .etapa .bola {{ display: inline-grid; place-items: center; width: 2.1em; height: 2.1em;
    border-radius: 50%; background: var(--ouro); color: var(--navy);
    font: 800 1em Arial, sans-serif; margin-bottom: 1.2vh; }}
  .etapa b {{ display: block; font-size: .92em; line-height: 1.2; color: #fff; }}
  .etapa i {{ display: block; font-family: Arial, sans-serif; font-style: normal;
    font-size: .68em; letter-spacing: .1em; text-transform: uppercase; color: var(--ouro);
    margin: .8vh 0; }}
  .etapa small {{ font-size: .74em; color: var(--suave); }}
  .e1 {{ border-top-color: #c0503f; }} .e2 {{ border-top-color: #d98032; }}
  .e3 {{ border-top-color: #d9b032; }} .e4 {{ border-top-color: #a7c05a; }}
  .e5 {{ border-top-color: #5aa76a; }} .e6 {{ border-top-color: #2e7d4f; }}
  .nota {{ margin-top: 2.4vh; font-size: .92em; color: var(--suave);
    border-left: 3px solid var(--ouro); padding-left: 1em; }}

  /* slide de tela */
  .tela-grid {{ display: grid; grid-template-columns: minmax(30ch, 2fr) 5fr; gap: 2.6vw;
    flex: 1; min-height: 0; align-items: center; }}
  .tela-txt ul {{ list-style: none; }}
  .tela-txt li {{ padding: 1.2vh 0 1.2vh 1.5em; position: relative; color: var(--suave);
    font-size: .92em; border-bottom: 1px solid rgba(246,241,231,.08); }}
  .tela-txt li::before {{ content: '›'; position: absolute; left: .2em; color: var(--ouro);
    font-weight: 700; }}
  .tela-img {{ min-height: 0; height: 100%; display: flex; align-items: center; }}
  .tela-img img {{ max-width: 100%; max-height: 100%; border-radius: 10px;
    box-shadow: 0 14px 60px rgba(0,0,0,.55); border: 1px solid rgba(246,241,231,.14); }}

  /* navegação */
  .nav {{ position: fixed; bottom: 2.2vh; right: 2.4vw; display: flex; gap: .6em;
    align-items: center; font-family: Arial, sans-serif; z-index: 10; }}
  .nav button {{ background: rgba(246,241,231,.08); color: var(--creme);
    border: 1px solid rgba(232,179,75,.4); border-radius: 10px; width: 2.6em; height: 2.6em;
    font-size: 1em; cursor: pointer; }}
  .nav button:hover {{ background: rgba(232,179,75,.25); }}
  .contador {{ font-size: .78em; color: var(--suave); min-width: 4.5em; text-align: center; }}
  .barra {{ position: fixed; left: 0; bottom: 0; height: 4px; background: var(--ouro);
    width: 0; transition: width .3s ease; z-index: 10; }}

  @media (max-width: 900px) {{
    body {{ overflow: auto; }}
    .slide {{ position: static; display: flex !important; min-height: 100vh; }}
    .tela-grid, .cols {{ grid-template-columns: 1fr; }}
    .fluxo {{ grid-template-columns: repeat(2, 1fr); }}
    .nums, .nums.linha2 {{ grid-template-columns: repeat(2, 1fr); }}
    .nav, .barra {{ display: none; }}
  }}
  @media print {{
    body {{ overflow: visible; background: var(--navy); }}
    .slide {{ position: static; display: flex !important; height: 100vh;
      page-break-after: always; }}
    .nav, .barra {{ display: none; }}
  }}
</style>
</head>
<body>
{slides}
<div class="nav">
  <button id="ant" aria-label="Slide anterior">‹</button>
  <span class="contador" id="cont"></span>
  <button id="prox" aria-label="Próximo slide">›</button>
</div>
<div class="barra" id="barra"></div>
<script>
  const slides = [...document.querySelectorAll('.slide')];
  let i = 0;
  function mostrar(n) {{
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach((s, k) => s.classList.toggle('ativa', k === i));
    document.getElementById('cont').textContent = (i + 1) + ' / ' + slides.length;
    document.getElementById('barra').style.width = ((i + 1) / slides.length * 100) + '%';
  }}
  document.getElementById('prox').onclick = () => mostrar(i + 1);
  document.getElementById('ant').onclick = () => mostrar(i - 1);
  addEventListener('keydown', (e) => {{
    if (['ArrowRight', ' ', 'PageDown'].includes(e.key)) mostrar(i + 1);
    if (['ArrowLeft', 'PageUp'].includes(e.key)) mostrar(i - 1);
    if (e.key === 'Home') mostrar(0);
    if (e.key === 'End') mostrar(slides.length - 1);
  }});
  addEventListener('click', (e) => {{
    if (e.target.closest('.nav')) return;
    mostrar(i + 1);
  }});
  let x0 = null;
  addEventListener('touchstart', (e) => x0 = e.touches[0].clientX);
  addEventListener('touchend', (e) => {{
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) mostrar(i + (dx < 0 ? 1 : -1));
    x0 = null;
  }});
  mostrar(0);
</script>
</body>
</html>'''

SAIDA.write_text(HTML, encoding='utf-8')
kb = SAIDA.stat().st_size / 1024
print(f'{SAIDA.name}: {kb:.0f} KB · {len(slides.split("<section")) - 1} slides')
