#!/usr/bin/env python3
"""Sessão sobrevive à aba reciclada; quem some de verdade (14h) é descartado
NA ABERTURA (decisão do dono, 12/09/2026).

A CAUSA, já fechada — não reinvestigar aqui.

O token mora em `sessionStorage` (`suinco-api.js`, `lerToken`/`guardarToken`/
`limparToken`). `sessionStorage` morre quando a aba fecha OU quando o sistema
reaproveita a aba em segundo plano — rotina no Android. Nesse instante não há
requisição nenhuma, então o servidor não vê nada: journal do VPS em 7 dias,
**1** sessão recusada (legítima), **0** token inválido, **0** falha de
conferência, com `JWT_VALIDADE=12h`. Quem apaga a sessão é o próprio
aparelho — não o servidor, e não a rede.

A DECISÃO DO DONO, nas palavras dele: *"portaria fica sempre aberto,
faturamento tambem, expedicao tambem, os demais logam em horario de
expediente normalmente, alysson loga do celular 24 horas, e fica ligado com
notificacoes push entao preciso que seja o minimo de impacto no
funcionamento disso"*. Disso saem três mudanças:

  1. o token sai de `sessionStorage` — passa a sobreviver ao fechamento e à
     reciclagem da aba;
  2. quem passa a proteger a troca de turno é o TEMPO SEM NINGUÉM MEXER, não
     mais a aba: 14 horas sem interação, descartada NA ABERTURA (não precisa
     esperar o temporizador de renovação, que é de 3h);
  3. o contador de última interação (`ultimaInteracao`, hoje só variável de
     memória — `let ultimaInteracao = Date.now()`) TAMBÉM precisa sobreviver
     à reciclagem. Sem isso, reabrir a aba reinicia o contador para "agora" e
     as 14h nunca vencem — a proteção do item 2 fica de fachada. É a parte
     mais importante desta guarda (item 4 abaixo), e é por isso que ela mede
     o VALOR do contador, não só o efeito dele.

O QUE NÃO PODE REGREDIR:

  - "Trocar usuário" (`trocarUsuario()` → `SuincoSharePoint.sair()`) precisa
    continuar apagando a sessão NA HORA — é o jeito certo de passar a
    estação para o próximo turno, logo é ele quem segura a regra de terminal
    compartilhado agora que a aba sozinha não protege mais nada;
  - a proteção de 31/08/2026 (ocorrência #24/#25 — o caso do Rene da
    Expedição, "SESSÃO PERDIDA NÃO É MODO LOCAL"): sem token em lugar
    nenhum, uma gravação NUNCA pode sair calada — tem que recusar e avisar;
  - nada no servidor muda (validade de 12h, renovação de 3h).

CONTRATO QUE ESTA GUARDA EXIGE DA CORREÇÃO (porque ela só pode ser escrita
depois, e não dá para medir "o valor do contador" sem um jeito de lê-lo):

  - o token persistido continua na MESMA chave, `suinco_token` — só muda de
    `sessionStorage` para `localStorage`. É a leitura mínima da frase do
    dono ("sai de sessionStorage"); se a implementação usar outra chave,
    troque a constante abaixo e diga por quê no relato de entrega;
  - existe `SuincoSharePoint.ultimaInteracaoEm()`, devolvendo o timestamp
    (ms) da última interação persistida — sem isso só dá para medir o
    EFEITO (expulsou/não expulsou), nunca o valor, e aí o item 2 abaixo pode
    "passar" por acidente mesmo se o contador reiniciar a cada reload, que é
    exatamente o jeito mais provável de a correção voltar pela metade.

O QUE ESTE TESTE EXIGE, e por quê cada bloco existe:

  1. com o token guardado, simular a reciclagem (apaga sessionStorage, mantém
     localStorage, recarrega) deixa o operador LOGADO — hoje cai pro login;
  2. mais de 14h sem interação: reabrir EXIGE login, mesmo com o token vivo
     na forma nova — a proteção de turno não pode ficar de fachada;
  3. dentro de 14h (13h de exemplo): reabrir continua logado — a régua não
     pode ser mais curta do que o dono pediu;
  4. o contador de interação sobrevive à reciclagem SEM voltar pra "agora" —
     medido pelo valor, com o relógio real andando entre a marca e a
     reabertura, não só pelo efeito;
  5. "Trocar usuário" continua apagando na hora — depois dele, reabrir exige
     login mesmo bem dentro das 14h;
  6. sem token em lugar nenhum (nem na chave antiga, nem na nova), a
     gravação continua RECUSADA e avisando que foi a sessão — a regra de
     31/08 não pode voltar a furar por este caminho;
  7. o mesmo em viewport de celular — é o caso do Alysson.

NENHUMA REQUISIÇÃO REAL SOBE PARA api.embarquesuinco.com.br: o build aponta
pra lá por padrão (`SP_CONFIG.api`) e isso sobrevive a qualquer reload porque
é constante no arquivo — por isso o bloqueio é feito no CONTEXTO do
navegador (`context.route`), não mexendo no `SP_CONFIG` em memória (que se
perde exatamente no reload que cada bloco provoca).

IDEMPOTENTE por construção: cada bloco abre um contexto de navegador NOVO
(Playwright isola localStorage/sessionStorage por contexto) e o fecha ao
final. Não toca no Postgres, não precisa de servidor — roda em `file://`,
igual a `test_sessao_vencida.py` e `test_offline_nao_grava.py`.

    python3 testes/test_sessao_sobrevive_reciclagem.py
"""
import asyncio
import sys

