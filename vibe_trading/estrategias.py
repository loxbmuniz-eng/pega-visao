#!/usr/bin/env python3
"""
Sinais de entrada. Cada estrategia le os candles e devolve, para cada candle,
a direcao da entrada: +1 compra, -1 venda, 0 nao opera.

REGRA QUE NAO SE QUEBRA — o sinal do indice i so pode usar dados ATE o candle i.
Olhar o candle i+1 para decidir a entrada em i e "vazamento de futuro", e e a
causa numero um de backtest bonito que perde dinheiro no ar. Toda estrategia
aqui decide no FECHAMENTO do candle i e entra nesse preco.

A estrategia 'moeda' existe como controle: ela e deliberadamente cega. Qualquer
estrategia que nao bata a 'moeda' por margem folgada nao tem vantagem nenhuma —
tem sorte na amostra.
"""

from __future__ import annotations

import random
from typing import Callable

import indicadores as ind


# --------------------------------------------------------------------------- #
# controles (sem vantagem nenhuma, de proposito)
# --------------------------------------------------------------------------- #

def moeda(c, semente: int = 7) -> list[int]:
    """Controle: direcao sorteada. Valor preditivo zero, por construcao."""
    r = random.Random(semente)
    return [r.choice([1, -1]) for _ in c.fechamento]


def sempre_compra(c) -> list[int]:
    """Controle: comprado sempre. Mede so a tendencia da janela."""
    return [1] * len(c.fechamento)


# --------------------------------------------------------------------------- #
# estrategias de seguir movimento
# --------------------------------------------------------------------------- #

def ema_cruzamento(c, rapida: int = 9, lenta: int = 21) -> list[int]:
    """Cruzamento de medias: entra na direcao do cruzamento, no candle dele."""
    er = ind.ema(c.fechamento, rapida)
    el = ind.ema(c.fechamento, lenta)
    s = [0] * len(c.fechamento)
    for i in range(1, len(c.fechamento)):
        if None in (er[i], el[i], er[i - 1], el[i - 1]):
            continue
        antes = er[i - 1] - el[i - 1]
        agora = er[i] - el[i]
        if antes <= 0 < agora:
            s[i] = 1
        elif antes >= 0 > agora:
            s[i] = -1
    return s


def rompimento_canal(c, n: int = 20) -> list[int]:
    """Rompimento de maxima/minima das ultimas n barras (estilo Donchian)."""
    s = [0] * len(c.fechamento)
    for i in range(n, len(c.fechamento)):
        topo = max(c.maxima[i - n : i])
        fundo = min(c.minima[i - n : i])
        if c.fechamento[i] > topo:
            s[i] = 1
        elif c.fechamento[i] < fundo:
            s[i] = -1
    return s


def momento_atr(c, n: int = 14, mult: float = 1.0) -> list[int]:
    """
    Continuacao de momento filtrada por ATR: entra quando o candle fecha
    deslocado mais de `mult` ATR em relacao a abertura.
    """
    a = ind.atr(c.maxima, c.minima, c.fechamento, n)
    s = [0] * len(c.fechamento)
    for i in range(len(c.fechamento)):
        if a[i] is None or a[i] == 0:
            continue
        corpo = c.fechamento[i] - c.abertura[i]
        if corpo > mult * a[i]:
            s[i] = 1
        elif corpo < -mult * a[i]:
            s[i] = -1
    return s


# --------------------------------------------------------------------------- #
# estrategias de reversao
# --------------------------------------------------------------------------- #

def rsi_reversao(c, n: int = 14, baixo: float = 30.0, alto: float = 70.0) -> list[int]:
    """RSI em extremo: compra no sobrevendido, vende no sobrecomprado."""
    r = ind.rsi(c.fechamento, n)
    s = [0] * len(c.fechamento)
    for i in range(1, len(c.fechamento)):
        if r[i] is None or r[i - 1] is None:
            continue
        if r[i - 1] <= baixo < r[i]:
            s[i] = 1
        elif r[i - 1] >= alto > r[i]:
            s[i] = -1
    return s


def bollinger_reversao(c, n: int = 20, k: float = 2.0) -> list[int]:
    """Toque na banda e volta: compra na banda inferior, vende na superior."""
    m = ind.sma(c.fechamento, n)
    d = ind.desvio(c.fechamento, n)
    s = [0] * len(c.fechamento)
    for i in range(len(c.fechamento)):
        if m[i] is None or d[i] is None or d[i] == 0:
            continue
        if c.fechamento[i] < m[i] - k * d[i]:
            s[i] = 1
        elif c.fechamento[i] > m[i] + k * d[i]:
            s[i] = -1
    return s


