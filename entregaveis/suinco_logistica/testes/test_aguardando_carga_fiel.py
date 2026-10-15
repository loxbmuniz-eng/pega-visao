#!/usr/bin/env python3
"""Aguardando Carga fiel ao pátio (15/10/2026).

O RELATO, do dono: "quando um caminhão entra sem ter carga programada ele
fica lá como criar carga, porém quando criarem carga por outro lugar, seja
por montagem do dia ou por programação, ele tem que sair da aguardando carga
e ir pra torre (...) tinha placas a mais de 240 horas como aguardando carga".
E depois: "põe esse aguardando carga pra funcionar de forma fiel ao que
realmente está acontecendo" — com a ressalva "tem placas que às vezes ficam
3 dias no pátio, por exemplo exportação; isso não pode conflitar".

AS DUAS CAUSAS, reproduzidas:
  1. A Programação RECUSAVA criar a carga com a placa que estava no
     Aguardando Carga ("já está nesta programação (sem número ainda)"). A
     trava de duplicidade contava a entrada sem carga como outra carga. Só a
     Montagem do Dia e o "Criar carga" da lista levavam o caminhão à Torre.
  2. O caminhão que foi embora SEM carregar não tinha uma saída que dissesse
     isso — a linha ficava na lista para sempre.

O QUE ESTE TESTE COBRA, pela tela, com a API e o banco de verdade:
  1. A lista não tem mais "Criar carga": cada linha tem "Saiu sem carregar"
     e "Excluir", e diz há quanto tempo o caminhão espera.
  2. NADA SAI POR PRAZO: a entrada de 10 dias atrás continua na lista,
     destacada ("há 10 dias"), porque exportação fica dias no pátio.
  3. "Saiu sem carregar" pergunta, registra no servidor (Seguiu Viagem, sem
     carregar, Histórico dizendo "entrada sem carga") e tira a linha.
  4. Criar a carga na Programação com a MESMA placa: o aviso diz que o
     caminhão está no pátio, a carga é criada (não recusada), a entrada
     junta-se a ela no banco, sai da lista e a carga aparece na Torre.
  5. Na Portaria, a entrada sem carga oferece "Saiu sem carregar" — não
     "Só devolução — saiu", que conta outra história.

REPROVA contra o publicado (lista com "Criar carga", Programação recusa):
    SUINCO_PAINEL_ARQUIVO=<index.html publicado> bash testes/rodar_tudo.sh aguardando_carga_fiel

    bash testes/rodar_tudo.sh aguardando_carga_fiel
"""
import asyncio
import os
import subprocess
import sys
from pathlib import Path
from playwright.async_api import async_playwright
from _pergunta import responder_pergunta

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
PAINEL = Path(os.environ.get('SUINCO_PAINEL_ARQUIVO', str(RAIZ / 'index.html')))
EMAIL_PORT = 'agf.portaria@teste.local'
EMAIL_LOG = 'agf.logistica@teste.local'
NUMERO = 'AGF-P2'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def psql(q):
    return subprocess.run(['su', 'postgres', '-c', 'psql -q -tA -d embarque_suinco'], input=q,
                          capture_output=True, text=True).stdout.strip()


def ids_das_placas(placas):
    lista = ','.join(f"'{p}'" for p in placas)
    r = psql(f"SELECT string_agg(carga_id, ',') FROM fact_viagens WHERE placa IN ({lista})")
    return set(x for x in (r or '').split(',') if x)


def limpar(novos):
    if novos:
        ids = ','.join(f"'{i}'" for i in novos)
        psql(f"DELETE FROM fact_statusfrota WHERE carga_id IN ({ids});"
             f"DELETE FROM log_eventos WHERE carga_id IN ({ids});"
             f"DELETE FROM fact_viagens WHERE carga_id IN ({ids});")
    psql(f"DELETE FROM operadores WHERE email IN ('{EMAIL_PORT}', '{EMAIL_LOG}');")


async def abrir(nav, email, rotulo):
    ctx = await nav.new_context(viewport={'width': 1400, 'height': 1000})
    pg = await ctx.new_page()
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    html = PAINEL.read_text(encoding='utf-8').replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    url = f'{API}/__agf_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.route('**/socket.io/socket.io.js', lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='application/javascript', body='')))
    await pg.goto(url)
    await pg.wait_for_selector('#login-email')
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar')
    await pg.wait_for_timeout(3000)
    return ctx, pg, erros


async def ir(pg, aba):
    await pg.click(f'.nav-tab[data-tab="{aba}"]')
    await pg.wait_for_timeout(800)


async def linhas_aguardando(pg):
    return await pg.evaluate("""() => [...document.querySelectorAll('#prog-aguardando-tbody tr')].map(tr => ({
        texto: tr.innerText.replace(/\\s+/g, ' ').trim(),
        antiga: tr.classList.contains('aguardando-antiga'),
        visivel: tr.getBoundingClientRect().height > 0,
        botoes: [...tr.querySelectorAll('button')].map(b => b.textContent.trim()),
    }))""")


