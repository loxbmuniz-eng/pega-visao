"""Responder a PERGUNTA DO PAINEL como a pessoa responde (08/10/2026).

Desde o Lote 2 do /impeccable (ocorrência #122), o painel não usa mais as
caixas do navegador (prompt/confirm): toda ação que pede certeza, senha ou
motivo abre a janela própria #modal-pergunta (app/15_pergunta.js). As
suítes que antes trocavam `window.confirm`/`window.prompt` por um atalho
agora respondem pela tela: digitam no campo e clicam no botão.

Uma função, todos os chamadores: se a pergunta mudar de forma, muda aqui.

Quando a ação é chamada DENTRO de um `evaluate` que espera o resultado
(`await algumaCoisaUI()`), o `await` ficaria parado na pergunta. O jeito:
disparar sem esperar, responder, e só então esperar —

    await pg.evaluate("(id) => { window.__acao = corrigirKmDaCargaUI(id, '640'); }", id)
    await responder_pergunta(pg)
    await pg.evaluate("() => window.__acao")
"""


async def responder_pergunta(pg, texto=None, confirmar=True, espera=400, prazo=4000):
    """Se a pergunta abrir, responde e devolve o TEXTO que ela mostrou
    (título, explicação e lista). Devolve None se nenhuma pergunta abriu
    dentro do prazo."""
    try:
        await pg.wait_for_selector('#modal-pergunta.open', timeout=prazo)
    except Exception:
        return None
    mostrou = await pg.inner_text('#modal-pergunta .pergunta-box')
    if texto is not None:
        await pg.fill('#pergunta-campo', texto)
    await pg.click('#pergunta-ok' if confirmar else '#pergunta-cancelar')
    await pg.wait_for_timeout(espera)
    return mostrou


async def pergunta_aberta(pg):
    """A pergunta está na tela agora?"""
    return await pg.is_visible('#modal-pergunta.open')


async def com_resposta(pg, funcao_js, arg=None, texto=None, confirmar=True, prazo=2000):
    """Roda `funcao_js` (uma função JS, normalmente async, que faz a ação e
    devolve o que o teste quer medir), responde a pergunta pela tela se ela
    abrir no caminho, e devolve (resultado, texto_que_a_pergunta_mostrou).

    É o `evaluate` de sempre, só que sem travar na pergunta: a ação é
    disparada, a pessoa responde, e então o resultado é lido."""
    await pg.evaluate(
        f"(arg) => {{ window.__acaoComPergunta = Promise.resolve(({funcao_js})(arg)); }}", arg)
    mostrou = await responder_pergunta(pg, texto=texto, confirmar=confirmar, prazo=prazo)
    resultado = await pg.evaluate("() => window.__acaoComPergunta")
    return resultado, mostrou
