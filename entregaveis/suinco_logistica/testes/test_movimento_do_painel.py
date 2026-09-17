#!/usr/bin/env python3
"""O painel se MEXE — e se mexe dentro das regras (16/09/2026).

Pedido do dono: *"quero um sistema com cara nova, COM ANIMAÇÕES, FLUIDEZ.
Tudo de preview que você me mostrou seja aplicado em seu devido lugar."*

Seis movimentos foram aprovados por ele, e cada um deles tem aqui a sua
seção. Mas a parte que este arquivo realmente protege não são as animações:
são os TETOS. Animação bonita que passa de 300 ms, que anima a tabela a cada
sincronia, ou que deixa um elemento invisível esperando o movimento começar,
não é melhoria — é defeito com cara de acabamento.

O QUE CADA SEÇÃO TRAVA

  1. SEGUIU VIAGEM: a linha não some seca — o caminhão anda e sai, e a linha
     fecha o próprio espaço. TETO DE 300 ms, e a conta não é estética: a
     Torre despacha ~31 cargas por dia. Sete décimos por saída seria meio
     minuto diário de gente esperando a tela terminar.
  2. SEGURAR PARA CANCELAR: `clip-path` contando 1,5 s em linear enquanto o
     dedo está lá; soltar antes volta em 200 ms e NADA acontece. E a parte
     que num painel em produção importa mais que a animação: quem chega por
     TECLADO continua passando. Botão que só nega é a ocorrência #13.
  3. BOTÃO QUE CONTA: Salvar → Salvando… → ✓ Salvo, com o texto trocando
     embaçado. E "✓ Salvo" só depois que a resposta chegou — se o servidor
     recusar, o botão nunca diz que salvou.
  4. LINHA NOVA entra deslizando de CIMA, nunca de `scale(0)`. E — a
     conferência que impede a tremedeira — a primeira pintura NÃO anima
     nada: abrir a aba com 30 cargas não faz 30 linhas dançarem, e a
     sincronia redesenhando as mesmas linhas não dispara nada.
  5. O AVISO entra e sai pelo MESMO lado, 320 ms entrando, 240 ms saindo.
  6. A ETAPA QUE SE CARIMBA: o visto se desenha em 340 ms, e SÓ o carimbo
     novo se desenha — a lista é redesenhada a cada leitura do servidor.
  7. O PAPEL NÃO SE MEXE. O servidor gera os PDFs com este mesmo CSS. Todo
     movimento desligado em `@media print`, e NENHUM estado de repouso
     invisível — foi uma regra de papel no nível errado que fez o relatório
     sair com página em branco (ocorrência #72).
  8. QUEM PEDIU MENOS MOVIMENTO recebe menos movimento, e não menos painel.

    python3 testes/test_movimento_do_painel.py
"""
import asyncio
import os
import pathlib
import sys

from playwright.async_api import async_playwright

# O painel medido é o que está AO LADO deste teste, não um caminho absoluto
# para outra cópia da árvore. É a ocorrência #47 em miniatura: medir o
# arquivo de outro commit responde uma pergunta que ninguém fez.
RAIZ = pathlib.Path(__file__).resolve().parent.parent
PAINEL = os.environ.get('SUINCO_PAINEL', (RAIZ / 'index.html').as_uri())

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def entrar(pg, setor='Logística'):
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(1100)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Ana')
    await pg.select_option('#login-setor', setor)
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(900)


# Semeia o pátio no próprio painel, pelas funções dele. A Torre lê DB.cargas
# e a Visão do Pátio monta as etapas de DB.movimentacoes.
SEMEAR = """(quantas) => {
  const agora = new Date();
  const h = (min) => new Date(agora.getTime() - min * 60000).toISOString();
  const FLUXO = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
                 'Embarque Finalizado','Faturado'];
  DB.cargas = []; DB.movimentacoes = [];
  for (let i = 0; i < quantas; i++) {
    const id = 'mv' + i;
    DB.cargas.push({ id, numeroCarga: 'MV-' + i,
      placa: (DB.frota[i] && DB.frota[i].placa) || ('AAA0A0' + i),
      transportadora: 'Transportadora ' + i, rota: '500', peso: 12000, sequencia: i + 1,
      status: FLUXO[4], dataProgramacao: agora.toISOString().slice(0, 10),
      criadaEm: h(400), atualizadaEm: h(20) });
    FLUXO.forEach((st, k) => DB.movimentacoes.push(
      { cargaId: id, status: st, quando: h(360 - k * 55), operador: 'Ana' }));
  }
  SuincoStore.save();
  renderAll();
  return DB.cargas.map(c => ({ id: c.id, placa: c.placa }));
}"""

