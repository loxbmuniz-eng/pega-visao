#!/usr/bin/env python3
"""A Montagem do Dia reordena em cascata, e não engole o que se digita.

DOIS RELATOS DO DONO, no mesmo dia:
  "eu quero conseguir arrumar e arrastar na montagem do dia"
  "no computador do wemerson ta dando umas travadas sera que ta muito pesado???"

NÃO ERA PESO — E ISSO FOI MEDIDO. Com 39 linhas (uma sexta cheia) e o
processador 4x mais lento para imitar a máquina dele: desenhar a tabela leva
187ms, o DOM fica com 5.494 nós, o JS ocupa 10 MB. Nada disso trava.

O QUE TRAVAVA: `renderMontagem` era chamada direto por carregarMontagemUI,
passando por fora da proteção de digitação que o renderAll já tinha. Digitar
"215" no peso e redesenhar deixava o campo VAZIO, com o elemento trocado e o
foco perdido — e a tabela era refeita a cada campo alterado. A pessoa via o
que acabou de escrever sumir. Trocar o computador não resolveria nada.

E A CASCATA: digitar 3 numa linha só escrevia 3. Se já houvesse linha na 3,
ficavam DUAS com o mesmo número, sem aviso. Agora a linha entra na 3 e as
outras descem uma casa — a mesma filaReordenada() que a Torre usa, no
servidor, porque duas contas divergem.

    python3 testes/test_montagem_cascata_e_digitacao.py
"""
import asyncio, json, os, subprocess, sys, urllib.error, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
PAINEL = 'file://' + str(RAIZ / 'index.html')
API = os.environ.get('SUINCO_API', 'http://127.0.0.1:3010')
SENHA = os.environ.get('SUINCO_SENHA', 'senha-de-teste-123')
EMAIL = 'mont-cascata@teste.local'
DIA = '2026-09-14'
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


def psql(q):
    r = subprocess.run(['su', 'postgres', '-c', 'psql -q -tA -d embarque_suinco'],
                       input=q, capture_output=True, text=True)
    if r.returncode != 0:
        print('    [psql]', (r.stderr or '').strip()[:140])
    return r


def http(c, token=None, metodo='GET', corpo=None):
    req = urllib.request.Request(f'{API}{c}', method=metodo)
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    d = None
    if corpo is not None:
        d = json.dumps(corpo).encode(); req.add_header('Content-Type', 'application/json')
    try:
        with urllib.request.urlopen(req, d, timeout=25) as r:
            return r.status, json.loads(r.read().decode() or 'null')
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or 'null')
        except Exception:
            return e.code, None


