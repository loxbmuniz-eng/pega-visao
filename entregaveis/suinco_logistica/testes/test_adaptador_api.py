#!/usr/bin/env python3
"""Prova que suinco-api.js conversa com a API de verdade, dentro de um navegador.

Não é teste de unidade: sobe a página, carrega o adaptador real, faz login
real e move uma carga pelo fluxo real, contra o backend Node + PostgreSQL.
O que ele responde é "o painel vai funcionar quando trocarmos o adaptador?".

Exige o servidor rodando (npm start no backend) e os operadores de teste
criados. Endereço e credenciais vêm por variável de ambiente.
"""
import asyncio
import os
import sys
import uuid
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
ADAPTADOR = '/home/user/pega-visao/entregaveis/suinco_logistica/suinco-api.js'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')

falhas = []

# Ids únicos por execução. Com id fixo, a segunda rodada encontra a carga já
# movida pela primeira e acusa falha onde não há — foi exatamente o que
# aconteceu na primeira versão deste teste.
RODADA = uuid.uuid4().hex[:8]
CARGA_FROTA = f'carga_ad_{RODADA}_frota'
CARGA_FLUXO = f'carga_ad_{RODADA}_fluxo'
CARGA_FILA = f'carga_ad_{RODADA}_fila'


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


async def main():
    async with async_playwright() as p:
        navegador = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctx = await navegador.new_context()
        pagina = await ctx.new_page()
        erros = []
        pagina.on('pageerror', lambda e: erros.append(str(e)))

        # A página de teste é servida da MESMA origem da API.
        #
        # Não é conveniência: o Chrome bloqueia uma página http comum de
        # alcançar loopback (política de Private Network Access), então uma
        # origem fictícia daria "Failed to fetch" e o teste acusaria erro
        # onde não há. Em produção nada disso acontece — o painel é https e
        # a API é https num domínio público. O CORS de verdade já é coberto
        # pela bateria do backend.
        pagina_teste = API + '/__teste_adaptador'
        await pagina.route(pagina_teste, lambda rota: asyncio.ensure_future(
            rota.fulfill(status=200, content_type='text/html; charset=utf-8',
                         body='<!doctype html><meta charset="utf-8"><title>t</title>')))
        await pagina.goto(pagina_teste)

        codigo = open(ADAPTADOR, encoding='utf-8').read()
        await pagina.add_script_tag(content=codigo)
        await pagina.evaluate("api => { SuincoSharePoint.SP_CONFIG.api = api; }", API)

        print('\n=== 1. ADAPTADOR CARREGA E EXPÕE O CONTRATO ===')
        contrato = ['iniciar', 'estaConfigurado', 'estado', 'aoMudarEstado',
                    'aoReceberDados', 'push', 'upsert', 'pull', 'pullTudo',
                    'drenarFila', 'pendentes', 'ultimaSincronia', 'arquivarDia',
                    'sincronizarAgora', 'iniciarSincroniaPeriodica', 'pararSincronia']
        faltando = await pagina.evaluate(
            "c => c.filter(n => typeof SuincoSharePoint[n] !== 'function')", contrato)
        ck('todas as funções que data.js e app.js chamam existem', not faltando,
           f'faltando: {faltando}' if faltando else f'{len(contrato)} funções')

        print('\n=== 2. SEM LOGIN, MODO LOCAL (painel abre mesmo assim) ===')
        ck('estaConfigurado() é falso sem token',
           await pagina.evaluate("() => SuincoSharePoint.estaConfigurado()") is False)
        await pagina.evaluate("() => SuincoSharePoint.iniciar()")
        ck('estado = local', await pagina.evaluate("() => SuincoSharePoint.estado()") == 'local')

        print('\n=== 3. LOGIN REAL CONTRA A API ===')
        op = await pagina.evaluate(
            "async ([e,s]) => { try { return await SuincoSharePoint.login(e,s); }"
            "catch(err){ return {erro: err.message}; } }",
            ['ana@teste.local', SENHA])
        ck('login devolveu o operador', op and not op.get('erro'), str(op))
        ck('o SETOR veio do servidor, não do cliente', op.get('setor') == 'Logística', op.get('setor'))
        ck('estado = online', await pagina.evaluate("() => SuincoSharePoint.estado()") == 'online')

        print('\n=== 4. TOKEN FICA EM sessionStorage (terminal compartilhado) ===')
        em_session = await pagina.evaluate("() => !!sessionStorage.getItem('suinco_token')")
        em_local = await pagina.evaluate("() => !!localStorage.getItem('suinco_token')")
        ck('token em sessionStorage', em_session)
        ck('token NÃO em localStorage', not em_local,
           'localStorage sobreviveria ao próximo turno no mesmo terminal')

        print('\n=== 5. CARGA INICIAL TRAZ A FROTA E AS CARGAS ===')
        dados = await pagina.evaluate("() => SuincoSharePoint.pullTudo()") or {}
        ck('a frota veio (749 placas)', len(dados.get('frota') or []) == 749,
           f"{len(dados.get('frota') or [])} placas")
        ck('formato de linha compatível com cargaDeLinhaRemota',
           all('Carga_ID' in c for c in (dados.get('cargas') or [])[:5]) or not dados.get('cargas'))
        ck('marca de sincronia gravada',
           bool(await pagina.evaluate("() => SuincoSharePoint.ultimaSincronia()")))

        print('\n=== 6. GRAVAÇÃO: TRAVA DE FROTA VALE NO SERVIDOR ===')
        r = await pagina.evaluate(
            "([id]) => SuincoSharePoint.upsert('cargas','Carga_ID',"
            "{Carga_ID:id, Placa:'ZZZ9999', Numero_Carga:'99001'})", [CARGA_FROTA])
        ck('placa fora da frota é recusada, e NÃO vai para a fila',
           r.get('recusado') is True and r.get('enfileirado') is False, str(r))

        placa = (dados['frota'][0])['Placa']
        r = await pagina.evaluate(
            "([p,id]) => SuincoSharePoint.upsert('cargas','Carga_ID',"
            "{Carga_ID:id, Placa:p, Numero_Carga:'99002',"
            " Peso_Kg:8000, Pra_Onde:'RET FRIGO', Paletizada:'Sim', Qtd_Ganchos:30,"
            " Status_Atual:'Aguardando Veículo'})", [placa, CARGA_FLUXO])
        ck('placa da frota é aceita', r.get('enfileirado') is False and not r.get('recusado'), str(r))

        print('\n=== 7. MÁQUINA DE ESTADOS: QUEM PODE MOVER CADA ETAPA ===')
        # A regra vigente, decidida pela operação: Logística e Administração
        # movem qualquer etapa (são quem destrava o pátio quando um setor
        # falta); os demais setores movem só a etapa que é deles. Este teste
        # cobra os dois lados — o acesso amplo e o limite de quem é restrito.
        #
        # A checagem vale porque roda no SERVIDOR: o setor vem do token
        # assinado, não do que o navegador diz ser.
        r = await pagina.evaluate(
            "([id]) => SuincoSharePoint.mudarStatus(id,'Aguardando Embarque')", [CARGA_FLUXO])
        ck('Logística move a etapa da Portaria (acesso total)',
           r.get('enfileirado') is False and not r.get('recusado'), str(r.get('erro') or r))
        ck('o status voltou aplicado',
           (r.get('item') or {}).get('status') == 'Aguardando Embarque')

        # Expedição tentando a etapa do Faturamento: setor restrito, etapa
        # que não é dele. É aqui que a autorização de servidor prova valor.
        await pagina.evaluate("() => SuincoSharePoint.sair()")
        op2 = await pagina.evaluate(
            "async ([e,s]) => SuincoSharePoint.login(e,s)", ['carla@teste.local', SENHA])
        ck('Expedição logou', op2.get('setor') == 'Expedição', str(op2.get('setor')))
        r = await pagina.evaluate(
            "([id]) => SuincoSharePoint.mudarStatus(id,'Embarque Iniciado')", [CARGA_FLUXO])
        ck('Expedição move a etapa que é dela',
           r.get('enfileirado') is False and not r.get('recusado'), str(r.get('erro') or r))
        # Leva até Embarque Finalizado antes de tentar faturar. Sem isso, a
        # recusa viria por transição inválida e o teste passaria sem provar
        # nada sobre setor — mediria a coisa errada e daria confiança falsa.
        await pagina.evaluate(
            "([id]) => SuincoSharePoint.mudarStatus(id,'Embarque Finalizado')", [CARGA_FLUXO])
        r = await pagina.evaluate(
            "([id]) => SuincoSharePoint.mudarStatus(id,'Faturado')", [CARGA_FLUXO])
        ck('Expedição é recusada na etapa do Faturamento',
           r.get('recusado') is True, str(r.get('erro') or r))
        ck('recusa NÃO vai para a fila',
           r.get('enfileirado') is False,
           'enfileirar uma recusa faria o painel repetir para sempre algo que nunca é aceito')

        print('\n=== 8. FILA OFFLINE ===')
        # Volta para a Logística antes de enfileirar: criar carga é ação dela.
        # Enfileirar como Portaria faria o servidor recusar com 403 na hora de
        # drenar, e o item seria descartado — comportamento correto, mas que
        # não é o que este teste quer medir.
        await pagina.evaluate("() => SuincoSharePoint.sair()")
        await pagina.evaluate("async ([e,s]) => SuincoSharePoint.login(e,s)",
                              ['ana@teste.local', SENHA])
        await ctx.set_offline(True)
        r = await pagina.evaluate(
            "([p,id]) => SuincoSharePoint.upsert('cargas','Carga_ID',"
            "{Carga_ID:id, Placa:p, Numero_Carga:'99003'})", [placa, CARGA_FILA])
        ck('sem rede, a gravação vai para a fila', r.get('enfileirado') is True, str(r))
        ck('pendentes() conta certo',
           await pagina.evaluate("() => SuincoSharePoint.pendentes()") >= 1)
        ck('estado = offline', await pagina.evaluate("() => SuincoSharePoint.estado()") == 'offline')

        await ctx.set_offline(False)
        d = await pagina.evaluate("() => SuincoSharePoint.drenarFila()")
        ck('a fila esvaziou quando a rede voltou', d.get('restantes') == 0, str(d))
        ck('pendentes() zerou',
           await pagina.evaluate("() => SuincoSharePoint.pendentes()") == 0)

        # Fila vazia não prova entrega: o item poderia ter sido descartado.
        # A pergunta que importa é se a carga chegou ao servidor.
        chegou = await pagina.evaluate("""async ([id]) => {
            const d = await SuincoSharePoint.pullTudo();
            return (d.cargas || []).some(c => c.Carga_ID === id);
        }""", [CARGA_FILA])
        ck('a carga gravada offline existe no servidor', chegou,
           'sem isto, "fila esvaziou" poderia significar "item perdido"')

        print('\n=== 9. LEITURA INCREMENTAL VÊ O QUE O OUTRO SETOR FEZ ===')
        recebido = await pagina.evaluate("""async () => {
            let capturado = null;
            SuincoSharePoint.aoReceberDados(d => { capturado = d; });
            await SuincoSharePoint.pull(true);
            return capturado;
        }""")
        ck('o callback aoReceberDados foi chamado', recebido is not None)
        ck('veio marcado como incremental', (recebido or {}).get('incremental') is True)

        print('\n=== 10. CONSOLE ===')
        ck('sem erros de página', not erros, str(erros))

        await navegador.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
