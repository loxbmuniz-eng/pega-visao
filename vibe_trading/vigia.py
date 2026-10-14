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
  - avisa no Telegram, se configurado: entrada, saida e resumo do dia.

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
}

SEGREDOS_MODELO = {
    "telegram_token": "",
    "telegram_chat_id": "",
    "openrouter_key": "",
}


# --------------------------------------------------------------------------- #
# arquivos
# --------------------------------------------------------------------------- #

def ler_json(caminho: str, padrao):
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return padrao


def gravar_json(caminho: str, dado) -> None:
    """Grava de forma atomica: um desligamento no meio nao corrompe o arquivo."""
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    tmp = caminho + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(dado, f, ensure_ascii=False)
    os.replace(tmp, caminho)


def anexar_json(caminho: str, registro: dict) -> None:
    os.makedirs(os.path.dirname(caminho), exist_ok=True)
    with open(caminho, "a", encoding="utf-8") as f:
        f.write(json.dumps(registro, ensure_ascii=False) + "\n")


def carregar_config(caminho: str = CONFIG) -> dict:
    if not os.path.exists(caminho):
        gravar_json(caminho, CONFIG_PADRAO)
        print(f"  criei {os.path.basename(caminho)} com a configuracao padrao (confl3 e engolfo, BTCUSDT 15m)")
    cfg = ler_json(caminho, CONFIG_PADRAO)
    for e in cfg["estrategias"]:
        if e["nome"] not in estrategias.REGISTRO:
            sys.exit(f"vigia.json: estrategia '{e['nome']}' nao existe. Disponiveis: {', '.join(estrategias.REGISTRO)}")
    for tf in cfg["periodos"]:
        if tf not in MS:
            sys.exit(f"vigia.json: periodo '{tf}' nao existe. Use: {', '.join(MS)}")
    return cfg


def carregar_segredos(caminho: str = SEGREDOS) -> dict:
    if not os.path.exists(caminho):
        return {}
    modo = os.stat(caminho).st_mode
    if modo & (stat.S_IRWXG | stat.S_IRWXO):
        print(f"  AVISO: {os.path.basename(caminho)} pode ser lido por outros usuarios. "
              f"Rode: chmod 600 {caminho}")
    return ler_json(caminho, {})


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

def ciclo(estado: dict, cfg: dict, ativo: str, tf: str, buscador, agora_ms: int,
          pasta: str = PASTA, avisar=None) -> int:
    """
    Busca os candles novos de um ativo/periodo e processa cada um, na ordem, em
    todas as trilhas. Devolve quantos candles foram processados (o maior numero
    entre as trilhas, nao a soma).
    `buscador(par, tf, n)` e `agora_ms` sao injetaveis para o teste de replay.
    """
    p = params_de(cfg)
    ms = MS[tf]
    arq_cache = os.path.join(pasta, f"candles_{ativo}_{tf}.json")
    c = ler_json(arq_cache, None)
    alinhar = any(e.get("alinhar") for e in cfg["estrategias"])
    trilhas_aqui = [(e, id_trilha(e, ativo, tf)) for e in cfg["estrategias"]]

    if c is None:  # primeira vez: historico para aquecer os indicadores, sem operar nele
        n = bt.candles_para(tf, cfg.get("historico_inicial_dias", 30), alinhar)
        c = cache_vazio()
        atualizar_cache(c, buscador(ativo, tf, n))
        gravar_json(arq_cache, c)
        for e, tid in trilhas_aqui:
            tr = estado["trilhas"].setdefault(tid, trilha_nova(cfg["moedas"]))
            tr["ultimo_t"] = c["t"][-1] if c["t"] else None
        return 0

    for e, tid in trilhas_aqui:  # estrategia nova no vigia.json comeca daqui, sem operar o passado
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
            tr["posicao"], fechou, abriu = passo(tr["posicao"], sinais[i], i, c, p)
            if fechou is not None:
                pnl, desfecho, pos = fechou
                tr["resultados"].append(pnl)
                saldo = sum(tr["resultados"])
                tr["pico"] = max(tr["pico"], saldo)
                tr["queda_max"] = max(tr["queda_max"], tr["pico"] - saldo)
                registro = {"trilha": tid, "estrategia": e["nome"], "ativo": ativo, "periodo": tf,
                            "lado": "compra" if pos.direcao > 0 else "venda", "entrada": pos.entrada,
                            "saida_t": c["t"][i], "desfecho": desfecho, "pnl": round(pnl, 6),
                            "candles": pos.barras, "recuperado": recuperado}
                anexar_json(os.path.join(pasta, "diario.jsonl"), registro)
                if avisar and not recuperado:
                    avisar(texto_saida(registro, tr))
            if abriu and avisar and not recuperado:
                avisar(texto_entrada(e["nome"], ativo, tf, tr["posicao"], p))
            for k, m in enumerate(tr["moedas"]):
                lado = lado_da_moeda(k, c["t"][i]) if sinais[i] != 0 else 0
                m["posicao"], fm, _ = passo(m["posicao"], lado, i, c, p)
                if fm is not None:
                    m["n"] += 1
                    m["soma"] += fm[0]
            tr["ultimo_t"] = c["t"][i]
        processados = max(processados, len(pendentes))
    return processados


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


# --------------------------------------------------------------------------- #
# mensagens
# --------------------------------------------------------------------------- #

def fmt(v: float) -> str:
    casas = 2 if v >= 1000 else 4
    return f"{v:,.{casas}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def texto_entrada(nome: str, ativo: str, tf: str, pos: dict, p: bt.Params) -> str:
    lado = "COMPRA" if pos["direcao"] > 0 else "VENDA"
    return (f"{lado} · {nome} · {ativo} {tf} (papel)\n"
            f"entrada {fmt(pos['entrada'])}\nstop {fmt(pos['px_stop'])}\nalvo {fmt(pos['px_alvo'])}\n"
            f"liquidacao a {p.alav:g}x: {fmt(pos['px_liq'])}\n"
            f"Sinal e ponto de atencao, nao ordem. Confira as regras antes de operar.")


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


def rodar(cfg: dict, segredos: dict, uma_vez: bool) -> None:
    arq_estado = os.path.join(PASTA, "estado.json")
    estado = ler_json(arq_estado, {"versao": 1, "trilhas": {}, "ultimo_resumo": None})
    avisar = (lambda t: telegram(segredos, t)) if segredos.get("telegram_token") else None
    log(f"vigia ligado: {', '.join(cfg['ativos'])} em {', '.join(cfg['periodos'])}; "
        f"estrategias {', '.join(e['nome'] for e in cfg['estrategias'])}; "
        f"telegram {'ligado' if avisar else 'desligado'}")
    if avisar and not uma_vez:
        avisar("Vigia ligado (papel). Estrategias: " + ", ".join(e["nome"] for e in cfg["estrategias"]))
    falhas = 0
    while True:
        agora = int(time.time() * 1000)
        for ativo in cfg["ativos"]:
            for tf in cfg["periodos"]:
                try:
                    aquecer = not os.path.exists(os.path.join(PASTA, f"candles_{ativo}_{tf}.json"))
                    n = ciclo(estado, cfg, ativo, tf, bt.buscar_ou_erro, agora, PASTA, avisar)
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

    if not os.path.exists(SEGREDOS):
        gravar_json(SEGREDOS, SEGREDOS_MODELO)
        os.chmod(SEGREDOS, 0o600)
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
