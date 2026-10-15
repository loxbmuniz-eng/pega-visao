#!/usr/bin/env python3
"""
Vigia: opera no PAPEL, ao vivo, as estrategias aprovadas — 24 horas, a cada
candle fechado — e mantem o placar contra a moeda pareada.

E a fase 2 do plano ("prova fora da amostra"): a estrategia roda em candles
que ela nunca viu, com a MESMA regra do backtest (backtest.checar_barra), e o
diario mostra se o que o teste prometia aparece de verdade.

O que ele faz a cada candle fechado:
  - roda cada estrategia congelada do vigia.json e abre/fecha operacoes de papel;
  - roda 20 moedas pareadas ao lado (entram nos mesmos candles, lado sorteado);
  - grava cada operacao fechada no diario (dados_vigia/diario.jsonl);
  - avisa no Telegram, se configurado: entrada, saida e resumo do dia;
  - se a arena estiver ligada (vigia.json -> "arena"), consulta a Qwen e o
    Claude nos candles de interesse e poe cada IA como mais uma trilha, com as
    mesmas regras de saida e as mesmas moedas pareadas (veja arena.py).

O que ele NAO faz: enviar ordem, pedir chave de corretora, mudar parametro.

Uso:
    python3 vigia.py                       # roda sem parar (Ctrl+C para parar)
    caffeinate -i python3 vigia.py         # no Mac: impede o Mac de dormir enquanto roda
    python3 vigia.py --placar              # mostra o placar e sai
    python3 vigia.py --uma-vez             # processa os candles pendentes e sai
    python3 vigia.py --telegram-descobrir  # descobre o seu chat id (veja segredos.json)
    python3 vigia.py --telegram-teste      # manda uma mensagem de teste

Desligou e religou? Ele busca os candles que fecharam enquanto estava fora e
processa na ordem, pela mesma regra: o placar nao muda por causa da pausa.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict

import alertas
import arena
import backtest as bt
import estatistica
import estrategias
import fatores
import ficha
import livro
import risco

AQUI = os.path.dirname(os.path.abspath(__file__))
PASTA = os.path.join(AQUI, "dados_vigia")
CONFIG = os.path.join(AQUI, "vigia.json")
SEGREDOS = os.path.join(AQUI, "segredos.json")

MS = {tf: minutos * 60_000 for tf, minutos in bt.PERIODOS.items()}
MAX_CACHE = 6000  # candles guardados por ativo/periodo (alinhamento no 15 min pede ~4200)

CONFIG_PADRAO = {
    "ativos": ["BTCUSDT"],
    "periodos": ["15m"],
    # De onde vem o candle que move as operacoes de papel. "pionex" = o perpetuo da
    # corretora onde se opera (o preco que dispara stop e liquidacao de verdade).
    "fonte": "pionex",
    # Segunda fonte, so para conferencia: se os fechamentos divergirem mais que
    # divergencia_max_pct, o vigia avisa. "" desliga.
    "conferir_com": "binance",
    "divergencia_max_pct": 0.3,
    # Grava o livro de ofertas (Pionex, Binance, Hyperliquid) a cada candle do menor
    # periodo, em dados_vigia/livro.jsonl. So gravacao: nenhuma estrategia usa.
    "gravar_livro": True,
    # Teto do risco somado de todas as posicoes abertas (se todas batessem no stop
    # juntas), em % da banca. O /status e o resumo mostram quando passa.
    "risco_total_max_pct": 6,
    "estrategias": [
        {"nome": "confl3", "lado": "ambos", "alinhar": False},
        {"nome": "engolfo", "lado": "ambos", "alinhar": False},
    ],
    "params": {"banca": 110, "margem": 15, "alav": 24, "taxa": 0.05, "mm": 0.5,
               "stop": 0.5, "rr": 2, "max_barras": 48},
    "moedas": 20,
    # A fase 2 julga UMA vez em cada ponto fixado antes, contando so operacoes ao vivo
    # (as fechadas com o vigia desligado nao contam). Julgar a cada operacao ate "dar
    # certo" aprovava 15% das estrategias sem vantagem; com estes pontos, nenhuma de 150.
    "julgar_em": [100, 200, 300],
    "historico_inicial_dias": 30,
    "resumo_diario_hora": 21,
    # A arena so liga com "ligada": true E pelo menos uma chave de IA no segredos.json.
    # O teto vale por IA por dia; a decisao de um candle e guardada e nunca repetida.
    "arena": {"ligada": False, "ativo": "BTCUSDT", "periodo": "15m",
              "qwen_modelo": "qwen/qwen3-max", "deepseek_modelo": "deepseek/deepseek-v3.2",
              "claude_modelo": "claude-opus-5-5",
              "claude_esforco": "low", "max_chamadas_dia": 30},
    # A ficha de cada operacao (/analisar no Telegram, vibe.py analisar): risco padrao,
    # tetos e tolerancias. Veja ficha.FICHA_PADRAO para o que cada um faz.
    "ficha": dict(ficha.FICHA_PADRAO),
    # /radar: os perpetuos da Pionex que mais oscilaram em 24 h, so os com volume.
    "radar": {"volume_min_usdt": 5_000_000, "quantos": 10},
    # Alertas de mercado no menor periodo: movimento brusco, topo e fundo da semana
    # passada, mudanca de faixa (numero redondo). So avisam. Veja alertas.py.
    "alertas": dict(alertas.ALERTAS_PADRAO),
    # Disjuntor do dia, para a conta REAL: voce anota cada resultado no Telegram
    # (/resultado -2,1). Com 3 perdas seguidas no dia, ou o dia em -6% da banca, toda
    # ficha ate a meia-noite (Brasilia) sai NAO OPERAR.
    "disjuntor": {"ligado": True, "perdas_seguidas": 3, "perda_dia_pct": 6.0},
    # Gestao de risco da conta REAL, tambem pelos /resultado: com a banca 10% abaixo do
    # pico a ficha usa metade do risco pedido, 20% abaixo um quarto; a semana (segunda
    # a domingo, Brasilia) em -10% da banca e toda ficha ate segunda sai NAO OPERAR.
    "risco": dict(risco.RISCO_PADRAO),
}

SEGREDOS_MODELO = {
    "telegram_token": "",
    "telegram_chat_id": "",
    "openrouter_key": "",
    "anthropic_api_key": "",
}

ESFORCOS = ("low", "medium", "high", "xhigh", "max")


# --------------------------------------------------------------------------- #
# arquivos
# --------------------------------------------------------------------------- #

def ler_json(caminho: str, padrao):
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return padrao


def gravar_json(caminho: str, dado, indent=None, privado: bool = False) -> None:
    """Grava de forma atomica: um desligamento no meio nao corrompe o arquivo.
    privado=True: o arquivo nasce so com leitura do dono (chmod 600), sem janela aberta."""
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    tmp = caminho + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600 if privado else 0o644)
    if privado:
        os.chmod(tmp, 0o600)  # se o .tmp ja existia com outra permissao
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(dado, f, ensure_ascii=False, indent=indent)
    os.replace(tmp, caminho)


def anexar_json(caminho: str, registro: dict) -> None:
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, "a", encoding="utf-8") as f:
        f.write(json.dumps(registro, ensure_ascii=False) + "\n")


# --------------------------------------------------------------------------- #
# diario encadeado: cada operacao carrega a assinatura da anterior
# --------------------------------------------------------------------------- #

def _assinar(anterior: str, registro: dict) -> str:
    corpo = json.dumps({k: v for k, v in registro.items() if k not in ("hash", "hash_anterior")},
                       sort_keys=True, ensure_ascii=False)
    return hashlib.sha256((anterior + corpo).encode()).hexdigest()


def _ultimo_hash(caminho: str) -> str:
    if not os.path.exists(caminho):
        return ""
    with open(caminho, "rb") as f:
        f.seek(max(0, os.path.getsize(caminho) - 16384))
        for linha in reversed(f.read().decode("utf-8", errors="replace").splitlines()):
            try:
                return json.loads(linha).get("hash", "")
            except ValueError:
                continue
    return ""


def anexar_encadeado(caminho: str, registro: dict) -> None:
    """Grava a operacao com a assinatura dela e a da anterior: mudar, apagar ou
    inserir uma linha depois quebra a corrente dali em diante, e o /status mostra."""
    anterior = _ultimo_hash(caminho)
    anexar_json(caminho, {**registro, "hash_anterior": anterior, "hash": _assinar(anterior, registro)})


def conferir_diario(caminho: str) -> dict:
    """{'n': linhas, 'encadeadas': quantas com assinatura, 'quebra': 1a linha alterada ou None}.
    Linhas antigas, sem assinatura, so sao aceitas ANTES da primeira assinada."""
    n = encadeadas = 0
    anterior, quebra = "", None
    if os.path.exists(caminho):
        with open(caminho, encoding="utf-8") as f:
            for n, linha in enumerate(f, 1):
                try:
                    r = json.loads(linha)
                except ValueError:
                    quebra = quebra or n
                    continue
                if "hash" not in r:
                    if encadeadas and quebra is None:
                        quebra = n
                    continue
                encadeadas += 1
                if quebra is None and (r.get("hash_anterior") != anterior or r["hash"] != _assinar(anterior, r)):
                    quebra = n
                anterior = r["hash"]
    return {"n": n, "encadeadas": encadeadas, "quebra": quebra}


def texto_diario(pasta: str = PASTA) -> str:
    c = conferir_diario(os.path.join(pasta, "diario.jsonl"))
    if c["quebra"]:
        return f"ATENCAO: o diario foi alterado na linha {c['quebra']} (de {c['n']}): o placar dali em diante nao e confiavel"
    return f"diario: {c['n']} operacoes, corrente de assinaturas integra"


# Campo novo num vigia.json que ja existia: o valor que reproduz o comportamento
# antigo, nao o padrao novo. Trocar a fonte no meio da fase 2 seria outra hipotese.
PADRAO_PARA_CONFIG_ANTIGA = {"fonte": "binance", "conferir_com": ""}


def carregar_config(caminho: str = CONFIG) -> dict:
    if not os.path.exists(caminho):
        gravar_json(caminho, CONFIG_PADRAO, indent=2)
        print(f"  criei {os.path.basename(caminho)} com a configuracao padrao (confl3 e engolfo, BTCUSDT 15m)")
    cfg = ler_json(caminho, CONFIG_PADRAO)
    # vigia.json de uma versao anterior: acrescenta so o que falta, sem mexer no que existe
    novos = [k for k in CONFIG_PADRAO if k not in cfg]
    for k in novos:
        cfg[k] = json.loads(json.dumps(PADRAO_PARA_CONFIG_ANTIGA.get(k, CONFIG_PADRAO[k])))
    for grupo in ("arena", "ficha", "radar", "alertas", "disjuntor", "risco"):
        novos += [f"{grupo}.{k}" for k in CONFIG_PADRAO[grupo] if k not in cfg[grupo]]
        for k in CONFIG_PADRAO[grupo]:
            cfg[grupo].setdefault(k, CONFIG_PADRAO[grupo][k])
    if novos:
        gravar_json(caminho, cfg, indent=2)
        print(f"  acrescentei ao {os.path.basename(caminho)}: {', '.join(novos)} (valores padrao)")
    if cfg["fonte"] not in bt.BUSCADORES:
        sys.exit(f"vigia.json: fonte '{cfg['fonte']}' nao existe. Use: {', '.join(bt.BUSCADORES)}")
    if cfg["conferir_com"] and cfg["conferir_com"] not in bt.BUSCADORES:
        sys.exit(f"vigia.json: conferir_com '{cfg['conferir_com']}' nao existe. Use: {', '.join(bt.BUSCADORES)} ou \"\"")
    a = cfg["arena"]
    if a["ligada"]:
        if a["ativo"] not in cfg["ativos"] or a["periodo"] not in cfg["periodos"]:
            sys.exit(f"vigia.json: a arena esta em {a['ativo']} {a['periodo']}, mas o vigia so acompanha "
                     f"{', '.join(cfg['ativos'])} em {', '.join(cfg['periodos'])}. Ajuste 'arena' ou 'ativos'/'periodos'.")
        if a["claude_esforco"] not in ESFORCOS:
            sys.exit(f"vigia.json: claude_esforco '{a['claude_esforco']}' nao existe. Use: {', '.join(ESFORCOS)}")
    for e in cfg["estrategias"]:
        if e["nome"] in estrategias.PRECISA_AGRESSORA:
            sys.exit(f"vigia.json: '{e['nome']}' usa a compra agressora, que o vigia ainda nao guarda. "
                     f"Ela roda na bateria (dado da Binance); se passar la, o vigia ganha essa coluna.")
        if e["nome"] not in estrategias.REGISTRO:
            sys.exit(f"vigia.json: estrategia '{e['nome']}' nao existe. Disponiveis: {', '.join(estrategias.REGISTRO)}")
    for tf in cfg["periodos"]:
        if tf not in MS:
            sys.exit(f"vigia.json: periodo '{tf}' nao existe. Use: {', '.join(MS)}")
    return cfg


def carregar_segredos(caminho: str = SEGREDOS) -> dict:
    """Le o segredos.json; cria o modelo vazio (chmod 600) se nao existir e acrescenta
    os campos novos, vazios, sem tocar nos que ja estao preenchidos."""
    if not os.path.exists(caminho):
        gravar_json(caminho, SEGREDOS_MODELO, indent=2, privado=True)
        return dict(SEGREDOS_MODELO)
    modo = os.stat(caminho).st_mode
    if modo & (stat.S_IRWXG | stat.S_IRWXO):
        print(f"  AVISO: {os.path.basename(caminho)} pode ser lido por outros usuarios. "
              f"Rode: chmod 600 {caminho}")
    seg = ler_json(caminho, {})
    novos = [k for k in SEGREDOS_MODELO if k not in seg]
    if novos:
        for k in novos:
            seg[k] = ""
        gravar_json(caminho, seg, indent=2, privado=True)
        print(f"  acrescentei ao {os.path.basename(caminho)} o campo vazio: {', '.join(novos)}")
    return seg


def params_de(cfg: dict) -> bt.Params:
    return bt.Params(**cfg["params"])


# --------------------------------------------------------------------------- #
# trilhas: uma estrategia num ativo e periodo, com as suas moedas
# --------------------------------------------------------------------------- #

def rotulo(ativo: str, fonte: str) -> str:
    """BTCUSDT na Binance (como sempre foi) ou BTCUSDT@pionex: fonte diferente e
    trilha diferente, e cache diferente — candles de duas fontes nunca se misturam."""
    return ativo if fonte == "binance" else f"{ativo}@{fonte}"


def arquivo_cache(pasta: str, ativo: str, tf: str, fonte: str) -> str:
    return os.path.join(pasta, f"candles_{rotulo(ativo, fonte)}_{tf}.json")


def id_trilha(e: dict, ativo: str, tf: str) -> str:
    return f"{e['nome']}|{e.get('lado', 'ambos')}|{'alinhado' if e.get('alinhar') else 'livre'}|{ativo}|{tf}"


def trilha_nova(n_moedas: int) -> dict:
    return {"posicao": None, "ultimo_t": None, "resultados": [], "pico": 0.0, "queda_max": 0.0,
            "moedas": [{"posicao": None, "n": 0, "soma": 0.0} for _ in range(n_moedas)]}


def lado_da_moeda(semente: int, t: int, frac_compra: float = 0.5) -> int:
    """Sorteio deterministico: a mesma moeda no mesmo candle tira sempre o mesmo lado,
    entao desligar e religar o vigia nao muda o resultado das moedas. Compra com a
    probabilidade `frac_compra` — a mesma mistura de compras e vendas da estrategia,
    para a tendencia do periodo nao contar como vantagem dela."""
    h = hashlib.sha256(f"{semente}:{t}".encode()).digest()
    return 1 if int.from_bytes(h[:8], "big") / 2 ** 64 < frac_compra else -1


def _pos_de(d):
    return bt.Posicao(**d) if d else None


def passo(pos_dict, sinal: int, i: int, c: dict, p: bt.Params):
    """
    Um candle para uma posicao (da estrategia ou de uma moeda). Mesma ordem do
    backtest.simular: primeiro o candle atua sobre a posicao aberta; uma posicao
    que fechou neste candle nao reabre nele; sem posicao, o sinal abre no
    fechamento. Devolve (posicao_nova, fechamento | None, abriu).
    """
    pos = _pos_de(pos_dict)
    fechou = None
    if pos is not None:
        pos.barras += 1
        r = bt.checar_barra(pos, c["maxima"][i], c["minima"][i], p)
        if r is not None:
            fechou = (r[0], r[1], pos)
        elif pos.barras >= p.max_barras:
            fechou = (bt.encerrar_no_preco(pos, c["fechamento"][i], p), "expirou", pos)
        if fechou is not None:
            pos = None
    abriu = False
    if pos is None and fechou is None and sinal != 0:
        pos = bt.abrir(c["fechamento"][i], 1 if sinal > 0 else -1, p)
        abriu = True
    return (asdict(pos) if pos else None), fechou, abriu


# --------------------------------------------------------------------------- #
# candles
# --------------------------------------------------------------------------- #

def cache_vazio() -> dict:
    return {"t": [], "abertura": [], "maxima": [], "minima": [], "fechamento": [], "volume": []}


def serie_do_cache(c: dict) -> bt.Serie:
    return bt.Serie(c["abertura"], c["maxima"], c["minima"], c["fechamento"], c["volume"], c["t"])


def atualizar_cache(c: dict, s: bt.Serie) -> int:
    """Acrescenta ao cache os candles fechados que ele ainda nao tem. Devolve quantos."""
    ultimo = c["t"][-1] if c["t"] else -1
    novos = 0
    for i, t in enumerate(s.t):
        if t > ultimo:
            for col, fonte in (("t", s.t), ("abertura", s.abertura), ("maxima", s.maxima),
                               ("minima", s.minima), ("fechamento", s.fechamento), ("volume", s.volume)):
                c[col].append(fonte[i])
            ultimo = t
            novos += 1
    if len(c["t"]) > MAX_CACHE + 1000:  # corta em blocos, nao a cada candle
        corte = len(c["t"]) - MAX_CACHE
        for col in c:
            del c[col][:corte]
    return novos


# --------------------------------------------------------------------------- #
# o ciclo
# --------------------------------------------------------------------------- #

NIVEIS = (("aprovada", 0.95), ("promissora", 0.80))


def julgar(ao_vivo: list[float], moedas_vivo: list[float], tentativas: int) -> dict:
    """Um julgamento da fase 2, feito UMA vez em cada ponto de corte fixado antes.
    Precisa ser positiva depois da taxa e ganhar de 75% das moedas pareadas; a chance
    de nao ser sorte (contando como tentativas todas as trilhas do vigia) decide o
    nivel: 95% ou mais = aprovada; 80% ou mais = promissora (dinheiro real so com
    risco reduzido); abaixo disso, reprovada."""
    r = bt.Resultado(resultados=list(ao_vivo))
    bate = bt.fracao_batida(sum(ao_vivo), moedas_vivo)
    prova = estatistica.sharpe_deflacionado(ao_vivo, max(1, tentativas))
    nivel = "reprovada"
    if r.por_operacao > 0 and bate >= 75:
        nivel = next((nome for nome, minimo in NIVEIS if prova["dsr"] >= minimo), "reprovada")
    return {"operacoes": len(ao_vivo), "por_operacao": round(r.por_operacao, 4), "bate": round(bate, 1),
            "nao_sorte": round(prova["dsr"], 4), "tentativas": tentativas, "nivel": nivel,
            "passa": nivel == "aprovada"}


def processar_barra(tr: dict, tid: str, nome: str, ativo: str, tf: str, sinal: int, i: int, c: dict,
                    p: bt.Params, recuperado: bool, pasta: str, avisar, motivo: str = "",
                    julgar_em=(100, 200, 300), tentativas: int = 1, confianca: float | None = None,
                    cfg: dict | None = None) -> None:
    """Um candle numa trilha (estrategia ou IA): a posicao, o diario, o aviso e as
    moedas pareadas. Estrategia e IA passam pela MESMA funcao. `cfg` e so para o aviso
    de entrada dizer se algum disjuntor da conta real esta armado (gestao)."""
    tr["posicao"], fechou, abriu = passo(tr["posicao"], sinal, i, c, p)
    if fechou is not None:
        pnl, desfecho, pos = fechou
        tr["resultados"].append(pnl)
        if not recuperado:
            tr.setdefault("ao_vivo", []).append(pnl)
        saldo = sum(tr["resultados"])
        tr["pico"] = max(tr["pico"], saldo)
        tr["queda_max"] = max(tr["queda_max"], tr["pico"] - saldo)
        registro = {"trilha": tid, "estrategia": nome, "ativo": ativo, "periodo": tf,
                    "lado": "compra" if pos.direcao > 0 else "venda", "entrada": pos.entrada,
                    "saida_t": c["t"][i], "desfecho": desfecho, "pnl": round(pnl, 6),
                    "candles": pos.barras, "recuperado": recuperado}
        if "motivo_entrada" in tr:
            registro["motivo_entrada"] = tr.pop("motivo_entrada")
        conf = tr.pop("confianca_entrada", None)
        if conf is not None:
            # nota de acerto (Brier): (confianca - acertou)^2. 0 = perfeito; 0,25 = sempre dizer 50%
            registro["confianca"] = conf
            tr.setdefault("brier", []).append(round((conf - (1.0 if pnl > 0 else 0.0)) ** 2, 6))
        anexar_encadeado(os.path.join(pasta, "diario.jsonl"), registro)
        if avisar and not recuperado:
            avisar(texto_saida(registro, tr))
    if abriu:
        if motivo:
            tr["motivo_entrada"] = motivo
        if confianca is not None:
            tr["confianca_entrada"] = confianca
        if avisar and not recuperado:
            g = gestao(ler_resultados(pasta), int(time.time() * 1000), cfg or {"params": {"banca": p.banca}})
            avisar(texto_entrada(nome, ativo, tf, tr["posicao"], p, motivo,
                                 nivel=(tr.get("julgamento") or {}).get("nivel", "em teste"),
                                 disjuntor_armado=bool(g["bloqueios"])))
    # a moeda compra na mesma proporcao em que a estrategia mandou comprar ate aqui
    frac = (tr.get("sinais_compra", 0) + 1) / (tr.get("sinais", 0) + 2)
    for k, m in enumerate(tr["moedas"]):
        lado = lado_da_moeda(k, c["t"][i], frac) if sinal != 0 else 0
        m["posicao"], fm, _ = passo(m["posicao"], lado, i, c, p)
        if fm is not None:
            m["n"] += 1
            m["soma"] += fm[0]
            if not recuperado:
                m["soma_vivo"] = m.get("soma_vivo", 0.0) + fm[0]
    feitos = tr.setdefault("julgamentos", {})
    for ponto in julgar_em:
        if str(ponto) not in feitos and len(tr.get("ao_vivo", [])) >= ponto:
            feitos[str(ponto)] = julgar(tr["ao_vivo"][:ponto], [m.get("soma_vivo", 0.0) for m in tr["moedas"]],
                                        tentativas)
            feitos[str(ponto)]["t"] = c["t"][i]
            tr["julgamento"] = feitos[str(ponto)]  # vale o julgamento mais recente
    if sinal != 0:
        tr["sinais"] = tr.get("sinais", 0) + 1
        tr["sinais_compra"] = tr.get("sinais_compra", 0) + (1 if sinal > 0 else 0)
    tr["ultimo_t"] = c["t"][i]


def ciclo(estado: dict, cfg: dict, ativo: str, tf: str, buscador, agora_ms: int,
          pasta: str = PASTA, avisar=None, juiz=None, fonte: str = "binance") -> int:
    """
    Busca os candles novos de um ativo/periodo e processa cada um, na ordem, em
    todas as trilhas. Devolve quantos candles foram processados (o maior numero
    entre as trilhas, nao a soma).
    `buscador(par, tf, n)` e `agora_ms` sao injetaveis para o teste de replay;
    `juiz` (arena.Juiz) liga as trilhas das IAs, se a arena for neste ativo/periodo.
    `fonte` so rotula trilhas e cache; quem busca e o `buscador`.
    """
    p = params_de(cfg)
    ms = MS[tf]
    estado["julgar_em"] = list(cfg.get("julgar_em", (100, 200, 300)))
    arq_cache = arquivo_cache(pasta, ativo, tf, fonte)
    c = ler_json(arq_cache, None)
    alinhar = any(e.get("alinhar") for e in cfg["estrategias"])
    rot = rotulo(ativo, fonte)
    trilhas_aqui = [(e, id_trilha(e, rot, tf)) for e in cfg["estrategias"]]
    a = cfg.get("arena") or {}
    ias = ([(n, id_trilha({"nome": n}, rot, tf)) for n in juiz.competidores()]
           if juiz is not None and a.get("ativo") == ativo and a.get("periodo") == tf else [])
    todas = [tid for _, tid in trilhas_aqui] + [tid for _, tid in ias]

    if c is None:  # primeira vez: historico para aquecer os indicadores, sem operar nele
        n = bt.candles_para(tf, cfg.get("historico_inicial_dias", 30), alinhar)
        c = cache_vazio()
        atualizar_cache(c, buscador(ativo, tf, n))
        gravar_json(arq_cache, c)
        for tid in todas:
            tr = estado["trilhas"].setdefault(tid, trilha_nova(cfg["moedas"]))
            tr["ultimo_t"] = c["t"][-1] if c["t"] else None
        return 0

    for tid in todas:  # trilha nova (estrategia ou IA) comeca daqui, sem operar o passado
        if tid not in estado["trilhas"]:
            tr = estado["trilhas"][tid] = trilha_nova(cfg["moedas"])
            tr["ultimo_t"] = c["t"][-1] if c["t"] else None

    faltam = max(1, int((agora_ms - c["t"][-1]) // ms)) if c["t"] else 1
    atualizar_cache(c, buscador(ativo, tf, min(faltam + 5, 20000)))
    gravar_json(arq_cache, c)

    serie = serie_do_cache(c)
    processados = 0
    for e, tid in trilhas_aqui:
        tr = estado["trilhas"][tid]
        pendentes = [i for i, t in enumerate(c["t"]) if tr["ultimo_t"] is None or t > tr["ultimo_t"]]
        if not pendentes:
            continue
        sinais = estrategias.sinais(e["nome"], serie, e.get("lado", "ambos"), e.get("alinhar", False))
        for i in pendentes:
            recuperado = agora_ms - (c["t"][i] + ms) > 2 * ms  # fechou enquanto o vigia estava fora
            processar_barra(tr, tid, e["nome"], rot, tf, sinais[i], i, c, p, recuperado, pasta, avisar,
                            julgar_em=cfg.get("julgar_em", (100, 200, 300)), tentativas=len(estado["trilhas"]),
                            cfg=cfg)
        processados = max(processados, len(pendentes))

    if ias:
        processados = max(processados, ciclo_arena(estado, juiz, dict(ias), rot, tf, c, serie, p,
                                                   agora_ms, pasta, avisar, cfg.get("julgar_em", (100, 200, 300)),
                                                   cfg=cfg))
    return processados


def ciclo_arena(estado: dict, juiz, tids: dict, ativo: str, tf: str, c: dict, serie: bt.Serie,
                p: bt.Params, agora_ms: int, pasta: str, avisar, julgar_em=(100, 200, 300),
                cfg: dict | None = None) -> int:
    """
    As IAs como trilhas. A IA so e consultada num candle que:
      - acabou de fechar (candle recuperado depois de uma pausa nao e consultado:
        a decisao tem que ser tomada no momento, sem saber o que veio depois);
      - e de interesse (rompimento do canal de 20 ou divergencia de RSI);
      - encontra pelo menos uma IA sem posicao (com posicao aberta, o sinal nao abriria nada).
    Nos outros candles o sinal da IA e NADA. As moedas pareadas entram nos candles em
    que a IA entrou, como nas estrategias.
    """
    ms = MS[tf]

    def pendente(nome: str, t: int) -> bool:
        ultimo = estado["trilhas"][tids[nome]]["ultimo_t"]
        return ultimo is None or t > ultimo

    pend = [i for i, t in enumerate(c["t"]) if any(pendente(n, t) for n in tids)]
    if not pend:
        return 0
    marca = arena.candles_de_interesse(serie)
    memoria = estado.setdefault("arena", {})
    for i in pend:
        t = c["t"][i]
        recuperado = agora_ms - (t + ms) > 2 * ms
        aqui = [n for n in tids if pendente(n, t)]
        decisoes: dict = {}
        if (marca[i] and not recuperado
                and any(estado["trilhas"][tids[n]]["posicao"] is None for n in aqui)):
            chave = f"{ativo}|{tf}|{t}"
            nova = chave not in memoria.get("decisoes", {})
            try:
                decisoes = juiz.decidir(memoria, chave, serie, i, p)
            except Exception as e:  # a arena nunca derruba o vigia: falhou, e NADA
                juiz.log(f"arena: falha ao decidir o candle {chave} ({type(e).__name__}): nada")
                decisoes = {}
            confs = (memoria.get("confiancas") or {}).get(chave, {}) if decisoes else {}
            if nova and decisoes:
                anexar_json(os.path.join(pasta, "arena.jsonl"), {
                    "t": t, "ativo": ativo, "periodo": tf, "fechamento": c["fechamento"][i],
                    "decisoes": {k: {"lado": v[0], "motivo": v[1], "confianca": confs.get(k)}
                                 for k, v in decisoes.items()}})
        else:
            confs = {}
        for n in aqui:
            lado, motivo = decisoes.get(n, (0, ""))
            processar_barra(estado["trilhas"][tids[n]], tids[n], n, ativo, tf, lado, i, c, p,
                            recuperado, pasta, avisar, motivo, julgar_em, len(estado["trilhas"]),
                            confianca=confs.get(n) if lado else None, cfg=cfg)
    return len(pend)


def conferir(estado: dict, cfg: dict, ativo: str, tf: str, principal: bt.Serie, outra: bt.Serie,
             agora_ms: int, avisar=None, registrar=None) -> float:
    """Confere a fonte principal contra a segunda nos ultimos candles que as duas tem.
    Divergencia acima do limite: avisa no maximo uma vez por hora por ativo/periodo."""
    d, n = bt.divergencia(principal, outra)
    limite = cfg.get("divergencia_max_pct", 0.3)
    reg = estado.setdefault("conferencia", {}).setdefault(f"{ativo}|{tf}", {"alertas": 0, "ultimo_alerta": 0})
    reg.update({"pct": round(d, 4), "comparados": n, "quando": agora_ms, "com": cfg["conferir_com"]})
    if n and d > limite:
        reg["alertas"] += 1
        if agora_ms - reg["ultimo_alerta"] >= 3_600_000:
            reg["ultimo_alerta"] = agora_ms
            msg = (f"ATENCAO: {ativo} {tf}: {cfg['fonte']} e {cfg['conferir_com']} divergem {d:.2f}% no "
                   f"fechamento (limite {limite:g}%). Confira o grafico antes de agir em qualquer sinal.")
            (registrar or log)(msg)
            if avisar:
                avisar(msg)
    return d


# --------------------------------------------------------------------------- #
# placar
# --------------------------------------------------------------------------- #

def placar(estado: dict) -> list[dict]:
    linhas = []
    for tid, tr in sorted(estado["trilhas"].items()):
        r = bt.Resultado(resultados=list(tr["resultados"]))
        n = len(r.resultados)
        lucro = sum(r.resultados)
        moedas = [m["soma"] for m in tr["moedas"]]
        bate = bt.fracao_batida(lucro, moedas) if n else 0.0
        j = tr.get("julgamento")
        vivas = len(tr.get("ao_vivo", []))
        pontos = estado.get("julgar_em", [100, 200, 300])
        proximo = next((x for x in pontos if x > vivas), None)
        falta = f"; proximo julgamento com {proximo}" if proximo else ""
        if j is None:
            fase2 = (f"EM TESTE: {vivas} operacoes ao vivo{falta} (as feitas com o vigia desligado nao contam). "
                     f"Nao use dinheiro real nela ainda.")
        else:
            rotulo = {"aprovada": "APROVADA", "promissora": "PROMISSORA (dinheiro real so com risco reduzido)",
                      "reprovada": "REPROVADA"}[j["nivel"]]
            fase2 = (f"{rotulo}, julgada com {j['operacoes']} operacoes ao vivo: {j['por_operacao']:+.2f} por op, "
                     f"bate {j['bate']:.0f}% das moedas, {j['nao_sorte'] * 100:.1f}% de chance de nao ser sorte{falta}")
        notas = tr.get("brier") or []
        linhas.append({"trilha": tid, "operacoes": n, "acerto": r.acerto, "ganho_medio": r.ganho_medio,
                       "perda_media": r.perda_media, "por_operacao": r.por_operacao, "lucro": lucro,
                       "queda_max": tr["queda_max"], "bate": bate,
                       "aberta": tr["posicao"] is not None, "fase2": fase2,
                       "nota": (sum(notas) / len(notas)) if notas else None, "n_nota": len(notas)})
    return linhas


def imprimir_placar(estado: dict) -> None:
    linhas = placar(estado)
    if not linhas:
        print("  ainda nao ha trilhas: rode o vigia primeiro")
        return
    print(f"  {'trilha':<34} | ops | acerto |  ganho | perda  |  por op |   lucro | pior queda | bate moedas")
    print("  " + "-" * 112)
    for l in linhas:
        print(f"  {l['trilha']:<34} | {l['operacoes']:3d} | {l['acerto']:5.1f}% | {l['ganho_medio']:+6.2f} | "
              f"{-l['perda_media']:+6.2f} | {l['por_operacao']:+7.2f} | {l['lucro']:+7.2f} | "
              f"{l['queda_max']:10.2f} | {l['bate']:5.0f}%{'  (posicao aberta)' if l['aberta'] else ''}")
        print(f"  {'':<34}   fase 2: {l['fase2']}")
    print()
    print("  Valores em USDT de papel, ja com a taxa. 'por op' e o que decide se ha lucro;")
    print("  'bate moedas' e de quantas moedas pareadas a estrategia ganhou nos mesmos candles.")
    custo = texto_custo_arena(estado)
    if custo:
        print()
        print("  " + custo.replace("\n", "\n  "))


def texto_custo_arena(estado: dict) -> str:
    """Chamadas e custo das IAs, medidos pelos tokens de cada resposta (nao estimados de antemao)."""
    a = estado.get("arena") or {}
    if not a.get("custo"):
        return ""
    linhas = ["ARENA: chamadas e custo desde o inicio (tokens medidos x preco de tabela)"]
    total = 0.0
    for prov, c in sorted(a["custo"].items()):
        total += c["usd"]
        sem = f" (+{c['sem_preco']} chamada(s) sem preco conhecido)" if c["sem_preco"] else ""
        linhas.append(f"  {prov}: {c['chamadas']} chamadas, {c['entrada']} tokens de entrada, "
                      f"{c['saida']} de saida, US$ {c['usd']:.2f}{sem}")
    hoje = (a.get("chamadas") or {}).get(time.strftime("%Y-%m-%d"), {})
    linhas.append(f"  total US$ {total:.2f}" + (f"; hoje: {', '.join(f'{k} {v}' for k, v in sorted(hoje.items()))}"
                                                 if hoje else ""))
    return "\n".join(linhas)


# --------------------------------------------------------------------------- #
# mensagens
# --------------------------------------------------------------------------- #

def fmt(v: float) -> str:
    casas = 2 if v >= 1000 else 4
    return f"{v:,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def projecao(p: bt.Params, liq_antes_do_stop: bool = False) -> tuple[float, float]:
    """(lucro no alvo, perda no stop) em USDT, ja com a taxa nas duas pontas. Se a
    liquidacao chega antes do stop, a perda e a margem mais a taxa de entrada."""
    taxa = p.notional * (p.taxa / 100) * 2
    ganho = p.notional * (p.stop * p.rr / 100) - taxa
    perda = (p.margem + p.notional * (p.taxa / 100)) if liq_antes_do_stop else p.notional * (p.stop / 100) + taxa
    return ganho, perda


AVISO_NIVEL = {
    "em teste": "EM TESTE: estrategia ainda NAO aprovada para dinheiro real",
    "reprovada": "REPROVADA na fase 2: NAO use dinheiro real nesta estrategia",
    "promissora": "PROMISSORA: dinheiro real so com risco reduzido",
}


def texto_da_ia(motivo: str, maximo: int = 300) -> str:
    """O motivo escrito pela IA vai ao Telegram como texto de terceiro: so caracteres
    imprimiveis, numa linha, com tamanho maximo."""
    limpo = " ".join("".join(ch if ch.isprintable() else " " for ch in str(motivo)).split())
    return limpo[:maximo] + ("..." if len(limpo) > maximo else "")


def texto_entrada(nome: str, ativo: str, tf: str, pos: dict, p: bt.Params, motivo: str = "",
                  nivel: str = "em teste", disjuntor_armado: bool = False) -> str:
    lado = "COMPRA" if pos["direcao"] > 0 else "VENDA"
    ganho, perda = projecao(p, pos.get("liq_antes_do_stop", False))
    linhas = [f"{lado} · {nome} · {ativo} {tf} (papel)"]
    if disjuntor_armado:
        linhas.append("DISJUNTOR ARMADO (do dia ou da semana): na conta real, NAO ABRA (veja /hoje)")
    if nivel in AVISO_NIVEL:
        linhas.append(AVISO_NIVEL[nivel])
    linhas += [f"entrada {fmt(pos['entrada'])}",
               f"alvo {fmt(pos['px_alvo'])}  ->  lucro {ganho:+.2f} USDT"
               + ("  (saida surfe: metade sai aqui, o stop do resto vai para a entrada e segue o preco)"
                  if p.saida == "surfe" else ""),
               f"stop {fmt(pos['px_stop'])}  ->  perda {-perda:.2f} USDT",
               f"relacao lucro/perda {ganho / perda:.2f}  (com taxa nas duas pontas)",
               f"liquidacao a {p.alav:g}x: {fmt(pos['px_liq'])}"]
    if motivo:
        linhas.append(f"motivo da IA (texto dela, nao verificado): {texto_da_ia(motivo)}")
    linhas.append("Sinal e ponto de atencao, nao ordem. Confira as regras antes de operar.")
    return "\n".join(linhas)


def texto_saida(reg: dict, tr: dict) -> str:
    r = bt.Resultado(resultados=list(tr["resultados"]))
    return (f"FECHOU · {reg['estrategia']} · {reg['ativo']} {reg['periodo']} (papel)\n"
            f"{reg['lado']} saiu por {reg['desfecho'].upper()}: {reg['pnl']:+.2f} USDT\n"
            f"placar: {len(r.resultados)} ops · acerto {r.acerto:.0f}% · por op {r.por_operacao:+.2f}")


def texto_resumo(estado: dict) -> str:
    partes = ["Resumo do dia (papel)"]
    for l in placar(estado):
        partes.append(f"{l['trilha'].replace('|', ' ')}: {l['operacoes']} ops, acerto {l['acerto']:.0f}%, "
                      f"por op {l['por_operacao']:+.2f}, lucro {l['lucro']:+.2f}, bate {l['bate']:.0f}% das moedas"
                      + (f", nota de acerto {l['nota']:.2f} em {l['n_nota']} (0 perfeito; 0,25 chute)"
                         if l.get("nota") is not None else ""))
    custo = texto_custo_arena(estado)
    if custo:
        partes.append(custo)
    partes.append("Se este resumo nao chegar amanha, o vigia parou.")
    return "\n".join(partes)


def telegram(segredos: dict, texto: str) -> bool:
    tok, chat = segredos.get("telegram_token"), segredos.get("telegram_chat_id")
    if not tok or not chat:
        return False
    try:
        dados = urllib.parse.urlencode({"chat_id": chat, "text": texto}).encode()
        urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/sendMessage", data=dados, timeout=15)
        return True
    except Exception as e:
        log(f"telegram falhou: {type(e).__name__}")
        return False


def risco_aberto(estado: dict, cfg: dict) -> tuple[int, float]:
    """Quantas posicoes de papel estao abertas (estrategias e IAs, sem as moedas) e
    quanto se perderia se TODAS batessem no stop juntas — o que acontece quando o
    mercado inteiro anda contra. Liquidacao antes do stop conta a margem inteira."""
    p = params_de(cfg)
    pos = bt.abrir(100.0, 1, p)
    por_posicao = (p.margem + p.notional * (p.taxa / 100) if pos.liq_antes_do_stop
                   else p.notional * (p.stop / 100) + p.notional * (p.taxa / 100) * 2)
    n = sum(1 for tr in estado.get("trilhas", {}).values() if tr.get("posicao"))
    return n, n * por_posicao


def texto_risco_aberto(estado: dict, cfg: dict) -> str:
    n, valor = risco_aberto(estado, cfg)
    banca, teto = cfg["params"]["banca"], cfg.get("risco_total_max_pct", 6)
    pct = valor / banca * 100 if banca else 0.0
    texto = (f"risco aberto: {n} posicao(oes) de papel; se todas batessem no stop juntas, "
             f"{valor:.2f} USDT ({pct:.1f}% da banca de {banca:g}; teto {teto:g}%)")
    if pct > teto:
        texto += ". ACIMA DO TETO: na conta real, nao abriria todas"
    return texto


def texto_status(estado: dict, cfg: dict, agora_ms: int, pasta: str = PASTA) -> str:
    """Se o vigia esta vivo: ultimo candle processado, posicoes abertas, conferencia, arena."""
    partes = [f"Vigia (papel) · fonte {cfg.get('fonte', 'binance')}"
              + (f", conferida com {cfg['conferir_com']}" if cfg.get("conferir_com") else "")]
    for ativo in cfg["ativos"]:
        for tf in cfg["periodos"]:
            rot = rotulo(ativo, cfg.get("fonte", "binance"))
            trs = {tid: tr for tid, tr in estado.get("trilhas", {}).items() if tid.endswith(f"|{rot}|{tf}")}
            if not trs:
                partes.append(f"{ativo} {tf}: ainda sem trilha (aquecendo)")
                continue
            ultimo = max((tr["ultimo_t"] or 0) for tr in trs.values())
            atraso = (agora_ms - (ultimo + MS[tf])) / 60_000 if ultimo else None
            abertas = [tid.split("|")[0] for tid, tr in trs.items() if tr["posicao"]]
            partes.append(f"{ativo} {tf}: ultimo candle fechado processado ha "
                          f"{f'{atraso:.0f} min' if atraso is not None else '?'}; posicao aberta: "
                          f"{', '.join(abertas) if abertas else 'nenhuma'}")
            conf = (estado.get("conferencia") or {}).get(f"{ativo}|{tf}")
            if conf:
                partes.append(f"  conferencia com {conf['com']}: diferenca de {conf['pct']:.3f}% "
                              f"nos ultimos {conf['comparados']} candles")
    partes.append(texto_risco_aberto(estado, cfg))
    partes.append(texto_diario(pasta))
    hoje = ((estado.get("arena") or {}).get("chamadas") or {}).get(time.strftime("%Y-%m-%d"))
    if hoje:
        partes.append("arena hoje: " + ", ".join(f"{k} {v} chamadas" for k, v in sorted(hoje.items())))
    return "\n".join(partes)


AJUDA_TELEGRAM = ("Comandos do vigia (papel, nenhuma ordem real):\n"
                  "/analisar MOEDA [risco%] [scalp|intraday|swing] - a ficha completa da operacao "
                  "(ex.: /analisar BTC 2 swing; sem risco, usa 2%)\n"
                  "/radar - as moedas que mais oscilam agora na Pionex (com volume)\n"
                  "/fichas - o placar das fichas: o veredito acerta?\n"
                  "/resultado -2,1 - anota o resultado (USDT) de uma operacao REAL fechada; arma os disjuntores "
                  "e reduz o risco quando a banca cai do pico\n"
                  "/hoje - o dia e a semana anotados, os disjuntores e o risco em uso\n"
                  "/desempenho - acerto, ganho e perda media, fator de lucro e pior queda das operacoes REAIS\n"
                  "/placar - o placar de cada estrategia e IA\n"
                  "/status - se o vigia esta vivo, ultimo candle, posicoes abertas\n"
                  "/ajuda - esta lista")


def fazer_ficha(argumentos: list[str], cfg: dict, estado: dict, agora_ms: int, pasta: str = PASTA,
                coletar=ficha.coletar) -> str:
    """/analisar: busca, analisa, registra para o placar das fichas e devolve o texto.
    Com o disjuntor do dia ou da semana armado, a leitura sai inteira mas o veredito e
    NAO OPERAR; com a banca abaixo do pico, o risco pedido cai (risco.ajuste)."""
    try:
        pedido = ficha.interpretar_pedido(argumentos, cfg.get("ficha"))
    except ValueError as e:
        return f"Nao deu para analisar: {e}"
    p = cfg["params"]
    resultados = ler_resultados(pasta)
    g = gestao(resultados, agora_ms, cfg)
    # o risco e sobre a banca de hoje: a configurada mais tudo o que foi anotado
    banca = g["ajuste"]["atual"]
    if banca <= 0:
        return f"A banca anotada chegou a {fmt_br(banca)} USDT: confira 'banca' no vigia.json e os /resultado."
    dados = coletar(pedido["par"], agora_ms)
    f = ficha.analisar(dados, pedido["horizonte"], pedido["risco_pct"], banca=banca, cfg=cfg.get("ficha"),
                       taxa=p["taxa"], mm_padrao=p["mm"], estado=estado,
                       divergencia_max=cfg.get("divergencia_max_pct", 0.3),
                       bloqueios_externos=g["bloqueios"] or None,
                       risco_fator=g["ajuste"]["multiplicador"], risco_motivo=g["ajuste"]["motivo"])
    if resultados:
        aj = g["ajuste"]
        f["contexto"].insert(0, f"banca de hoje: {_br2(banca)} USDT ({_br2(p['banca'])} configurada, "
                                f"{fmt_br(banca - p['banca'])} nos resultados anotados)"
                                + (f" · pico {_br2(aj['pico'])}, {ficha.pct(aj['queda_pct'], 1)} abaixo"
                                   if aj["queda_pct"] > 0 else "")
                                + f" · semana {fmt_br(g['semana']['soma'])} USDT")
    return ficha.texto(f, ficha.registrar(pasta, f))


def gestao(resultados: list[dict], agora_ms: int, cfg: dict) -> dict:
    """Tudo o que os /resultado decidem, num lugar so (a ficha, o /resultado e o /hoje
    chamam esta): o disjuntor do dia, o da semana e o risco pela queda desde o pico."""
    banca = cfg["params"]["banca"]
    dia = disjuntor(resultados, agora_ms, banca, cfg.get("disjuntor"))
    semana = risco.disjuntor_semana(resultados, agora_ms, banca, cfg.get("risco"))
    aj = risco.ajuste(banca, resultados, cfg.get("risco"))
    return {"dia": dia, "semana": semana, "ajuste": aj,
            "bloqueios": [m["motivo"] for m in (dia, semana) if m["armado"]]}


def _br2(v: float) -> str:
    return ficha.fmt_usdt(v).lstrip("+")


# --------------------------------------------------------------------------- #
# disjuntor do dia (conta real, anotada a mao)
# --------------------------------------------------------------------------- #

def dia_brasilia(ms: int) -> int:
    """O dia de quem opera: Brasilia, UTC-3 o ano todo."""
    return (ms - 3 * 3_600_000) // 86_400_000


def ler_resultados(pasta: str = PASTA) -> list[dict]:
    caminho = os.path.join(pasta, "resultados.jsonl")
    if not os.path.exists(caminho):
        return []
    saida = []
    with open(caminho, encoding="utf-8") as f:
        for linha in f:
            try:
                r = json.loads(linha)
                saida.append({"quando_ms": int(r["quando_ms"]), "valor": float(r["valor"])})
            except (ValueError, KeyError, TypeError):
                continue
    return saida


def disjuntor(resultados: list[dict], agora_ms: int, banca: float, cfg: dict | None = None) -> dict:
    """O dia de hoje (Brasilia): quantas operacoes, a soma, as perdas seguidas no fim
    e se o disjuntor armou (perdas seguidas no limite, ou o dia abaixo do limite)."""
    cfg = {"ligado": True, "perdas_seguidas": 3, "perda_dia_pct": 6.0, **(cfg or {})}
    hoje = [r["valor"] for r in sorted(resultados, key=lambda r: r["quando_ms"])
            if dia_brasilia(r["quando_ms"]) == dia_brasilia(agora_ms)]
    soma = sum(hoje)
    seguidas = 0
    for v in reversed(hoje):
        if v >= 0:
            break
        seguidas += 1
    limite = -banca * cfg["perda_dia_pct"] / 100
    motivo = ""
    if cfg["ligado"] and seguidas >= cfg["perdas_seguidas"]:
        motivo = f"disjuntor do dia: {seguidas} perdas seguidas hoje ({fmt_br(soma)} USDT). Pare ate amanha"
    elif cfg["ligado"] and soma <= limite:
        motivo = (f"disjuntor do dia: hoje em {fmt_br(soma)} USDT, alem do limite de {cfg['perda_dia_pct']:g}% "
                  f"da banca ({fmt_br(limite)}). Pare ate amanha")
    return {"armado": bool(motivo), "motivo": motivo, "n": len(hoje), "soma": soma, "seguidas": seguidas}


def fmt_br(v: float) -> str:
    return ficha.fmt_usdt(v)


def anotar_resultado(argumentos: list[str], cfg: dict, agora_ms: int, pasta: str = PASTA) -> str:
    """/resultado -2,1: anota o resultado (USDT) de uma operacao REAL ja fechada."""
    banca = cfg["params"]["banca"]
    try:
        valor = float((argumentos or [""])[0].replace(",", "."))
    except ValueError:
        return "Use: /resultado -2,1  (o resultado em USDT, ja com as taxas; negativo = perda)"
    if not abs(valor) <= banca:
        return f"{valor:g} USDT passa da banca inteira ({banca:g}): confira o valor e mande de novo."
    antes = gestao(ler_resultados(pasta), agora_ms, cfg)
    os.makedirs(pasta, exist_ok=True)
    anexar_json(os.path.join(pasta, "resultados.jsonl"), {"quando_ms": agora_ms, "valor": valor})
    g = gestao(ler_resultados(pasta), agora_ms, cfg)
    dj, ds, aj = g["dia"], g["semana"], g["ajuste"]
    texto = (f"Anotado: {fmt_br(valor)} USDT. Hoje: {dj['n']} operacao(oes), {fmt_br(dj['soma'])} USDT, "
             f"{dj['seguidas']} perda(s) seguida(s). Semana: {fmt_br(ds['soma'])} USDT. "
             f"Banca: {_br2(aj['atual'])} USDT.")
    if dj["armado"] and not antes["dia"]["armado"]:
        texto += f"\nDISJUNTOR ARMADO. {dj['motivo']}. Toda ficha ate meia-noite sai NAO OPERAR."
    elif dj["armado"]:
        texto += "\nO disjuntor continua armado: pare por hoje."
    if ds["armado"] and not antes["semana"]["armado"]:
        texto += f"\nDISJUNTOR DA SEMANA ARMADO. {ds['motivo']}. Toda ficha ate segunda sai NAO OPERAR."
    m0, m1 = antes["ajuste"]["multiplicador"], aj["multiplicador"]
    if m1 < m0:
        texto += f"\nRISCO REDUZIDO: {aj['motivo']}. A proxima ficha ja calcula assim."
    elif m1 > m0:
        texto += ("\nRISCO DE VOLTA AO NORMAL: a banca voltou a menos de "
                  if m1 == 1 else "\nRISCO SUBIU PARA METADE: a banca voltou a menos de ")
        cr = {**risco.RISCO_PADRAO, **(cfg.get("risco") or {})}
        texto += (f"{(cr['queda_metade_pct'] if m1 == 1 else cr['queda_quarto_pct']):g}% do pico "
                  f"({_br2(aj['pico'])} USDT).")
    return texto


def texto_hoje(cfg: dict, agora_ms: int, pasta: str = PASTA) -> str:
    g = gestao(ler_resultados(pasta), agora_ms, cfg)
    dj, ds, aj = g["dia"], g["semana"], g["ajuste"]
    L = [f"Hoje (Brasilia): {dj['n']} operacao(oes) anotada(s), {fmt_br(dj['soma'])} USDT, "
         f"{dj['seguidas']} perda(s) seguida(s).",
         f"DISJUNTOR ARMADO: {dj['motivo']}." if dj["armado"] else "Disjuntor do dia desarmado.",
         f"Semana (segunda a domingo): {fmt_br(ds['soma'])} USDT; o limite e {fmt_br(ds['limite'])}.",
         f"DISJUNTOR DA SEMANA ARMADO: {ds['motivo']}." if ds["armado"] else "Disjuntor da semana desarmado.",
         f"Banca {_br2(aj['atual'])} USDT, pico {_br2(aj['pico'])}"
         + (f", {ficha.pct(aj['queda_pct'], 1)} abaixo." if aj["queda_pct"] > 0 else ".")]
    L.append(f"RISCO REDUZIDO: {aj['motivo']}." if aj["multiplicador"] < 1 else "Risco normal: a ficha usa o pedido.")
    return "\n".join(L)


def texto_desempenho(cfg: dict, pasta: str = PASTA) -> str:
    resultados = ler_resultados(pasta)
    banca = cfg["params"]["banca"]
    return risco.texto_desempenho(risco.desempenho(banca, resultados),
                                  risco.ajuste(banca, resultados, cfg.get("risco")))


def texto_fichas(pasta: str, agora_ms: int, buscar=None) -> str:
    feitas = ficha.conferir_fichas(pasta, agora_ms, buscar)
    return ficha.texto_placar_fichas(ficha.placar_fichas(pasta, feitas))


def texto_radar(cfg: dict, giro=fatores.giro_24h) -> str:
    r = cfg.get("radar") or CONFIG_PADRAO["radar"]
    return ficha.texto_radar(ficha.radar(giro(), r["volume_min_usdt"], r["quantos"]), r["volume_min_usdt"])


SERVICOS = {
    "analisar": lambda args, cfg, estado, agora: fazer_ficha(args, cfg, estado, agora),
    "resultado": lambda args, cfg, agora: anotar_resultado(args, cfg, agora),
    "hoje": lambda cfg, agora: texto_hoje(cfg, agora),
    "desempenho": lambda cfg: texto_desempenho(cfg),
    "fichas": lambda agora: texto_fichas(PASTA, agora),
    "radar": lambda cfg: texto_radar(cfg),
}


def responder_comando(texto: str, estado: dict, cfg: dict, agora_ms: int, servicos: dict | None = None) -> str | None:
    """A resposta a um comando do Telegram. Os que buscam dado na rede nunca derrubam
    quem escuta: falha vira mensagem."""
    partes = (texto or "").strip().split()
    if not partes:
        return None
    palavra, argumentos = partes[0].split("@")[0].lower(), partes[1:]
    servicos = servicos or SERVICOS
    if palavra == "/placar":
        return texto_resumo(estado).replace("Resumo do dia (papel)", "Placar agora (papel)")
    if palavra == "/status":
        return texto_status(estado, cfg, agora_ms)
    if palavra in ("/ajuda", "/start", "/help"):
        return AJUDA_TELEGRAM
    try:
        if palavra == "/analisar":
            return servicos["analisar"](argumentos, cfg, estado, agora_ms)
        if palavra == "/fichas":
            return servicos["fichas"](agora_ms)
        if palavra == "/radar":
            return servicos["radar"](cfg)
        if palavra == "/resultado":
            return servicos["resultado"](argumentos, cfg, agora_ms)
        if palavra == "/hoje":
            return servicos["hoje"](cfg, agora_ms)
        if palavra == "/desempenho":
            return servicos["desempenho"](cfg)
    except Exception as e:
        return f"Nao consegui responder {palavra}: {type(e).__name__}: {str(e)[:150]}"
    return None


def _telegram_atualizacoes(tok: str, offset, espera: int) -> list:
    q = {"timeout": espera}
    if offset is not None:
        q["offset"] = offset
    url = f"https://api.telegram.org/bot{tok}/getUpdates?" + urllib.parse.urlencode(q)
    with urllib.request.urlopen(url, timeout=espera + 15) as r:
        return json.loads(r.read().decode()).get("result", [])


def escutar_telegram(segredos: dict, cfg: dict, arq_estado: str, parar: threading.Event,
                     pedir=_telegram_atualizacoes, enviar=None, espera: int = 50) -> None:
    """Responde comandos SO do chat configurado. Le o estado do disco (o laco principal
    grava de forma atomica), entao nunca disputa memoria com o vigia."""
    tok, chat = segredos.get("telegram_token"), str(segredos.get("telegram_chat_id") or "")
    if not tok or not chat:
        return
    enviar = enviar or (lambda t: telegram(segredos, t))
    offset = None
    try:  # o que chegou com o vigia desligado fica sem resposta (seria velho)
        antigas = pedir(tok, -1, 0)
        if antigas:
            offset = antigas[-1]["update_id"] + 1
    except Exception:
        pass
    while not parar.is_set():
        try:
            novas = pedir(tok, offset, espera)
        except Exception:
            parar.wait(15)
            continue
        for u in novas:
            offset = u["update_id"] + 1
            msg = u.get("message") or {}
            if str((msg.get("chat") or {}).get("id")) != chat:
                continue  # outra pessoa achou o robo: nao responde nada
            resposta = responder_comando(msg.get("text", ""), ler_json(arq_estado, {"trilhas": {}}), cfg,
                                         int(time.time() * 1000))
            if resposta:
                enviar(resposta)


def telegram_descobrir(segredos: dict, gravar: bool = False, caminho: str = SEGREDOS) -> bool:
    """Acha o chat de quem mandou mensagem ao robo. Com gravar=True e um chat so,
    grava no segredos.json. Devolve True se gravou."""
    tok = segredos.get("telegram_token")
    if not tok:
        sys.exit("Coloque o telegram_token em segredos.json primeiro (veja o README).")
    try:
        with urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/getUpdates", timeout=15) as r:
            dados = json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        motivo = "token errado: confira o que o @BotFather mandou" if e.code in (401, 404) else f"HTTP {e.code}"
        print(f"O Telegram recusou ({motivo}).")
        return False
    except (urllib.error.URLError, OSError, ValueError) as e:
        print(f"Nao consegui falar com o Telegram ({type(e).__name__}): confira a internet e tente de novo.")
        return False
    chats = {}
    for u in dados.get("result", []):
        msg = u.get("message") or u.get("channel_post") or {}
        ch = msg.get("chat") or {}
        if ch.get("id") is not None:
            chats[ch["id"]] = ch.get("first_name") or ch.get("title") or ""
    if not chats:
        print("Nenhuma conversa encontrada. Mande qualquer mensagem para o seu robo no Telegram e rode de novo.")
        return False
    if gravar and len(chats) == 1:
        cid, nome = next(iter(chats.items()))
        guardar_segredo("telegram_chat_id", str(cid), caminho)
        print(f"chat de {nome or cid} gravado no {os.path.basename(caminho)}")
        return True
    for cid, nome in chats.items():
        print(f"chat id: {cid}   ({nome})   -> coloque em telegram_chat_id no segredos.json")
    if gravar:
        print("Mais de uma conversa encontrada: nao gravei nenhuma, para nao avisar a pessoa errada.")
    return False


def guardar_segredo(nome: str, valor: str, caminho: str = SEGREDOS) -> None:
    """Grava um campo do segredos.json (chmod 600) sem apagar os outros."""
    if nome not in SEGREDOS_MODELO:
        sys.exit(f"campo '{nome}' nao existe no segredos.json. Campos: {', '.join(SEGREDOS_MODELO)}")
    seg = carregar_segredos(caminho)
    seg[nome] = valor.strip()
    gravar_json(caminho, seg, indent=2, privado=True)


def definir_banca(valor: str, caminho: str = CONFIG) -> str:
    """vibe.py banca 100: a banca da conta (USDT) no vigia.json. Nao zera o placar."""
    try:
        banca = float(str(valor).replace(",", "."))
    except ValueError:
        return f"'{valor}' nao e um numero. Use: python3 vibe.py banca 100"
    if not 0 < banca < 10_000_000:
        return f"banca de {banca:g} USDT nao faz sentido. Use o saldo da conta de futuros, ex.: 100"
    cfg = carregar_config(caminho)
    antes = cfg["params"]["banca"]
    cfg["params"]["banca"] = banca
    gravar_json(caminho, cfg, indent=2)
    return (f"banca: {antes:g} -> {banca:g} USDT. A ficha calcula o risco sobre ela (mais os /resultado "
            f"anotados). O placar do vigia continua.")


def ligar_arena(ligar: bool, caminho: str = CONFIG) -> None:
    cfg = carregar_config(caminho)
    cfg["arena"]["ligada"] = ligar
    gravar_json(caminho, cfg, indent=2)
    print(f"arena {'ligada' if ligar else 'desligada'} no {os.path.basename(caminho)}"
          + (" (so funciona com pelo menos uma chave de IA no segredos.json)" if ligar else ""))


# --------------------------------------------------------------------------- #
# laco
# --------------------------------------------------------------------------- #

LOG_MAX = 5_000_000  # bytes; passou disso, o log atual vira vigia.log.1 e comeca outro


def log(msg: str) -> None:
    linha = time.strftime("[%d/%m %H:%M:%S] ") + msg
    print(linha, flush=True)
    try:
        os.makedirs(PASTA, exist_ok=True)
        arq = os.path.join(PASTA, "vigia.log")
        if os.path.exists(arq) and os.path.getsize(arq) > LOG_MAX:
            os.replace(arq, arq + ".1")
        with open(arq, "a", encoding="utf-8") as f:
            f.write(linha + "\n")
    except OSError:
        pass


def avisar_mercado(estado: dict, cfg: dict, ativo: str, tf: str, agora_ms: int, fonte: str, avisar=None,
                   pasta: str = PASTA, registrar=None) -> list[str]:
    """Alertas de mercado do ultimo candle fechado (alertas.py), com a memoria no estado."""
    registrar = registrar or log
    serie = serie_do_cache(ler_json(arquivo_cache(pasta, ativo, tf, fonte), cache_vazio()))
    memoria = estado.setdefault("alertas", {}).setdefault(ativo, {})
    textos = alertas.avaliar(ativo, tf, serie, agora_ms, memoria, cfg.get("alertas"))
    for t in textos:
        registrar(t)
        if avisar:
            avisar(t)
    return textos


def assinatura_params(cfg: dict, com_banca: bool = False) -> str:
    """O que, se mudar, faz o placar valer para outra hipotese. A banca fica de fora:
    ela nao muda nenhuma operacao de papel (so o % do risco aberto e o disjuntor), e
    atualizar a banca depois de um deposito nao pode zerar a fase 2. com_banca=True e o
    formato antigo, so para reconhecer o estado de quem ja rodava."""
    params = dict(cfg["params"])
    if not com_banca:
        params.pop("banca", None)
    base = {"params": params, "fonte": cfg.get("fonte", "binance"), "moedas": cfg["moedas"]}
    return hashlib.sha256(json.dumps(base, sort_keys=True).encode()).hexdigest()[:12]


def conferir_params(estado: dict, cfg: dict, registrar=None) -> bool:
    """Mudou stop, alvo, alavancagem, margem, taxa, fonte ou moedas no vigia.json: o
    placar recomeca do zero (o antigo fica guardado em 'arquivadas', sem se misturar).
    Devolve True se recomecou."""
    nova = assinatura_params(cfg)
    antiga = estado.get("params_assinatura")
    if antiga is None:
        estado["params_assinatura"] = nova
        return False
    if antiga == nova:
        return False
    if antiga == assinatura_params(cfg, com_banca=True):  # mesmo placar, assinatura do formato antigo
        estado["params_assinatura"] = nova
        return False
    estado.setdefault("arquivadas", {})[antiga] = {"trilhas": estado.get("trilhas", {}),
                                                   "ate": time.strftime("%Y-%m-%d %H:%M")}
    estado["trilhas"] = {}
    estado["params_assinatura"] = nova
    (registrar or log)("os parametros do vigia.json mudaram: o placar recomeca do zero "
                       "(o anterior fica guardado em 'arquivadas', sem se misturar)")
    return True


def montar_juiz(cfg: dict, segredos: dict, registrar=None, conferir=arena.conferir_modelo,
                criar=arena.criar_claude):
    """A arena, se ligada e com pelo menos uma IA disponivel; senao None (e diz por que)."""
    registrar = registrar or log
    a = cfg.get("arena") or {}
    if not a.get("ligada"):
        return None
    claude = None
    pela_openrouter = {}
    for nome, campo in (("Qwen", "qwen_modelo"), ("DeepSeek", "deepseek_modelo")):
        modelo = a.get(campo) or ""
        if not modelo:
            continue  # nome vazio no vigia.json: este competidor fica de fora de proposito
        if not segredos.get("openrouter_key"):
            registrar(f"arena: openrouter_key vazia no segredos.json; {nome} fica de fora")
            continue
        situacao, preco, parecidos = conferir(modelo)
        if situacao == "nao_existe":
            registrar(f"arena: o modelo '{modelo}' nao existe na OpenRouter; {nome} fica de fora. "
                      f"Modelos dessa familia que existem hoje: {', '.join(parecidos) or 'nenhum'}. "
                      f"Troque {campo} no vigia.json.")
            continue
        pela_openrouter[nome] = arena.ModeloOpenRouter(segredos["openrouter_key"], modelo, preco)
        if situacao == "sem_lista":
            registrar("arena: nao consegui ler a lista de modelos da OpenRouter agora; sigo com "
                      f"'{modelo}' (se o nome estiver errado, cada resposta vira NADA e aparece no log)")
    qwen, deepseek = pela_openrouter.get("Qwen"), pela_openrouter.get("DeepSeek")
    if segredos.get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY"):
        claude, motivo = criar(segredos, a["claude_modelo"], a["claude_esforco"])
        if claude is None:
            registrar("arena: o Claude fica de fora: " + motivo)
    else:
        registrar("arena: anthropic_api_key vazia no segredos.json; o Claude fica de fora")
    if not qwen and not deepseek and not claude:
        registrar("arena ligada no vigia.json, mas sem nenhuma IA disponivel: o vigia segue sem arena")
        return None
    juiz = arena.Juiz(qwen, claude, int(a["max_chamadas_dia"]), registrar, deepseek=deepseek)
    registrar(f"arena ligada em {a['ativo']} {a['periodo']}: {', '.join(juiz.competidores())}; "
              f"teto de {a['max_chamadas_dia']} chamadas por IA por dia")
    return juiz


_TRAVA: list = []


def travar(pasta: str = PASTA):
    """Um vigia por pasta: dois juntos gravariam o mesmo estado e estragariam o placar.
    A trava some sozinha quando o processo acaba (inclusive se ele cair)."""
    import fcntl
    os.makedirs(pasta, exist_ok=True)
    arq = open(os.path.join(pasta, "vigia.trava"), "a")
    try:
        fcntl.flock(arq, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        arq.close()
        sys.exit("Ja existe um vigia rodando nesta pasta. Feche o outro (Ctrl+C na outra janela) "
                 "ou, no VPS, use 'sudo vibe-instalar --status'.")
    _TRAVA.append(arq)
    return arq


def rodar(cfg: dict, segredos: dict, uma_vez: bool) -> None:
    travar(PASTA)
    arq_estado = os.path.join(PASTA, "estado.json")
    estado = ler_json(arq_estado, {"versao": 1, "trilhas": {}, "ultimo_resumo": None})
    avisar = (lambda t: telegram(segredos, t)) if segredos.get("telegram_token") else None
    if conferir_params(estado, cfg):
        gravar_json(arq_estado, estado)
        if avisar:
            avisar("Os parametros do vigia mudaram: o placar recomecou do zero (o anterior ficou guardado).")
    fonte, outra_fonte = cfg["fonte"], cfg.get("conferir_com") or ""
    if outra_fonte == fonte:
        outra_fonte = ""
    log(f"vigia ligado: {', '.join(cfg['ativos'])} em {', '.join(cfg['periodos'])}; fonte {fonte}"
        f"{f' (conferida com {outra_fonte})' if outra_fonte else ''}; "
        f"estrategias {', '.join(e['nome'] for e in cfg['estrategias'])}; "
        f"telegram {'ligado' if avisar else 'desligado'}")
    juiz = montar_juiz(cfg, segredos)
    if avisar and segredos.get("telegram_chat_id") and not uma_vez:
        threading.Thread(target=escutar_telegram, args=(segredos, cfg, arq_estado, threading.Event()),
                         daemon=True, name="telegram").start()
        log("telegram: respondendo /analisar, /radar, /fichas, /resultado, /hoje, /desempenho, /placar, "
            "/status e /ajuda "
            "(so ao seu chat)")
    if avisar and not uma_vez:
        avisar("Vigia ligado (papel). Estrategias: " + ", ".join(e["nome"] for e in cfg["estrategias"])
               + (f". Arena: {', '.join(juiz.competidores())}" if juiz else ""))
    falhas = 0
    while True:
        agora = int(time.time() * 1000)
        for ativo in cfg["ativos"]:
            for tf in cfg["periodos"]:
                try:
                    aquecer = not os.path.exists(arquivo_cache(PASTA, ativo, tf, fonte))
                    n = ciclo(estado, cfg, ativo, tf, bt.BUSCADORES[fonte], agora, PASTA, avisar, juiz, fonte)
                    if aquecer:
                        log(f"{ativo} {tf}: historico carregado para aquecer os indicadores (sem operar nele). "
                            f"A partir do proximo candle fechado, o vigia opera no papel.")
                    gravar_json(arq_estado, estado)
                    falhas = 0
                    if n:
                        abertas = [tid.split("|")[0] for tid, tr in estado["trilhas"].items()
                                   if tr["posicao"] and f"|{rotulo(ativo, fonte)}|{tf}" in tid]
                        log(f"{ativo} {tf}: {n} candle(s) processado(s); posicao aberta em: "
                            f"{', '.join(abertas) if abertas else 'nenhuma'}")
                        if tf == cfg["periodos"][0]:
                            avisar_mercado(estado, cfg, ativo, tf, agora, fonte, avisar)
                            gravar_json(arq_estado, estado)
                        if cfg.get("gravar_livro") and tf == cfg["periodos"][0]:
                            ultimo = (ler_json(arquivo_cache(PASTA, ativo, tf, fonte), cache_vazio())["t"] or [None])[-1]
                            livro.gravar(PASTA, ativo, ultimo, agora, registrar=log)
                        if outra_fonte:
                            try:
                                principal = serie_do_cache(ler_json(arquivo_cache(PASTA, ativo, tf, fonte), cache_vazio()))
                                conferir(estado, cfg, ativo, tf, principal,
                                         bt.BUSCADORES[outra_fonte](ativo, tf, 6), agora, avisar)
                                gravar_json(arq_estado, estado)
                            except bt.ErroBusca as e:
                                log(f"{ativo} {tf}: conferencia com {outra_fonte} sem dados "
                                    f"({e.erros[0] if e.erros else 'erro'}); sigo so com {fonte}")
                except bt.ErroBusca as e:
                    falhas += 1
                    log(f"{ativo} {tf}: sem dados ({e.erros[0] if e.erros else 'erro'}); tento de novo")
                except Exception as e:  # nada derruba o vigia: registra, espera e tenta de novo
                    falhas += 1
                    log(f"{ativo} {tf}: erro inesperado ({type(e).__name__}: {str(e)[:200]}); tento de novo")
                    if falhas == 5 and avisar:
                        avisar(f"Vigia com erro repetido em {ativo} {tf}: {type(e).__name__}. Ele segue tentando; "
                               f"veja o log (vibe-instalar --status).")
        hoje = time.strftime("%Y-%m-%d")
        if (avisar and int(time.strftime("%H")) >= cfg.get("resumo_diario_hora", 21)
                and estado.get("ultimo_resumo") != hoje):
            resumo = texto_resumo(estado)
            if ficha.ler_fichas(PASTA):
                try:
                    resumo += "\n\n" + texto_fichas(PASTA, int(time.time() * 1000))
                except Exception as e:
                    resumo += f"\n\nplacar das fichas sem conferencia hoje ({type(e).__name__})"
            if avisar(resumo):
                estado["ultimo_resumo"] = hoje
                gravar_json(arq_estado, estado)
        if uma_vez:
            return
        # dorme ate o proximo fechamento de candle (+8 s de folga), no maximo 60 s
        agora = time.time() * 1000
        proximos = [(agora // MS[tf] + 1) * MS[tf] + 8000 - agora for tf in cfg["periodos"]]
        espera = min(60.0, max(5.0, min(proximos) / 1000)) if falhas < 3 else 60.0
        time.sleep(espera)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--placar", action="store_true", help="mostra o placar e sai")
    ap.add_argument("--uma-vez", action="store_true", help="processa os candles pendentes e sai")
    ap.add_argument("--telegram-descobrir", action="store_true")
    ap.add_argument("--gravar", action="store_true", help="com --telegram-descobrir: grava o chat se houver um so")
    ap.add_argument("--telegram-teste", action="store_true")
    ap.add_argument("--guardar-segredo", metavar="CAMPO",
                    help="le o valor da entrada padrao e grava no segredos.json (o valor nao aparece na tela)")
    ap.add_argument("--arena", choices=("ligar", "desligar"), help="liga ou desliga a arena no vigia.json")
    args = ap.parse_args()

    if args.guardar_segredo:
        guardar_segredo(args.guardar_segredo, sys.stdin.read())
        print(f"{args.guardar_segredo} gravado no segredos.json")
        return
    if args.arena:
        ligar_arena(args.arena == "ligar")
        return

    segredos = carregar_segredos()

    if args.telegram_descobrir:
        ok = telegram_descobrir(segredos, gravar=args.gravar)
        if args.gravar and not ok:
            sys.exit(1)
        return
    if args.telegram_teste:
        ok = telegram(segredos, "Teste do vigia: se esta mensagem chegou, os alertas funcionam.")
        print("mensagem enviada" if ok else "nao enviou: confira telegram_token e telegram_chat_id em segredos.json")
        return

    cfg = carregar_config()
    if args.placar:
        imprimir_placar(ler_json(os.path.join(PASTA, "estado.json"), {"trilhas": {}}))
        return
    try:
        rodar(cfg, segredos, args.uma_vez)
    except KeyboardInterrupt:
        log("vigia desligado (Ctrl+C). Ao religar, ele recupera os candles que fecharem ate la.")


if __name__ == "__main__":
    main()