# Um servidor de mentira que registra o que foi chamado. Vale para o que
# este arquivo mede — o MOVIMENTO da tela — e para nada além disso: a
# verdade da saída no servidor é de test_saida_confirmada_pelo_servidor.
FINGIR_SERVIDOR = """(cfg) => {
  window.__chamadas = [];
  window.SuincoSharePoint = window.SuincoSharePoint || {};
  SuincoSharePoint.estaConfigurado = () => true;
  SuincoSharePoint.portariaSaida = async (placa, lacres) => {
    window.__chamadas.push(['saida', placa, lacres]);
    window.__saiu = (cfg.resposta.liberadas || []).map(c => c.id);
    return cfg.resposta;
  };
  /* A sincronia traz a verdade do servidor de volta, que é exatamente o
     que acontece no pátio: quem confirmou a saída foi a transação, e o
     painel adota a resposta dela. Sem isto a carga continuaria "Faturado"
     na memória desta aba e a linha nunca sairia da Torre — o teste estaria
     medindo um painel que nunca existe em produção. */
  SuincoSharePoint.sincronizarAgora = async () => {
    (window.__saiu || []).forEach((id) => {
      const c = DB.cargas.find(x => x.id === id);
      if (c) c.status = 'Seguiu Viagem';
    });
  };
}"""

# Filma a linha quadro a quadro até ela sair do DOM. Mede o que a pessoa vê:
# a posição, a opacidade e a ALTURA — não a classe CSS, que é atalho.
FILMAR_LINHA = """(id) => {
  const sel = 'tr[data-carga="' + id + '"]';
  const t0 = performance.now();
  window.__filme = { quadros: [], fim: null };
  (function passo(){
    const tr = document.querySelector(sel);
    const t = performance.now() - t0;
    if (!tr) { window.__filme.fim = t; return; }
    const cel = tr.querySelector('td') || tr;
    const cs = getComputedStyle(cel);
    window.__filme.quadros.push({
      t: Math.round(t), transform: cs.transform, opacidade: Number(cs.opacity),
      altura: tr.getBoundingClientRect().height });
    if (t < 3000) requestAnimationFrame(passo); else window.__filme.fim = -1;
  })();
}"""


