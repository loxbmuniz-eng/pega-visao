#!/usr/bin/env python3
"""Painel novo falando com servidor antigo não pode mentir que apagou.

O painel e a API são publicados separado: o painel vai para o Vercel num
merge, a API precisa de alguém rodando o instalador na VPS. Entre um e
outro existe uma janela em que o navegador está atualizado e o servidor
não.

Nessa janela, `DELETE /api/cargas/:id` bate numa rota que ainda não existe.
O adaptador tratava QUALQUER 404 como "a carga já não está lá" e devolvia
sucesso: a carga sumia da tela de quem apagou, continuava no banco,
continuava aparecendo para os outros setores e voltava na próxima leitura
completa. Divergência silenciosa entre dois terminais.

Os dois 404 são distinguíveis pelo código no corpo:

    CARGA_NAO_ENCONTRADA  -> a carga não existe. Sucesso, é o que se queria.
    ROTA_INEXISTENTE      -> o SERVIDOR está velho. Erro, e ruidoso.

O teste usa um `fetch` de mentira porque o que se quer medir é a decisão do
adaptador diante de cada resposta — subir dois servidores em versões
diferentes para provar isso seria caro e mais frágil.

    python3 testes/test_servidor_desatualizado.py
"""
import asyncio
import datetime
import sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