def vwap_reversao(c, n: int = 20, desvio_pct: float = 0.3) -> list[int]:
    """Desvio da VWAP: aposta no retorno a media ponderada por volume."""
    v = ind.vwap_janela(c.maxima, c.minima, c.fechamento, c.volume, n)
    s = [0] * len(c.fechamento)
    for i in range(len(c.fechamento)):
        if v[i] is None or v[i] == 0:
            continue
        dist = (c.fechamento[i] - v[i]) / v[i] * 100.0
        if dist < -desvio_pct:
            s[i] = 1
        elif dist > desvio_pct:
            s[i] = -1
    return s


# --------------------------------------------------------------------------- #
# confluencia — o checklist do scalper disciplinado
# --------------------------------------------------------------------------- #

def confluencia(c, minimo: int = 4, n_tend: int = 50, n_tend_longa: int = 200,
                n_canal: int = 20, n_rsi: int = 14, n_atr: int = 14,
                n_vol: int = 20, atr_piso_pct: float = 0.05) -> list[int]:
    """
    Exige varias confirmacoes na MESMA direcao antes de entrar.

    As cinco checagens, e por que cada uma existe:

    1. TENDENCIA   EMA 50 acima da EMA 200 -> so compra; abaixo -> so vende.
                   Operar contra a tendencia maior e o erro mais caro do
                   scalping: voce acerta a direcao do minuto e perde na hora.

    2. GATILHO     fechamento rompe a maxima (ou minima) das ultimas n_canal
                   barras. E o evento que justifica entrar AGORA e nao antes.

    3. NAO ESTICADO  RSI ainda nao esta no extremo oposto do movimento.
                   Comprar o que ja subiu 70 de RSI e pagar o topo.

    4. VOLATILIDADE  ATR em % do preco acima de um piso. Em mercado parado o
                   movimento nao cobre a taxa — a melhor operacao e nenhuma.
                   Este filtro e o que mais protege banca pequena.

    5. VOLUME      volume do candle acima da sua propria media. Rompimento sem
                   volume costuma ser armadilha.

    TENDENCIA e GATILHO sao obrigatorios: a tendencia escolhe o lado, o gatilho
    e o momento. Os outros tres sao filtros. `minimo` conta os votos incluindo
    os dois obrigatorios, entao:
        confl3 = tendencia + gatilho + 1 filtro
        confl4 = tendencia + gatilho + 2 filtros
        confl5 = tudo
    (Versao anterior nao exigia o gatilho: tendencia + RSI + ATR + volume, que
    sao verdade quase sempre ao mesmo tempo, bastavam para 4/5 e o "sinal"
    ficava ligado em ~44% dos candles — um estado, nao um evento.)

    Qual nivel presta e pergunta empirica, nao de opiniao — rode --robustez
    com confl3, confl4 e confl5 e compare.
    """
    n = len(c.fechamento)
    s = [0] * n

    e_curta = ind.ema(c.fechamento, n_tend)
    e_longa = ind.ema(c.fechamento, n_tend_longa)
    r = ind.rsi(c.fechamento, n_rsi)
    a = ind.atr(c.maxima, c.minima, c.fechamento, n_atr)
    vol_media = ind.sma(c.volume, n_vol)

    for i in range(n):
        if i < max(n_canal, n_atr, n_rsi) + 1:
            continue

        # ---- 1. tendencia maior define o lado permitido ----
        lado = 0
        if e_curta[i] is not None and e_longa[i] is not None:
            lado = 1 if e_curta[i] > e_longa[i] else -1
        if lado == 0:
            continue

        votos = 1  # a tendencia e o primeiro voto

        # ---- 2. gatilho de rompimento, no lado da tendencia (OBRIGATORIO) ----
        topo = max(c.maxima[i - n_canal : i])
        fundo = min(c.minima[i - n_canal : i])
        gatilho = (lado > 0 and c.fechamento[i] > topo) or (lado < 0 and c.fechamento[i] < fundo)
        if gatilho:
            votos += 1

        # ---- 3. nao entrar esticado ----
        if r[i] is not None:
            if (lado > 0 and r[i] < 70.0) or (lado < 0 and r[i] > 30.0):
                votos += 1

        # ---- 4. volatilidade paga a taxa? ----
        if a[i] is not None and c.fechamento[i] > 0:
            if (a[i] / c.fechamento[i] * 100.0) >= atr_piso_pct:
                votos += 1

        # ---- 5. volume confirma ----
        if vol_media[i] is not None and vol_media[i] > 0:
            if c.volume[i] > vol_media[i]:
                votos += 1

        if dispara(gatilho, votos, minimo):
            s[i] = lado

    return s


def dispara(gatilho: bool, votos: int, minimo: int) -> bool:
    """A decisao de entrar. Mesma regra que Motor.dispara no monitor.html."""
    return gatilho and votos >= minimo


def confluencia_3(c) -> list[int]:
    return confluencia(c, minimo=3)


def confluencia_5(c) -> list[int]:
    return confluencia(c, minimo=5)


