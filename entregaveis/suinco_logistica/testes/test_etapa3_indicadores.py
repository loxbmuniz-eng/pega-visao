#!/usr/bin/env python3
"""Tema 2027, Etapa 3 (Indicadores) — prova de que a camada muda a faixa
BI e de que o `index.html` PUBLICADO (sem a camada) não tem essas mudanças.

Compara dois arquivos:
  - o PUBLICADO de verdade, extraído da branch de entrega
    (`claude/pega-visao-up19-deliverables-6cqhjb`) para
    /tmp/publicado_index.html antes de rodar este teste;
  - o `index.html` gerado por `build_arquivo_unico.py` NESTE worktree, já
    com `tema2027/20_indicadores.css` preenchido.

Três marcas da Etapa 3, escolhidas por não dependerem de nenhum token que
outra etapa (1, 2, 4, 5, 6) ainda vai definir — só de valores literais do
próprio arquivo desta etapa, para o teste valer isoladamente em paralelo:

  1. `.bento.bi-faixa .stat-box::after` (a régua de cor) fica mais grossa:
     3px no publicado, 4px na camada nova.
  2. `.bento.bi-faixa .stat-num` cresce: 21px no publicado, 22px na camada
     nova.
  3. A régua da caixa "Aguardando Veículo" (`.stat-box::after` dela) ganha
     um pulso de opacidade (`@keyframes t27-pulso`) só quando a contagem é
     maior que zero — animation-name 'none' no publicado, 't27-pulso' na
     camada nova.

Preparar o arquivo publicado (uma vez, ou sempre que a branch de entrega
mudar):

    git show claude/pega-visao-up19-deliverables-6cqhjb:\
entregaveis/suinco_logistica/index.html > /tmp/publicado_index.html

Rodar depois de `python3 build_arquivo_unico.py`:

    PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium \
        python3 testes/test_etapa3_indicadores.py
"""
import asyncio
import pathlib
import sys

from playwright.async_api import async_playwright

BASE = pathlib.Path(__file__).parent.parent
NOVO = f"file://{BASE / 'index.html'}"
PUBLICADO = 'file:///tmp/publicado_index.html'

falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


# Mesma semente de test_faixa_indicadores_bi.py: cargas nascendo ao longo
# de 14 dias, para "Aguardando Veículo" nascer com contagem > 0 e a Torre
# usar de fato o formato .bi-faixa.
SEED = """(qtd) => {
  DB.operador = {nome:'Chefe', setor:'Administração'};
  const st = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
              'Embarque Finalizado','Faturado','Seguiu Viagem'];
  const tr = ['TRANSPORTES ALFA','LOG BETA','RODO GAMA','EXPRESSO DELTA'];
  DB.frota = []; DB.cargas = []; DB.movimentacoes = [];
  const agora = Date.now();
  for(let i=0;i<qtd;i++){
    const placa = 'ABC' + (1+i%9) + 'D' + String(10+(i*7)%89);
    DB.frota.push({placa, transportadora:tr[i%4], tipoVeiculo:'Truck',
                   uf:'SP', capacidadeKg:14000, atualizadoEm:new Date().toISOString()});
    const s = st[i%6];
    const diasAtras = 13 - Math.floor(i / (qtd/14));
    const nasce = agora - diasAtras*86400000 - (i%9)*3600000;
    const c = {
      id:'carga_'+i, numeroCarga:String(10200+i), placa,
      transportadora:tr[i%4], tipoVeiculo:'Truck', motorista:'Motorista '+i,
      cliente:'Cliente '+(i%9), destino:'Cidade '+(i%7), produto:'Suíno resfriado',
      peso:8000+(i*137)%9000, doca:String(1+i%6), sequencia:i+1,
      observacoes:'', praOnde:'Entrega', rota:'500', paletizada:'Não',
      qtdGanchos:10+i%40, qtdEntregas:1+i%4, status:s, aguardandoCarga:false,
      criadoEm:new Date(nasce).toISOString(), criadoPor:'Logística',
      programadoEm:new Date(nasce).toISOString(),
      atualizadoEm:new Date(nasce).toISOString()
    };
    DB.cargas.push(c);
    const passo = 20 + (13 - diasAtras) * 6 + (i % 5) * 3;
    st.slice(0, st.indexOf(s)+1).forEach((sx,k)=>{
      DB.movimentacoes.push({id:'mov_'+i+'_'+k, cargaId:c.id, placa,
        statusAnterior:k?st[k-1]:null, statusNovo:sx, operador:'Op '+(k%4),
        setor:['Logística','Portaria','Expedição','Expedição','Faturamento','Portaria'][k],
        timestamp:new Date(nasce + k*passo*60000).toISOString(),
        numeroCarga:c.numeroCarga});
    });
    if(s === 'Seguiu Viagem') c.concluidoEm = new Date(nasce + 5*passo*60000).toISOString();
  }
  document.getElementById('modal-operador')?.classList.remove('open');
  renderAll();
}"""

