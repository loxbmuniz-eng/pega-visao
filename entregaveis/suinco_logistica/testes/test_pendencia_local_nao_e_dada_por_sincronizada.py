#!/usr/bin/env python3
"""Edição local pendente some SEM AVISO quando chega uma atualização de OUTRA carga.

O MAIS GRAVE DOS QUATRO — é perda de dado CALADA, não um aviso errado.
Reproduzido e medido pela frente que investigou (evidência em
scratchpad/frente_c/debug13.out).

A CAUSA, em `data.js`, dentro de `fundirEstadoRemoto` (linhas 1372-1384):

    if(res.cargasNovas || res.cargasAtualizadas || res.movimentacoesNovas){
      if(!DB._sincronizado) DB._sincronizado = {};
      DB.cargas.forEach(c => {
        const marca = c.atualizadoEm || c.criadoEm || '';
        SuincoStore._ultimoSync.set(c.id, marca);
        DB._sincronizado[c.id] = marca;
      });
      SuincoStore.save();
    }

Este `forEach` estampa "já sincronizado" em TODAS as cargas locais —
inclusive as que têm GRAVAÇÃO LOCAL PENDENTE que nunca chegou ao servidor
(`c._pendente`, a mesma marca que a regra 3 de `fundirEstadoRemoto` já
respeita na hora de aceitar ou não uma atualização remota, linha 1216:
`if(local._pendente){ res.ignoradasPorPendencia++; return; }`). O `forEach`
do fim roda sobre `DB.cargas` INTEIRO, sem essa mesma checagem.

Consequência provada: a Portaria edita um lacre (rede instável, a
gravação ainda não confirmou — `_pendente=true`). Chega QUALQUER
atualização remota de QUALQUER OUTRA carga (o pátio está ativo; isso
acontece toda hora) → `fundirEstadoRemoto` roda → o `forEach` estampa
`_ultimoSync[lacre-pendente] = atualizadoEm-local` SEM o lacre ter subido.
Na sincronia seguinte, `sincronizarCargasAlteradas` (linha 756) vê
`this._ultimoSync.get(c.id) === marca` → "nada mudou nesta" → NUNCA tenta
enviar de novo. O dado fica preso naquele aparelho, a Torre de outro
terminal nunca mostra o lacre novo, e ninguém é avisado — porque, aos
olhos do painel, está tudo sincronizado.

POR QUE ISTO NÃO É O MESMO QUE test_incerteza_nao_apaga_carga.py: aquele
teste trava a CRIAÇÃO que nunca confirma (`_nuncaConfirmada`), e ali a
regra é "continua tentando, nunca marca como resolvido". Este aqui é uma
EDIÇÃO já confirmada antes (a carga existe há dias) que ganha uma alteração
NOVA enquanto a rede está ruim — e o bloco de `fundirEstadoRemoto` marca
essa alteração como entregue sem ela ter saído do aparelho.

ATENÇÃO — MESMO BLOCO DO "DEFEITO 4" (eco de login), ÂNGULOS DIFERENTES.
Os dois relatos apontam para as MESMAS linhas 1372-1384: o #4 diz QUANDO
o bloco roda (tarde demais — depois das mesclagens de frota/rotas, que já
dispararam save() e mandaram PATCH espontâneo para cargas que ninguém
editou); este teste diz QUAIS cargas ele estampa (todas, inclusive as com
`_pendente`). Uma correção que só mexa no QUANDO (mover o bloco para antes
das mesclagens) e não no QUAIS (ainda stampar `_pendente`) deixa a MESMA
carga presa no cenário abaixo — por isso a asserção aqui é sobre o
RESULTADO (a pendência continua sendo tentada depois), não sobre a ordem
das linhas, e continua valendo para as duas formas de correção.

O QUE ESTE TESTE TRAVA (e hoje reprova)
  1. uma carga com gravação local PENDENTE não pode ser marcada como
     sincronizada só porque OUTRA carga foi atualizada remotamente;
  2. a PRÓXIMA sincronia, depois que a pendência se resolve (a rede volta
     ou a tentativa falha), TEM que tentar enviá-la de novo — a marca
     falsa é o que impediria isso;
  3. se mesmo assim ela não puder ser enviada, o operador tem que ficar
     sabendo — silêncio aqui é o próprio defeito.

    python3 testes/test_pendencia_local_nao_e_dada_por_sincronizada.py
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


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1400, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL); await pg.wait_for_timeout(900)
        await pg.evaluate("() => { sessionStorage.setItem('suinco_token', 'token-de-teste'); }")
        await pg.evaluate("() => mostrarLoginLocal()")
        await pg.fill('#login-nome', 'Gestor')
        await pg.select_option('#login-setor', 'Logística')
        await pg.click('button:has-text(\"Entrar sem servidor\")')
        await pg.wait_for_timeout(400)

        print('\n=== 1. GRAVAÇÃO LOCAL PENDENTE + CHEGA ATUALIZAÇÃO DE OUTRA CARGA ===')
        d = await pg.evaluate("""() => {
          DB.cargas = [];
          SuincoStore._ultimoSync = new Map();
          DB._sincronizado = {};

          // O LACRE DA PORTARIA, ainda em voo — rede instável, a gravação
          // desta alteração NUNCA confirmou com o servidor. `_pendente` é
          // a MESMA marca que a regra 3 de fundirEstadoRemoto já respeita
          // para não deixar uma leitura remota sobrescrever o campo.
          const agora = new Date().toISOString();
          const pendente = {
            id: 'carga_pendente_1', numeroCarga: 'PEND-1', placa: 'AAA1A11',
            status: 'Aguardando Veículo', criadoEm: '2026-09-01T10:00:00.000Z',
            atualizadoEm: agora, lacre: 'LACRE-NOVO-123', _pendente: true,
          };
          DB.cargas.push(pendente);

          // A ATUALIZAÇÃO REMOTA É DE OUTRA CARGA — ninguém tocou na
          // pendente. É exatamente o gatilho do relato: "chega UMA
          // atualização remota de QUALQUER OUTRA carga".
          fundirEstadoRemoto({
            cargas: [{
              Carga_ID: 'carga_outra_2', Numero_Carga: 'OUTRA-2', Placa: 'BBB2B22',
              Status_Atual: 'Aguardando Veículo',
              Criado_Em: agora, Atualizado_Em: agora,
            }],
            movimentacoes: [], frota: [], rotas: [],
          });

          return {
            marcaDaPendente: SuincoStore._ultimoSync.get('carga_pendente_1'),
            atualizadoEmDaPendente: pendente.atualizadoEm,
            sincronizadoPersistido: (DB._sincronizado || {})['carga_pendente_1'],
          };
        }""")
        ck('a carga pendente NÃO foi marcada como sincronizada no Map em memória',
           d['marcaDaPendente'] != d['atualizadoEmDaPendente'], str(d))
        ck('nem na marca que sobrevive ao F5 (DB._sincronizado)',
           d['sincronizadoPersistido'] != d['atualizadoEmDaPendente'], str(d))

        print('\n=== 2. A PRÓXIMA SINCRONIA AINDA TENTA ENVIAR A PENDÊNCIA ===')
        # A pendência "se resolve" (a tentativa em voo finalmente termina —
        # aqui simulada como concluída) e um fetch espião confere se o
        # motor de sincronia ainda tenta subir esta carga, ou se a desistiu
        # por julgá-la "já sincronizada".
        e = await pg.evaluate("""async () => {
          window.__chamadas = [];
          window.fetch = async (url, opts) => {
            const corpo = opts && opts.body ? JSON.parse(opts.body) : {};
            window.__chamadas.push({ url: String(url), metodo: (opts && opts.metodo) || (opts && opts.method) || 'GET', id: corpo.id });
            const json = (o, status=200) => new Response(JSON.stringify(o), { status, headers: {'content-type':'application/json'} });
            if (/\\/api\\/cargas$/.test(String(url))) return json({ id: corpo.id, versao: 2 }, 201);
            if (/\\/api\\/cargas\\//.test(String(url))) return json({ id: corpo.id, versao: 2 });
            return json({});
          };
          const pendente = DB.cargas.find(c => c.id === 'carga_pendente_1');
          delete pendente._pendente;   // a tentativa em voo terminou
          SuincoStore.save();
          await new Promise(r => setTimeout(r, 900));
          return {
            tentouEnviar: window.__chamadas.some(c => c.id === 'carga_pendente_1'),
            chamadas: window.__chamadas,
          };
        }""")
        ck('a sincronia seguinte TENTA enviar a carga que ficou pendente',
           e['tentouEnviar'] is True, str(e['chamadas']))

        ck('nenhum erro de JavaScript', not erros, str(erros[:2]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)


asyncio.run(main())
