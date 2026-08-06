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

        print('\n=== CONSOLE ===')
        ck('sem erros de página', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
