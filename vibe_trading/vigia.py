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
import time
import urllib.parse
import urllib.request
from dataclasses import asdict

import arena
import backtest as bt
import estrategias

AQUI = os.path.dirname(os.path.abspath(__file__))
PASTA = os.path.join(AQUI, "dados_vigia")
CONFIG = os.path.join(AQUI, "vigia.json")
SEGREDOS = os.path.join(AQUI, "segredos.json")

MS = {tf: minutos * 60_000 for tf, minutos in bt.PERIODOS.items()}
MAX_CACHE = 6000  # candles guardados por ativo/periodo (alinhamento no 15 min pede ~4200)

CONFIG_PADRAO = {
    "ativos": ["BTCUSDT"],
    "periodos": ["15m"],
    "estrategias": [
        {"nome": "confl3", "lado": "ambos", "alinhar": False},
        {"nome": "engolfo", "lado": "ambos", "alinhar": False},
    ],
    "params": {"banca": 110, "margem": 15, "alav": 24, "taxa": 0.05, "mm": 0.5,
               "stop": 0.5, "rr": 2, "max_barras": 48},
    "moedas": 20,
    "historico_inicial_dias": 30,
    "resumo_diario_hora": 21,
    # A arena so liga com "ligada": true E pelo menos uma chave de IA no segredos.json.
    # O teto vale por IA por dia; a decisao de um candle e guardada e nunca repetida.
    "arena": {"ligada": False, "ativo": "BTCUSDT", "periodo": "15m",
              "qwen_modelo": "qwen/qwen3-max", "claude_modelo": "claude-opus-5-5",
              "claude_esforco": "low", "max_chamadas_dia": 30},
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


def carregar_config(caminho: str = CONFIG) -> dict:
    if not os.path.exists(caminho):
        gravar_json(caminho, CONFIG_PADRAO, indent=2)
        print(f"  criei {os.path.basename(caminho)} com a configuracao padrao (confl3 e engolfo, BTCUSDT 15m)")
    cfg = ler_json(caminho, CONFIG_PADRAO)
    # vigia.json de uma versao anterior: acrescenta so o que falta, sem mexer no que existe
    novos = [k for k in CONFIG_PADRAO if k not in cfg]
    for k in novos:
        cfg[k] = json.loads(json.dumps(CONFIG_PADRAO[k]))
    novos += [f"arena.{k}" for k in CONFIG_PADRAO["arena"] if k not in cfg["arena"]]
    for k in CONFIG_PADRAO["arena"]:
        cfg["arena"].setdefault(k, CONFIG_PADRAO["arena"][k])
    if novos:
        gravar_json(caminho, cfg, indent=2)
        print(f"  acrescentei ao {os.path.basename(caminho)}: {', '.join(novos)} (valores padrao)")
    a = cfg["arena"]
    if a["ligada"]:
        if a["ativo"] not in cfg["ativos"] or a["periodo"] not in cfg["periodos"]:
            sys.exit(f"vigia.json: a arena esta em {a['ativo']} {a['periodo']}, mas o vigia so acompanha "
                     f"{', '.join(cfg['ativos'])} em {', '.join(cfg['periodos'])}. Ajuste 'arena' ou 'ativos'/'periodos'.")
        if a["claude_esforco"] not in ESFORCOS:
            sys.exit(f"vigia.json: claude_esforco '{a['claude_esforco']}' nao existe. Use: {', '.join(ESFORCOS)}")
    for e in cfg["estrategias"]:
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

def id_trilha(e: dict, ativo: str, tf: str) -> str:
    return f"{e['nome']}|{e.get('lado', 'ambos')}|{'alinhado' if e.get('alinhar') else 'livre'}|{ativo}|{tf}"


def trilha_nova(n_moedas: int) -> dict:
    return {"posicao": None, "ultimo_t": None, "resultados": [], "pico": 0.0, "queda_max": 0.0,
            "moedas": [{"posicao": None, "n": 0, "soma": 0.0} for _ in range(n_moedas)]}


def lado_da_moeda(semente: int, t: int) -> int:
    """Sorteio deterministico: a mesma moeda no mesmo candle tira sempre o mesmo lado,
    entao desligar e religar o vigia nao muda o resultado das moedas."""
    h = hashlib.sha256(f"{semente}:{t}".encode()).digest()
    return 1 if h[0] % 2 == 0 else -1


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

def processar_barra(tr: dict, tid: str, nome: str, ativo: str, tf: str, sinal: int, i: int, c: dict,
                    p: bt.Params, recuperado: bool, pasta: str, avisar, motivo: str = "") -> None:
    """Um candle numa trilha (estrategia ou IA): a posicao, o diario, o aviso e as
    moedas pareadas. Estrategia e IA passam pela MESMA funcao."""
    tr["posicao"], fechou, abriu = passo(tr["posicao"], sinal, i, c, p)
    if fechou is not None:
        pnl, desfecho, pos = fechou
        tr["resultados"].append(pnl)
        saldo = sum(tr["resultados"])
        tr["pico"] = max(tr["pico"], saldo)
        tr["queda_max"] = max(tr["queda_max"], tr["pico"] - saldo)
        registro = {"trilha": tid, "estrategia": nome, "ativo": ativo, "periodo": tf,
                    "lado": "compra" if pos.direcao > 0 else "venda", "entrada": pos.entrada,
                    "saida_t": c["t"][i], "desfecho": desfecho, "pnl": round(pnl, 6),
                    "candles": pos.barras, "recuperado": recuperado}
        if "motivo_entrada" in tr:
            registro["motivo_entrada"] = tr.pop("motivo_entrada")
        anexar_json(os.path.join(pasta, "diario.jsonl"), registro)
        if avisar and not recuperado:
            avisar(texto_saida(registro, tr))
    if abriu:
        if motivo:
            tr["motivo_entrada"] = motivo
        if avisar and not recuperado:
            avisar(texto_entrada(nome, ativo, tf, tr["posicao"], p, motivo))
    for k, m in enumerate(tr["moedas"]):
        lado = lado_da_moeda(k, c["t"][i]) if sinal != 0 else 0
        m["posicao"], fm, _ = passo(m["posicao"], lado, i, c, p)
        if fm is not None:
            m["n"] += 1
            m["soma"] += fm[0]
    tr["ultimo_t"] = c["t"][i]


def ciclo(estado: dict, cfg: dict, ativo: str, tf: str, buscador, agora_ms: int,
          pasta: str = PASTA, avisar=None, juiz=None) -> int:
    """
    Busca os candles novos de um ativo/periodo e processa cada um, na ordem, em
    todas as trilhas. Devolve quantos candles foram processados (o maior numero
    entre as trilhas, nao a soma).
    `buscador(par, tf, n)` e `agora_ms` sao injetaveis para o teste de replay;
    `juiz` (arena.Juiz) liga as trilhas das IAs, se a arena for neste ativo/periodo.
    """
    p = params_de(cfg)
    ms = MS[tf]
    arq_cache = os.path.join(pasta, f"candles_{ativo}_{tf}.json")
    c = ler_json(arq_cache, None)
    alinhar = any(e.get("alinhar") for e in cfg["estrategias"])
    trilhas_aqui = [(e, id_trilha(e, ativo, tf)) for e in cfg["estrategias"]]
    a = cfg.get("arena") or {}
    ias = ([(n, id_trilha({"nome": n}, ativo, tf)) for n in juiz.competidores()]
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
            processar_barra(tr, tid, e["nome"], ativo, tf, sinais[i], i, c, p, recuperado, pasta, avisar)
        processados = max(processados, len(pendentes))

    if ias:
        processados = max(processados, ciclo_arena(estado, juiz, dict(ias), ativo, tf, c, serie, p,
                                                   agora_ms, pasta, avisar))
    return processados


def ciclo_arena(estado: dict, juiz, tids: dict, ativo: str, tf: str, c: dict, serie: bt.Serie,
                p: bt.Params, agora_ms: int, pasta: str, avisar) -> int:
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
            if nova and decisoes:
                anexar_json(os.path.join(pasta, "arena.jsonl"), {
                    "t": t, "ativo": ativo, "periodo": tf, "fechamento": c["fechamento"][i],
                    "decisoes": {k: {"lado": v[0], "motivo": v[1]} for k, v in decisoes.items()}})
        for n in aqui:
            lado, motivo = decisoes.get(n, (0, ""))
            processar_barra(estado["trilhas"][tids[n]], tids[n], n, ativo, tf, lado, i, c, p,
                            recuperado, pasta, avisar, motivo)
    return len(pend)


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
        bate = (sum(1 for x in moedas if lucro > x) / len(moedas) * 100) if moedas and n else 0.0
        if n < 30:
            fase2 = f"faltam {30 - n} operacoes para julgar"
        elif r.por_operacao > 0 and bate >= 75:
            fase2 = "PASSA: positiva depois da taxa e bate 75%+ das moedas"
        elif r.por_operacao > 0:
            fase2 = "positiva, mas nao bate a moeda com folga: inconclusivo"
        else:
            fase2 = "NAO PASSA: perde dinheiro depois da taxa"
        linhas.append({"trilha": tid, "operacoes": n, "acerto": r.acerto, "ganho_medio": r.ganho_medio,
                       "perda_media": r.perda_media, "por_operacao": r.por_operacao, "lucro": lucro,
                       "queda_max": tr["queda_max"], "bate": bate,
                       "aberta": tr["posicao"] is not None, "fase2": fase2})
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


def texto_entrada(nome: str, ativo: str, tf: str, pos: dict, p: bt.Params, motivo: str = "") -> str:
    lado = "COMPRA" if pos["direcao"] > 0 else "VENDA"
    return (f"{lado} · {nome} · {ativo} {tf} (papel)\n"
            f"entrada {fmt(pos['entrada'])}\nstop {fmt(pos['px_stop'])}\nalvo {fmt(pos['px_alvo'])}\n"
            f"liquidacao a {p.alav:g}x: {fmt(pos['px_liq'])}\n"
            + (f"motivo da IA: {motivo}\n" if motivo else "")
            + "Sinal e ponto de atencao, nao ordem. Confira as regras antes de operar.")


def texto_saida(reg: dict, tr: dict) -> str:
    r = bt.Resultado(resultados=list(tr["resultados"]))
    return (f"FECHOU · {reg['estrategia']} · {reg['ativo']} {reg['periodo']} (papel)\n"
            f"{reg['lado']} saiu por {reg['desfecho'].upper()}: {reg['pnl']:+.2f} USDT\n"
            f"placar: {len(r.resultados)} ops · acerto {r.acerto:.0f}% · por op {r.por_operacao:+.2f}")


def texto_resumo(estado: dict) -> str:
    partes = ["Resumo do dia (papel)"]
    for l in placar(estado):
        partes.append(f"{l['trilha'].replace('|', ' ')}: {l['operacoes']} ops, acerto {l['acerto']:.0f}%, "
                      f"por op {l['por_operacao']:+.2f}, lucro {l['lucro']:+.2f}, bate {l['bate']:.0f}% das moedas")
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


def telegram_descobrir(segredos: dict) -> None:
    tok = segredos.get("telegram_token")
    if not tok:
        sys.exit("Coloque o telegram_token em segredos.json primeiro (veja o README).")
    with urllib.request.urlopen(f"https://api.telegram.org/bot{tok}/getUpdates", timeout=15) as r:
        dados = json.loads(r.read().decode())
    chats = {}
    for u in dados.get("result", []):
        msg = u.get("message") or u.get("channel_post") or {}
        ch = msg.get("chat") or {}
        if ch.get("id") is not None:
            chats[ch["id"]] = ch.get("first_name") or ch.get("title") or ""
    if not chats:
        print("Nenhuma conversa encontrada. Mande qualquer mensagem para o seu robo no Telegram e rode de novo.")
    for cid, nome in chats.items():
        print(f"chat id: {cid}   ({nome})   -> coloque em telegram_chat_id no segredos.json")


# --------------------------------------------------------------------------- #
# laco
# --------------------------------------------------------------------------- #

def log(msg: str) -> None:
    linha = time.strftime("[%d/%m %H:%M:%S] ") + msg
    print(linha, flush=True)
    try:
        os.makedirs(PASTA, exist_ok=True)
        with open(os.path.join(PASTA, "vigia.log"), "a", encoding="utf-8") as f:
            f.write(linha + "\n")
    except OSError:
        pass


def montar_juiz(cfg: dict, segredos: dict, registrar=None, conferir=arena.conferir_qwen,
                criar=arena.criar_claude):
    """A arena, se ligada e com pelo menos uma IA disponivel; senao None (e diz por que)."""
    registrar = registrar or log
    a = cfg.get("arena") or {}
    if not a.get("ligada"):
        return None
    qwen = claude = None
    if segredos.get("openrouter_key"):
        situacao, preco, qwens = conferir(a["qwen_modelo"])
        if situacao == "nao_existe":
            registrar(f"arena: o modelo '{a['qwen_modelo']}' nao existe na OpenRouter; a Qwen fica de fora. "
                      f"Modelos Qwen que existem hoje: {', '.join(qwens) or 'nenhum'}. "
                      f"Troque qwen_modelo no vigia.json.")
        else:
            qwen = arena.Qwen(segredos["openrouter_key"], a["qwen_modelo"], preco)
            if situacao == "sem_lista":
                registrar("arena: nao consegui ler a lista de modelos da OpenRouter agora; sigo com "
                          f"'{a['qwen_modelo']}' (se o nome estiver errado, cada resposta vira NADA e aparece no log)")
    else:
        registrar("arena: openrouter_key vazia no segredos.json; a Qwen fica de fora")
    if segredos.get("anthropic_api_key") or os.environ.get("ANTHROPIC_API_KEY"):
        claude, motivo = criar(segredos, a["claude_modelo"], a["claude_esforco"])
        if claude is None:
            registrar("arena: o Claude fica de fora: " + motivo)
    else:
        registrar("arena: anthropic_api_key vazia no segredos.json; o Claude fica de fora")
    if not qwen and not claude:
        registrar("arena ligada no vigia.json, mas sem nenhuma IA disponivel: o vigia segue sem arena")
        return None
    juiz = arena.Juiz(qwen, claude, int(a["max_chamadas_dia"]), registrar)
    registrar(f"arena ligada em {a['ativo']} {a['periodo']}: {', '.join(juiz.competidores())}; "
              f"teto de {a['max_chamadas_dia']} chamadas por IA por dia")
    return juiz


def rodar(cfg: dict, segredos: dict, uma_vez: bool) -> None:
    arq_estado = os.path.join(PASTA, "estado.json")
    estado = ler_json(arq_estado, {"versao": 1, "trilhas": {}, "ultimo_resumo": None})
    avisar = (lambda t: telegram(segredos, t)) if segredos.get("telegram_token") else None
    log(f"vigia ligado: {', '.join(cfg['ativos'])} em {', '.join(cfg['periodos'])}; "
        f"estrategias {', '.join(e['nome'] for e in cfg['estrategias'])}; "
        f"telegram {'ligado' if avisar else 'desligado'}")
    juiz = montar_juiz(cfg, segredos)
    if avisar and not uma_vez:
        avisar("Vigia ligado (papel). Estrategias: " + ", ".join(e["nome"] for e in cfg["estrategias"])
               + (f". Arena: {', '.join(juiz.competidores())}" if juiz else ""))
    falhas = 0
    while True:
        agora = int(time.time() * 1000)
        for ativo in cfg["ativos"]:
            for tf in cfg["periodos"]:
                try:
                    aquecer = not os.path.exists(os.path.join(PASTA, f"candles_{ativo}_{tf}.json"))
                    n = ciclo(estado, cfg, ativo, tf, bt.buscar_ou_erro, agora, PASTA, avisar, juiz)
                    if aquecer:
                        log(f"{ativo} {tf}: historico carregado para aquecer os indicadores (sem operar nele). "
                            f"A partir do proximo candle fechado, o vigia opera no papel.")
                    gravar_json(arq_estado, estado)
                    falhas = 0
                    if n:
                        abertas = [tid.split("|")[0] for tid, tr in estado["trilhas"].items()
                                   if tr["posicao"] and f"|{ativo}|{tf}" in tid]
                        log(f"{ativo} {tf}: {n} candle(s) processado(s); posicao aberta em: "
                            f"{', '.join(abertas) if abertas else 'nenhuma'}")
                except bt.ErroBusca as e:
                    falhas += 1
                    log(f"{ativo} {tf}: sem dados ({e.erros[0] if e.erros else 'erro'}); tento de novo")
        hoje = time.strftime("%Y-%m-%d")
        if (avisar and int(time.strftime("%H")) >= cfg.get("resumo_diario_hora", 21)
                and estado.get("ultimo_resumo") != hoje):
            if avisar(texto_resumo(estado)):
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
    ap.add_argument("--telegram-teste", action="store_true")
    args = ap.parse_args()

    segredos = carregar_segredos()

    if args.telegram_descobrir:
        telegram_descobrir(segredos)
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
