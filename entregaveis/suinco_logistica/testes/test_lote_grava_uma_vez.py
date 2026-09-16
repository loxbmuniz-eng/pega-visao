#!/usr/bin/env python3
"""Um lote que chega do servidor grava UMA vez, não uma por linha (16/09/2026).

O RELATO DO DONO: "continua travando e apresentando crashes frequentes".
O registro do navegador dele, colado por ele, fechou a pergunta que estava
aberta desde 11/09:

    15/09/2026, 15:37:27 · 2.2s · aba "torre" · fora de desenho
    15/09/2026, 15:32:27 · 2.1s · (idêntico)
    15/09/2026, 15:27:27 · 2.1s · (idêntico)
      cargas 467 (17 em aberto) · 2992 movimentações · 3893 elementos na tela
      memória 7 MB de 4192 · 0 eventos e 0 desenhos nos 30 s antes · aba visível

Cinco minutos EXATOS entre eles, três vezes. Isso é relógio, não volume — e
os números idênticos provam que nada mudou entre um e outro.

A CAUSA: `INTERVALO_ROTAS_MS = 5*60*1000` reconfere a lista de rotas. Chegam
113 rotas, e `upsertRota` chama `SuincoStore.save()` SEM CONDIÇÃO — que faz
`JSON.stringify(DB)` inteiro, `localStorage.setItem` e ainda varre todas as
cargas em `sincronizarCargasAlteradas()`. Cento e treze vezes seguidas, na
thread que desenha a tela.

MEDIDO (Chromium, 467 cargas + 2992 movimentações = 0,90 MB gravados):

    uma gravação .................    10,1 ms
    113 gravações (as rotas) .....   924,8 ms
    862 gravações (o login) ......  7152,7 ms

O login sofre do mesmo: 749 veículos + 113 rotas = 862 gravações.
"fora de desenho" bate porque gravar não é desenhar; "0 eventos" bate porque
é relógio; os números idênticos batem porque ele regrava a mesma coisa.

O QUE ESTE TESTE TRAVA — contagem, não tempo (tempo varia de máquina):
  1. lote de 113 rotas ............... UMA gravação;
  2. lote de 749 veículos ............ UMA gravação;
  3. lote de login (os dois juntos) .. UMA gravação;
  4. rota avulsa FORA de lote ........ continua gravando na hora;
  5. o dado precisa estar GRAVADO no fim — economizar gravação não pode
     virar dado perdido, que é o modo de falhar caro deste arquivo;
  6. erro no meio do lote não pode deixar o painel mudo para sempre.
"""
import asyncio, sys
from playwright.async_api import async_playwright