# --------------------------------------------------------------------------- #
# padroes
# --------------------------------------------------------------------------- #

def engolfo(c) -> list[int]:
    """
    Engolfo: o corpo do candle i engole o corpo do anterior, de cor oposta.

    Alta: anterior de baixa, atual de alta, abre ate o fechamento anterior,
    fecha acima da abertura anterior e tem corpo maior. Baixa: o espelho.
    Decide no fechamento de i usando so i e i-1.
    """
    n = len(c.fechamento)
    s = [0] * n
    for i in range(1, n):
        o0, f0 = c.abertura[i - 1], c.fechamento[i - 1]
        o1, f1 = c.abertura[i], c.fechamento[i]
        if abs(f1 - o1) <= abs(f0 - o0):
            continue
        if f0 < o0 and f1 > o1 and o1 <= f0 and f1 >= o0:
            s[i] = 1
        elif f0 > o0 and f1 < o1 and o1 >= f0 and f1 <= o0:
            s[i] = -1
    return s


def divergencia_rsi(c, k: int = 3, n_rsi: int = 14,
                    dist_min: int = 5, dist_max: int = 60) -> list[int]:
    """
    Divergencia entre preco e RSI.

    Alta: o preco faz um fundo MAIS BAIXO que o fundo anterior, mas o RSI faz um
    fundo MAIS ALTO. A queda perdeu forca. Baixa: topo mais alto no preco, topo
    mais baixo no RSI.

    O ponto que mais engana em backtest: um fundo so e fundo depois que o preco
    sobe nos k candles seguintes. Entao o pivo em j so e CONFIRMADO no candle
    i = j + k, e e em i que o sinal sai e a entrada acontece. Marcar o sinal em
    j seria comprar no fundo exato sabendo o futuro.

    Pivo de fundo em j: minima[j] menor que as k anteriores e menor ou igual as
    k seguintes. Os dois pivos comparados precisam estar entre dist_min e
    dist_max candles um do outro. Se fundo e topo divergirem no mesmo candle,
    nao opera.
    """
    r = ind.rsi(c.fechamento, n_rsi)
    n = len(c.fechamento)
    s = [0] * n
    ult_fundo = None
    ult_topo = None
    for i in range(2 * k, n):
        j = i - k
        if r[j] is None:
            continue
        alta = baixa = False

        if c.minima[j] < min(c.minima[j - k:j]) and c.minima[j] <= min(c.minima[j + 1:i + 1]):
            if (ult_fundo is not None and dist_min <= j - ult_fundo <= dist_max
                    and c.minima[j] < c.minima[ult_fundo] and r[j] > r[ult_fundo]):
                alta = True
            ult_fundo = j

        if c.maxima[j] > max(c.maxima[j - k:j]) and c.maxima[j] >= max(c.maxima[j + 1:i + 1]):
            if (ult_topo is not None and dist_min <= j - ult_topo <= dist_max
                    and c.maxima[j] > c.maxima[ult_topo] and r[j] < r[ult_topo]):
                baixa = True
            ult_topo = j

        if alta and not baixa:
            s[i] = 1
        elif baixa and not alta:
            s[i] = -1
    return s


# --------------------------------------------------------------------------- #
# alinhamento entre periodos
# --------------------------------------------------------------------------- #

MIN5, MIN15, H1, H4, H12, D1 = 300_000, 900_000, 3_600_000, 14_400_000, 43_200_000, 86_400_000

# os dois periodos acima de cada um; 24 h nao tem periodo acima
ACIMA: dict[int, tuple[int, ...]] = {
    MIN5: (MIN15, H1),
    MIN15: (H1, H4),
    H1: (H4, H12),
    H4: (H12, D1),
    H12: (D1,),
}