from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
DOMINIO_PRODUCAO = 'https://api.embarquesuinco.com.br'
CHAVE_TOKEN = 'suinco_token'          # contrato: mesma chave, storage novo
JANELA_INATIVIDADE_H = 14             # decisão do dono, 12/09/2026

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def nova_pagina(nav, largura=1440, altura=900):
    """Contexto novo e isolado, com a produção bloqueada em TODA navegação
    deste contexto — inclusive os reloads que os blocos abaixo provocam.
    O .js estático do socket.io segue liberado: é biblioteca pública, sem
    dado, e é o mesmo tratamento que os testes já existentes dão a ele."""
    ctx = await nav.new_context(viewport={'width': largura, 'height': altura})

    async def bloquear(route):
        if 'socket.io.js' in route.request.url:
            await route.continue_()
        else:
            await route.abort()

    await ctx.route(f'{DOMINIO_PRODUCAO}/**', bloquear)
    pg = await ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(900)
    return ctx, pg, erros


async def logar_como(pg, nome, setor, email, token):
    """Planta o estado de 'já entrou pelo servidor, sessão viva' na chave
    NOVA (localStorage) e garante que a antiga (sessionStorage) está vazia —
    não sobra token em lugar nenhum que não seja o contrato desta guarda."""
    await pg.evaluate(
        """([nome, setor, email, token, chave]) => {
            DB.operador = { id: 'u-' + nome, nome, setor, email };
            SuincoStore.save();
            localStorage.setItem('suinco_entrou_pelo_servidor', '1');
            localStorage.setItem(chave, token);
            sessionStorage.removeItem(chave);
            SuincoSharePoint.registrarInteracao();
        }""",
        [nome, setor, email, token, CHAVE_TOKEN],
    )


