#!/usr/bin/env python3
"""Placa cadastrada não pode fazer todo terminal reler o pátio (14/09/2026).

PEDIDO DO DONO: "eu nao quero travamento funcionando com 100 pessoas se eu
quiser, por isso quero essa folga".

MEDIDO com o medidor de lotação, contra banco semeado igual ao de produção
(761 cargas, 3.044 movimentações, 77.095 clientes):

    operadores | ciclo normal p95 |  a rajada p95 | dados na rajada
            10 |          197 ms  |       710 ms  |    12,3 MB
            50 |          130 ms  |     2.192 ms  |    61,3 MB
           100 |          263 ms  |     4.035 ms  |   122,6 MB
           150 |          285 ms  |     6.656 ms  |   183,9 MB

O ciclo normal aguenta 150 operadores a 285 ms — o painel NÃO é lento. Quem
derruba é a rajada: `POST /frota` emitia `frota:atualizada` para a sala
inteira e TODO terminal respondia com `pullTudo()`, uma leitura COMPLETA.
Linear: 1,23 MB e 41 ms por operador conectado. Uma placa digitada, 100
pessoas na tela = 123 MB no mesmo instante.

E era desperdício puro: a MESMA rota já emite `carga:atualizada` para cada
carga afetada, com o conteúdo. Faltava só o dado da FROTA — que agora vem
dentro do próprio aviso.

O QUE ESTE TESTE TRAVA:
  1. aviso COM o veículo -> ZERO chamadas de rede, e a frota atualiza;
  2. aviso SEM o veículo (servidor antigo, entre o Vercel e o atualizar.sh)
     -> busca SÓ a frota, e NUNCA `/api/estado`.
"""
import asyncio, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []
def ck(nome, ok, extra=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {extra}" if extra else ''))
    if not ok: falhas.append(nome)

PREPARO = """() => {
  window.__urls = [];
  localStorage.setItem('suinco_token', 'token-de-teste');
  SuincoSharePoint.SP_CONFIG.ativo = true;
  SuincoSharePoint.SP_CONFIG.api = 'https://api.embarquesuinco.com.br';
  window.fetch = async (url) => {
    const u = String(url); window.__urls.push(u);
    const corpo = u.includes('/api/frota')
      ? [{ placa: 'RAJ1A11', transportadora: 'T', tipoVeiculo: 'Truck',
           motorista: 'M', capacidadeKg: 1000, uf: 'MG', precisaRevisao: false }]
      : { marca: '2026-09-14T11:00:00.000Z', completo: false, cargas: [], movimentacoes: [] };
    return { ok: true, status: 200, json: async () => corpo,
             text: async () => JSON.stringify(corpo) };
  };
}"""

async def main():
    print('\n=== 1. O AVISO TRAZ O VEÍCULO: NENHUMA CHAMADA DE REDE ===')
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL); await pg.wait_for_timeout(1300)
        await pg.evaluate(PREPARO)

        r1 = await pg.evaluate("""() => {
            window.__urls = [];
            SuincoSharePoint.receberFrotaAtualizada({
              placa: 'RAJ2B22',
              veiculo: { placa: 'RAJ2B22', transportadora: 'TRANSP MEDIDA',
                         tipoVeiculo: 'Carreta', motorista: 'Jose',
                         capacidadeKg: 28000, uf: 'MG', precisaRevisao: false },
            });
            const v = (DB.frota || []).find(f => f.placa === 'RAJ2B22');
            return { chamadas: window.__urls.slice(),
                     placaEntrou: !!v,
                     transportadora: v && v.transportadora };
        }""")
        ck('ZERO chamadas de rede — o pátio não é relido', len(r1['chamadas']) == 0, str(r1['chamadas']))
        ck('e a frota foi atualizada na memória', r1['placaEntrou'], str(r1))
        ck('com o dado que veio no aviso', r1['transportadora'] == 'TRANSP MEDIDA', str(r1))

        print('\n=== 2. SERVIDOR ANTIGO (aviso sem veículo): SÓ A FROTA ===')
        r2 = await pg.evaluate("""async () => {
            window.__urls = [];
            SuincoSharePoint.receberFrotaAtualizada({ placa: 'RAJ1A11' });
            await new Promise(r => setTimeout(r, 300));
            return window.__urls.slice();
        }""")
        ck('buscou a frota', any('/api/frota' in u for u in r2), str(r2))
        ck('e NUNCA o estado completo — é isso que travava 100 pessoas',
           not any('/api/estado' in u for u in r2), str(r2))
        ck('nenhum erro de JavaScript', not erros, str(erros[:1]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)

asyncio.run(main())
