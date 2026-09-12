#!/usr/bin/env python3
"""Recusa PERMANENTE do servidor (rota não cadastrada) não pode virar "offline".

RELATO DO DONO — log do VPS, 11/09/2026, TREZE vezes no mesmo dia (15:09,
15:17, 15:19, 15:27, 15:33, 19:07, 19:09, 20:18, 20:19, 20:23, 20:24, 20:26,
20:29):

    [erro] POST /api/cargas — error: insert or update on table "fact_viagens"
    violates foreign key constraint "fact_viagens_rota_codigo_fkey"

`fact_viagens.rota_codigo` tem `REFERENCES dim_rotas(codigo)`
(migrations/001_schema.sql:95). Criar carga com um código de rota que não
está cadastrado faz o Postgres recusar o INSERT, e a rota hoje responde
500 — CONFIRMADO contra o backend de verdade nesta investigação (banco
limpo, só migrations 001-051, nenhum dado preexistente que pudesse
disfarçar o resultado):

    POST /api/cargas {rota: "<código que não existe>"} →
    500 {"erro":"Erro interno no servidor.","codigo":"ERRO_INTERNO"}

A CADEIA DO DEFEITO, em suinco-api.js: `eFalhaDeRede(e)` trata TODO status
>= 500 como "a rede caiu" — correto para a maioria dos 500 (a infra pode
voltar). Mas ESTE 500 é uma recusa PERMANENTE do banco: aquele código de
rota nunca vai ser aceito, não importa quantas vezes o painel tente de
novo. `upsert()` confere com o servidor antes de desistir (a regra da
#48/#53, `cargaQueOServidorTem`) — a conferência RESPONDE (o servidor está
de pé e rápido) e diz que a carga não existe, porque o INSERT nunca
aconteceu (`conferencia.falhou=false`, `conferencia.item=null`). Isso cai
em `enfileirar({tipo:'carga', corpo})` SEM `incerta`, e o painel afirma
"VOCÊ ESTÁ OFFLINE — SISTEMA INDISPONÍVEL... CONECTE-SE PARA CONTINUAR" —
quando o servidor respondeu rápido e com total certeza que aquele código
de rota não existe. O operador, seguindo o aviso ao pé da letra, reconecta
e tenta de novo com o MESMO código — e de novo, e de novo: é a rajada de
13 tentativas no mesmo dia que o Luis viu no log, para um erro que refazer
nunca vai resolver.

POR QUE ESTE TESTE BATE NO SERVIDOR DE VERDADE, E NÃO NUM `fetch` FALSO
(diferente dos vizinhos test_demora_nao_apaga_carga.py/
test_incerteza_nao_apaga_carga.py, que testam decisão 100% do painel): a
convenção já usada para o MESMO cadastro em modelo_semana.js — validar
`rota_codigo` contra `dim_rotas` ANTES do insert e devolver 4xx com um
`codigo` próprio (`"Rota X não está cadastrada."`, `ROTA_DESCONHECIDA`) —
é o jeito natural de corrigir isto. Se a correção for essa, o código do
PAINEL não precisa mudar NADA: o bloco que já existe em upsert() para
409/422/403 já classifica certo uma recusa de criação. A guarda certa,
então, é o CONTRATO HTTP entre painel e servidor — e só um servidor de
verdade tem esse contrato para testar.

O QUE ESTE TESTE TRAVA (e hoje reprova)
  1. a recusa chega ao painel classificada como RECUSA — o aviso NÃO pode
     dizer OFFLINE nem mandar "conecte-se", porque não é isso que houve;
  2. o operador recebe o MESMO molde de aviso já usado para qualquer outra
     recusa de criação ("...removida da tela — nunca existiu no banco") —
     não uma mentira sobre a rede;
  3. a carga NÃO fica presa tentando de novo pra sempre: ela sai da tela,
     como qualquer recusa de criação de verdade (#07/08);
  4. confirmado NO BANCO, não só na tela: nenhuma linha fantasma em
     `fact_viagens` para o número de carga usado no teste.

Requer um backend de verdade no ar, banco PRÓPRIO (nunca o compartilhado
em bateria), com as migrations aplicadas e os operadores de teste
cadastrados (ana@teste.local / Logística):

    SUINCO_API=http://127.0.0.1:3025 SUINCO_PGDATABASE=suinco_guardas \
        python3 testes/test_recusa_permanente_nao_e_offline.py
"""
import asyncio
import os
import subprocess
import sys
import uuid

