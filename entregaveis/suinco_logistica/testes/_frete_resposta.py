"""Responder a pergunta do frete como a pessoa responde (06/10/2026).

Desde a ocorrência #115, toda contratação (placa entrando) PERGUNTA a
observação do frete: TABELA ou COMBINADO com o valor. As suítes que criam ou
completam carga pela tela, e que não testam o frete, usam isto logo depois
do clique que contrata — marcam TABELA e confirmam, pela tela.

Uma função, todos os chamadores: se a pergunta mudar de forma, muda aqui.
"""


async def responder_frete(pg, obs='TABELA', valor=None, espera=400):
    """Se a pergunta do frete estiver aberta, responde e devolve True."""
    await pg.wait_for_timeout(espera)
    if not await pg.is_visible('#modal-frete-contratar.open'):
        return False
    await pg.check('#frete-c-tabela' if obs == 'TABELA' else '#frete-c-combinado')
    if valor is not None:
        await pg.fill('#frete-c-valor', valor)
    await pg.click('#frete-c-confirmar')
    await pg.wait_for_timeout(espera)
    return True