async def main():
    h = subprocess.run(['node', '-e', f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True).stdout.strip()
    psql(f"DELETE FROM operadores WHERE email IN ('{EMAIL_PORT}', '{EMAIL_LOG}');"
         f"INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES "
         f"('{EMAIL_PORT}', 'Porteiro AGF', 'Portaria', '{h}', true),"
         f"('{EMAIL_LOG}', 'Logística AGF', 'Logística', '{h}', true);")
    # Quatro placas da Frota sem nada em aberto, de transportadoras que PAGAM
    # frete (criar com placa é contratar: a pergunta do frete tem que abrir).
    livres = psql("SELECT string_agg(placa, '|') FROM (SELECT DISTINCT ON (v.transportadora) v.placa "
                  "FROM dim_veiculos v LEFT JOIN fact_viagens f ON f.placa = v.placa AND f.excluida_em IS NULL "
                  "WHERE v.transportadora <> '' AND upper(v.transportadora) NOT LIKE '%SUINCO%' "
                  "AND upper(v.transportadora) NOT LIKE '%FOB%' AND f.carga_id IS NULL "
                  "ORDER BY v.transportadora, v.placa LIMIT 4) t")
    P = [x for x in (livres or '').split('|') if x]
    ck('quatro placas livres da Frota', len(P) == 4, str(P))
    if len(P) < 4:
        limpar(set())
        return 1
    antes = ids_das_placas(P)

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        try:
            print('\n=== 0. A PORTARIA REGISTRA QUATRO CHEGADAS SEM PROGRAMAÇÃO ===')
            ctxP, pgP, errosP = await abrir(nav, EMAIL_PORT, 'portaria')
            await ir(pgP, 'portaria')
            for placa in P:
                await pgP.fill('#portaria-placa', placa)
                await pgP.click('button:has-text("Chegou")')
                await responder_pergunta(pgP, prazo=1200)
                await pgP.wait_for_timeout(1500)
            await pgP.wait_for_timeout(2000)
            abertas = psql("SELECT count(*) FROM fact_viagens WHERE aguardando_carga AND excluida_em IS NULL "
                           "AND status_atual = 'Aguardando Embarque' AND placa IN (" + ','.join(f"'{x}'" for x in P) + ")")
            ck('as quatro entradas estão no banco como Aguardando Carga', abertas == '4', abertas)

            print('\n=== 5. NA PORTARIA, A ENTRADA SEM CARGA SAI "SEM CARREGAR" ===')
            linhaP = pgP.locator('#portaria-prog-tbody tr').filter(has_text=P[3])
            botoesP = await linhaP.first.locator('button').all_inner_texts() if await linhaP.count() else []
            ck('a linha da Portaria oferece "Saiu sem carregar"',
               any('Saiu sem carregar' in b for b in botoesP), str(botoesP))
            ck('e não "Só devolução — saiu" (ele não trouxe devolução)',
               not any('Só devolução' in b for b in botoesP), str(botoesP))
            await ctxP.close()

            # O caminhão da placa P[0] chegou há DEZ dias (exportação, por
            # exemplo). Envelhece a entrada e o carimbo da chegada no banco.
            psql(f"UPDATE fact_viagens SET criado_em = now() - interval '10 days', atualizado_em = now() "
                 f"WHERE placa = '{P[0]}' AND aguardando_carga AND excluida_em IS NULL;"
                 f"UPDATE fact_statusfrota SET data_evento = now() - interval '10 days' "
                 f"WHERE placa = '{P[0]}' AND status_novo = 'Aguardando Embarque';")

            ctxL, pg, erros = await abrir(nav, EMAIL_LOG, 'logistica')
            dialogos = []
            await ir(pg, 'programacao')

            print('\n=== 1. A LISTA: SEM "CRIAR CARGA", COM O TEMPO DE ESPERA ===')
            ls = await linhas_aguardando(pg)
            das_placas = {pl: next((l for l in ls if pl in l['texto']), None) for pl in P}
            ck('as quatro entradas estão na lista', all(das_placas.values()), str([l['texto'][:40] for l in ls]))
            ck('nenhuma linha oferece "Criar carga"',
               all(not any('Criar carga' in b for b in l['botoes']) for l in ls), str([l['botoes'] for l in ls]))
            ck('toda linha tem "Saiu sem carregar" e "Excluir"',
               all(any('Saiu sem carregar' in b for b in l['botoes']) and any('Excluir' in b for b in l['botoes'])
                   for l in ls), str([l['botoes'] for l in ls]))
            nova = das_placas[P[1]] or {}
            ck('a entrada de agora diz há quanto tempo ("há 0 h") e não é destacada',
               'há 0 h' in nova.get('texto', '') and not nova.get('antiga'), str(nova))

            print('\n=== 2. NADA SAI POR PRAZO: A DE 10 DIAS CONTINUA, DESTACADA ===')
            velha = das_placas[P[0]] or {}
            ck('a entrada de 10 dias continua na lista e à vista', bool(velha) and velha.get('visivel'), str(velha))
            ck('ela diz "há 10 dias"', 'há 10 dias' in velha.get('texto', ''), velha.get('texto'))
            ck('e vem destacada para alguém conferir', velha.get('antiga') is True, str(velha))

            print('\n=== 3. "SAIU SEM CARREGAR" REGISTRA E TIRA A LINHA ===')
            linha1 = pg.locator('#prog-aguardando-tbody tr').filter(has_text=P[1])
            botao1 = linha1.first.locator('button:has-text("Saiu sem carregar")')
            mostrou = None
            if await botao1.count():
                await botao1.click()
                mostrou = await responder_pergunta(pg, prazo=3000)
            ck('pergunta antes, dizendo que ele chegou sem carga',
               bool(mostrou) and 'sem carga programada' in mostrou, (mostrou or '')[:120])
            await pg.wait_for_timeout(3000)
            r = psql(f"SELECT status_atual || '|' || coalesce(saida_sem_carregar::text, '') FROM fact_viagens "
                     f"WHERE placa = '{P[1]}' AND aguardando_carga AND excluida_em IS NULL")
            ck('no banco: Seguiu Viagem, marcada como sem carregar', r == 'Seguiu Viagem|true', r)
            acao = psql(f"SELECT acao FROM log_eventos WHERE placa = '{P[1]}' AND acao LIKE 'Status:%Seguiu Viagem%'")
            ck('o Histórico diz "entrada sem carga — saiu sem carregar"',
               'entrada sem carga — saiu sem carregar' in (acao or ''), acao)
            ls = await linhas_aguardando(pg)
            ck('a linha saiu do Aguardando Carga', not any(P[1] in l['texto'] for l in ls),
               str([l['texto'][:30] for l in ls]))

            print('\n=== 4. A CARGA CRIADA NA PROGRAMAÇÃO COM A MESMA PLACA LEVA O CAMINHÃO PARA A TORRE ===')
            await pg.fill('#prog-placa', P[2])
            await pg.dispatch_event('#prog-placa', 'input')
            await pg.wait_for_timeout(500)
            aviso = ' '.join((await pg.inner_text('#prog-frota-hint')).split())
            ck('o aviso da placa diz que ele está no pátio sem carga', 'está no pátio sem carga' in aviso, aviso[:160])
            await pg.fill('#prog-numero-carga', NUMERO)
            await pg.click('button:has-text("Criar Carga (Aguardando Veículo)")')
            await pg.wait_for_timeout(900)
            pergunta = await pg.evaluate(
                "() => document.getElementById('modal-frete-contratar').classList.contains('open')")
            recusa = await pg.evaluate("""() => [...document.querySelectorAll('.notif-item')]
                .map(e => e.textContent).join(' ')""")
            ck('a Programação NÃO recusa a placa que está no Aguardando Carga',
               'já está nesta programação' not in (recusa or ''), (recusa or '')[:160])
            ck('criar com placa é contratar: a pergunta do frete abre', pergunta)
            if pergunta:
                await pg.check('#frete-c-tabela')
                await pg.click('#frete-c-confirmar')
            await pg.wait_for_timeout(4000)
            c = psql(f"SELECT carga_id || '|' || status_atual FROM fact_viagens WHERE numero_carga = '{NUMERO}' "
                     "AND excluida_em IS NULL")
            ck('no banco: a carga existe, já em Aguardando Embarque', c.endswith('|Aguardando Embarque'), c)
            orfa = psql(f"SELECT count(*) FROM fact_viagens WHERE placa = '{P[2]}' AND aguardando_carga "
                        "AND excluida_em IS NULL")
            ck('e a entrada sem carga juntou-se a ela (saiu da operação)', orfa == '0', orfa)
            ls = await linhas_aguardando(pg)
            ck('a linha saiu do Aguardando Carga', not any(P[2] in l['texto'] for l in ls),
               str([l['texto'][:30] for l in ls]))
            await ir(pg, 'torre')
            # Para a Logística, número e placa na Torre são CAMPOS editáveis:
            # o que a pessoa vê é o valor do campo, não o texto da célula.
            na_torre = await pg.evaluate("""([n, placa]) => [...document.querySelectorAll('#torre-tbody tr')]
                .some(tr => { const vals = [...tr.querySelectorAll('input')].map(i => i.value).concat(tr.innerText);
                              return vals.some(v => v.includes(n)) && vals.some(v => v.includes(placa)); })""", [NUMERO, P[2]])
            ck('a carga dele está na Torre, com o número e a placa', na_torre)

            ck('nenhum erro de JavaScript', not erros and not errosP, str((erros + errosP)[:2]))
            await ctxL.close()
        finally:
            await nav.close()
            limpar(ids_das_placas(P) - antes)

    print('\n=======================================================')
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print('   -', f)
        return 1
    print('  Tudo verde: o Aguardando Carga mostra o que acontece no pátio, e nada sai por prazo.')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
