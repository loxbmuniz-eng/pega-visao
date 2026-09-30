#!/usr/bin/env python3
"""Pátio ao vivo: o cartão aberto e o rádio contam a história inteira (30/09/2026).

PEDIDO DO DONO: "melhore a qualidade das informações que aparecem quando eu
clico em cada cartão e a qualidade das informações que aparecem no rádio do
pátio" — com as respostas dele: "pergunta 1 a perguntas 2 a" (nome e setor
de quem carimbou; o rádio com as 15 últimas de hoje).

O QUE ESTE TESTE TRAVA:
  CARTÃO ABERTO
  1. a ficha: placa, tipo de veículo, transportadora, motorista, peso,
     sequência do dia e doca;
  2. "agora": a etapa, há quanto tempo, a previsão de saída;
  3. a linha do tempo: cada etapa com a hora, QUEM carimbou (nome e setor) e
     quanto tempo ficou nela — em âmbar quando passou do normal; a etapa
     atual "em andamento"; as que faltam aparecem apagadas.
  RÁDIO
  4. as 15 últimas movimentações de hoje;
  5. cada linha: hora, quem (nome e setor), o que fez, a carga, rota e
     praça, placa, e quanto tempo levou a etapa que acabou — em âmbar
     quando passou do normal; a saída diz o tempo total de pátio;
  6. tocar numa linha abre o cartão da carga.

Relógio fixo às 15h00 de hoje. Dados inventados e marcados (cargas 900601+,
rota TESTE, nomes "… Teste").

    python3 testes/test_patio_vivo_cartao_e_radio.py
"""
import asyncio
import datetime
import os
import sys
from playwright.async_api import async_playwright

AQUI = os.path.dirname(os.path.abspath(__file__))
PAINEL = 'file://' + os.path.join(os.path.dirname(AQUI), 'index.html')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


# Embarque Iniciado nos 12 dias anteriores (o movimento de hoje também entra
# na conta do normal, então o teste não fixa o número do percentil).
DURACOES_EI = [10, 12, 14, 16, 18, 20, 22, 25, 30, 35, 40, 45]

SEMEAR = """(duracoes) => {
  DB.operador = {nome:'Teste', setor:'Administração'};
  document.getElementById('modal-operador')?.classList.remove('open');
  const agora = Date.now(), min = 60000, dia = 86400000, iso = t => new Date(t).toISOString();
  const h = (hh, mm) => { const d = new Date(); d.setHours(hh, mm || 0, 0, 0); return d.getTime(); };
  const cargas = [], movs = [];
  let n = 0;
  const carga = (o) => { const c = Object.assign({ id:'teste-cr-' + n, numeroCarga:String(900601 + n),
      placa:'TST' + (6000 + n), rota:'TESTE', peso:1000, qtdEntregas:1, sequencia:null,
      programadoEm:iso(h(7)), criadoEm:iso(h(7)), atualizadoEm:iso(agora) }, o); n++; cargas.push(c); return c; };
  const mov = (c, st, t, quem, setor) => movs.push({ id:'teste-cr-m-' + movs.length, cargaId:c.id, placa:c.placa,
      statusNovo:st, operador: quem || 'Ana Teste', setor: setor || 'Logística', timestamp:iso(t) });
  // A carga que o teste abre
  const A = carga({ status:'Embarque Finalizado', tipoVeiculo:'Truck', transportadora:'TRANSP TESTE',
      motorista:'MOTORISTA TESTE', peso:12500, sequencia:3, doca:'4' });
  mov(A, 'Aguardando Veículo', h(8), 'Ana Teste', 'Logística');
  mov(A, 'Aguardando Embarque', h(13), 'Paulo Teste', 'Portaria');
  mov(A, 'Embarque Iniciado', h(13, 30), 'João Teste', 'Expedição');
  mov(A, 'Embarque Finalizado', h(14, 40), 'João Teste', 'Expedição');   // embarcou 1h10: além do normal
  // Uma que já saiu hoje
  const S = carga({ status:'Seguiu Viagem' });
  mov(S, 'Aguardando Embarque', h(13, 20), 'Paulo Teste', 'Portaria');
  mov(S, 'Embarque Iniciado', h(13, 40), 'João Teste', 'Expedição');
  mov(S, 'Embarque Finalizado', h(14), 'João Teste', 'Expedição');
  mov(S, 'Faturado', h(14, 20), 'Rita Teste', 'Faturamento');
  mov(S, 'Seguiu Viagem', h(14, 50), 'Paulo Teste', 'Portaria');
  // Movimento de fundo de hoje: mais 3 cargas × 4 carimbos
  for(let k = 0; k < 3; k++){
    const c = carga({ status:'Faturado' });
    mov(c, 'Aguardando Embarque', h(11, k * 5)); mov(c, 'Embarque Iniciado', h(11, 20 + k * 5));
    mov(c, 'Embarque Finalizado', h(12, k * 5)); mov(c, 'Faturado', h(12, 30 + k * 5));
  }
  // O histórico dos dias anteriores (o normal das etapas)
  duracoes.forEach((d, i) => {
    let t = agora - (2 + i) * dia;
    const c = carga({ status:'Seguiu Viagem', programadoEm:iso(t - 60 * min), criadoEm:iso(t - 60 * min) });
    mov(c, 'Aguardando Embarque', t); t += 20 * min;
    mov(c, 'Embarque Iniciado', t); t += d * min;
    mov(c, 'Embarque Finalizado', t); t += 10 * min;
    mov(c, 'Faturado', t); t += 15 * min;
    mov(c, 'Seguiu Viagem', t);
  });
  DB.cargas = cargas; DB.movimentacoes = movs;
  invalidarIndiceMovimentacoes();
  renderAll(); abrirTab('patio');
  return { A: A.id, S: S.id };
}"""

