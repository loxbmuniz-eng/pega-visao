#!/usr/bin/env python3
"""Sessão vencida não grava no vazio, e tem o caminho de volta (31/08/2026).

O RELATO. Print do celular do Rene da Expedição, mandado pelo dono. Na tela:
a faixa vermelha "VOCÊ ESTÁ OFFLINE — SISTEMA INDISPONÍVEL", os botões
"Iniciar Embarque" e "Finalizar Embarque", a carga 118495 da placa MMJ9E91 —
e, no alto do aparelho, o indicador de **5G**. Ele não estava offline.

No rodapé, em letra pequena: "Sem conexão com o servidor — entre de novo
para voltar a compartilhar". Esse é o texto do estado `local`, e é o que
denuncia o que tinha acontecido de verdade: a SESSÃO dele venceu.

O QUE SE MEDIU antes de mexer, com a sessão vencida:

    configurado: False        estado: local
    respostaDoUpsert: {'enfileirado': False}    <- nenhuma recusa
    cargaFicouNaTela: True    cargasDepois: 1
    filaOffline: 0            avisoNaTela: False

Ou seja: carga criada, guardada só no aparelho, nada enviado, nada
enfileirado, nada dito. O operador trabalha a tarde inteira gravando no
vácuo — que é EXATAMENTE o incidente do Alysson de 31/08 ("alterei no
computador e ao acessar pelo celular o sistema reverteu todas as
alterações"), e exatamente o que a trava de offline existe para impedir.

POR QUE A TRAVA NÃO PEGAVA. Ela cobre "a rede caiu". Não cobria "a sessão
venceu" — e no pátio esse é o caso MUITO mais comum, porque o token mora em
sessionStorage e morre quando a aba fecha; no celular o Android descarta aba
em segundo plano o tempo todo. Sem token, `estaConfigurado()` responde não e
os cinco caminhos de escrita saíam com `{enfileirado:false}`, calados.

O QUE ESTE TESTE EXIGE:

  1. com a sessão vencida, a gravação é RECUSADA — e a recusa diz que foi a
     sessão, não a rede;
  2. nada fica guardado para subir depois: a fila continua vazia;
  3. a faixa diz SESSÃO EXPIROU, não OFFLINE, e afirma que o aparelho tem
     internet — senão a pessoa vai procurar sinal que não falta;
  4. a faixa tem o botão de entrar de novo, com alvo de toque de 44px, e ele
     ABRE a tela de login. Botão que só nega não ensina o caminho;
  5. quem escolheu "Entrar sem servidor" NÃO é afetado: modo local é decisão
     de quem usa, não acidente.

Roda sem servidor.

    python3 testes/test_sessao_vencida.py
"""
import asyncio
import sys