CENARIOS = [
    # (rótulo, status, corpo, espera_erro, marca esperada no resultado)
    ('carga já não existe', 404,
     {'erro': 'Carga não encontrada.', 'codigo': 'CARGA_NAO_ENCONTRADA'},
     False, None),
    ('servidor sem a rota (versão antiga)', 404,
     {'erro': 'Rota não encontrada: DELETE /api/cargas/x', 'codigo': 'ROTA_INEXISTENTE'},
     True, 'SERVIDOR_DESATUALIZADO'),
    ('exclusão recusada pela regra', 409,
     {'erro': 'Carga já seguiu viagem.', 'codigo': 'FLUXO'},
     False, 'recusado'),
]


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        pg = await nav.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(900)

        # Sessão de mentira: excluir() sai cedo se não estiver configurado.
        # O token mora em sessionStorage, e NÃO em localStorage — terminal de
        # pátio é compartilhado, e a sessão do turno da manhã não pode valer
        # para quem sentar ali à noite.
        await pg.evaluate("""() => {
            sessionStorage.setItem('suinco_token', 'token-de-teste');
        }""")

        configurado = await pg.evaluate("() => SuincoSharePoint.estaConfigurado()")
        ck('sessão de teste reconhecida pelo adaptador', configurado,
           'sem isso excluir() sai antes de chamar a rede e o teste não mede nada')

        for rotulo, status, corpo, espera_erro, marca in CENARIOS:
            r = await pg.evaluate("""async ([status, corpo]) => {
                const original = window.fetch;
                window.fetch = async () => new Response(JSON.stringify(corpo), {
                    status, headers: { 'content-type': 'application/json' }
                });
                try {
                    const res = await SuincoSharePoint.excluir('carga-x', 'motivo de teste');
                    return { ok: true, res };
                } catch (e) {
                    return { ok: false, mensagem: e.message, codigo: e.codigo };
                } finally {
                    window.fetch = original;
                }
            }""", [status, corpo])

            if espera_erro:
                ck(f'{rotulo}: levanta erro em vez de fingir sucesso', not r['ok'],
                   f"devolveu {r.get('res')}")
                if not r['ok']:
                    ck(f'{rotulo}: erro identificado como {marca}',
                       r.get('codigo') == marca, str(r.get('codigo')))
                    ck(f'{rotulo}: a mensagem diz que NÃO excluiu',
                       'NÃO foi excluída' in (r.get('mensagem') or ''),
                       r.get('mensagem', '')[:80])
            elif marca == 'recusado':
                ck(f'{rotulo}: marcado como recusa, não como falha de rede',
                   r['ok'] and r['res'].get('recusado') is True
                   and r['res'].get('enfileirado') is False,
                   str(r.get('res')))
            else:
                ck(f'{rotulo}: tratado como sucesso', r['ok'], str(r.get('mensagem')))

        print('\n=== QUALQUER ROTA NOVA, NÃO SÓ A DE EXCLUIR CARGA ===')
        # Relato do dono, 26/08/2026, com foto da aba Usuários: clicou em
        # Excluir e leu "Não consegui excluir: Rota não encontrada: DELETE
        # /api/operadores/12". O painel tinha subido no Vercel com o botão;
        # o servidor ainda não tinha rodado o atualizar.sh.
        #
        # O aviso de "servidor desatualizado" existia desde 16/08, mas só
        # dentro de excluir() de CARGA. Toda função nova nascia sem ele e
        # repetia o mesmo relato. Agora o tratamento é do `chamar()`, então
        # vale para qualquer rota — inclusive as que ainda nem foram
        # escritas. Este caso usa excluirOperador porque foi o que estourou
        # em campo, mas o que está sendo testado é o caminho comum.
        r = await pg.evaluate("""async () => {
            const original = window.fetch;
            window.fetch = async () => new Response(JSON.stringify(
                { erro: 'Rota não encontrada: DELETE /api/operadores/12',
                  codigo: 'ROTA_INEXISTENTE' }),
                { status: 404, headers: { 'content-type': 'application/json' } });
            try {
                await SuincoSharePoint.excluirOperador('12');
                return { ok: true };
            } catch (e) {
                return { ok: false, mensagem: e.message,
                         codigo: e.codigo, marcado: !!e.servidorDesatualizado };
            } finally {
                window.fetch = original;
            }
        }""")
        ck('uma rota que o servidor não tem levanta erro', not r['ok'], str(r))
        ck('a mensagem NÃO é o texto técnico do servidor',
           'Rota não encontrada' not in (r.get('mensagem') or ''),
           r.get('mensagem', '')[:90])
        ck('ela diz que o servidor é que está atrás',
           'servidor' in (r.get('mensagem') or '').lower(), r.get('mensagem', '')[:90])
        ck('ela diz que NADA foi alterado — é o que tira o medo de repetir',
           'NADA foi alterado' in (r.get('mensagem') or ''), r.get('mensagem', '')[:90])
        ck('ela nomeia o atualizar.sh, que é a ação que resolve',
           'atualizar.sh' in (r.get('mensagem') or ''), r.get('mensagem', '')[:90])
        ck('e o erro fica marcado para quem quiser tratar em código',
           r.get('marcado') is True, str(r.get('marcado')))

        print('\n=== 10. O PAINEL AVISA QUANDO O SERVIDOR FICOU PARA TRAS ===')
        # Cobranca do dono em 26/08/2026: "voce errou e ficou em silencio
        # numa operacao rodando". Tres relatos daquela semana (botao de
        # excluir usuario, montagem duplicando) tinham a mesma causa — o
        # servidor sem o atualizar.sh — e em todos a informacao dependia de
        # alguem lembrar de avisar. Aqui o painel percebe sozinho.
        agora = datetime.datetime.now(datetime.timezone.utc)
        cenarios = {
            'atrasado_adm': {
                'setor': 'Administração',
                'painel': agora.isoformat(),
                'servidor': (agora - datetime.timedelta(days=2)).isoformat(),
            },
            'atrasado_portaria': {
                'setor': 'Portaria',
                'painel': agora.isoformat(),
                'servidor': (agora - datetime.timedelta(days=2)).isoformat(),
            },
            'em_dia': {
                'setor': 'Administração',
                'painel': agora.isoformat(),
                'servidor': agora.isoformat(),
            },
            'minutos_de_diferenca': {
                'setor': 'Administração',
                'painel': agora.isoformat(),
                'servidor': (agora - datetime.timedelta(minutes=20)).isoformat(),
            },
        }
        r = await pg.evaluate("""async (cenarios) => {
          const original = window.fetch;
          const vistos = [];
          const notifyOriginal = window.notify;
          window.notify = (msg) => { vistos.push(String(msg)); };
          const resultado = {};
          try {
            for(const [nome, c] of Object.entries(cenarios)){
              vistos.length = 0;
              DB.operador = { nome: 'Teste', setor: c.setor };
              window.SUINCO_BUILD_EM = c.painel;
              window.fetch = async () => new Response(
                JSON.stringify({ ok: true, versao: '01/01 abc1234', versaoEm: c.servidor }),
                { status: 200, headers: { 'content-type': 'application/json' } });
              await conferirVersaoDoServidor();
              resultado[nome] = vistos.slice();
            }
          } finally {
            window.fetch = original;
            window.notify = notifyOriginal;
          }
          return resultado;
        }""", cenarios)

        ck('a Administracao e avisada quando o servidor esta atras',
           len(r['atrasado_adm']) == 1, str(r['atrasado_adm'])[:110])
        ck('o aviso nomeia o atualizar.sh, que e a acao que resolve',
           any('atualizar.sh' in m for m in r['atrasado_adm']),
           str(r['atrasado_adm'])[:110])
        ck('a Portaria NAO e avisada — nao e ela quem roda a atualizacao',
           len(r['atrasado_portaria']) == 0, str(r['atrasado_portaria']))
        ck('servidor em dia nao gera aviso nenhum',
           len(r['em_dia']) == 0, str(r['em_dia']))
        # Publicar o painel e atualizar o servidor nunca caem no mesmo
        # minuto. Avisar por 20 minutos de diferenca seria ensinar todo
        # mundo a ignorar o aviso.
        ck('vinte minutos de diferenca nao geram aviso (folga de deploy)',
           len(r['minutos_de_diferenca']) == 0, str(r['minutos_de_diferenca']))

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
