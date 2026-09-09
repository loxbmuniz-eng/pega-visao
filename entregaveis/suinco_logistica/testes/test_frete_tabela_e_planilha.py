#!/usr/bin/env python3
"""A tabela de frete na tela, os dois KM e a planilha (09/09/2026).

PEDIDO DO DONO, com a tabela oficial em PDF:
  "criar tabela de frete no embarquesuinco.com.br, cadastro possa ser
   editavel e criada da mesma forma que funcionam os cadastros"
  "a tabela de frete deve fazer o calculo segundo a kilometragem e destino"
  "vao ser dois campos de KM, um de KM DESTINO, e KM DESLOCAMENTO
   (precisa ser o valor certinho do valor que sera pago no frete)"
  "transportadora suinco ou FOB nao tem valor de frete"
  "o relatorio de administracao de fretes (...) precisa ser disponibilizado
   em formato de planilha para reduzir retrabalho"
  E, respondendo às perguntas: "1 KM" · "1 trava a contratacao" ·
  "2 observacao obrigatoria" · "6 logistica e administracao".

O QUE ESTE TESTE TRAVA
  1. o destino puxa o KM da tabela e preenche o deslocamento;
  2. KM divergente AVISA — não recusa: desvio e retorno existem;
  3. sem KM e sem observação, a tela não deixa contratar a placa — e DIZ
     o que falta, com foco no campo (botão desabilitado não ensina);
  4. sem placa, a carga nasce sem KM — é programação, não contratação;
  5. a planilha sai com as 19 colunas na ordem que ele ditou, sem
     paletizada, com o documento de frete por último;
  6. quem não pode ver valor de frete não vê o card de cadastro nem o
     valor na planilha;
  7. as duas listas de "quem vê valor" (painel e servidor) são a mesma.

    python3 testes/test_frete_tabela_e_planilha.py
"""
import asyncio
import re
import sys
from pathlib import Path
from playwright.async_api import async_playwright

RAIZ = Path('/home/user/pega-visao/entregaveis/suinco_logistica')
PAINEL = 'file://' + str(RAIZ / 'index.html')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


TABELA = """() => {
  receberTabelaDeFrete({
    tarifas: [
      {tipoVeiculo:'3/4', valorPorKm:5.04, operador:'PDF'},
      {tipoVeiculo:'Toco', valorPorKm:6.09, operador:'PDF'},
      {tipoVeiculo:'Truck', valorPorKm:7.75, operador:'PDF'},
      {tipoVeiculo:'Bitruck', valorPorKm:8.97, operador:'PDF'},
      {tipoVeiculo:'Carreta', valorPorKm:11.66, operador:'PDF'},
    ],
    destinos: [
      {destino:'GOIANIA', km:583, operador:'PDF'},
      {destino:'MONTES CLAROS (COM DESVIO)', km:585, operador:'PDF'},
      {destino:'MONTES CLAROS (SEM DESVIO)', km:445, operador:'PDF'},
      {destino:'UBERLANDIA', km:220, operador:'PDF'},
    ],
  });
  preencherSelectsDestinoFrete();
}"""