from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def painel(nav, larg=740, alt=360):
    """Abre e entra em modo local (é só o esqueleto; cada bloco ajusta depois)."""
    ctx = await nav.new_context(viewport={'width': larg, 'height': alt})
    pg = await ctx.new_page()
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(900)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Rene')
    await pg.select_option('#login-setor', 'Expedição')
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(500)
    return ctx, pg


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        erros = []

        print('\n=== 1. SESSÃO VENCIDA: A GRAVAÇÃO É RECUSADA, E DIZ POR QUÊ ===')
        ctx, pg = await painel(nav)
        pg.on('pageerror', lambda e: erros.append(str(e)))
        r = await pg.evaluate("""async () => {
            // O ESTADO DO RENE: entrou PELO SERVIDOR (por isso a marca) e
            // depois ficou sem token — aba descartada ou 401.
            localStorage.setItem('suinco_entrou_pelo_servidor', '1');
            SuincoSharePoint.SP_CONFIG.ativo = true;
            SuincoSharePoint.SP_CONFIG.api = 'http://127.0.0.1:59999';
            sessionStorage.removeItem('suinco_token');
            DB.operador = { id:'u1', nome:'Rene', setor:'Expedição',
                            email:'rene@suinco.com.br' };
            const c = criarCargaProgramada({ placa: DB.frota[0].placa,
              numeroCarga:'SESSAO-1', peso:9000, rota:'500', operador:'Rene' });
            const resp = await SuincoSharePoint.upsert('cargas', 'x',
              { ID: c.id, Placa: c.placa, Numero_Carga: 'SESSAO-1' }, 'Rene');
            await new Promise(r => setTimeout(r, 1200));
            return { sessaoPerdida: SuincoSharePoint.sessaoPerdida(),
                     resp, fila: SuincoSharePoint.pendentes() };
        }""")
        ck('o painel reconhece que a sessão se perdeu', r['sessaoPerdida'] is True, str(r))
        ck('a gravação é RECUSADA (não sai calada)',
           bool(r['resp'] and r['resp'].get('recusado')), str(r['resp']))
        ck('e a recusa diz que foi a SESSÃO, não a rede',
           bool(r['resp'] and r['resp'].get('sessaoExpirada')), str(r['resp']))
        ck('a fila continua VAZIA — nada guardado para subir depois',
           r['fila'] == 0, f"fila={r['fila']}")

        print('\n=== 2. A FAIXA DIZ A VERDADE ===')
        faixa = await pg.evaluate("""() => {
            atualizarFaixaOffline('local');
            const f = document.getElementById('faixa-offline');
            return f ? f.innerText.toUpperCase().replace(/\\s+/g,' ') : null;
        }""")
        ck('a faixa existe', bool(faixa), str(faixa))
        if faixa:
            ck('ela diz SESSÃO EXPIROU', 'SESSÃO EXPIROU' in faixa, faixa[:130])
            ck('ela NÃO diz que a pessoa está offline',
               'VOCÊ ESTÁ OFFLINE' not in faixa, faixa[:130])
            ck('ela avisa que o aparelho TEM internet',
               'INTERNET' in faixa, faixa[:170])

        print('\n=== 3. O CAMINHO DE VOLTA ESTÁ NA FAIXA, E FUNCIONA ===')
        botao = await pg.evaluate("""() => {
            const b = document.querySelector('#faixa-offline .faixa-offline-btn');
            if(!b) return { semBotao: true };
            const q = b.getBoundingClientRect();
            return { texto: b.innerText.trim(), altura: Math.round(q.height),
                     visivel: q.width > 0 && q.height > 0 };
        }""")
        ck('a faixa tem o botão de entrar de novo',
           not botao.get('semBotao'), str(botao))
        if not botao.get('semBotao'):
            ck('o alvo de toque tem 44px ou mais (pátio, luva, uma mão só)',
               botao['altura'] >= 44, f"{botao['altura']}px")
            await pg.click('#faixa-offline .faixa-offline-btn')
            await pg.wait_for_timeout(600)
            abriu = await pg.evaluate("""() => ({
                loginAberto: document.getElementById('modal-operador')
                               .classList.contains('open'),
                campoEmailVisivel: !document.getElementById('login-servidor').hidden,
                faixaSaiu: !document.getElementById('faixa-offline')
            })""")
            ck('clicar abre a tela de login', abriu['loginAberto'], str(abriu))
            ck('com o formulário do servidor à mostra', abriu['campoEmailVisivel'], str(abriu))
            ck('e a faixa sai da frente para não atrapalhar de novo',
               abriu['faixaSaiu'], str(abriu))
        await ctx.close()

        print('\n=== 4. MODO LOCAL DE PROPÓSITO CONTINUA FUNCIONANDO ===')
        # Quem escolheu "Entrar sem servidor" nunca marcou entrada pelo
        # servidor. A trava não pode confundir decisão com acidente.
        ctx2, pg2 = await painel(nav)
        pg2.on('pageerror', lambda e: erros.append(str(e)))
        local = await pg2.evaluate("""async () => {
            const c = criarCargaProgramada({ placa: DB.frota[0].placa,
              numeroCarga:'LOCAL-1', peso:9000, rota:'500', operador:'Rene' });
            const resp = await SuincoSharePoint.upsert('cargas','x',
              { ID: c.id, Placa: c.placa, Numero_Carga:'LOCAL-1' }, 'Rene');
            return { sessaoPerdida: SuincoSharePoint.sessaoPerdida(), resp,
                     carga: DB.cargas.some(x => x.numeroCarga === 'LOCAL-1') };
        }""")
        ck('modo local NÃO é tratado como sessão perdida',
           local['sessaoPerdida'] is False, str(local))
        ck('e a gravação local não é recusada',
           not (local['resp'] or {}).get('recusado'), str(local['resp']))
        ck('a carga continua na tela de quem escolheu o modo local',
           local['carga'], str(local))
        await ctx2.close()

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


sys.exit(asyncio.run(main()))