PAINEL = 'file:///home/user/pega-visao/entregaveis/suinco_logistica/index.html'
falhas = []
def ck(nome, ok, extra=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {extra}" if extra else ''))
    if not ok: falhas.append(nome)

# Conta gravações no cofre do painel sem tocar em mais nada.
ESPIAO = """() => {
  const real = Storage.prototype.setItem;
  window.__gravacoes = [];
  Storage.prototype.setItem = function(k, v){
    if(k === 'suinco_painel_v1') window.__gravacoes.push(v.length);
    return real.apply(this, arguments);
  };
  window.__zerar = () => { window.__gravacoes = []; };
}"""

# Volume igual ao do navegador do dono, para o teste medir o caso real.
SEMEAR = """() => {
  DB.cargas = []; DB.movimentacoes = [];
  for(let i=0;i<467;i++) DB.cargas.push({
    id:'c'+i, numeroCarga:'118'+(700+i), placa:'RNW7J'+(i%10), motorista:'MOT '+i,
    rota:'5'+(10+i%40), transportadora:'TRANSP '+(i%20), tipoVeiculo:'Carreta',
    peso:20000+i, status:'EMBARQUE FINALIZADO', criadoEm:'2026-09-15T12:00:00.000Z',
    atualizadoEm:'2026-09-15T12:00:00.000Z',
  });
  for(let i=0;i<2992;i++) DB.movimentacoes.push({
    id:'m'+i, cargaId:'c'+(i%467), placa:'RNW7J'+(i%10), statusAnterior:'A',
    statusNovo:'B', setor:'Expedicao', data:'2026-09-15T12:00:00.000Z', operador:'Rene',
  });
}"""

def rotas(n):
    return ("[" + ",".join(
        f'{{Codigo:"9{i:03d}",Nome:"ROTA TESTE {i}",Detalhe:"",Operador:"",Ativa:true}}'
        for i in range(n)) + "]")

def frota(n):
    return ("[" + ",".join(
        f'{{Placa:"TST{i:04d}",Transportadora:"T{i%10}",Tipo_Veiculo:"Truck",'
        f'Motorista:"M{i}",Capacidade_kg:11000,UF:"MG"}}'
        for i in range(n)) + "]")

async def abrir(p):
    nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
    pg = await nav.new_page()
    await pg.goto(PAINEL)
    await pg.wait_for_function('typeof fundirEstadoRemoto === "function"')
    await pg.evaluate(ESPIAO)
    await pg.evaluate(SEMEAR)
    return nav, pg

async def main():
    async with async_playwright() as p:

        print('\n=== 1. AS 113 ROTAS DOS 5 MINUTOS ===')
        nav, pg = await abrir(p)
        n = await pg.evaluate("""() => {
          window.__zerar();
          fundirEstadoRemoto({incremental:true, cargas:[], movimentacoes:[],
                              frota:[], rotas:""" + rotas(113) + """});
          return window.__gravacoes.length;
        }""")
        ck('113 rotas geram UMA gravação', n == 1, f'gravou {n}x')
        existe = await pg.evaluate("""() => !!ROTA_POR_CODIGO.get('9112')""")
        ck('e a última rota do lote está aplicada', existe)
        gravado = await pg.evaluate(
            """() => { const r = localStorage.getItem('suinco_painel_v1');
                       return r ? JSON.parse(r).cargas.length : -1; }""")
        ck('o cofre local tem as 467 cargas depois do lote', gravado == 467, f'{gravado}')
        await nav.close()

        print('\n=== 2. OS 749 VEÍCULOS ===')
        nav, pg = await abrir(p)
        n = await pg.evaluate("""() => {
          window.__zerar();
          fundirEstadoRemoto({incremental:true, cargas:[], movimentacoes:[],
                              rotas:[], frota:""" + frota(749) + """});
          return window.__gravacoes.length;
        }""")
        ck('749 veículos geram UMA gravação', n == 1, f'gravou {n}x')
        # Economizar gravação não pode virar dado perdido: o cofre local
        # precisa ter a frota depois do lote, não só a memória.
        no_cofre = await pg.evaluate(
            """() => { const r = localStorage.getItem('suinco_painel_v1');
                       if(!r) return -1;
                       const f = JSON.parse(r).frota || [];
                       return f.filter(x => String(x.placa||'').startsWith('TST')).length; }""")
        ck('as 749 placas estão GRAVADAS no cofre local', no_cofre == 749, f'{no_cofre} no cofre')
        na_memoria = await pg.evaluate(
            """() => (DB.frota||[]).filter(x => String(x.placa||'').startsWith('TST')).length""")
        ck('e também na memória', na_memoria == 749, f'{na_memoria}')
        await nav.close()

        print('\n=== 3. O LOGIN: OS DOIS LOTES JUNTOS ===')
        nav, pg = await abrir(p)
        n = await pg.evaluate("""() => {
          window.__zerar();
          fundirEstadoRemoto({incremental:true, cargas:[], movimentacoes:[],
                              frota:""" + frota(749) + """, rotas:""" + rotas(113) + """});
          return window.__gravacoes.length;
        }""")
        ck('862 linhas geram UMA gravação, não 862', n == 1, f'gravou {n}x')
        await nav.close()

        print('\n=== 4. FORA DE LOTE NADA MUDA ===')
        nav, pg = await abrir(p)
        n = await pg.evaluate("""() => {
          window.__zerar();
          upsertRota('777', 'ROTA AVULSA', '', '', {});
          return window.__gravacoes.length;
        }""")
        ck('uma rota cadastrada pela tela grava na hora', n == 1, f'gravou {n}x')
        await nav.close()

        print('\n=== 5. ERRO NO MEIO DO LOTE NÃO DEIXA O PAINEL MUDO ===')
        nav, pg = await abrir(p)
        tem = await pg.evaluate("() => typeof SuincoStore.emLote === 'function'")
        ck('SuincoStore.emLote existe', tem)
        ok = tem and await pg.evaluate("""() => {
          try { SuincoStore.emLote(() => { throw new Error('estouro'); }); } catch(e){}
          window.__zerar();
          upsertRota('778', 'DEPOIS DO ERRO', '', '', {});
          return window.__gravacoes.length === 1;
        }""")
        ck('depois de um erro dentro do lote, gravar volta a funcionar', ok)
        await nav.close()

    print()
    if falhas:
        print(f"RESULTADO: {len(falhas)} FALHA(S) — " + '; '.join(falhas))
        sys.exit(1)
    print("RESULTADO: tudo verde")

asyncio.run(main())