def seed(setor='Logística'):
    return """() => {
  DB.operador = {nome:'Chefe', setor:'%s'};
  DB.frota = []; DB.cargas = []; DB.movimentacoes = [];
  const agora = Date.now(), iso = (t)=>new Date(t).toISOString();
  const st = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
              'Embarque Finalizado','Faturado','Seguiu Viagem'];
  DB.frota.push({placa:'FRT1A11', transportadora:'ALFA TRANSPORTES', tipoVeiculo:'Truck',
                 uf:'MG', capacidadeKg:14000, motorista:'João', atualizadoEm:iso(agora)});
  DB.frota.push({placa:'FRT2B22', transportadora:'SUINCO', tipoVeiculo:'Truck',
                 uf:'MG', capacidadeKg:14000, atualizadoEm:iso(agora)});
  /* Uma placa LIVRE, sem carga aberta. A trava de duplicidade de placa
     (11/08/2026) dispara ANTES da de KM, e usar a placa que já está na
     programação faria este teste medir aquela trava achando que mede esta
     — a causa nº 2 das quatro do vermelho. */
  DB.frota.push({placa:'FRT3C33', transportadora:'BETA LOG', tipoVeiculo:'Carreta',
                 uf:'MG', capacidadeKg:28000, atualizadoEm:iso(agora)});
  // Uma carga já faturada, com frete calculado pelo servidor.
  const t0 = agora - 5*3600000;
  DB.cargas.push({ id:'c_frete', numeroCarga:'118900', placa:'FRT1A11',
    transportadora:'ALFA TRANSPORTES', tipoVeiculo:'Truck', motorista:'João',
    cliente:'C', destino:'D', peso:12500, doca:'1', sequencia:1,
    observacoes:'valor combinado R$ 4.600 por causa do retorno vazio',
    praOnde:'ENTREGA DIRETA', rota:'500', paletizada:'Não', qtdGanchos:0, qtdEntregas:3,
    status:'Faturado', aguardandoCarga:false, criadoEm:iso(t0), programadoEm:iso(t0),
    atualizadoEm:iso(t0), criadoPor:'Logística',
    freteDestino:'GOIANIA', kmDestino:583, kmDeslocamento:640,
    freteValor:4960.00, freteTarifaUsada:7.75, freteMotivo:'', freteDocumento:'DOC-771' });
  for(let j=0;j<=4;j++){
    DB.movimentacoes.push({id:'mov_f_'+j, cargaId:'c_frete', placa:'FRT1A11',
      statusAnterior:j?st[j-1]:null, statusNovo:st[j], operador:'Op', setor:'Portaria',
      timestamp:iso(t0 + j*30*60000), numeroCarga:'118900'});
  }
  document.getElementById('modal-operador')?.classList.remove('open');
  renderAll();
}""" % setor


