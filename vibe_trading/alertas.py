#!/usr/bin/env python3
"""
Alertas de mercado do vigia, no fechamento de cada candle do menor periodo:

  MOVIMENTO BRUSCO   a amplitude do candle passou de 3x o ruido normal (a mediana
                     dos 100 candles anteriores). No maximo 1 por hora por moeda.
  TOPO/FUNDO DA SEMANA  o fechamento rompeu o topo ou perdeu o fundo da semana
                     passada (segunda a domingo, UTC). Uma vez por semana cada um.
  MUDOU DE FAIXA     o fechamento atravessou um numero redondo (1.000 no BTC a 60
                     mil; o mesmo degrau da ficha). O mesmo nivel no mesmo sentido, no
                     maximo a cada 4 h (subir e voltar avisa as duas coisas).

So avisam: nenhum alerta abre operacao. Candle velho (o vigia voltando de uma
pausa) nao gera alerta atrasado. Os niveis sao os mesmos da ficha
(ficha.extremos_dia_semana e ficha.passo_redondo).
"""

from __future__ import annotations

import math

import backtest as bt
import ficha
import indicadores as ind

ALERTAS_PADRAO = {"ligados": True, "brusco_vezes": 3.0, "brusco_intervalo_min": 60, "faixa_intervalo_min": 240}
JANELA_RUIDO = 100


def avaliar(ativo: str, tf: str, s: bt.Serie, agora_ms: int, memoria: dict, cfg: dict | None = None) -> list[str]:
    """Os alertas do ultimo candle fechado de `s`. `memoria` (guardada no estado do
    vigia) impede repetir o mesmo alerta."""
    cfg = {**ALERTAS_PADRAO, **(cfg or {})}
    if not cfg["ligados"] or len(s) < JANELA_RUIDO + 1:
        return []
    ms = bt.PERIODOS[tf] * 60_000
    i = len(s) - 1
    if agora_ms - (s.t[i] + ms) > 2 * ms:
        return []
    if memoria.get("ultimo_t") == s.t[i]:
        return []  # este candle ja foi avaliado
    memoria["ultimo_t"] = s.t[i]
    out = []
    preco, antes = s.fechamento[i], s.fechamento[i - 1]

    ruido = ind.ruido_tipico(s.maxima[i - JANELA_RUIDO:i], s.minima[i - JANELA_RUIDO:i],
                             s.fechamento[i - JANELA_RUIDO:i])
    amplitude = (s.maxima[i] - s.minima[i]) / preco * 100 if preco else 0.0
    if ruido > 0 and amplitude >= cfg["brusco_vezes"] * ruido \
            and agora_ms - memoria.get("brusco", 0) >= cfg["brusco_intervalo_min"] * 60_000:
        memoria["brusco"] = agora_ms
        var = (preco / s.abertura[i] - 1) * 100
        out.append(f"MOVIMENTO BRUSCO {ativo} {tf}: {'+' if var > 0 else ''}{ficha.pct(var)} no candle, amplitude "
                   f"{ficha.pct(amplitude)} ({ficha.vezes(amplitude / ruido)} o normal). Preco {ficha.fmt_preco(preco)}.")

    ext = ficha.extremos_dia_semana(s, agora_ms)
    semana = ficha.semana_de(agora_ms // ficha.DIA)
    topo, fundo = ext.get("topo da semana passada"), ext.get("fundo da semana passada")
    if topo is not None and antes <= topo < preco and memoria.get("topo_semana") != semana:
        memoria["topo_semana"] = semana
        out.append(f"ROMPEU O TOPO DA SEMANA PASSADA {ativo}: fechou {ficha.fmt_preco(preco)} acima de "
                   f"{ficha.fmt_preco(topo)}.")
    if fundo is not None and antes >= fundo > preco and memoria.get("fundo_semana") != semana:
        memoria["fundo_semana"] = semana
        out.append(f"PERDEU O FUNDO DA SEMANA PASSADA {ativo}: fechou {ficha.fmt_preco(preco)} abaixo de "
                   f"{ficha.fmt_preco(fundo)}.")

    passo = ficha.passo_redondo(preco)
    de, para = math.floor(antes / passo), math.floor(preco / passo)
    if de != para:
        nivel = max(de, para) * passo
        chave = f"{nivel:.10g}|{'sobe' if para > de else 'desce'}"  # a volta tambem avisa
        faixas = memoria.setdefault("faixas", {})
        for k in [k for k, t in faixas.items() if agora_ms - t > 86_400_000]:
            del faixas[k]
        if agora_ms - faixas.get(chave, 0) >= cfg["faixa_intervalo_min"] * 60_000:
            faixas[chave] = agora_ms
            out.append(f"MUDOU DE FAIXA {ativo}: {'subiu acima' if para > de else 'caiu abaixo'} de "
                       f"{ficha.fmt_preco(nivel)} (fechou {ficha.fmt_preco(preco)}).")
    return out
