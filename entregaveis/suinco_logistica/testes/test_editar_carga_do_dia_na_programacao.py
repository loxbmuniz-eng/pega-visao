#!/usr/bin/env python3
"""Mexer na carga do dia pela Programação, sem símbolo de proibido (27/08/2026).

O RELATO, do dono:

    "eu quero entender porque o antonio ta tentando mexer nas cargas de hoje
     pela programacao aparece o simbolo de proibido, voce precisa liberar
     acesso pra administracao e logistica e nao bloquear"

    "é nas cargas do dia (...) nao importa onde, precisa ter acesso a editar
     a qualquer coisa que quiserem"

O QUE ESTAVA ACONTECENDO. Na Montagem do dia, a linha trancava assim que
virava carga (`efetivada_em`): perdia o clique, ficava apagada e ganhava o
cursor de proibido. Valia para todo mundo, inclusive para a Administração.

E o bloqueio NÃO era de setor: `camposEditaveisPor()` no servidor sempre deu
a lista inteira para a Logística, e a Administração herda ela. Era só tela.

POR QUE NÃO BASTAVA DESTRAVAR. O servidor recusa alterar montagem já
efetivada com 409 JA_EFETIVADA, e com razão: "depois de efetivada a linha é
histórico; quem quiser mudar mexe na CARGA, que tem log de revisões". Tirar
o cadeado sem mais nada faria o campo mudar na tela e a carga continuar
igual — troca um "não" honesto por uma mentira.

A SAÍDA, que é o que o dono pediu na mesma mensagem ("na programacao a
visao de edicao seja semelhante a da torre de controle"): depois de virar
carga, a linha deixa de ser rascunho e passa a ser uma JANELA para a carga.
Os campos chamam as MESMAS funções da Torre e da Fila de Programados
(atualizarNumeroCargaUI, atualizarPlacaUI, atualizarPesoUI,
atualizarSequenciaUI), então a alteração cai na carga, entra no log de
revisões e sobe para todos os setores.

    python3 testes/test_editar_carga_do_dia_na_programacao.py
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


async def entrar(pg, setor):
    """Entra e assume o setor pedido.

    O login SEM SERVIDOR oferece só Logística, Portaria, Expedição e
    Faturamento — Administração e os demais existem só com servidor. Para
    medir a regra da Administração aqui, entra-se como Logística e troca-se
    o setor do operador na memória, que é exatamente o que o painel lê em
    podeEditarCargaDoDia().
    """
    await pg.goto(PAINEL)
    await pg.wait_for_timeout(1100)
    await pg.evaluate("() => mostrarLoginLocal()")
    await pg.fill('#login-nome', 'Antonio')
    base = setor if setor in ('Logística', 'Portaria', 'Expedição', 'Faturamento') else 'Logística'
    await pg.select_option('#login-setor', base)
    await pg.click('button:has-text("Entrar sem servidor")')
    await pg.wait_for_timeout(900)
    if base != setor:
        await pg.evaluate("(s) => { DB.operador.setor = s; }", setor)


# Uma linha de montagem que JÁ virou carga — o caso do Antonio.
# Devolve o resumo da linha E a linha ABERTA, porque os doze campos do
# formulário só existem depois do clique.
MONTA = """(setor) => {
  const placa = (DB.frota && DB.frota[0] && DB.frota[0].placa) || '';
  const carga = criarCargaProgramada({
    placa, numeroCarga: '880001', cliente: 'C', destino: 'D',
    rota: '500', peso: 8000, sequencia: 3,
    operador: {nome:'Ana', setor:'Logística'} });
  const m = { montagem_id: 'mont_teste_1', rota_codigo: '500', rota_nome: 'Patos',
              apelido_rota: '', sequencia: 3, numero_carga: '880001',
              placa, peso: 8000, tipo_operacao: 'Entrega',
              efetivada_em: new Date().toISOString(), cancelada_em: null,
              carga_id: carga.id };
  const fechada = linhaMontagemHtml(m);
  _montagemAberta = 'mont_teste_1';
  const aberta = linhaMontagemHtml(m);
  _montagemAberta = null;
  return { html: fechada, aberta, cargaId: carga.id, placa };
}"""


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        erros = []

        for setor, deveEditar in [('Logística', True), ('Administração', True),
                                  ('Portaria', False)]:
            pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
            pg.on('pageerror', lambda e: erros.append(str(e)))
            await entrar(pg, setor)
            r = await pg.evaluate(MONTA, setor)
            html = r['html']

            print(f'\n=== {setor.upper()} ===')
            temCampoPlaca = 'atualizarPlacaUI' in html
            temCampoPeso = 'atualizarPesoUI' in html
            temCampoNumero = 'atualizarNumeroCargaUI' in html
            gravaNaMontagem = "alterarMontagemUI('mont_teste_1','sequencia'" in html
            fraca = 'linha-fraca' in html

            if deveEditar:
                ck('a placa é editável na própria linha', temCampoPlaca)
                ck('o peso é editável na própria linha', temCampoPeso)
                ck('o número da carga é editável na própria linha', temCampoNumero)
                ck('a linha NÃO fica apagada (sem cursor de proibido)', not fraca)
                ck('e a gravação vai para a CARGA, não para o rascunho',
                   not gravaNaMontagem and f"'{r['cargaId']}'" in html)

                # O RELATO DE 27/08: "o tonin nao consegue mais abrir a carga
                # e editar detalhadamente cada carga, quantidade de entrega,
                # ganchos, isso precisa ser expansivel e nao pode faltar onde
                # colocar". Três células na linha não substituem o formulário.
                ab = r['aberta']
                cid = r['cargaId']
                ck('a linha ABRE o formulário completo', 'mont-detalhe' in ab
                   and 'mont-form' in ab)
                faltando = [rot for rot, marca in [
                    ('Qtd. Entregas', f"atualizarEntregasUI('{cid}'"),
                    ('Qtd. Ganchos', f"atualizarGanchosUI('{cid}'"),
                    ('Motorista', f"atualizarMotoristaUI('{cid}'"),
                    ('Transportadora', f"atualizarTransportadoraUI('{cid}'"),
                    ('Observações', f"atualizarObservacoesUI('{cid}'"),
                    ('Tipo de Operação', f"atualizarPraOndeUI('{cid}'"),
                    ('Paletizada', f"atualizarPaletizadaUI('{cid}'"),
                    ('Sequência', f"atualizarSequenciaUI('{cid}'"),
                    ('Peso', f"atualizarPesoUI('{cid}'"),
                    ('Número de Carga', f"atualizarNumeroCargaUI('{cid}'"),
                    ('Placa', f"atualizarPlacaUI('{cid}'"),
                ] if marca not in ab]
                # Onze gravam; Tipo de Veículo vem da Frota e Rota vem do
                # modelo do dia — os dois aparecem, sem edição, por decisão
                # antiga do formulário da montagem.
                ck('os onze campos editáveis gravam na CARGA, nenhum faltando',
                   not faltando,
                   'faltando: ' + ', '.join(faltando) if faltando else '11 de 11')
                ck('nada do formulário grava no rascunho da montagem',
                   "alterarMontagemUI('mont_teste_1'" not in ab)
                ck('e a linha não oferece "Criar carga" para carga que já existe',
                   'efetivarMontagemUI' not in ab)
            else:
                ck('setor sem permissão continua só lendo',
                   not (temCampoPlaca or temCampoPeso or temCampoNumero))
                ck('e a linha segue marcada como histórico', fraca)
                ck('e nem abre formulário', 'mont-detalhe' not in r['aberta'])
            await pg.close()

        # A edição precisa CHEGAR na carga, não só existir na tela.
        pg = await nav.new_page(viewport={'width': 1280, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await entrar(pg, 'Administração')
        print('\n=== A ALTERAÇÃO CHEGA NA CARGA ===')
        d = await pg.evaluate("""() => {
              const placa = (DB.frota && DB.frota[0] && DB.frota[0].placa) || '';
              const c = criarCargaProgramada({ placa, numeroCarga: '880002',
                cliente: 'C', destino: 'D', rota: '500', peso: 8000,
                operador: {nome:'Ana', setor:'Logística'} });
              const antes = c.atualizadoEm;
              atualizarPesoUI(c.id, '12345');
              const depois = getCarga(c.id);
              return { peso: depois.peso, carimbou: depois.atualizadoEm !== antes };
            }""")
        ck('o peso mudou na carga de verdade', str(d['peso']) == '12345', str(d['peso']))
        # A TRILHA DE AUDITORIA É DO SERVIDOR, e é ele quem manda. Os campos
        # de carga gravam em `carga_revisoes` (lida por GET /cargas/:id/revisoes),
        # não em DB.alteracoes — o painel sem servidor não tem como exercitar
        # isso, e afirmar aqui que "ficou no log" seria medir a camada errada e
        # dar um verde falso. Deste lado o que se prova é que a carga mudou e
        # foi carimbada para subir.
        ck('e a carga foi carimbada para subir ao servidor', d['carimbou'])

        print('\n=== SEM ERRO DE JAVASCRIPT ===')
        ck('console limpo', not erros, str(erros))
        await nav.close()

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print(f'    · {f}')
        sys.exit(1)
    print('  Tudo verde.')


asyncio.run(main())