async def main():
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', headless=True)
        erros = []
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(800)
        await pg.evaluate(seed())
        await pg.evaluate(TABELA)

        print('\n=== 1. O DESTINO PUXA O KM DA TABELA ===')
        await pg.evaluate("abrirTab('programacao')")
        await pg.wait_for_timeout(400)
        r = await pg.evaluate("""() => {
            document.getElementById('prog-frete-destino').value = 'GOIANIA';
            destinoFreteMudouUI();
            return { ref: document.getElementById('prog-km-destino').value,
                     desl: document.getElementById('prog-km-deslocamento').value,
                     aviso: document.getElementById('prog-frete-aviso').textContent.trim() };
        }""")
        ck('escolher GOIANIA traz os 583 km da tabela', r['ref'] == '583', str(r))
        ck('e preenche o deslocamento com ele (o caso comum é um clique)', r['desl'] == '583', str(r))
        ck('sem divergência, sem aviso', r['aviso'] == '', r['aviso'][:80])

        ck('o KM de referência é só de leitura (muda no cadastro, não aqui)',
           await pg.evaluate("() => document.getElementById('prog-km-destino').readOnly"))

        print('\n=== 2. KM DIVERGENTE AVISA — NÃO RECUSA ===')
        r = await pg.evaluate("""() => {
            document.getElementById('prog-km-deslocamento').value = '640';
            kmDeslocamentoMudouUI();
            return document.getElementById('prog-frete-aviso').textContent.trim();
        }""")
        ck('avisa a diferença, com os dois números e o saldo',
           '640' in r and '583' in r and '57' in r, r[:110])
        ck('e diz que quem paga é o deslocamento', 'deslocamento' in r.lower(), r[:110])

        r = await pg.evaluate("""() => {
            document.getElementById('prog-frete-destino').value = 'CIDADE NOVA QUE NAO ESTA NA TABELA';
            destinoFreteMudouUI();
            return { ref: document.getElementById('prog-km-destino').value,
                     aviso: document.getElementById('prog-frete-aviso').textContent.trim() };
        }""")
        ck('destino fora da tabela: sem KM de referência, e a tela explica',
           r['ref'] == '' and 'Tabela de Frete' in r['aviso'], str(r)[:140])

        print('\n=== 3. SEM KM A CARGA NASCE — E A FALTA É DITA, NÃO ESCONDIDA ===')
        # A REGRA MUDOU DE PROPÓSITO, horas depois de eu escrever este teste:
        # causa nº 1 das quatro, não regressão. A trava de KM existiu e saiu
        # por decisão do dono — "não põe a trava do quilômetro então" — depois
        # de a bateria mostrar que a Montagem do Dia cria carga em LOTE por
        # outro caminho, sem campo de KM, e que carga recusada na criação é
        # APAGADA do painel. O lote sumiria na frente da Logística.
        #
        # O que este bloco guarda agora é o que ficou no lugar, e vale mais:
        # a carga nasce, e a ausência do KM é DECLARADA. Célula vazia sem
        # explicação é lida como R$ 0,00 por quem confere frete.
        r = await pg.evaluate("""() => {
            ['prog-frete-destino','prog-km-destino','prog-km-deslocamento','prog-obs']
              .forEach(id=>document.getElementById(id).value='');
            document.getElementById('prog-placa').value = 'FRT3C33';
            document.getElementById('prog-numero-carga').value = 'SEM-KM';
            const antes = DB.cargas.length;
            criarCargaProgramadaUI();
            const nova = DB.cargas[DB.cargas.length-1];
            return { criou: DB.cargas.length > antes,
                     km: nova && nova.kmDeslocamento,
                     valor: nova && nova.freteValor };
        }""")
        ck('a carga É criada — nada de caminhão parado por falta de KM', r['criou'], str(r))
        ck('o KM fica null, não zero — zero quilômetro calcularia frete de R$ 0,00',
           r['km'] is None, f"kmDeslocamento={r['km']}")
        ck('e sem KM não há valor inventado', r['valor'] is None, f"freteValor={r['valor']}")

        # A cobrança mudou de lugar: saiu do portão e foi para o relatório,
        # que é onde o dado é usado.
        motivo = await pg.evaluate("""() => {
            const c = DB.cargas.find(x=>x.numeroCarga==='SEM-KM');
            if(!c) return null;
            c.freteMotivo = 'Sem KM de deslocamento — o valor não pode ser calculado.';
            const d = dadosPlanilhaDeFretes([c])[0];
            return { motivo: d.freteMotivo, valor: d.freteValor, km: d.kmDeslocamento };
        }""")
        ck('a planilha carrega o MOTIVO da célula vazia',
           motivo and 'Sem KM' in (motivo['motivo'] or ''), str(motivo))
        ck('com o valor vazio, não zerado', motivo and motivo['valor'] is None, str(motivo))

        print('\n=== 4. SEM PLACA, A CARGA NASCE SEM KM — É PROGRAMAÇÃO ===')
        r = await pg.evaluate("""() => {
            document.getElementById('prog-placa').value = '';
            document.getElementById('prog-numero-carga').value = 'SEM-PLACA';
            document.getElementById('prog-obs').value = '';
            const antes = DB.cargas.length;
            criarCargaProgramadaUI();
            const nova = DB.cargas[DB.cargas.length-1];
            return { criou: DB.cargas.length > antes,
                     km: nova && nova.kmDeslocamento,
                     placa: nova && nova.placa };
        }""")
        ck('carga sem caminhão é criada normalmente', r['criou'], str(r))
        ck('e nasce com KM null — null não é zero', r['km'] is None, f"kmDeslocamento={r['km']}")

        print('\n=== 5. A PLANILHA, COM AS COLUNAS NA ORDEM DITADA ===')
        csv = await pg.evaluate("""async () => {
            let capturado = null;
            const _blob = window.Blob;
            window.Blob = function(partes, opc){ capturado = String(partes.join('')); return new _blob(partes, opc); };
            const _cria = URL.createObjectURL; URL.createObjectURL = () => 'blob:fake';
            const _rev = URL.revokeObjectURL; URL.revokeObjectURL = () => {};
            const _click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function(){};
            await exportarPlanilhaFretes();
            window.Blob = _blob; URL.createObjectURL = _cria; URL.revokeObjectURL = _rev;
            HTMLAnchorElement.prototype.click = _click;
            return capturado;
        }""")
        ck('a planilha foi gerada', bool(csv), str(csv)[:60])
        linhas = (csv or '').replace('﻿', '').split('\r\n')
        cab = linhas[0].split(';') if linhas else []
        esperado = ['Sequência', 'Nº da Carga', 'Data do Faturamento', 'Rota', 'Tipo de Operação',
                    'Placa', 'Transportadora', 'Tipo de Veículo', 'Peso (t)',
                    'Destino do Frete', 'KM Destino', 'KM Deslocamento', 'KM Divergente',
                    'Entregas', 'Motorista', 'Valor do Frete (R$)', 'Observação do Frete',
                    'Observações', 'Documento de Frete']
        ck('coluna A é a Sequência', cab[:1] == ['Sequência'], str(cab[:3]))
        ck('coluna B é o Nº da Carga', cab[1:2] == ['Nº da Carga'], str(cab[:3]))
        ck('coluna C é a Data do Faturamento', cab[2:3] == ['Data do Faturamento'], str(cab[:3]))
        ck('a ÚLTIMA coluna é o Documento de Frete', cab[-1:] == ['Documento de Frete'], str(cab[-2:]))
        ck('as 19 colunas na ordem exata', cab == esperado,
           f"faltando/sobrando: {set(esperado) ^ set(cab)}" if cab != esperado else '')
        ck('PALETIZADA foi excluída, como ele pediu',
           not any('aletizad' in c for c in cab), str([c for c in cab if 'aletizad' in c]))

        dados = linhas[1].split(';') if len(linhas) > 1 else []
        ck('a linha traz a carga com os dois KM', dados[10:12] == ['583', '640'], str(dados[9:13]))
        ck('e marca a divergência como coluna, não como cor', dados[12:13] == ['SIM'], str(dados[12:13]))
        ck('o valor sai com vírgula decimal (o Excel pt-BR soma a coluna)',
           dados[15:16] == ['4960,00'], str(dados[15:16]))
        ck('e o documento de frete dele vem junto', dados[-1] == 'DOC-771', str(dados[-1:]))
        ck('a data do faturamento é a do EVENTO, não a de hoje',
           bool(dados[2]) and re.match(r'^\d{2}/\d{2}', dados[2]), str(dados[2:3]))

        print('\n=== 6. QUEM NÃO PODE VER VALOR, NÃO VÊ ===')
        for setor in ['Portaria', 'Expedição', 'Comercial', 'Faturamento']:
            ve = await pg.evaluate("(s) => podeVerValorDeFreteUI(s)", setor)
            ck(f'{setor} não vê valor de frete', ve is False, str(ve))
        for setor in ['Logística', 'Administração']:
            ve = await pg.evaluate("(s) => podeVerValorDeFreteUI(s)", setor)
            ck(f'{setor} vê', ve is True, str(ve))

        await pg.evaluate(seed('Portaria'))
        await pg.evaluate(TABELA)
        await pg.evaluate("abrirTab('cadastros'); renderCadastros()")
        await pg.wait_for_timeout(300)
        escondido = await pg.evaluate("() => { const c=document.getElementById('card-tabela-frete'); return !c || c.hidden; }")
        ck('a Portaria não vê o card da Tabela de Frete', escondido)

        await pg.evaluate(seed('Logística'))
        await pg.evaluate(TABELA)
        await pg.evaluate("abrirTab('cadastros'); renderCadastros()")
        await pg.wait_for_timeout(300)
        r = await pg.evaluate("""() => ({
            visivel: !document.getElementById('card-tabela-frete').hidden,
            tarifas: document.querySelectorAll('#frete-tarifas-tbody tr').length,
            destinos: document.querySelectorAll('#frete-destinos-tbody tr').length,
        })""")
        ck('a Logística vê o card', r['visivel'], str(r))
        ck('com as 5 tarifas', r['tarifas'] == 5, str(r))
        ck('e os destinos', r['destinos'] == 4, str(r))

        print('\n=== 7. AS DUAS LISTAS DE "QUEM VÊ VALOR" SÃO A MESMA ===')
        # O painel é build de arquivo único e não importa do servidor: a
        # regra existe dos dois lados. Duas cópias que divergem é o defeito
        # que a lista de SETORES já teve em SEIS lugares (02/09/2026).
        fluxo = (RAIZ / 'backend/src/dominio/fluxo.js').read_text(encoding='utf-8')
        m = re.search(r"export function podeVerValorDeFrete\(setor\) \{\s*return ([^;]+);", fluxo)
        ck('o servidor tem a regra escrita', bool(m), str(m))
        if m:
            do_servidor = set(re.findall(r"'([^']+)'", m.group(1)))
            do_servidor.discard('setor')
            if 'SETOR_IRRESTRITO' in m.group(1):
                do_servidor.add('Administração')
            do_painel = set()
            for s in ['Logística', 'Portaria', 'Expedição', 'Faturamento', 'Administração',
                      'Comercial', 'Controles Internos', 'Central de Notas', 'Qualidade']:
                if await pg.evaluate("(x) => podeVerValorDeFreteUI(x)", s):
                    do_painel.add(s)
            ck('painel e servidor liberam EXATAMENTE os mesmos setores',
               do_painel == do_servidor, f"painel={sorted(do_painel)} · servidor={sorted(do_servidor)}")

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros)[:300])
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    return 1 if falhas else 0


sys.exit(asyncio.run(main()))