def ms_base(c) -> int | None:
    """Duracao do candle da serie, pela mediana do intervalo entre aberturas."""
    t = getattr(c, "t", None) or []
    if len(t) < 2:
        return None
    difs = sorted(t[i] - t[i - 1] for i in range(1, min(len(t), 400)))
    return difs[len(difs) // 2]


def reamostrar(c, ms_alvo: int, base: int) -> tuple[list[int], list[float]]:
    """
    Monta candles de um periodo maior a partir dos menores: (aberturas, fechamentos).

    Agrupa pela fronteira de relogio em UTC (abertura // ms_alvo), igual a
    Binance. Grupo incompleto — comeco da serie no meio de uma hora, ou candle
    faltando — e descartado: um candle de 1 h montado com 3 de 4 pedacos e um
    candle que nao existiu.
    """
    por_grupo = ms_alvo // base
    aberturas: list[int] = []
    fechamentos: list[float] = []
    grupo, conta, ultimo = None, 0, 0.0
    for i, t in enumerate(c.t):
        g = t // ms_alvo
        if g != grupo:
            if grupo is not None and conta == por_grupo:
                aberturas.append(grupo * ms_alvo)
                fechamentos.append(ultimo)
            grupo, conta = g, 0
        conta += 1
        ultimo = c.fechamento[i]
    if grupo is not None and conta == por_grupo:
        aberturas.append(grupo * ms_alvo)
        fechamentos.append(ultimo)
    return aberturas, fechamentos


def tendencia_em(t_htf: list[int], e_curta: list, e_longa: list, ms_htf: int,
                 t_limite: int, desde: int = 0) -> tuple[int, int]:
    """
    Tendencia (+1 alta, -1 baixa, 0 sem dado) do ultimo candle do periodo maior
    que FECHOU ate t_limite. Devolve (tendencia, indice) para o chamador
    continuar a busca de onde parou.

    Regra conservadora: o candle maior so vale se fechou ate a ABERTURA do candle
    menor (t_limite). As 10:00 o candle de 15 min das 9:45 usa o de 1 h das 8:00,
    nao o das 9:00, que fecha junto com ele. Assim o monitor nunca depende de
    qual mensagem chegou primeiro da Binance, e o backtest decide igual.
    """
    k = desde
    while k + 1 < len(t_htf) and t_htf[k + 1] + ms_htf <= t_limite:
        k += 1
    if not t_htf or t_htf[k] + ms_htf > t_limite:
        return 0, k
    if e_curta[k] is None or e_longa[k] is None:
        return 0, k
    return (1 if e_curta[k] > e_longa[k] else -1), k


def alinhamento(c, n_curta: int = 50, n_longa: int = 200) -> list[int]:
    """
    Para cada candle: +1 se TODOS os periodos acima estao em alta, -1 se todos
    em baixa, 0 se misto, sem dado ou sem periodo acima (24 h).
    """
    n = len(c.fechamento)
    base = ms_base(c)
    if base not in ACIMA:
        return [0] * n
    por_htf = []
    for ms_htf in ACIMA[base]:
        t_htf, f_htf = reamostrar(c, ms_htf, base)
        ec, el = ind.ema(f_htf, n_curta), ind.ema(f_htf, n_longa)
        tend, k = [0] * n, 0
        for i in range(n):
            tend[i], k = tendencia_em(t_htf, ec, el, ms_htf, c.t[i], k)
        por_htf.append(tend)
    saida = [0] * n
    for i in range(n):
        vals = {t[i] for t in por_htf}
        if vals == {1}:
            saida[i] = 1
        elif vals == {-1}:
            saida[i] = -1
    return saida


def filtrar(c, sinais: list[int], lado: str = "ambos", alinhar: bool = False) -> list[int]:
    """
    Os dois filtros que o usuario liga sob demanda.
      lado: "compra" so deixa long, "venda" so short, "ambos" deixa tudo.
      alinhar: so deixa o sinal que vai na mesma direcao dos periodos acima.
    """
    if lado not in ("ambos", "compra", "venda"):
        raise ValueError(f"lado invalido: {lado}")
    al = alinhamento(c) if alinhar else None
    saida = []
    for i, x in enumerate(sinais):
        if x == 0 or (lado == "compra" and x < 0) or (lado == "venda" and x > 0):
            saida.append(0)
        elif al is not None and al[i] != x:
            saida.append(0)
        else:
            saida.append(x)
    return saida


def sinais(nome: str, c, lado: str = "ambos", alinhar: bool = False) -> list[int]:
    """Sinais da estrategia ja com os filtros. E por aqui que o backtest pede."""
    return filtrar(c, gerar(nome, c), lado, alinhar)


# --------------------------------------------------------------------------- #
# registro
# --------------------------------------------------------------------------- #

# --------------------------------------------------------------------------- #
# montagens de mesa (analise grafica classica do BTC), cada uma testavel contra a moeda
# --------------------------------------------------------------------------- #

def cacada_stops(c, n: int = 20) -> list[int]:
    """Caca de stops: o pavio passa da maxima (ou minima) das ultimas n barras, onde
    ficam os stops de quem esta do outro lado, e o candle fecha de volta para dentro,
    na cor contraria. Entra contra o falso rompimento."""
    s = [0] * len(c.fechamento)
    for i in range(n, len(c.fechamento)):
        topo = max(c.maxima[i - n:i])
        fundo = min(c.minima[i - n:i])
        if c.maxima[i] > topo and c.fechamento[i] < topo and c.fechamento[i] < c.abertura[i]:
            s[i] = -1
        elif c.minima[i] < fundo and c.fechamento[i] > fundo and c.fechamento[i] > c.abertura[i]:
            s[i] = 1
    return s


def _testar_zona(c, i: int, ativo):
    """A MESMA regra para reteste, vao de valor justo e bloco de ordens.
    ativo = (direcao, baixo, alto, ultimo indice da espera). Compra: a minima entra
    na zona (<= alto) e o candle fecha acima do baixo. Venda: o espelho. Fechar do
    lado errado da zona, ou passar do prazo, cancela. Devolve (sinal, ativo)."""
    d, baixo, alto, ate = ativo
    if i > ate:
        return 0, None
    if d > 0 and c.minima[i] <= alto and c.fechamento[i] > baixo:
        return 1, None
    if d < 0 and c.maxima[i] >= baixo and c.fechamento[i] < alto:
        return -1, None
    if (d > 0 and c.fechamento[i] < baixo) or (d < 0 and c.fechamento[i] > alto):
        return 0, None
    return 0, ativo


def rompimento_reteste(c, n: int = 20, espera: int = 10) -> list[int]:
    """Rompimento com reteste: depois de romper o canal de n barras, o preco volta ao
    nivel rompido em ate `espera` candles, toca e fecha do lado do rompimento. Entra
    no reteste, um por rompimento. Fechar do lado errado cancela a espera. Enquanto
    espera, maximas novas no mesmo sentido nao trocam o nivel: o reteste e do nivel
    que foi rompido primeiro."""
    s = [0] * len(c.fechamento)
    ativo = None  # o nivel rompido e uma zona de altura zero
    for i in range(n, len(c.fechamento)):
        if ativo is not None:
            s[i], ativo = _testar_zona(c, i, ativo)
            if s[i]:
                continue
        topo = max(c.maxima[i - n:i])
        fundo = min(c.minima[i - n:i])
        if c.fechamento[i] > topo and (ativo is None or ativo[0] != 1):
            ativo = (1, topo, topo, i + espera)
        elif c.fechamento[i] < fundo and (ativo is None or ativo[0] != -1):
            ativo = (-1, fundo, fundo, i + espera)
    return s


def compressao_expansao(c, n: int = 20, k: float = 2.0, janela: int = 100, recente: int = 5) -> list[int]:
    """Compressao e expansao: a largura da Bollinger chega ao menor valor das ultimas
    `janela` barras E fica abaixo de 60% da largura mediana dessa janela (o mercado
    comprimiu de verdade; volatilidade constante nao conta), e o primeiro rompimento
    do canal de n barras nos `recente` candles seguintes da a direcao."""
    m = ind.sma(c.fechamento, n)
    d = ind.desvio(c.fechamento, n)
    largura = [None if m[i] is None or d[i] is None or not m[i] else 2 * k * d[i] / m[i]
               for i in range(len(c.fechamento))]
    aperto = [False] * len(c.fechamento)
    for i in range(len(c.fechamento)):
        janela_ok = [x for x in largura[max(0, i - janela + 1):i + 1] if x is not None]
        if largura[i] is None or len(janela_ok) < janela:
            continue
        ordenada = sorted(janela_ok)
        mediana = ordenada[len(ordenada) // 2]
        # tolerancia relativa: larguras iguais saem diferentes na 15a casa decimal
        if largura[i] <= ordenada[0] * (1 + 1e-9) and largura[i] < 0.6 * mediana:
            aperto[i] = True
    s = [0] * len(c.fechamento)
    for i in range(n, len(c.fechamento)):
        if not any(aperto[max(0, i - recente):i]):
            continue
        topo = max(c.maxima[i - n:i])
        fundo = min(c.minima[i - n:i])
        if c.fechamento[i] > topo:
            s[i] = 1
        elif c.fechamento[i] < fundo:
            s[i] = -1
    return s


def sessao_ativa(t_ms: int) -> bool:
    """Londres e Nova York abertas juntas, aproximado em UTC: 12h as 17h, segunda a
    sexta. Horario de verao desloca a sobreposicao em 1 hora; a janela cobre os dois."""
    hora = (t_ms // 3_600_000) % 24
    dia_semana = ((t_ms // 86_400_000) + 3) % 7  # 01/01/1970 foi quinta; segunda = 0
    return dia_semana < 5 and 12 <= hora < 17


def confl3_sessao(c) -> list[int]:
    """A confl3 so no horario de maior liquidez."""
    return [x if x and sessao_ativa(c.t[i]) else 0 for i, x in enumerate(confluencia_3(c))]


def vwap_do_dia(c, minimo_no_dia: int = 4) -> list[int]:
    """Preco medio do dia (VWAP desde 00:00 UTC): quem fecha acima dele esta do lado
    comprador. Entra no toque: a minima toca a VWAP e o candle fecha acima, com o
    candle anterior ja acima (compra); o espelho para venda. So depois de alguns
    candles no dia, para a VWAP ter peso."""
    v = ind.vwap_diaria(c.maxima, c.minima, c.fechamento, c.volume, c.t)
    s = [0] * len(c.fechamento)
    no_dia = 0
    for i in range(len(c.fechamento)):
        no_dia = 1 if i == 0 or c.t[i] // 86_400_000 != c.t[i - 1] // 86_400_000 else no_dia + 1
        if i == 0 or no_dia <= minimo_no_dia or v[i] is None or v[i - 1] is None:
            continue
        if c.minima[i] <= v[i] < c.fechamento[i] and c.fechamento[i - 1] > v[i - 1]:
            s[i] = 1
        elif c.maxima[i] >= v[i] > c.fechamento[i] and c.fechamento[i - 1] < v[i - 1]:
            s[i] = -1
    return s


# --------------------------------------------------------------------------- #
# Smart Money Concepts, escritos como regra exata
# --------------------------------------------------------------------------- #

def estrutura_mercado(c, k: int = 3):
    """Topos e fundos confirmados (pivo: maior que os k candles de cada lado, so
    conhecido k candles depois) e as quebras de estrutura. Para cada candle i:
      eventos[i]  +1 quebra de estrutura de alta (BOS), +2 mudanca de carater para alta
                  (CHoCH: rompeu o topo vindo de tendencia de baixa); -1 e -2 o espelho;
      faixas[i]   (ultimo fundo, ultimo topo) confirmados ate i;
      tendencias[i] +1, -1 ou 0 (antes da primeira quebra).
    Cada topo ou fundo so e quebrado uma vez."""
    n = len(c.fechamento)
    eventos, faixas, tendencias = [0] * n, [(None, None)] * n, [0] * n
    topo = fundo = None
    topo_rompido = fundo_rompido = False
    tend = 0
    for i in range(n):
        j = i - k
        if j - k >= 0:
            if e_topo(c, j, k):
                topo, topo_rompido = c.maxima[j], False
            if e_fundo(c, j, k):
                fundo, fundo_rompido = c.minima[j], False
        if topo is not None and not topo_rompido and c.fechamento[i] > topo:
            eventos[i], tend, topo_rompido = (2 if tend == -1 else 1), 1, True
        elif fundo is not None and not fundo_rompido and c.fechamento[i] < fundo:
            eventos[i], tend, fundo_rompido = (-2 if tend == 1 else -1), -1, True
        faixas[i], tendencias[i] = (fundo, topo), tend
    return eventos, faixas, tendencias


def e_topo(c, j: int, k: int = 3) -> bool:
    """Topo confirmado em j: maxima maior que a dos k candles de cada lado."""
    return c.maxima[j] > max(c.maxima[j - k:j]) and c.maxima[j] > max(c.maxima[j + 1:j + k + 1])


def e_fundo(c, j: int, k: int = 3) -> bool:
    """Fundo confirmado em j: minima menor que a dos k candles de cada lado."""
    return c.minima[j] < min(c.minima[j - k:j]) and c.minima[j] < min(c.minima[j + 1:j + k + 1])


def perna_atual(c, direcao: int, k: int = 3):
    """A perna que importa para entrar, ate o ultimo candle: na compra, do ultimo
    fundo confirmado ate a maior maxima desde ele (fundo, topo); na venda, do ultimo
    topo confirmado ate a menor minima desde ele. Desconto, premio e zona otima se
    medem nela. None se nao ha pivo confirmado."""
    for j in range(len(c.fechamento) - 1 - k, k - 1, -1):
        if direcao > 0 and e_fundo(c, j, k):
            return c.minima[j], max(c.maxima[j:])
        if direcao < 0 and e_topo(c, j, k):
            return min(c.minima[j:]), c.maxima[j]
    return None


def quebra_estrutura(c, k: int = 3) -> list[int]:
    """BOS: entra a favor na quebra que continua a tendencia."""
    ev, _, _ = estrutura_mercado(c, k)
    return [1 if x == 1 else -1 if x == -1 else 0 for x in ev]


def mudanca_carater(c, k: int = 3) -> list[int]:
    """CHoCH: entra na primeira quebra contra a tendencia (reversao)."""
    ev, _, _ = estrutura_mercado(c, k)
    return [1 if x == 2 else -1 if x == -2 else 0 for x in ev]


def vao_valor_justo(c, espera: int = 10, minimo_pct: float = 0.05) -> list[int]:
    """FVG: em tres candles, a maxima do 1o fica abaixo da minima do 3o (vao de alta;
    o espelho e o de baixa), com pelo menos `minimo_pct`% do preco. Entra quando o
    preco volta ao vao e segura (mesma regra de zona do reteste)."""
    s = [0] * len(c.fechamento)
    ativo = None
    for i in range(2, len(c.fechamento)):
        if ativo is not None:
            s[i], ativo = _testar_zona(c, i, ativo)
            if s[i]:
                continue
        vao = fvg_em(c, i, minimo_pct)
        if vao is not None:
            ativo = (*vao, i + espera)
    return s


def fvg_em(c, i: int, minimo_pct: float = 0.05):
    """O vao de valor justo que o candle i fecha, ou None: (direcao, baixo, alto).
    A estrategia fvg e a ficha usam esta mesma funcao."""
    if i < 2:
        return None
    if c.maxima[i - 2] < c.minima[i] and (c.minima[i] - c.maxima[i - 2]) / c.fechamento[i] * 100 >= minimo_pct:
        return 1, c.maxima[i - 2], c.minima[i]
    if c.minima[i - 2] > c.maxima[i] and (c.minima[i - 2] - c.maxima[i]) / c.fechamento[i] * 100 >= minimo_pct:
        return -1, c.maxima[i], c.minima[i - 2]
    return None


def bloco_de_ordens(c, k: int = 3, busca: int = 10, espera: int = 20, so_smc: bool = False) -> list[int]:
    """Order block: quando a estrutura quebra para cima, a zona e o ultimo candle de
    baixa antes do impulso (nos `busca` candles anteriores); entra quando o preco volta
    a zona e segura. O espelho para baixo. Com so_smc=True, so entra a favor da
    tendencia da estrutura e no lado certo da faixa: compra abaixo do meio entre o
    ultimo fundo e o ultimo topo (desconto), vende acima (premio)."""
    ev, faixas, tend = estrutura_mercado(c, k)
    s = [0] * len(c.fechamento)
    ativo = None
    for i in range(len(c.fechamento)):
        if ativo is not None:
            sinal, ativo = _testar_zona(c, i, ativo)
            if sinal and so_smc:
                fundo, topo = faixas[i]
                meio = (fundo + topo) / 2 if fundo is not None and topo is not None else None
                if meio is None or sinal != tend[i] or (sinal > 0 and c.fechamento[i] >= meio) \
                        or (sinal < 0 and c.fechamento[i] <= meio):
                    sinal = 0
            s[i] = sinal
            if sinal:
                continue
        zona = ob_do_evento(c, i, ev[i], busca)
        if zona is not None:
            ativo = (*zona, i + espera)
    return s


def ob_do_evento(c, i: int, evento: int, busca: int = 10):
    """O bloco de ordens de uma quebra de estrutura no candle i, ou None:
    (direcao, baixo, alto). Quebra para cima: o ultimo candle de baixa nos `busca`
    candles anteriores; o espelho para baixo. A estrategia ob e a ficha usam esta
    mesma funcao."""
    if evento > 0:
        ob = next((j for j in range(i - 1, max(-1, i - busca - 1), -1) if c.fechamento[j] < c.abertura[j]), None)
        return None if ob is None else (1, c.minima[ob], c.maxima[ob])
    if evento < 0:
        ob = next((j for j in range(i - 1, max(-1, i - busca - 1), -1) if c.fechamento[j] > c.abertura[j]), None)
        return None if ob is None else (-1, c.minima[ob], c.maxima[ob])
    return None


def smc_completo(c) -> list[int]:
    """A montagem SMC inteira: bloco de ordens a favor da estrutura, no desconto ou no premio."""
    return bloco_de_ordens(c, so_smc=True)


def ichimoku_cruzamento(c) -> list[int]:
    """Ichimoku classico: o tenkan cruza o kijun para cima, com o fechamento acima
    da nuvem e acima do fechamento de 26 barras atras (o chikou livre). O espelho
    para venda."""
    ich = ind.ichimoku(c.maxima, c.minima)
    t, k, na, nb = ich["tenkan"], ich["kijun"], ich["nuvem_a"], ich["nuvem_b"]
    s = [0] * len(c.fechamento)
    for i in range(1, len(c.fechamento)):
        if None in (t[i], k[i], t[i - 1], k[i - 1], na[i], nb[i]) or i < 26:
            continue
        f = c.fechamento[i]
        if t[i] > k[i] and t[i - 1] <= k[i - 1] and f > max(na[i], nb[i]) and f > c.fechamento[i - 26]:
            s[i] = 1
        elif t[i] < k[i] and t[i - 1] >= k[i - 1] and f < min(na[i], nb[i]) and f < c.fechamento[i - 26]:
            s[i] = -1
    return s


def spring_wyckoff(c, n: int = 40, lateral: float = 0.25) -> list[int]:
    """Spring de Wyckoff: numa faixa LATERAL (nas n barras anteriores o preco andou
    no maximo 25% da altura da faixa, de ponta a ponta), a minima fura o fundo da
    faixa e o candle fecha de volta dentro, de alta: quem vendeu no rompimento
    ficou preso. O espelho (upthrust) para venda. Diferente da caca de stops, so
    vale com o mercado de lado."""
    s = [0] * len(c.fechamento)
    for i in range(n, len(c.fechamento)):
        topo = max(c.maxima[i - n:i])
        fundo = min(c.minima[i - n:i])
        altura = topo - fundo
        if altura <= 0 or abs(c.fechamento[i - 1] - c.fechamento[i - n]) > lateral * altura:
            continue
        if c.minima[i] < fundo < c.fechamento[i] and c.fechamento[i] > c.abertura[i]:
            s[i] = 1
        elif c.maxima[i] > topo > c.fechamento[i] and c.fechamento[i] < c.abertura[i]:
            s[i] = -1
    return s


def com_fluxo(c, sinais: list[int], n: int = 3) -> list[int]:
    """Mantem so o sinal em que a agressao dos ultimos n candles (o do sinal incluido,
    ja fechado) vai a favor: compra com mais compra agressora, venda com mais venda.
    Sem a coluna de agressao, nenhum sinal: a estrategia nao roda sem o dado."""
    d = ind.delta_agressao(c.volume, c.agressora)
    out = []
    for i, s in enumerate(sinais):
        janela = d[max(0, i - n + 1):i + 1]
        if s == 0 or len(janela) < n or any(x is None for x in janela):
            out.append(0)
            continue
        media = sum(janela) / n
        out.append(s if (s > 0 and media > 0) or (s < 0 and media < 0) else 0)
    return out


def confl3_fluxo(c) -> list[int]:
    return com_fluxo(c, confluencia_3(c))


def canal_fluxo(c) -> list[int]:
    return com_fluxo(c, rompimento_canal(c))


# Estrategias que precisam da coluna de compra agressora (so a Binance informa).
PRECISA_AGRESSORA = {"confl3_fluxo", "canal_fluxo"}


REGISTRO: dict[str, tuple[Callable, str]] = {
    "moeda":      (moeda,               "CONTROLE — direcao sorteada, sem vantagem"),
    "comprado":   (sempre_compra,       "CONTROLE — comprado sempre, mede a tendencia"),
    "ema":        (ema_cruzamento,      "cruzamento de EMA 9/21"),
    "canal":      (rompimento_canal,    "rompimento de canal de 20 barras"),
    "momento":    (momento_atr,         "continuacao de momento filtrada por ATR"),
    "rsi":        (rsi_reversao,        "reversao por RSI 14 (30/70)"),
    "bollinger":  (bollinger_reversao,  "reversao na banda de Bollinger 20/2"),
    "vwap":       (vwap_reversao,       "reversao a VWAP de 20 barras"),
    "confl3":     (confluencia_3,       "confluencia — 3 das 5 confirmacoes"),
    "confl4":     (confluencia,         "confluencia — 4 das 5 (recomendado)"),
    "confl5":     (confluencia_5,       "confluencia — 5 das 5, so o livro-texto"),
    "engolfo":    (engolfo,             "padrao: engolfo de alta e de baixa"),
    "divergencia": (divergencia_rsi,    "padrao: divergencia entre preco e RSI 14"),
    "confl3_fluxo": (confl3_fluxo,      "confluencia 3/5 so com a agressao a favor (Binance)"),
    "canal_fluxo": (canal_fluxo,        "rompimento do canal so com a agressao a favor (Binance)"),
    "cacada":     (cacada_stops,        "mesa: caca de stops (pavio fora do canal, fecha dentro)"),
    "reteste":    (rompimento_reteste,  "mesa: rompimento com reteste do nivel rompido"),
    "compressao": (compressao_expansao, "mesa: compressao da Bollinger e rompimento depois"),
    "sessao":     (confl3_sessao,       "mesa: confl3 so com Londres e Nova York abertas"),
    "vwap_dia":   (vwap_do_dia,         "mesa: toque e defesa do preco medio do dia"),
    "bos":        (quebra_estrutura,    "SMC: quebra de estrutura a favor da tendencia"),
    "choch":      (mudanca_carater,     "SMC: mudanca de carater (primeira quebra contra)"),
    "fvg":        (vao_valor_justo,     "SMC: volta ao vao de valor justo e segura"),
    "ob":         (bloco_de_ordens,     "SMC: volta ao bloco de ordens e segura"),
    "smc":        (smc_completo,        "SMC: bloco de ordens a favor da estrutura, no desconto/premio"),
    "ichimoku":   (ichimoku_cruzamento, "Ichimoku: tenkan cruza kijun, fora da nuvem, chikou livre"),
    "spring":     (spring_wyckoff,      "Wyckoff: spring/upthrust numa faixa lateral"),
}


def gerar(nome: str, candles) -> list[int]:
    """Gera os sinais da estrategia pelo nome registrado."""
    if nome not in REGISTRO:
        raise KeyError(
            f"estrategia '{nome}' nao existe. Disponiveis: {', '.join(REGISTRO)}"
        )
    return REGISTRO[nome][0](candles)


def listar() -> str:
    largura = max(len(k) for k in REGISTRO)
    return "\n".join(
        f"  {nome.ljust(largura)}  {desc}" for nome, (_, desc) in REGISTRO.items()
    )