async def estado_da_tela(pg):
    return await pg.evaluate(
        """() => ({
            preLogin: document.body.classList.contains('pre-login'),
            loginAberto: document.getElementById('modal-operador').classList.contains('open'),
            temSessao: typeof temSessaoParaOPainel === 'function' ? temSessaoParaOPainel() : null,
        })"""
    )


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        erros_js = []

        # ------------------------------------------------------------------
        print('\n=== 1. SESSÃO SOBREVIVE À ABA RECICLADA ===')
        # A reciclagem de verdade: o Android mata a aba em segundo plano, e
        # o que sobra quando ela volta é só o que estava em localStorage.
        # sessionStorage nunca sobrevive a isso — não é isso que mudou; o
        # que mudou é ONDE o token mora.
        ctx, pg, erros = await nova_pagina(nav)
        await logar_como(pg, 'Alysson', 'Faturamento', 'alysson@suinco.com.br',
                          'tok-reciclagem-1')
        await pg.evaluate("() => sessionStorage.clear()")
        await pg.reload()
        await pg.wait_for_timeout(1500)
        r = await estado_da_tela(pg)
        ck('depois da reciclagem, o painel reconhece que TEM sessão',
           r['temSessao'] is True, str(r))
        ck('e revela a tela de trabalho — NÃO cai para o login',
           r['preLogin'] is False and r['loginAberto'] is False, str(r))
        erros_js += erros
        await ctx.close()

        # ------------------------------------------------------------------
        print('\n=== 2. ABANDONO DE VERDADE (>14h) AINDA EXPULSA, NA ABERTURA ===')
        # Se a correção só mover o token de storage e esquecer a régua de
        # 14h, este bloco é o único dos sete que pega isso: sem ele, uma
        # sessão persistida vale para sempre, que é exatamente o "ponto sem
        # nó" que o dono não quer num terminal de pátio compartilhado.
        ctx, pg, erros = await nova_pagina(nav)
        await logar_como(pg, 'Bruna', 'Faturamento', 'bruna@suinco.com.br',
                          'tok-abandono-1')
        t0 = await pg.evaluate("() => Date.now()")
        await pg.evaluate("() => sessionStorage.clear()")
        depois_de_14h30 = t0 + int((JANELA_INATIVIDADE_H + 0.5) * 3600 * 1000)
        await pg.add_init_script(f"Date.now = () => {depois_de_14h30};")
        await pg.reload()
        await pg.wait_for_timeout(1500)
        r = await estado_da_tela(pg)
        ck(f'mais de {JANELA_INATIVIDADE_H}h sem ninguém mexer: descartada JÁ NA ABERTURA '
           '(não espera o temporizador de 3h)',
           r['preLogin'] is True and r['temSessao'] is False, str(r))
        erros_js += erros
        await ctx.close()

        # ------------------------------------------------------------------
        print('\n=== 3. DENTRO DE 14h (13h), NÃO EXPULSA ===')
        # O contrapeso do bloco 2: sem ele, bastaria qualquer número grande
        # de horas para "passar" o bloco 2 — inclusive uma régua curta
        # demais (4h, por exemplo, que é a de HOJE para a renovação, não
        # para a reabertura) que expulsaria o Alysson no meio do uso normal.
        ctx, pg, erros = await nova_pagina(nav)
        await logar_como(pg, 'Carla', 'Faturamento', 'carla@suinco.com.br',
                          'tok-dentro-janela-1')
        t0 = await pg.evaluate("() => Date.now()")
        await pg.evaluate("() => sessionStorage.clear()")
        depois_de_13h = t0 + 13 * 3600 * 1000
        await pg.add_init_script(f"Date.now = () => {depois_de_13h};")
        await pg.reload()
        await pg.wait_for_timeout(1500)
        r = await estado_da_tela(pg)
        ck('com 13h sem mexer (dentro da janela de 14h), continua logado',
           r['preLogin'] is False and r['temSessao'] is True, str(r))
        erros_js += erros
        await ctx.close()

        # ------------------------------------------------------------------
        print('\n=== 4. O CONTADOR DE INTERAÇÃO SOBREVIVE, SEM VOLTAR PARA "AGORA" ===')
        # A PARTE MAIS IMPORTANTE. Mede o VALOR, não o efeito: deixa o
        # relógio real andar uns segundos antes de reciclar, e confere que o
        # timestamp lido depois é O MESMO de antes — não um valor próximo do
        # momento da reabertura. Se o contador reiniciasse a cada reload
        # (hoje ele reinicia: é variável de memória, `let ultimaInteracao =
        # Date.now()`), o bloco 2 nunca aconteceria na vida real, porque toda
        # reabertura zeraria o relógio da inatividade.
        ctx, pg, erros = await nova_pagina(nav)
        await logar_como(pg, 'Dario', 'Faturamento', 'dario@suinco.com.br',
                          'tok-contador-1')
        tem_getter = await pg.evaluate(
            "() => typeof SuincoSharePoint.ultimaInteracaoEm === 'function'")
        ck('existe um jeito de LER o valor do contador '
           '(SuincoSharePoint.ultimaInteracaoEm)', tem_getter,
           'sem isso só dá para medir o EFEITO — e o bloco 2 pode "passar" por '
           'acidente mesmo com o contador reiniciando a cada reload')
        if tem_getter:
            t_antes = await pg.evaluate("() => SuincoSharePoint.ultimaInteracaoEm()")
            await pg.wait_for_timeout(4000)   # tempo real passando, de propósito
            await pg.evaluate("() => sessionStorage.clear()")
            await pg.reload()
            await pg.wait_for_timeout(1200)
            tem_getter_depois = await pg.evaluate(
                "() => typeof SuincoSharePoint.ultimaInteracaoEm === 'function'")
            if tem_getter_depois:
                t_depois = await pg.evaluate("() => SuincoSharePoint.ultimaInteracaoEm()")
                diferenca = abs(t_depois - t_antes)
                ck('o valor NÃO voltou para "agora" — persistiu de verdade através do reload',
                   diferenca < 1500,
                   f'antes={t_antes} depois={t_depois} diferença={diferenca}ms '
                   '(se tivesse reiniciado, a diferença seria ~4000ms, o tempo que esperamos)')
            else:
                ck('o contador continua legível depois do reload', False,
                   'a função existia antes do reload e desapareceu depois')
        else:
            ck('contador sobrevive à reciclagem sem voltar para "agora"', False,
               'não foi possível medir — função ausente; parando aqui (falhar rápido)')
        erros_js += erros
        await ctx.close()

        # ------------------------------------------------------------------
        print('\n=== 5. "TROCAR USUÁRIO" CONTINUA APAGANDO NA HORA ===')
        # Agora que a aba sozinha não protege mais nada, ESTE botão é quem
        # garante a troca de turno no terminal compartilhado. Se ele parar
        # de limpar a chave nova, o próximo operador herda a sessão de quem
        # saiu — o problema que a troca de usuário existe para evitar.
        ctx, pg, erros = await nova_pagina(nav)
        await logar_como(pg, 'Elaine', 'Logística', 'elaine@suinco.com.br',
                          'tok-trocar-1')
        await pg.evaluate("() => trocarUsuario()")
        await pg.wait_for_timeout(600)
        await pg.reload()
        await pg.wait_for_timeout(1200)
        r = await estado_da_tela(pg)
        ck('depois de "Trocar usuário", reabrir EXIGE login mesmo bem dentro das 14h',
           r['preLogin'] is True and r['loginAberto'] is True, str(r))
        erros_js += erros
        await ctx.close()

        # ------------------------------------------------------------------
        print('\n=== 6. A REGRA DE 31/08 CONTINUA DE PÉ: SEM TOKEN, NÃO GRAVA CALADO ===')
        # O caso do Rene da Expedição (#24/#25): quem entrou pelo servidor e
        # ficou sem token NUNCA pode ter a gravação saindo silenciosa — tem
        # que recusar e avisar que foi a sessão. Tira o token das DUAS
        # chaves (a antiga e a nova) para não deixar nenhuma porta de saída.
        ctx, pg, erros = await nova_pagina(nav)
        await pg.evaluate(
            """([chave]) => {
                localStorage.setItem('suinco_entrou_pelo_servidor', '1');
                SuincoSharePoint.SP_CONFIG.ativo = true;
                SuincoSharePoint.SP_CONFIG.api = 'http://127.0.0.1:59999';
                localStorage.removeItem(chave);
                sessionStorage.removeItem(chave);
                DB.operador = { id: 'u-rene', nome: 'Rene', setor: 'Expedição',
                                email: 'rene@suinco.com.br' };
            }""",
            [CHAVE_TOKEN],
        )
        r = await pg.evaluate(
            """async () => {
                const c = criarCargaProgramada({ placa: DB.frota[0].placa,
                  numeroCarga: 'GUARDA-SESSAO-1', peso: 9000, rota: '500',
                  operador: 'Rene' });
                const resp = await SuincoSharePoint.upsert('cargas', 'x',
                  { ID: c.id, Placa: c.placa, Numero_Carga: 'GUARDA-SESSAO-1' }, 'Rene');
                return { sessaoPerdida: SuincoSharePoint.sessaoPerdida(), resp,
                         fila: SuincoSharePoint.pendentes() };
            }"""
        )
        ck('sem token em lugar nenhum, o painel reconhece a sessão perdida',
           r['sessaoPerdida'] is True, str(r))
        ck('a gravação é RECUSADA — nunca sai calada',
           bool(r['resp'] and r['resp'].get('recusado')), str(r['resp']))
        ck('e a recusa diz que foi a SESSÃO, não a rede',
           bool(r['resp'] and r['resp'].get('sessaoExpirada')), str(r['resp']))
        ck('a fila continua VAZIA — nada fica pra subir escondido depois',
           r['fila'] == 0, f"fila={r['fila']}")
        erros_js += erros
        await ctx.close()

        # ------------------------------------------------------------------
        print('\n=== 7. NO CELULAR (CASO DO ALYSSON): A SESSÃO TAMBÉM SOBREVIVE ===')
        # Ele loga do celular 24h, com notificação push ligada — é o
        # cenário que a decisão do dono cita por nome. Confirma a mesma
        # garantia do bloco 1 num viewport de telefone em pé, e que a tela
        # revelada não estoura a largura do aparelho.
        ctx, pg, erros = await nova_pagina(nav, largura=390, altura=844)
        await logar_como(pg, 'Alysson', 'Faturamento', 'alysson@suinco.com.br',
                          'tok-celular-1')
        await pg.evaluate("() => sessionStorage.clear()")
        await pg.reload()
        await pg.wait_for_timeout(1500)
        r = await pg.evaluate(
            """() => ({
                preLogin: document.body.classList.contains('pre-login'),
                temSessao: typeof temSessaoParaOPainel === 'function' ? temSessaoParaOPainel() : null,
                scrollW: document.documentElement.scrollWidth,
                clientW: document.documentElement.clientWidth,
            })"""
        )
        ck('no celular, depois da reciclagem, continua logado — não é só no desktop',
           r['temSessao'] is True and r['preLogin'] is False, str(r))
        ck('e a tela revelada não estoura a largura do aparelho',
           r['scrollW'] <= r['clientW'] + 1, str(r))
        erros_js += erros
        await ctx.close()

        ck('nenhum erro de JavaScript em nenhum bloco', not erros_js,
           '; '.join(erros_js[:4]))
        await nav.close()

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


sys.exit(asyncio.run(main()))
