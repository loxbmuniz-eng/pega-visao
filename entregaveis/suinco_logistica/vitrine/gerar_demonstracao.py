#!/usr/bin/env python3
"""A base de demonstração da vitrine — feita PELO painel, não à mão.

POR QUE ELA NÃO É UM JSON ESCRITO À MÃO. Um retrato de banco digitado por
fora envelhece calado: no dia em que a carga ganhar um campo, o arquivo
continua sem ele, a vitrine mostra uma tela quebrada, e ninguém liga uma
coisa à outra. Aqui a base nasce do próprio painel — `criarCargaProgramada`
e `avancarStatusCarga` são as mesmas funções que a Logística usa. Se a
forma da carga mudar, esta base muda junto.

O QUE É INVENTADO, E O QUE NÃO É. As placas e as rotas saem do cadastro
real que já viaja dentro do `index.html` — a trava de frota recusa placa
desconhecida, então usar placa de mentira daria uma vitrine que não
funciona. O que é montado aqui é só o MOVIMENTO: qual placa está em qual
etapa, a que horas. Nome de transportadora e de motorista são genéricos de
propósito: a vitrine pode ser compartilhada, e empresa real aparecendo
"atrasada" numa tela de demonstração é afirmação que ninguém fez.

    python3 vitrine/gerar_demonstracao.py
"""
import asyncio
import json
import re
import sys
from pathlib import Path

from playwright.async_api import async_playwright

RAIZ = Path(__file__).resolve().parent.parent
PAINEL = RAIZ / 'index.html'
SAIDA = RAIZ / 'vitrine' / 'demonstracao.json'
CHAVE = 'suinco_painel_v1'

# O roteiro da vitrine: uma etapa de cada, para nenhuma tela abrir vazia.
# `horas` é quantas horas ATRÁS a carga chegou — é o que faz o relógio da
# Torre ter o que mostrar, inclusive um caso acima da meta de 3h.
ROTEIRO = [
    # etapa final,              rota,  horas atrás,  peso
    ('Aguardando Veículo',      '500',  None, 24500),
    ('Aguardando Embarque',     '504',   0.7, 26800),
    ('Aguardando Embarque',     '503',   4.2, 25100),   # acima da meta: 3h
    ('Embarque Iniciado',       '501',   1.5, 27200),
    ('Embarque Finalizado',     '502',   2.1, 26400),
    ('Faturado',                '505',   2.8, 24900),
    ('Seguiu Viagem',           '500',   5.0, 27000),
]