from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
PGDATABASE_TESTE = os.environ.get('SUINCO_PGDATABASE', 'embarque_suinco')
NUMERO_CARGA = 'GUARDA1-ROTAINVALIDA'
ROTA_INEXISTENTE = 'ROTA-GUARDA-' + uuid.uuid4().hex[:8].upper()

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def _limpar():
    # Idempotente: sem isto, rodar o teste duas vezes deixaria sobra de uma
    # execução anterior disputando a mesma chave (numero_carga) com a
    # seguinte — e, se a correção algum dia permitir a criação por engano
    # com outro código válido, a segunda rodada encontraria a linha errada.
    subprocess.run(['sudo', '-u', 'postgres', 'psql', '-q', '-tA', '-d', PGDATABASE_TESTE, '-c',
                     "DELETE FROM fact_statusfrota WHERE carga_id IN "
                     f"(SELECT carga_id FROM fact_viagens WHERE numero_carga = '{NUMERO_CARGA}'); "
                     f"DELETE FROM fact_viagens WHERE numero_carga = '{NUMERO_CARGA}';"],
                    capture_output=True, text=True)


def _linhas_no_banco():
    r = subprocess.run(['sudo', '-u', 'postgres', 'psql', '-tAF|', '-d', PGDATABASE_TESTE, '-c',
                         f"SELECT carga_id, rota_codigo FROM fact_viagens WHERE numero_carga = '{NUMERO_CARGA}'"],
                        capture_output=True, text=True)
    return [l for l in r.stdout.strip().split('\n') if l]