async def main():
    print('\n=== 1. A DIGITAÇÃO SOBREVIVE AO REDESENHO ===')
    print('    (o relato da "travada" no computador do Wemerson)')
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width':1400,'height':900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(1200)
        r = await pg.evaluate("""() => {
          DB.operador = {nome:'Wemerson', setor:'Logística'};
          const ms = [];
          for (let i=1;i<=39;i++) ms.push({
            montagem_id:'m'+i, data_prog:'2026-09-14', rota_codigo:'500', rota_nome:'R',
            sequencia:i, numero_carga:'', peso:null, qtd_entregas:1, qtd_ganchos:0,
            paletizada:'Não', tipo_operacao:'', motorista:'', observacoes:'',
            placa:'', transportadora:'', frete_destino:null, km_destino:null,
            km_deslocamento:null, frete_valor:null });
          _montagemDia = { dia:'2026-09-14', diaSemana:1, modelo:[], montagens:ms };
          /* A ABA PRECISA ESTAR ABERTA, e isso não é detalhe de teste:
             `focus()` NÃO pega em elemento dentro de container oculto, e a
             proteção de digitação só captura o que está com o foco. A
             primeira versão deste bloco media o cartão escondido, concluía
             "a digitação some" e apontava para um defeito que não existe.
             O operador usa com a aba aberta — é assim que se mede. */
          /* renderAll() PRIMEIRO: é ele que revela o painel depois do
             login. Sem essa chamada a tela inteira continua no estado
             pré-login, o campo nasce dentro de container oculto, e focus()
             não pega em elemento oculto — o teste mediria o nada e
             acusaria um defeito inexistente. */
          renderAll();
          abrirTab('programacao');
          const card = document.getElementById('card-montagem');
          if(card) card.hidden = false;
          renderMontagem();
          const campo = document.querySelector('#mont-tbody .peso-input');
          if(!campo) return { erro:'sem campo de peso' };
          campo.focus(); campo.value = '215';
          const t0 = performance.now();
          renderMontagem();                    // o redesenho que engolia
          const ms_render = Math.round(performance.now() - t0);
          const agora = document.querySelector('#mont-tbody .peso-input');
          return { valor: agora ? agora.value : null,
                   focado: document.activeElement === agora,
                   ms: ms_render,
                   linhas: document.querySelectorAll('#mont-tbody tr.mont-linha').length };
        }""")
        ck('o que estava sendo digitado continua no campo', r.get('valor') == '215',
           f"campo ficou com {r.get('valor')!r}")
        ck('e o cursor não pula fora do campo', r.get('focado') is True, str(r.get('focado')))
        ck('39 linhas desenham rápido (não é peso)', (r.get('ms') or 999) < 600,
           f"{r.get('ms')} ms para {r.get('linhas')} linhas")

        print('\n=== 2. A ALÇA SÓ APARECE ONDE ARRASTAR FUNCIONA ===')
        d = await pg.evaluate("""() => {
          _montagemDia.montagens[0].efetivada_em = '2026-09-14T10:00:00Z';
          renderMontagem();
          const trs = [...document.querySelectorAll('#mont-tbody tr.mont-linha')];
          return {
            total: trs.length,
            arrastaveis: trs.filter(t => t.getAttribute('draggable') === 'true').length,
            primeiraTemAlca: !!trs[0].querySelector('.alca-arrastar'),
            segundaTemAlca: !!trs[1].querySelector('.alca-arrastar'),
          };
        }""")
        ck('linha já efetivada não é arrastável', d.get('primeiraTemAlca') is False,
           'a alça apareceu numa linha que virou carga')
        ck('linha ainda rascunho é arrastável', d.get('segundaTemAlca') is True)
        ck('as demais seguem arrastáveis', d.get('arrastaveis') == d.get('total') - 1,
           f"{d.get('arrastaveis')} de {d.get('total')}")
        ck('nenhum erro de JavaScript', not erros, str(erros[:1]))
        await nav.close()

    print('\n=== 3. A CASCATA ACONTECE NO SERVIDOR ===')
    h = subprocess.run(['node', '-e',
                        f"console.log(require('bcryptjs').hashSync('{SENHA}', 4))"],
                       cwd=str(RAIZ / 'backend'), capture_output=True, text=True)
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}';")
    psql("INSERT INTO operadores (email, nome, setor, senha_hash, ativo) VALUES "
         f"('{EMAIL}', 'Wemerson', 'Logística', '{h.stdout.strip()}', true);")
    st, r = http('/auth/login', metodo='POST', corpo={'email': EMAIL, 'senha': SENHA})
    token = (r or {}).get('token')
    ck('login', bool(token), f'HTTP {st}')
    if not token:
        return
    rota = psql('SELECT codigo FROM dim_rotas LIMIT 1;').stdout.strip()
    psql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}';")

    ids = []
    for i in (1, 2, 3):
        st, n = http('/api/montagem', token=token, metodo='POST', corpo={
            'dia': DIA, 'rotaCodigo': rota, 'sequencia': i,
            'qtdEntregas': 1, 'paletizada': 'Não'})
        ids.append(((n or {}).get('montagem') or {}).get('montagem_id'))
    ck('três linhas criadas, nas posições 1, 2 e 3', all(ids), str(len(ids)))

    # a terceira vai para a posição 1 — as outras têm que DESCER
    st, _ = http(f'/api/montagem/{ids[2]}/sequenciar', token=token,
                 metodo='POST', corpo={'posicao': 1})
    ck('reordenar responde ok', st == 200, f'HTTP {st}')
    st, dia = http(f'/api/montagem?dia={DIA}', token=token)
    pos = {m['montagem_id']: m['sequencia'] for m in (dia or {}).get('montagens', [])}
    ck('a linha movida foi para a posição 1', pos.get(ids[2]) == 1, str(pos.get(ids[2])))
    ck('a que estava na 1 desceu para a 2', pos.get(ids[0]) == 2, str(pos.get(ids[0])))
    ck('a que estava na 2 desceu para a 3', pos.get(ids[1]) == 3, str(pos.get(ids[1])))
    ck('e ninguém ficou com número repetido',
       len(set(pos.values())) == len(pos), str(sorted(pos.values())))

    print('\n=== 4. POSIÇÃO FORA DA FILA É RECUSADA, DIZENDO AS VÁLIDAS ===')
    st, e = http(f'/api/montagem/{ids[0]}/sequenciar', token=token,
                 metodo='POST', corpo={'posicao': 999})
    ck('recusa a posição solta', st == 400, f'HTTP {st}')
    ck('e a mensagem nomeia as posições válidas',
       'válidas' in str((e or {}).get('erro', '')), str((e or {}).get('erro'))[:90])

    psql(f"DELETE FROM programacao_montagem WHERE data_prog = '{DIA}';")
    psql(f"DELETE FROM operadores WHERE email = '{EMAIL}';")
    print('\n=== RESULTADO ===')
    print('  FALHAS:', ', '.join(falhas) if falhas else 'NENHUMA')
    sys.exit(1 if falhas else 0)


asyncio.run(main())