async def main():
    if not PAINEL.exists():
        print(f'não achei {PAINEL} — rode antes: python3 build_arquivo_unico.py')
        return 1

    async with async_playwright() as p:
        nav = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium',
                                      headless=True)
        pg = await (await nav.new_context(viewport={'width': 1500, 'height': 950})).new_page()
        erros = []
        pg.on('pageerror', lambda e: erros.append(str(e)))

        html = re.sub(r'(api\.embarquesuinco\.com\.br[^}]*?\bativo:\s*)true,', r'\1false,',
                      PAINEL.read_text(encoding='utf-8'), count=1)
        url = 'https://vitrine.local/painel'
        await pg.route(url, lambda r: asyncio.ensure_future(
            r.fulfill(status=200, content_type='text/html; charset=utf-8', body=html)))
        await pg.goto(url)
        await pg.wait_for_function('typeof criarCargaProgramada === "function"', timeout=25000)

        retrato = await pg.evaluate("""(roteiro) => {
            /* Entra como Logística: é o setor que cria carga e pode dar
               qualquer passo do fluxo — sem isso o roteiro pararia na
               primeira etapa que não é dele. */
            DB.operador = { nome: 'Demonstração', setor: 'Logística', turno: 'A' };

            const ORDEM = ['Aguardando Veículo','Aguardando Embarque','Embarque Iniciado',
                           'Embarque Finalizado','Faturado','Seguiu Viagem'];
            /* Placas de verdade, do cadastro que já viaja no arquivo. A trava
               de frota recusa placa desconhecida — usar inventada daria uma
               vitrine que não funciona. */
            const HISTORICO = 24;   // cargas de dias anteriores, para o "normal da etapa" do Pátio ao vivo
            const placas = DB.frota.slice(0, roteiro.length + HISTORICO).map(f => f.placa);
            if (placas.length < roteiro.length + HISTORICO) return { erro: 'frota vazia no painel' };
            const H = 3600e3, M = 60e3, agora = Date.now();
            /* O HISTÓRICO (30/09/2026). O Pátio ao vivo compara o tempo na
               etapa com o normal DAQUELA etapa nos últimos 30 dias, e com
               menos de 10 passagens diz "sem histórico suficiente". Sem
               passado, a vitrine mostraria só isso. Aqui entram 24 cargas
               de 1 a 24 dias atrás, com tempos por etapa que variam — carga
               9001xx, rota e placa do cadastro, motorista genérico. */
            const ROTAS_H = ['500', '501', '502', '503', '504', '505'];
            for (let k = 0; k < HISTORICO; k++) {
              const c = criarCargaProgramada({
                placa: placas[roteiro.length + k], rota: ROTAS_H[k % ROTAS_H.length], peso: 24000 + (k % 7) * 400,
                numeroCarga: String(900101 + k), motorista: 'Motorista H' + (k + 1),
                cliente: 'Cliente de demonstração', operador: 'Demonstração',
              });
              if (!c) continue;
              for (let passo = 1; passo < ORDEM.length; passo++) {
                avancarStatusCarga(c.id, ORDEM[passo], 'Demonstração', 'Logística');
              }
              // minutos em cada etapa: Aguard. Embarque, Emb. Iniciado, Emb. Finalizado, Faturado
              const tempos = [20 + (k * 7) % 45, 35 + (k * 11) % 40, 10 + (k * 5) % 30, 10 + (k * 3) % 25];
              let t = agora - (1 + k) * 24 * H + 7 * H;
              const nasceu = new Date(t - 2 * H).toISOString();
              c.criadoEm = nasceu; c.programadoEm = nasceu;
              const movs = DB.movimentacoes.filter(m => m.cargaId === c.id);
              movs.forEach(m => {
                if (m.statusNovo === 'Aguardando Veículo') { m.timestamp = nasceu; return; }
                const i = ORDEM.indexOf(m.statusNovo) - 1;
                m.timestamp = new Date(t).toISOString();
                if (i >= 0 && i < tempos.length) t += tempos[i] * M;
              });
            }

            roteiro.forEach(([etapa, rota, horas, peso], i) => {
              const c = criarCargaProgramada({
                placa: placas[i], rota, peso,
                /* sequência do dia: a primeira espera o caminhão enquanto
                   as de trás já entraram — é o "passada na fila" */
                sequencia: i + 1,
                /* NÚMERO DE CARGA NA DEMONSTRAÇÃO (25/09/2026). A base
                   nascia sem número, e o Histórico da vitrine ficava com a
                   coluna vazia — não dava para julgar a tela que a coluna
                   existe para mostrar. A faixa 9000xx é deliberadamente
                   fora do padrão da operação, e a vitrine avisa em todas
                   as letras que os dados são de demonstração. */
                numeroCarga: String(900001 + i),
                motorista: 'Motorista ' + (i + 1),
                cliente: 'Cliente de demonstração',
                operador: 'Demonstração',
              });
              if (!c) return;
              const ate = ORDEM.indexOf(etapa);
              for (let passo = 1; passo <= ate; passo++) {
                avancarStatusCarga(c.id, ORDEM[passo], 'Demonstração', 'Logística');
              }
              /* RECUAR O RELÓGIO DA CHEGADA. Sem isto toda carga teria
                 chegado "agora" e a Torre mostraria 0min em todas — a tela
                 ficaria certa e sem nada para olhar. Mexe no carimbo do
                 registro, que é de onde a conta de tempo sai. */
              if (horas !== null) {
                /* Da chegada até agora, as etapas se repartem por igual:
                   assim cada caminhão tem um tempo NA ETAPA de verdade,
                   não "0 min" (30/09/2026). */
                const chegou = agora - horas * H;
                const passos = DB.movimentacoes.filter(m => m.cargaId === c.id && m.statusNovo !== 'Aguardando Veículo');
                const fatia = (horas * H) / (passos.length + (etapa === 'Seguiu Viagem' ? 0 : 1));
                passos.forEach((m, j) => { m.timestamp = new Date(chegou + j * fatia).toISOString(); });
                /* a programação vem ANTES da chegada: sem isto o carimbo
                   "programou" ficava na hora da geração, depois de todos os
                   outros, e o cartão aberto mostrava a carga "voltando" */
                const prog = new Date(chegou - 30 * 60e3).toISOString();
                DB.movimentacoes.filter(m => m.cargaId === c.id && m.statusNovo === 'Aguardando Veículo')
                  .forEach(m => { m.timestamp = prog; });
                c.criadoEm = prog; c.programadoEm = prog;
              }
            });
            SuincoStore.save();
            return { ok: true, cargas: DB.cargas.length,
                     movimentacoes: DB.movimentacoes.length,
                     bruto: localStorage.getItem('suinco_painel_v1') };
        }""", ROTEIRO)

        await nav.close()

    if retrato.get('erro'):
        print('falhou:', retrato['erro']); return 1
    if erros:
        print('erro de JavaScript no painel:', erros[:2]); return 1
    if not retrato.get('bruto'):
        print('o painel não gravou nada no localStorage'); return 1

    dados = json.loads(retrato['bruto'])
    # A FROTA VIAJA NO RETRATO, e eu já tentei o contrário (24/09/2026).
    #
    # Tirar as 749 placas daqui parecia limpeza: o painel as reembute e as
    # recarrega sozinho quando a cópia local está vazia. Só que aí
    # `carregarFrotaSeedSeVazia` dispara na abertura da VITRINE, grava o
    # banco local por cima, e o retrato inteiro — cargas e operador — vai
    # junto. A vitrine passou a abrir pedindo login, com o pátio vazio.
    #
    # E o receio que me levou a tirar (duas cópias da frota divergindo,
    # ocorrência #17) não se aplica: este arquivo é GERADO pelo painel a
    # cada rodada, não mantido à mão. Cópia que nasce da fonte não diverge
    # da fonte. O custo é o arquivo ir de 20 KB para ~208 KB.
    pass
    SAIDA.parent.mkdir(exist_ok=True)
    SAIDA.write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'OK: {SAIDA.name} — {retrato["cargas"]} carga(s), '
          f'{retrato["movimentacoes"]} movimentação(ões)')
    return 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