async def main():
    _limpar()
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctx = await nav.new_context(viewport={'width': 1280, 'height': 900})
        pg = await ctx.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        respostas_post = []
        pg.on('response', lambda r: (
            respostas_post.append(r.status)
            if r.request.method == 'POST' and r.url.rstrip('/').endswith('/api/cargas')
            else None
        ))

        html = open(PAINEL_ARQ, encoding='utf-8').read()
        html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
        html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                            f'{API}/socket.io/socket.io.js')
        url = f'{API}/__recusa_permanente'
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        ok_login = True
        try:
            await pg.wait_for_selector('#login-email', timeout=25000)
        except Exception:
            ok_login = False
        ck('a tela de login apareceu (servidor no ar em ' + API + ')', ok_login)
        if not ok_login:
            await nav.close()
            return 1

        await pg.fill('#login-email', 'ana@teste.local')
        await pg.fill('#login-senha', SENHA)
        await pg.click('#btn-entrar')
        await pg.wait_for_timeout(2500)

        logou = await pg.evaluate("() => typeof DB !== 'undefined' && !!DB.operador")
        ck('login real (Logística) entrou', logou, 'sem sessão, o resto do teste não significa nada')
        if not logou:
            await nav.close()
            return 1

        print('\n=== 1. CRIAR CARGA COM ROTA QUE NÃO EXISTE — CONTRA O SERVIDOR DE VERDADE ===')
        # `criarCargaProgramada` (data.js) já confere a rota contra a lista
        # LOCAL (`rotaInfo()`) antes de montar a carga, e zera o campo se não
        # reconhece o código — é uma proteção legítima, mas que impediria
        # este teste de chegar ao cenário real (o relato é de um código que
        # o SERVIDOR recusa; como ele chega até ali não é o que este teste
        # precisa provar — a investigação já fechou a causa). Por isso o
        # teste monta a carga à mão, exatamente como `sincronizarCarga`
        # (data.js) monta qualquer carga para subir, e chama a MESMA função
        # que todo caminho de gravação usa — "uma função, dois chamadores":
        # testar na função compartilhada prova a regra para QUALQUER
        # chamador que um dia mande um código de rota que o servidor recusa,
        # não só para o caminho específico do incidente.
        d = await pg.evaluate("""async ([numeroCarga, rota]) => {
          window.__avisos = [];
          const _notify = window.notify;
          window.notify = (msg, ...r) => { window.__avisos.push(String(msg)); return _notify ? _notify(msg, ...r) : null; };
          const f = DB.frota.find(x => x.placa && x.transportadora);
          const agora = new Date().toISOString();
          const carga = {
            id: 'carga_' + Math.random().toString(36).slice(2),
            numeroCarga, placa: f.placa, transportadora: f.transportadora || '',
            tipoVeiculo: f.tipoVeiculo || '', motorista: '', cliente: '', destino: '',
            peso: 9000, doca: '', sequencia: null, observacoes: '', praOnde: '',
            paletizada: 'Não', qtdGanchos: 0, qtdEntregas: 1,
            freteDestino: '', kmDeslocamento: null, freteDocumento: '',
            status: 'Aguardando Veículo', aguardandoCarga: false,
            criadoEm: agora, criadoPor: 'Ana', programadoEm: agora, atualizadoEm: agora,
            rota,
            _nuncaConfirmada: true,
          };
          DB.cargas.push(carga);
          const id = carga.id;
          await SuincoStore.sincronizarCarga(carga, DB.operador);
          await new Promise(r => setTimeout(r, 1500));
          const c = DB.cargas.find(x => x.id === id);
          return { id, continuaNaTela: !!c, avisos: window.__avisos.slice() };
        }""", [NUMERO_CARGA, ROTA_INEXISTENTE])

        await pg.wait_for_timeout(500)   # folga para a última resposta de rede chegar ao listener

        print('\n=== 2. O CONTRATO HTTP: A RECUSA PRECISA SER 4xx, NÃO 500 ===')
        # Esta é a causa raiz, confirmada contra o Postgres de verdade: o
        # INSERT viola a FK fact_viagens_rota_codigo_fkey e hoje sobe como
        # 500 sem nenhum `codigo` de negócio — é ISSO que faz eFalhaDeRede()
        # (suinco-api.js) tratar a recusa como "a rede caiu".
        ck('o POST de criação aconteceu', len(respostas_post) >= 1, str(respostas_post))
        ck('e respondeu com um erro de CLIENTE (4xx), não 500 — rota inválida é dado, não rede',
           bool(respostas_post) and all(400 <= s < 500 for s in respostas_post),
           f'status(s) observado(s): {respostas_post}')

        avisos_txt = ' | '.join(d['avisos']).upper()
        print('\n=== 3. O AVISO NÃO PODE CHAMAR ISSO DE "OFFLINE" ===')
        ck('nenhum aviso diz "OFFLINE"', 'OFFLINE' not in avisos_txt, d['avisos'])
        ck('nenhum aviso manda "CONECTE-SE" (não é isso que vai resolver)',
           'CONECTE-SE' not in avisos_txt, d['avisos'])

        print('\n=== 4. O OPERADOR RECEBE O MOLDE DE RECUSA DE VERDADE (não uma mentira sobre rede) ===')
        # Mesmo texto já usado, sem mudar nada, para QUALQUER outra recusa de
        # criação (placa fora da frota, setor sem permissão) — é o molde que
        # `receberRecusaDeCarga` (app.js) já produz quando `r.offline` NÃO
        # vem marcado. Se isto aparecer, o painel classificou certo.
        ck('algum aviso confirma que a carga foi removida por recusa de verdade',
           'REMOVIDA DA TELA' in avisos_txt and 'NUNCA EXISTIU NO BANCO' in avisos_txt,
           d['avisos'])

        print('\n=== 5. NÃO FICA TENTANDO PRA SEMPRE ===')
        ck('a carga saiu da tela — não é "incerta", é recusa definitiva',
           d['continuaNaTela'] is False, str(d))

        print('\n=== 6. A VERDADE MORA NO BANCO: nenhuma linha fantasma ===')
        linhas = _linhas_no_banco()
        ck('fact_viagens não tem nenhuma linha para esta carga', linhas == [], linhas)

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    _limpar()
    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