GAVETA = """() => {
  const g = document.getElementById('gv-miolo');
  const itens = [...g.querySelectorAll('.gv-lista > li')].map(li => ({
    texto: li.textContent.replace(/\\s+/g, ' ').trim(), alem: li.dataset.alem || '', futura: li.classList.contains('futura') }));
  return { olho: document.getElementById('gv-olho').textContent, sub: document.getElementById('gv-sub').textContent,
           ficha: (g.querySelector('.pv-gv-ficha') || {}).textContent || '',
           agora: ((g.querySelector('.pv-gv-agora') || {}).textContent || '').replace(/\\s+/g, ' '), itens };
}"""

RADIO = """() => [...document.querySelectorAll('#pv-radio > li')].map(li => ({
  texto: li.textContent.replace(/\\s+/g, ' ').trim(), alem: li.dataset.alem || '', tipo: li.dataset.tipo || '' }))"""


async def main():
    agora = datetime.datetime.now().replace(hour=15, minute=0, second=0, microsecond=0)
    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium')
        pg = await nav.new_page(viewport={'width': 1440, 'height': 900})
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))
        await pg.clock.set_fixed_time(agora)
        await pg.goto(PAINEL)
        await pg.wait_for_timeout(700)
        ids = await pg.evaluate(SEMEAR, DURACOES_EI)
        await pg.wait_for_timeout(800)

        print('\n=== O CARTÃO ABERTO ===')
        await pg.click(f'.pv-card[data-id="{ids["A"]}"]')
        await pg.wait_for_timeout(500)
        g = await pg.evaluate(GAVETA)
        print('   ficha:', g['ficha'])
        print('   agora:', g['agora'])
        for it in g['itens']:
            print('   ·', it)
        for campo in ('TST6000', 'Truck', 'TRANSP TESTE', 'MOTORISTA TESTE', '12.500 kg', '3', 'Doca 4'):
            ck(f'a ficha traz {campo}', campo in g['ficha'], g['ficha'])
        ck('"agora": a etapa e há quanto tempo', 'Embarque Finalizado' in g['agora'] and 'há 20 min' in g['agora'], g['agora'])
        ck('"agora": a previsão de saída', 'sai por volta de' in g['agora'], g['agora'])
        ae = next((i for i in g['itens'] if i['texto'].startswith('Aguardando Embarque')), None)
        ei = next((i for i in g['itens'] if i['texto'].startswith('Embarque Iniciado')), None)
        ef = next((i for i in g['itens'] if i['texto'].startswith('Embarque Finalizado')), None)
        fut = [i for i in g['itens'] if i['futura']]
        ck('a entrada: hora, quem carimbou e quanto ficou',
           ae and '13:00' in ae['texto'] and 'Paulo Teste (Portaria)' in ae['texto'] and 'ficou 30 min' in ae['texto'],
           ae and ae['texto'])
        ck('o embarque que passou do normal fica marcado e diz o normal',
           ei and 'ficou 1h10' in ei['texto'] and ei['alem'] == '1' and 'além do normal: 9 em 10 em até' in ei['texto'],
           ei and str(ei))
        ck('a etapa atual está "em andamento"', ef and 'em andamento há 20 min' in ef['texto'], ef and ef['texto'])
        ck('as etapas que faltam aparecem apagadas (Faturado, Seguiu Viagem)',
           [i['texto'].split(' —')[0].strip() for i in fut] == ['Faturado', 'Seguiu Viagem'], str(fut))

        print('\n=== O RÁDIO ===')
        await pg.keyboard.press('Escape')
        await pg.wait_for_timeout(300)
        r = await pg.evaluate(RADIO)
        for it in r[:6]:
            print('   ·', it)
        ck('as 15 últimas de hoje', len(r) == 15, str(len(r)))
        fim = next((i for i in r if '14:40' in i['texto']), None)
        ck('a linha diz quem, o que, a carga, rota e placa',
           fim and 'João Teste (Expedição)' in fim['texto'] and 'finalizou o embarque da carga 900601' in fim['texto']
           and 'TESTE' in fim['texto'] and 'TST6000' in fim['texto'], fim and fim['texto'])
        ck('e quanto levou a etapa que acabou — em âmbar se passou do normal',
           fim and 'levou 1h10 embarcando' in fim['texto'] and fim['alem'] == '1', fim and str(fim))
        saida = next((i for i in r if i['tipo'] == 'saida'), None)
        ck('a saída diz o tempo total de pátio', saida and '1h30 de pátio' in saida['texto'], saida and saida['texto'])
        chegada = next((i for i in r if i['tipo'] == 'chegada'), None)
        ck('a chegada ao pátio fica marcada', chegada is not None, str([i['tipo'] for i in r]))

        print('\n=== TOCAR NA LINHA ABRE O CARTÃO ===')
        await pg.click('#pv-radio > li:has-text("14:40") button')
        await pg.wait_for_timeout(500)
        olho = await pg.evaluate("() => document.getElementById('gv-olho').textContent")
        ck('abre a carga 900601', olho == 'Carga 900601', olho)

        ck('nenhum erro de JavaScript', not erros, '; '.join(erros[:3]))
        await nav.close()

    print('\n=== RESULTADO ===')
    print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
    sys.exit(1 if falhas else 0)


asyncio.run(main())
