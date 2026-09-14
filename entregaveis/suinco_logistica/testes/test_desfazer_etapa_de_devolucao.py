#!/usr/bin/env python3
"""Um clique errado na devolução tem volta (14/09/2026).

Levantado na auditoria de prontidão, antes de as devoluções entrarem em
operação oficial. O ciclo inteiro funcionava — cada setor no seu passo, a
recusa ensinando, a trilha guardando tudo. Faltava DESFAZER.

Carimbada a etapa errada, ninguém conseguia voltar: nem quem carimbou, nem
a Logística, nem a Administração. Todos recebiam 409 "Não é possível ir de
X direto para Y", porque a máquina de estados só conhecia o sentido de ida.
O único socorro era a Administração abrir "↩ Alterações" e restaurar uma
revisão — que a Logística não enxerga e que ninguém procura quando o que
houve foi um toque errado no celular às 2 da manhã.

A Portaria fica aberta 24 horas. Devolução travada até alguém acordar é
caminhão parado no portão.

O que este teste trava, na TELA (o servidor tem a suíte 18):

  1. O botão de desfazer aparece para quem carimbou o passo.
  2. A pergunta EXPLICA — qual carimbo sai, de quem era, para onde volta,
     e o que continua gravado. Regra da casa: "botão desabilitado não
     ensina o caminho, só nega".
  3. Desfeita a etapa, a devolução volta UMA casa e o carimbo some.
  4. O passo pode ser dado de novo — desfazer não trava.
  5. Quem NÃO fez o passo não vê o botão (a Central de Notas não apaga a
     pesagem do Faturamento).
  6. Devolução recém-lançada não mostra botão nenhum: não há o que desfazer.

Exige o backend local no ar e os operadores de teste.

    python3 testes/test_desfazer_etapa_de_devolucao.py
"""
import asyncio, os, sys
from playwright.async_api import async_playwright

API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
PAINEL_ARQ = '/home/user/pega-visao/entregaveis/suinco_logistica/index.html'
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
falhas = []

def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok: falhas.append(nome)

