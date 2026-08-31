#!/usr/bin/env python3
"""Offline não grava nada. Nem guarda para mandar depois. (31/08/2026)

A DECISÃO, do dono, nas palavras dele:

    "Aceitar a alteração e gravação só on line. Offline não. (...) se estiver
     conectado aceita alteração, aceita inclusão, aceita qualquer coisa. Off
     Line não tem conversa não!"

E a razão que ele deu, que é a regra certa de sistema compartilhado:

    "a proposta do off line funciona quando você tem operações que são
     específicas de UM usuário (...) você bipa 10 notas, essas notas estão
     com você, ninguém não vai mexer. Agora as cargas um monte de gente
     mexe (...) dados compartilhados você não pode tratar com isso porque
     senão pode dar sobreposição."

O QUE ISSO FECHA — duas perdas de trabalho em três dias:

  · 29/08 — o relatório do Everaldo desfez as correções do Alysson;
  · 31/08 — o Alysson: "alterei no computador (...) ao acessar pelo celular,
    o sistema reverteu todas as alterações e restaurou a configuração
    anterior do telefone, sobrescrevendo o que eu tinha acabado de fazer".

Nos dois casos o mecanismo foi o mesmo: um aparelho com cópia velha subiu a
fila offline por cima do que os outros já tinham feito.

O QUE ESTE TESTE EXIGE:

  1. offline, a gravação é RECUSADA — e a fila continua vazia. Nada fica
     guardado para subir depois;
  2. a recusa CHEGA no operador, com o texto que o dono pediu;
  3. a faixa de alerta aparece na tela e some quando volta a conexão;
  4. fila que já estava no aparelho é descartada na abertura, e o painel
     DIZ o que foi descartado — jogar trabalho fora calado é pior que o
     defeito que estamos consertando.

    python3 testes/test_offline_nao_grava.py
"""
import asyncio
import os
import sys