def deslocamento_x(matriz):
    """Quanto o elemento andou no eixo X, lendo a matriz do computed style."""
    if not matriz or not matriz.startswith('matrix'):
        return 0.0
    nums = [float(x) for x in matriz[matriz.index('(') + 1:matriz.rindex(')')].split(',')]
    return nums[4] if len(nums) == 6 else nums[12]


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(
            executable_path=os.environ.get('PLAYWRIGHT_CHROMIUM_PATH', '/opt/pw-browsers/chromium'),
            headless=True)
        erros = []

        # ==============================================================
        print('\n=== 1. "SEGUIU VIAGEM": O CAMINHÃO SAI DO PÁTIO ===')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)
        cargas = await pg.evaluate(SEMEAR, 3)
        await pg.evaluate("() => abrirTab('torre')")
        await pg.wait_for_timeout(800)

        alvo = cargas[0]
        tem_linha = await pg.evaluate(
            "(id) => !!document.querySelector('tr[data-carga=\"' + id + '\"]')", alvo['id'])
        ck('a carga tem linha etiquetada na tela (data-carga)', tem_linha, alvo['id'])

        await pg.evaluate(FINGIR_SERVIDOR, {
            'resposta': {'liberadas': [{'id': alvo['id'], 'numeroCarga': 'MV-0'}], 'pendentes': []}})
        await pg.evaluate("(p) => { document.getElementById('portaria-placa').value = p; }",
                          alvo['placa'])
        await pg.evaluate(FILMAR_LINHA, alvo['id'])
        await pg.evaluate("() => acaoSaidaUI()")
        await pg.wait_for_timeout(2200)
        filme = await pg.evaluate("() => window.__filme")

        quadros = filme['quadros']
        fim = filme['fim']
        andou = max((deslocamento_x(q['transform']) for q in quadros), default=0)
        apagou = min((q['opacidade'] for q in quadros), default=1)
        alturas = [q['altura'] for q in quadros]

        ck('a linha ANDOU para a direita antes de sair — não sumiu seca',
           andou >= 20, f'andou {andou:.0f}px')
        ck('e foi apagando enquanto andava', apagou <= 0.35, f'opacidade mínima {apagou:.2f}')
        ck('a linha FECHOU o próprio espaço (altura foi a ~zero)',
           bool(alturas) and max(alturas) > 10 and min(alturas) <= 2,
           f'de {max(alturas):.0f}px para {min(alturas):.0f}px')
        # O TETO. 300 ms é a regra; 60 ms de folga para o relógio do
        # navegador e para o redesenho que vem logo atrás.
        # O TETO É DO QUE A PESSOA VÊ: do clique até a linha ter acabado de
        # sair — apagada e com o espaço fechado. Medido nos quadros, não no
        # que o CSS declara: inclui o atraso do relógio do navegador.
        #
        # A remoção do DOM vem logo atrás, no `renderAll()`, e é conferida
        # separadamente: ela não faz parte do movimento (o redesenho da
        # tabela é custo que o painel já tinha), mas a linha também não pode
        # ficar de fantasma na tela depois de ter saído.
        fim_visual = next((q['t'] for q in quadros
                           if q['altura'] <= 2 and q['opacidade'] <= 0.02), None)
        ck('o movimento inteiro cabe em 300 ms',
           fim_visual is not None and fim_visual <= 300,
           f'{fim_visual}ms até o caminhão terminar de sair')
        ck('e não foi instantâneo — deu tempo de ver o caminhão sair',
           fim_visual is not None and fim_visual >= 150, f'{fim_visual}ms')
        ck('nenhum fantasma fica na tela depois — o redesenho vem logo atrás',
           fim is not None and fim > 0 and fim <= 450, f'{fim}ms até sair do DOM')
        ck('a saída seguiu pela rota do servidor, como antes',
           'saida' in [c[0] for c in (await pg.evaluate("() => window.__chamadas") or [])])
        await pg.close()

        # ==============================================================
        print('\n=== 2. SEGURAR PARA CANCELAR ===')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)
        cargas = await pg.evaluate(SEMEAR, 3)
        await pg.evaluate("() => abrirTab('torre')")
        await pg.wait_for_timeout(800)

        botao = await pg.query_selector('#torre-tbody tr .btn-danger')
        ck('o botão de cancelar/excluir está na Torre', botao is not None)
        if botao is None:
            await nav.close()
            print('\n=== RESULTADO ===\n  FALHAS: ' + ', '.join(falhas))
            return 1

        ck('ele pede para ser SEGURADO (data-segurar)',
           await botao.get_attribute('data-segurar') is not None)

        LER_BARRA = """() => {
          const b = document.querySelector('#torre-tbody tr .btn-danger');
          return { clip: getComputedStyle(b, '::after').clipPath,
                   classe: b.className }; }"""
        repouso = await pg.evaluate(LER_BARRA)
        ck('em repouso a barra está recolhida (não cobre o botão)',
           '100%' in repouso['clip'], repouso['clip'])

        caixa = await botao.bounding_box()
        await pg.mouse.move(caixa['x'] + caixa['width'] / 2, caixa['y'] + caixa['height'] / 2)
        await pg.mouse.down()
        await pg.wait_for_timeout(250)
        cedo = await pg.evaluate(LER_BARRA)
        await pg.wait_for_timeout(700)
        meio = await pg.evaluate(LER_BARRA)
        await pg.mouse.up()
        await pg.wait_for_timeout(500)
        solto = await pg.evaluate(LER_BARRA)
        quantas = await pg.evaluate("() => DB.cargas.length")

        def resto(clip):
            """Quanto ainda falta a barra cobrir, em % — 100 = recolhida.

            Devolve None quando não há barra nenhuma: `clip-path: none` não é
            "barra cheia", é ausência de barra, e tratar os dois como a mesma
            coisa faria o teste passar num painel que não tem o gesto.
            """
            if not clip or not clip.startswith('inset'):
                return None
            for pedaco in clip.replace('inset(', '').replace(')', '').split():
                if pedaco.endswith('%'):
                    return float(pedaco[:-1])
            return 0.0

        ck('segurando, a barra COMEÇA a contar',
           resto(cedo['clip']) is not None and resto(cedo['clip']) < 100, cedo['clip'])
        ck('e vai avançando enquanto o dedo fica',
           None not in (resto(meio['clip']), resto(cedo['clip']))
           and resto(meio['clip']) < resto(cedo['clip']),
           f"{resto(cedo['clip'])} -> {resto(meio['clip'])} restando")
        ck('soltando antes da hora, a barra VOLTA',
           resto(solto['clip']) is not None and resto(solto['clip']) >= 99, solto['clip'])
        ck('e NADA acontece com a carga', quantas == 3, f'{quantas} cargas')

        # Toque curto não pode ficar mudo: ele ENSINA o gesto. Botão que só
        # nega é o defeito da ocorrência #13.
        await pg.evaluate("() => document.querySelectorAll('.notif-item').forEach(n=>n.remove())")
        await botao.click()
        await pg.wait_for_timeout(400)
        dica = await pg.evaluate(
            "() => [...document.querySelectorAll('.notif-item')].map(n=>n.textContent).join(' ')")
        ck('toque curto EXPLICA o gesto em vez de só não funcionar',
           'egure' in dica, dica[:70])
        ck('e continua sem mexer na carga',
           await pg.evaluate("() => DB.cargas.length") == 3)

        # A SAÍDA QUE NÃO PODE FECHAR: teclado e chamada de programa passam
        # pelo caminho de sempre. Sem isto, o gesto novo trancaria fora quem
        # não usa o dedo.
        pg.once('dialog', lambda d: asyncio.ensure_future(d.accept('teste de teclado')))
        await pg.evaluate(
            "() => document.querySelector('#torre-tbody tr .btn-danger').click()")
        await pg.wait_for_timeout(1200)
        ck('teclado/chamada de programa ainda conseguem cancelar — ninguém fica trancado fora',
           await pg.evaluate("() => DB.cargas.length") == 2,
           str(await pg.evaluate("() => DB.cargas.length")))

        # Agora o gesto INTEIRO: 1,5 s com o dedo no botão.
        botao = await pg.query_selector('#torre-tbody tr .btn-danger')
        caixa = await botao.bounding_box()
        pg.once('dialog', lambda d: asyncio.ensure_future(d.accept('segurou até o fim')))
        await pg.mouse.move(caixa['x'] + caixa['width'] / 2, caixa['y'] + caixa['height'] / 2)
        await pg.mouse.down()
        await pg.wait_for_timeout(1800)
        await pg.mouse.up()
        await pg.wait_for_timeout(1200)
        ck('segurando até o fim, a carga é cancelada',
           await pg.evaluate("() => DB.cargas.length") == 1,
           str(await pg.evaluate("() => DB.cargas.length")))
        await pg.close()

        # ==============================================================
        print('\n=== 3. O BOTÃO CONTA O QUE ESTÁ FAZENDO ===')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)
        await pg.evaluate("() => abrirTab('cadastros')")
        await pg.wait_for_timeout(900)
        await pg.evaluate("""() => {
            window.SuincoSharePoint = window.SuincoSharePoint || {};
            SuincoSharePoint.gravarDestinoFrete = (d) => new Promise(
              (ok) => setTimeout(() => ok({ ok: true, destino: d.destino }), 600));
          }""")
        existe = await pg.evaluate(
            "() => !!document.querySelector('button[onclick*=\"addDestinoFreteUI(\"]')")
        ck('o botão de salvar destino está na tela', existe)
        await pg.fill('#frete-destino-nome', 'MOVIMENTO TESTE')
        await pg.fill('#frete-destino-km', '123')
        # DISPARA E NÃO ESPERA. `evaluate` de função assíncrona só volta
        # quando a promessa resolve — esperando aqui, o botão já teria
        # contado tudo antes da primeira medição, e o teste mediria o fim
        # de um filme que ele não viu.
        await pg.evaluate("() => { addDestinoFreteUI(); }")

        VER_BOTAO = """() => {
          const b = document.querySelector('button[onclick*="addDestinoFreteUI("]');
          const cs = getComputedStyle(b);
          return { texto: b.textContent.trim(), filtro: cs.filter,
                   ocupado: b.getAttribute('aria-busy') }; }"""
        await pg.wait_for_timeout(60)
        borrando = await pg.evaluate(VER_BOTAO)
        await pg.wait_for_timeout(300)
        fazendo = await pg.evaluate(VER_BOTAO)
        await pg.wait_for_timeout(700)
        feito = await pg.evaluate(VER_BOTAO)
        await pg.wait_for_timeout(1400)
        voltou = await pg.evaluate(VER_BOTAO)

        ck('o texto troca EMBAÇADO — os dois estados não são dois objetos',
           'blur' in borrando['filtro'], borrando['filtro'])
        ck('e o borrão é sutil (2,6px), não mancha',
           'blur' in borrando['filtro'] and float(
               borrando['filtro'].split('blur(')[1].split('px')[0]) <= 4,
           borrando['filtro'])
        ck('enquanto grava, o botão diz "Salvando…"',
           'alvando' in fazendo['texto'], fazendo['texto'])
        ck('e avisa o leitor de tela que está ocupado', fazendo['ocupado'] == 'true')
        ck('depois da resposta do servidor, ele diz "Salvo"',
           'alvo' in feito['texto'], feito['texto'])
        ck('e volta a ser o botão de antes — não fica um carimbo permanente',
           'alvar' in voltou['texto'] and 'alvando' not in voltou['texto']
           and 'aria' != voltou['ocupado'] and voltou['ocupado'] is None,
           f"{voltou['texto']!r} ocupado={voltou['ocupado']}")

        # A REGRA DA CASA: quem decide é a transação. Servidor que recusa
        # não pode virar "✓ Salvo".
        await pg.evaluate("""() => {
            SuincoSharePoint.gravarDestinoFrete = () => new Promise(
              (ok) => setTimeout(() => ok({ recusado: true, erro: 'sem conexão' }), 200));
          }""")
        await pg.fill('#frete-destino-nome', 'RECUSADO')
        await pg.fill('#frete-destino-km', '50')
        await pg.evaluate("() => { addDestinoFreteUI(); }")
        await pg.wait_for_timeout(1600)
        recusa = await pg.evaluate(
            "() => [...document.querySelectorAll('.notif-item')].map(n=>n.textContent).join(' ')")
        ck('recusa do servidor é dita em voz alta, não em silêncio',
           'NÃO foi salvo' in recusa, recusa[-90:])
        await pg.close()

        # ==============================================================
        print('\n=== 4. LINHA NOVA ENTRA DESLIZANDO DE CIMA ===')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)
        await pg.evaluate(SEMEAR, 4)
        await pg.evaluate("() => abrirTab('torre')")
        await pg.wait_for_timeout(900)

        # A PRIMEIRA PINTURA NÃO ANIMA. É a conferência que impede a boa
        # ideia de virar tremedeira: abrir a aba com 30 cargas não pode
        # fazer 30 linhas dançarem.
        primeiras = await pg.evaluate(
            "() => document.querySelectorAll('#torre-tbody tr.linha-nova').length")
        ck('abrir a aba com o pátio cheio NÃO faz as linhas dançarem',
           primeiras == 0, f'{primeiras} linhas animadas na primeira pintura')

        # E redesenhar as MESMAS linhas — que é o que a sincronia faz
        # sozinha o tempo todo — também não dispara nada.
        await pg.evaluate("() => renderAll()")
        await pg.wait_for_timeout(500)
        redesenho = await pg.evaluate(
            "() => document.querySelectorAll('#torre-tbody tr.linha-nova').length")
        ck('redesenhar as mesmas cargas (a sincronia) não anima nada',
           redesenho == 0, f'{redesenho} linhas animadas no redesenho')

        nova = await pg.evaluate("""() => {
            const agora = new Date();
            const c = { id: 'mv-nova', numeroCarga: 'MV-NOVA', placa: 'ZZZ9Z99',
              transportadora: 'Chegou agora', rota: '500', peso: 9000, sequencia: 99,
              status: 'Faturado', dataProgramacao: agora.toISOString().slice(0,10),
              criadaEm: agora.toISOString(), atualizadaEm: agora.toISOString() };
            DB.cargas.push(c);
            DB.movimentacoes.push({cargaId:c.id, status:'Faturado', quando:agora.toISOString(), operador:'Ana'});
            renderAll();
            const tr = document.querySelector('tr[data-carga="mv-nova"]');
            const cs = tr ? getComputedStyle(tr) : null;
            return { animadas: document.querySelectorAll('#torre-tbody tr.linha-nova').length,
                     nome: cs && cs.animationName, dur: cs && cs.animationDuration,
                     curva: cs && cs.animationTimingFunction }; }""")
        ck('a carga NOVA entra animada — e só ela',
           nova['animadas'] == 1, f"{nova['animadas']} linhas")
        ck('ela desliza de cima, com a curva da casa',
           nova['nome'] == 'movLinhaEntra' and 'cubic-bezier(0.23, 1, 0.32, 1)' in (nova['curva'] or ''),
           f"{nova['nome']} {nova['curva']}")
        ck('em 260 ms — abaixo do teto de 300',
           nova['dur'] in ('0.26s', '260ms'), str(nova['dur']))

        # NUNCA `scale(0)`: nada no mundo real aparece do nada.
        regras = await pg.evaluate("""() => {
            const achados = [];
            for (const folha of document.styleSheets) {
              let regras; try { regras = folha.cssRules; } catch(e) { continue; }
              for (const r of regras) {
                const t = r.cssText || '';
                if (/scale\\(\\s*0\\s*\\)/.test(t)) achados.push(t.slice(0,90));
                if (r.cssRules) for (const q of r.cssRules) {
                  const u = q.cssText || '';
                  if (/scale\\(\\s*0\\s*\\)/.test(u)) achados.push(u.slice(0,90));
                }
              }
            }
            return achados; }""")
        ck('nenhuma regra do painel usa scale(0) — nada aparece do nada',
           not regras, str(regras[:2]))
        await pg.close()

        # ==============================================================
        print('\n=== 5. O AVISO ENTRA E SAI PELO MESMO LADO ===')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)
        await pg.evaluate("() => { document.querySelectorAll('.notif-item').forEach(n=>n.remove()); "
                          "notify('Aviso de teste do movimento', 'success', 9000); }")
        await pg.wait_for_timeout(120)
        entrada = await pg.evaluate("""() => {
            const n = document.querySelector('.notif-item');
            const cs = getComputedStyle(n);
            return { nome: cs.animationName, dur: cs.animationDuration,
                     curva: cs.animationTimingFunction,
                     x: new DOMMatrix(cs.transform).m41 }; }""")
        ck('o aviso ENTRA animado, 320 ms, com a curva da casa',
           entrada['nome'] == 'movAvisoEntra' and entrada['dur'] in ('0.32s', '320ms')
           and 'cubic-bezier(0.23, 1, 0.32, 1)' in entrada['curva'],
           f"{entrada['nome']} {entrada['dur']} {entrada['curva']}")
        ck('e entra pela DIREITA — a borda onde a pilha de avisos mora',
           entrada['x'] > 0, f"x={entrada['x']:.0f}px")

        await pg.wait_for_timeout(600)
        await pg.click('.notif-fechar')
        await pg.wait_for_timeout(120)
        saida = await pg.evaluate("""() => {
            const n = document.querySelector('.notif-item');
            if (!n) return null;
            const cs = getComputedStyle(n);
            return { nome: cs.animationName, dur: cs.animationDuration,
                     x: new DOMMatrix(cs.transform).m41 }; }""")
        ck('ele SAI animado em vez de sumir no lugar', saida is not None and
           saida['nome'] == 'movAvisoSai', str(saida))
        ck('sai pelo MESMO lado por onde entrou — é o mesmo objeto indo embora',
           saida is not None and saida['x'] > 0, str(saida and round(saida['x'])))
        ck('e sai mais rápido do que entra (240 ms contra 320)',
           saida is not None and saida['dur'] in ('0.24s', '240ms'), str(saida and saida['dur']))
        await pg.wait_for_timeout(500)
        ck('e some de verdade no fim — não fica lixo na tela',
           await pg.evaluate("() => document.querySelectorAll('.notif-item').length") == 0)
        await pg.close()

        # ==============================================================
        print('\n=== 6. A ETAPA QUE SE CARIMBA ===')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)
        carimbo = await pg.evaluate("""() => {
            const dev = { id: 'dev-mov', tipo: 'DEVOLUCAO', status: 'Lançada',
              carimbos: { portaria: { por: 'Ana', em: new Date().toISOString() } } };
            const caixa = document.createElement('div');
            caixa.id = 'prova-carimbo';
            caixa.innerHTML = carimbosDev(dev);
            document.body.appendChild(caixa);
            const path = caixa.querySelector('.dev-carimbo-ok .dev-visto path');
            const cs = path ? getComputedStyle(path) : null;
            /* O MESMO carimbo, desenhado de novo: é o que a sincronia faz. */
            const denovo = document.createElement('div');
            denovo.innerHTML = carimbosDev(dev);
            return { tem: !!path, nome: cs && cs.animationName, dur: cs && cs.animationDuration,
                     repouso: cs && cs.strokeDashoffset,
                     novoNaPrimeira: caixa.querySelectorAll('.dev-carimbo-novo').length,
                     novoNaSegunda: denovo.querySelectorAll('.dev-carimbo-novo').length }; }""")
        ck('a etapa carimbada ganha um visto', carimbo['tem'], str(carimbo))
        ck('e o visto se DESENHA em 340 ms',
           carimbo['nome'] == 'movVistoDesenha' and carimbo['dur'] in ('0.34s', '340ms'),
           f"{carimbo['nome']} {carimbo['dur']}")
        ck('só o carimbo NOVO se desenha — o redesenho não recarimba tudo',
           carimbo['novoNaPrimeira'] == 1 and carimbo['novoNaSegunda'] == 0,
           f"primeira {carimbo['novoNaPrimeira']}, segunda {carimbo['novoNaSegunda']}")
        await pg.close()

        # ==============================================================
        print('\n=== 7. O PAPEL NÃO SE MEXE (o servidor gera o PDF com este CSS) ===')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)
        await pg.evaluate(SEMEAR, 3)
        await pg.evaluate("() => abrirTab('torre')")
        await pg.wait_for_timeout(700)
        # Põe TODAS as marcas de movimento na tela ao mesmo tempo e olha
        # como elas ficam no papel.
        #
        # A TABELA DE PROVA FICA FORA DAS ABAS. No papel, `.tab-page` inteira
        # é `display:none` — medir a linha da Torre ali responderia "zero de
        # altura" sempre, por um motivo que não tem nada a ver com movimento.
        # Uma tabela solta no corpo da página é a forma do documento de
        # verdade, e é onde a pergunta faz sentido.
        await pg.evaluate("""() => {
            const t = document.createElement('table');
            t.id = 'prova-papel-tabela';
            t.innerHTML = '<tbody><tr class="linha-seguiu-viagem linha-seguiu-viagem-fecha'
              + ' linha-nova"><td>Carga MV-9 — a que saiu</td>'
              + '<td><span>um pedaco</span></td></tr></tbody>';
            document.body.appendChild(t);
            const dev = { id:'d', tipo:'DEVOLUCAO', status:'Lançada',
              carimbos:{ portaria:{ por:'Ana', em:new Date().toISOString() } } };
            const caixa = document.createElement('div');
            caixa.id = 'prova-papel';
            caixa.innerHTML = carimbosDev(dev);
            document.body.appendChild(caixa);
            notify('aviso no papel', 'success', 60000);
          }""")
        await pg.emulate_media(media='print')
        await pg.wait_for_timeout(300)
        papel = await pg.evaluate("""() => {
            const tr = document.querySelector('#prova-papel-tabela tr');
            const td = tr.querySelector('td');
            const path = document.querySelector('#prova-papel .dev-visto path');
            const av = document.querySelector('.notif-item');
            const btn = document.querySelector('[data-segurar]');
            const ler = (el, pseudo) => { if (!el) return null;
              const c = getComputedStyle(el, pseudo || null);
              return { anim: c.animationName, trans: c.transitionProperty,
                       op: Number(c.opacity), tr: c.transform, disp: c.display,
                       off: c.strokeDashoffset, filtro: c.filter }; };
            return { linha: ler(tr), celula: ler(td), visto: ler(path),
                     aviso: av ? ler(av) : null,
                     barra: btn ? ler(btn, '::after') : null,
                     alturaLinha: tr.getBoundingClientRect().height,
                     textoVisivel: td.getBoundingClientRect().height > 8
                       && getComputedStyle(td).fontSize !== '0px' }; }""")

        for nome, e in (('a linha da carga', papel['linha']), ('a célula', papel['celula']),
                        ('o visto do checklist', papel['visto'])):
            # `None` aqui quer dizer que o elemento nem existe — num painel
            # sem o movimento é o que acontece, e não é aprovação.
            ck(f'no papel, {nome} não anima', bool(e) and e['anim'] == 'none',
               'não existe' if not e else str(e['anim']))
            ck(f'no papel, {nome} não transiciona',
               bool(e) and (e['trans'] in ('none', 'all') or e['trans'] == ''),
               'não existe' if not e else str(e['trans']))
        # ISTO É A OCORRÊNCIA #72 EM MINIATURA: estado de repouso invisível
        # no papel sai como espaço em branco. Nenhum elemento pode depender
        # de uma animação para aparecer.
        ck('no papel, NADA nasce transparente (senão sai branco)',
           papel['linha']['op'] == 1 and papel['celula']['op'] == 1
           and (papel['aviso'] is None or papel['aviso']['op'] == 1),
           f"linha={papel['linha']['op']} célula={papel['celula']['op']}")
        ck('no papel, NADA nasce deslocado',
           papel['linha']['tr'] == 'none' and papel['celula']['tr'] == 'none',
           f"{papel['linha']['tr']} / {papel['celula']['tr']}")
        ck('no papel, o visto sai DESENHADO (dashoffset zero)',
           bool(papel['visto'])
           and float(str(papel['visto']['off'] or 0).replace('px', '')) == 0,
           'não existe' if not papel['visto'] else str(papel['visto']['off']))
        # ISTO É O CORAÇÃO DA SEÇÃO. Linha com zero de altura no documento
        # é uma faixa em branco no lugar de um registro — exatamente o
        # formato da ocorrência #72.
        ck('no papel, a linha continua tendo altura — não sai como faixa em branco',
           papel['alturaLinha'] > 8, f"{papel['alturaLinha']:.0f}px")
        ck('no papel, o conteúdo da linha continua legível',
           papel['textoVisivel'], str(papel['textoVisivel']))
        ck('no papel, a barra de segurar não existe',
           papel['barra'] is None or papel['barra']['disp'] == 'none',
           str(papel['barra'] and papel['barra']['disp']))
        await pg.emulate_media(media='screen')
        await pg.close()

        # ==============================================================
        print('\n=== 8. QUEM PEDIU MENOS MOVIMENTO RECEBE MENOS ===')
        ctx = await nav.new_context(viewport={'width': 1400, 'height': 900},
                                    reduced_motion='reduce')
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg)
        cargas = await pg.evaluate(SEMEAR, 3)
        await pg.evaluate("() => abrirTab('torre')")
        await pg.wait_for_timeout(700)
        parado = await pg.evaluate("""() => {
            const tr = document.querySelector('#torre-tbody tr[data-carga]');
            tr.classList.add('linha-nova', 'linha-seguiu-viagem');
            const c = getComputedStyle(tr.querySelector('td'));
            const l = getComputedStyle(tr);
            return { anim: l.animationName, tr: c.transform, op: Number(c.opacity) }; }""")
        ck('com movimento reduzido, a linha não desliza nem some',
           parado['anim'] == 'none' and parado['tr'] == 'none' and parado['op'] == 1,
           str(parado))
        # E o painel continua INTEIRO: a ação não pode ficar presa atrás de
        # uma animação que não vai acontecer.
        pg.once('dialog', lambda d: asyncio.ensure_future(d.accept('sem movimento')))
        await pg.click('#torre-tbody tr .btn-danger')
        await pg.wait_for_timeout(1200)
        ck('e o cancelar continua funcionando com um clique só',
           await pg.evaluate("() => DB.cargas.length") == 2,
           str(await pg.evaluate("() => DB.cargas.length")))
        await ctx.close()

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