MEDIR = """() => {
  const cx = (rot) => [...document.querySelectorAll('#torre-stats .stat-box')]
    .find(e => (e.querySelector('.stat-label')||{}).textContent === rot);
  const av = cx('Aguardando Veículo');
  const outra = [...document.querySelectorAll('#torre-stats .stat-box')]
    .find(e => (e.querySelector('.stat-label')||{}).textContent === 'Aguardando Embarque');
  const afterW = (e) => e ? getComputedStyle(e, '::after').width : null;
  const numFS = (e) => e ? getComputedStyle(e.querySelector('.stat-num')).fontSize : null;
  const animName = (e) => e ? getComputedStyle(e, '::after').animationName : null;
  return {
    reguaWidth: afterW(outra),
    numFontSize: numFS(outra),
    pulsoAguardandoVeiculo: animName(av),
  };
}"""


async def medir_arquivo(nav, url):
    pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
    erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    await pg.goto(url)
    await pg.wait_for_timeout(700)
    await pg.evaluate(SEED, 56)
    await pg.wait_for_timeout(800)
    r = await pg.evaluate(MEDIR)
    r['erros'] = erros
    await pg.close()
    return r


async def main():
    if not pathlib.Path('/tmp/publicado_index.html').exists():
        ck('/tmp/publicado_index.html existe (extraído da branch de entrega)', False,
           'rode: git show claude/pega-visao-up19-deliverables-6cqhjb:'
           'entregaveis/suinco_logistica/index.html > /tmp/publicado_index.html')
        print('\n=== RESULTADO ===\n  FALHAS: publicado ausente')
        return 1

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)

        pub = await medir_arquivo(nav, PUBLICADO)
        novo = await medir_arquivo(nav, NOVO)

        await nav.close()

    print('=== PUBLICADO (esperado: SEM a camada Tema 2027) ===')
    print(' ', pub)
    print('=== NOVO (esperado: COM a camada Tema 2027) ===')
    print(' ', novo)
    print()

    print('=== 1. RÉGUA DE COR MAIS GROSSA (3px → 4px) ===')
    ck('publicado tem a régua em 3px (REPROVA como camada nova)',
       pub['reguaWidth'] == '3px', pub['reguaWidth'])
    ck('novo tem a régua em 4px (a Etapa 3 mudou)',
       novo['reguaWidth'] == '4px', novo['reguaWidth'])

    print('\n=== 2. NÚMERO DA FAIXA CRESCE (21px → 22px) ===')
    ck('publicado tem o número em 21px (REPROVA como camada nova)',
       pub['numFontSize'] == '21px', pub['numFontSize'])
    ck('novo tem o número em 22px (a Etapa 3 mudou)',
       novo['numFontSize'] == '22px', novo['numFontSize'])

    print('\n=== 3. PULSO NA CAIXA "AGUARDANDO VEÍCULO" (só quando n > 0) ===')
    ck('publicado não tem pulso nenhum (REPROVA como camada nova)',
       pub['pulsoAguardandoVeiculo'] in (None, 'none'), pub['pulsoAguardandoVeiculo'])
    ck('novo pulsa com @keyframes t27-pulso',
       novo['pulsoAguardandoVeiculo'] == 't27-pulso', novo['pulsoAguardandoVeiculo'])

    ck('nenhum erro de JavaScript no publicado', not pub['erros'], '; '.join(pub['erros'][:3]))
    ck('nenhum erro de JavaScript no novo', not novo['erros'], '; '.join(novo['erros'][:3]))

    print('\n' + '=' * 55)
    if falhas:
        print(f'  {len(falhas)} FALHA(S):')
        for f in falhas:
            print(f'    - {f}')
        return 1
    print('  Tudo verde: o publicado REPROVA como camada nova, o build novo PASSA.')
    return 0


sys.exit(asyncio.run(main()))