from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        ctx = await nav.new_context(viewport={'width': 1280, 'height': 900})
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        html = open(PAINEL_ARQ, encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = f'{API}/__offline'
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        await pg.wait_for_selector('#login-email', timeout=25000)
        await pg.fill('#login-email', 'chefe@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(3000)

        print('\n=== 1. A FILA OFFLINE NÃO GUARDA MAIS NADA ===')
        # Corta a rede para a API — o painel continua aberto, como no pátio
        # quando o sinal cai.
        await pg.route(f'{API}/api/**', lambda r: asyncio.ensure_future(r.abort()))
        await pg.route(f'{API}/auth/**', lambda r: asyncio.ensure_future(r.abort()))

        r = await pg.evaluate("""async () => {
              const f = DB.frota.find(x => x.placa && x.transportadora);
              const c = criarCargaProgramada({placa: f.placa, numeroCarga: 'OFF-1',
                cliente: 'C', destino: 'D', peso: 1000, operador: 'Chefe'});
              SuincoStore.save();
              await new Promise(r => setTimeout(r, 2500));
              return { fila: SuincoSharePoint.pendentes(),
                       estado: SuincoSharePoint.estado(),
                       online: SuincoSharePoint.estaOnline() };
            }""")
        ck('a fila continua VAZIA depois de tentar gravar offline',
           r['fila'] == 0, f"fila={r['fila']}")
        ck('o painel se reconhece offline', r['online'] is False, str(r['estado']))

        print('\n=== 2. A RECUSA CHEGA NO OPERADOR ===')
        texto = await pg.evaluate("() => document.body.innerText")
        ck('a tela avisa que está offline e que não gravou',
           'OFFLINE' in texto.upper(), 'nenhuma menção a OFFLINE na tela')

        print('\n=== 2b. A CARGA NÃO FICA FANTASMA, E O AVISO NÃO CULPA O SERVIDOR ===')
        # Achado ao isolar test_contador_torre (31/08/2026): a trava de
        # offline devolve `{recusado:true, offline:true}`, e criação nunca
        # confirmada que é recusada SAI da tela — certo, senão a carga fica
        # visível só para quem lançou, como o fantasma de 07/08.
        #
        # O que estava errado era o TEXTO: dizia "o servidor recusou a
        # criação desta carga", e quem está sem sinal ia procurar placa fora
        # da frota ou falta de permissão — problema que não existe. Offline
        # não é recusa do servidor, é ausência dele; o conserto é reconectar
        # e refazer, não corrigir cadastro.
        sumida = await pg.evaluate("""() => ({
            aindaNaTela: DB.cargas.some(c => c.numeroCarga === 'OFF-1'),
            texto: document.body.innerText
        })""")
        ck('a carga lançada offline não fica fantasma na tela',
           sumida['aindaNaTela'] is False, 'OFF-1 continua em DB.cargas')
        ck('o aviso NÃO diz que o servidor recusou — ele nem foi consultado',
           'servidor recusou' not in sumida['texto'],
           'a tela culpa o servidor por uma falta de conexão')

        print('\n=== 3. A FAIXA DE ALERTA, COM O TEXTO DO DONO ===')
        faixa = await pg.evaluate("""() => {
            const f = document.getElementById('faixa-offline');
            return f ? f.innerText.toUpperCase().replace(/\\s+/g,' ') : null;
        }""")
        ck('a faixa existe', bool(faixa), str(faixa))
        if faixa:
            for pedaco in ('ALERTA', 'VOCÊ ESTÁ OFFLINE', 'SISTEMA INDISPONÍVEL',
                           'CONECTE-SE PARA CONTINUAR'):
                ck(f'a faixa diz "{pedaco}"', pedaco in faixa, faixa[:110])

        print('\n=== 4. A CONEXÃO VOLTA: A FAIXA SOME ===')
        await pg.unroute(f'{API}/api/**')
        await pg.unroute(f'{API}/auth/**')
        await pg.evaluate("async () => { try{ await SuincoSharePoint.sincronizarAgora(); }catch(e){} }")
        await pg.wait_for_timeout(2500)
        sumiu = await pg.evaluate("""() => ({
            faixa: !!document.getElementById('faixa-offline'),
            online: SuincoSharePoint.estaOnline()
        })""")
        ck('voltou a conexão e a faixa saiu da tela',
           not sumiu['faixa'], str(sumiu))

        print('\n=== 5. FILA VELHA NO APARELHO É DESCARTADA, E O PAINEL DIZ ===')
        # Planta uma fila como a que existe hoje nos aparelhos e recarrega.
        await pg.evaluate("""() => {
            // A chave REAL da fila (CHAVE_FILA em suinco-api.js). Chutar o
            // nome fazia o teste plantar num lugar que ninguém lê — e ele
            // passava a medir o próprio erro em vez do painel.
            localStorage.setItem('suinco_fila_api', JSON.stringify([
              { tipo:'carga', corpo:{ placa:'AAA1A11', numeroCarga:'VELHA-1' },
                enfileiradoEm:'2026-08-30T10:00:00.000Z' },
              { tipo:'status', cargaId:'x', status:'Aguardando Embarque',
                enfileiradoEm:'2026-08-30T10:01:00.000Z' }
            ]));
        }""")
        await pg.reload()
        await pg.wait_for_timeout(4000)
        depois = await pg.evaluate("""() => ({
            fila: (typeof SuincoSharePoint !== 'undefined') ? SuincoSharePoint.pendentes() : -1,
            texto: document.body.innerText
        })""")
        ck('a fila velha foi jogada fora', depois['fila'] == 0, f"fila={depois['fila']}")
        ck('e o painel DISSE o que descartou',
           'DESCARTAD' in depois['texto'].upper(),
           'nenhum aviso de descarte na tela')

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:2]))
        await nav.close()

    print()
    if falhas:
        print(f'{len(falhas)} FALHA(S): ' + ', '.join(falhas))
        return 1
    print('tudo verde')
    return 0


sys.exit(asyncio.run(main()))