async def abrir(nav, email, rotulo):
    ctx = await nav.new_context()
    pg = await ctx.new_page()
    html = open(PAINEL_ARQ, encoding='utf-8').read()
    html = html.replace("api: 'https://api.embarquesuinco.com.br'", f"api: '{API}'")
    html = html.replace('https://api.embarquesuinco.com.br/socket.io/socket.io.js',
                        f'{API}/socket.io/socket.io.js')
    url = f'{API}/__painel_desf_{rotulo}'
    await pg.route(url, lambda r: asyncio.ensure_future(
        r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
    await pg.goto(url); await pg.wait_for_timeout(1000)
    await pg.fill('#login-email', email)
    await pg.fill('#login-senha', SENHA)
    await pg.click('#btn-entrar'); await pg.wait_for_timeout(3000)
    return ctx, pg


async def ver_devolucoes(pg):
    """Abre a aba e recarrega — sem isso DB.devolucoes fica vazio e o teste
    mede a ausência da lista, não a ausência do botão."""
    await pg.evaluate("() => abrirTab('devolucoes')")
    await pg.wait_for_timeout(400)
    await pg.evaluate("async () => { await carregarDevolucoes(); }")
    await pg.wait_for_timeout(900)

async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        ctxA, pgA = await abrir(nav, 'chefe@teste.local', 'admin')
        setor = await pgA.evaluate("() => DB.operador && DB.operador.setor")
        if setor != 'Administração':
            ck('admin logado', False, str(setor)); await nav.close(); return 1

        # A 510 é rota do cadastro oficial (seed.js) e existe em qualquer
        # banco onde o instalador rodou — não inventa código de rota nem
        # depende de outra suíte ter criado o dela.

        async def nova(passos, tipo='DEVOLUCAO'):
            """Cria e leva a devolução até onde o teste precisa, pela API."""
            return await pgA.evaluate("""async ([passos, tipo]) => {
              const hoje = new Date().toISOString().slice(0,10);
              const d = await SuincoSharePoint.devolucoes.criar({
                dataDev: hoje, regiao:'DESFAZER', tipo,
                rotas: tipo === 'SOBRA' ? [] : ['510'],
                notaTransferencia:'DESF'+Date.now(),
                itens: [],
              });
              for (const para of passos) {
                await SuincoSharePoint.devolucoes.etapa(d.id, { para });
              }
              return d.id;
            }""", [passos, tipo])

        print('\n=== 1. QUEM CARIMBOU VÊ O BOTÃO DE DESFAZER ===')
        idA = await nova(['Recebida na Portaria', 'Conferida no Faturamento'])
        ctxF, pgF = await abrir(nav, 'dev.diego@devteste.local', 'fat')
        setorF = await pgF.evaluate("() => DB.operador && DB.operador.setor")
        ck('Faturamento logado', setorF == 'Faturamento', str(setorF))
        await ver_devolucoes(pgF)
        botao = await pgF.evaluate("""(id) => {
          const d = getDevolucao(id);
          return d ? blocoDesfazerDev(d) : '(devolução não chegou ao painel)';
        }""", idA)
        ck('o Faturamento vê o botão de desfazer o próprio carimbo',
           'Desfazer' in botao, botao[:120])

        print('\n=== 2. QUEM NÃO FEZ O PASSO NÃO VÊ O BOTÃO ===')
        ctxN, pgN = await abrir(nav, 'dev.notas@devteste.local', 'notas')
        await ver_devolucoes(pgN)
        botaoN = await pgN.evaluate("""(id) => {
          const d = getDevolucao(id);
          return d ? blocoDesfazerDev(d) : '(devolução não chegou ao painel)';
        }""", idA)
        ck('a Central de Notas NÃO vê botão para apagar a pesagem do Faturamento',
           botaoN == '', repr(botaoN)[:120])
        await ctxN.close()

        print('\n=== 3. A PERGUNTA EXPLICA ANTES DE APAGAR ===')
        perg = await pgF.evaluate("""(id) => {
          let texto = null;
          const orig = window.confirm;
          window.confirm = (t) => { texto = t; return false; };   // recusa: nada é apagado
          try { desfazerEtapaDevolucaoUI(id); } finally { window.confirm = orig; }
          return texto;
        }""", idA)
        ck('houve pergunta antes de desfazer', bool(perg), repr(perg)[:80])
        if perg:
            ck('a pergunta diz QUAL etapa sai', 'Conferida no Faturamento' in perg)
            ck('a pergunta diz PARA ONDE volta', 'Recebida na Portaria' in perg)
            ck('a pergunta diz QUEM carimbou', 'por' in perg.lower())
            ck('a pergunta avisa que o dado digitado CONTINUA',
               'CONTINUA' in perg or 'continua' in perg)
        estado = await pgF.evaluate("""async (id) => {
          const hoje = new Date().toISOString().slice(0,10);
          const l = await SuincoSharePoint.devolucoes.listar(hoje, hoje);
          const d = (l.devolucoes||l||[]).find(x=>x.id===id);
          return d && d.status;
        }""", idA)
        ck('responder NÃO não muda nada', estado == 'Conferida no Faturamento', str(estado))

        print('\n=== 4. DESFEITA, A DEVOLUÇÃO VOLTA UMA CASA ===')
        erro = await pgF.evaluate("""async (id) => {
          const orig = window.confirm; window.confirm = () => true;
          try { await SuincoSharePoint.devolucoes.desfazerEtapa(id); return null; }
          catch(e){ return (e && e.message) || String(e); }
          finally { window.confirm = orig; }
        }""", idA)
        ck('o servidor aceitou o desfazer', erro is None, str(erro))
        await pgF.wait_for_timeout(1800)
        depois = await pgF.evaluate("""async (id) => {
          const hoje = new Date().toISOString().slice(0,10);
          const l = await SuincoSharePoint.devolucoes.listar(hoje, hoje);
          const d = (l.devolucoes||l||[]).find(x=>x.id===id) || {};
          return { status: d.status, carimbo: (d.carimbos||{}).faturamento || null,
                   anterior: (d.carimbos||{}).portaria || null };
        }""", idA)
        ck('voltou para "Recebida na Portaria"',
           depois['status'] == 'Recebida na Portaria', str(depois['status']))
        ck('o carimbo do passo desfeito saiu', depois['carimbo'] is None, str(depois['carimbo']))
        ck('o carimbo da etapa ANTERIOR continua', bool(depois['anterior']))

        print('\n=== 5. O PASSO PODE SER DADO DE NOVO ===')
        de_novo = await pgF.evaluate("""async (id) => {
          try { const d = await SuincoSharePoint.devolucoes.etapa(id,
                  { para: 'Conferida no Faturamento' });
                return d.status; }
          catch(e){ return 'ERRO: ' + (e && e.message); }
        }""", idA)
        ck('desfazer não trava a devolução',
           de_novo == 'Conferida no Faturamento', str(de_novo))

        print('\n=== 6. DEVOLUÇÃO RECÉM-LANÇADA NÃO TEM O QUE DESFAZER ===')
        idB = await nova([])
        await pgA.wait_for_timeout(1200)
        vazio = await pgA.evaluate("""async (id) => {
          const hoje = new Date().toISOString().slice(0,10);
          const l = await SuincoSharePoint.devolucoes.listar(hoje, hoje);
          const d = (l.devolucoes||l||[]).find(x=>x.id===id);
          return d ? blocoDesfazerDev(d) : '(não achei a devolução)';
        }""", idB)
        ck('sem etapa carimbada, sem botão', vazio == '', repr(vazio)[:100])

        await ctxF.close(); await ctxA.close(); await nav.close()

    print('\n' + ('TODOS OS TESTES PASSARAM' if not falhas
                  else f'{len(falhas)} FALHA(S): ' + ', '.join(falhas)))
    return 1 if falhas else 0

sys.exit(asyncio.run(main()))
