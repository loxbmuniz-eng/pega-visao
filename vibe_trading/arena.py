#!/usr/bin/env python3
"""
Arena: IAs de linguagem como competidoras no vigia, no PAPEL e ao vivo.

Ate quatro competidores, todos com as MESMAS regras do resto do projeto:
  ia:qwen         a Qwen decide sozinha (via OpenRouter)
  ia:deepseek     o DeepSeek decide sozinho (via OpenRouter, mesma chave da Qwen)
  ia:claude       o Claude decide sozinho (SDK oficial da Anthropic)
  ia:qwen+claude  a Qwen propoe e o Claude aprova ou veta

O que a IA pode fazer: dizer COMPRA, VENDA ou NADA num candle fechado.
O que ela NAO pode: escolher tamanho, alavancagem, stop ou alvo (saem das
regras fixas, em codigo), ver texto da internet (recebe so numeros gerados
pelo nosso codigo), ou mexer em dinheiro (nao ha ferramenta nem chave de
corretora). Resposta fora do formato, recusa, erro de rede ou teto diario
atingido: vira NADA. O erro sempre cai para o lado de nao operar.

Por que so ao vivo: o modelo foi treinado com textos que incluem o historico
de precos, entao num backtest no passado ele pode "lembrar" o que aconteceu.
Candles posteriores ao treino nao tem esse problema.

Quando a IA e consultada: so nos candles de interesse (rompimento do canal de
20 candles ou divergencia de RSI). Isso corta a maior parte das chamadas e do
custo; nos outros candles o competidor fica de fora.
"""

from __future__ import annotations

import json
import re
import time
import urllib.request

import estrategias
import indicadores as ind

ESQUEMA_DECISAO = {
    "type": "object",
    "properties": {
        "lado": {"type": "string", "enum": ["compra", "venda", "nada"]},
        "motivo": {"type": "string"},
        "confianca": {"type": "number"},
    },
    "required": ["lado", "motivo", "confianca"],
    "additionalProperties": False,
}

ESQUEMA_VETO = {
    "type": "object",
    "properties": {
        "veredito": {"type": "string", "enum": ["aprova", "veta"]},
        "motivo": {"type": "string"},
    },
    "required": ["veredito", "motivo"],
    "additionalProperties": False,
}

INSTRUCAO = (
    "Voce e um competidor numa arena de trading de papel, sem dinheiro real. "
    "Recebe dados numericos de um candle que acabou de fechar e decide se abre uma operacao "
    "no fechamento dele: 'compra', 'venda' ou 'nada'. As regras de saida sao fixas e voce nao "
    "as escolhe: {regras}. Ficar de fora e uma decisao valida e frequente. Voce sera comparado "
    "com moedas sorteadas que entram nos mesmos candles: so vale entrar quando os dados derem "
    "razao concreta para um lado. Responda apenas no formato pedido, com um motivo curto "
    "(ate 200 caracteres) e a confianca: um numero de 0 a 1, a chance que voce da de a operacao "
    "bater o alvo antes do stop. Ela vira a sua nota de acerto: confianca alta que erra pesa contra."
)


# --------------------------------------------------------------------------- #
# quando consultar e o que mostrar
# --------------------------------------------------------------------------- #

def candles_de_interesse(serie) -> list[bool]:
    """Rompimento do canal de 20 candles ou divergencia de RSI. Usa so dados ate i."""
    n = len(serie.fechamento)
    div = estrategias.divergencia_rsi(serie)
    marca = [False] * n
    for i in range(20, n):
        topo = max(serie.maxima[i - 20:i])
        fundo = min(serie.minima[i - 20:i])
        if serie.fechamento[i] > topo or serie.fechamento[i] < fundo or div[i] != 0:
            marca[i] = True
    return marca


def montar_dados(serie, i: int, p) -> str:
    """Resumo SO NUMERICO dos ultimos 48 candles (o candle i e os 47 anteriores). Nenhum texto de fora."""
    f = serie.fechamento
    ema50 = ind.ema(f, 50)
    ema200 = ind.ema(f, 200)
    rsi = ind.rsi(f, 14)
    atr = ind.atr(serie.maxima, serie.minima, f, 14)
    vwap = ind.vwap_janela(serie.maxima, serie.minima, f, serie.volume, 20)
    volm = ind.sma(serie.volume, 20)
    eng = estrategias.engolfo(serie)[i]
    div = estrategias.divergencia_rsi(serie)[i]
    topo = max(serie.maxima[i - 20:i])
    fundo = min(serie.minima[i - 20:i])

    def r(x, casas=2):
        return None if x is None else round(x, casas)

    ref = f[i]
    candles = []
    for j in range(max(0, i - 47), i + 1):
        # precos relativos ao fechamento atual (%), para a IA olhar o formato e nao o nivel
        candles.append([round((serie.abertura[j] / ref - 1) * 100, 3), round((serie.maxima[j] / ref - 1) * 100, 3),
                        round((serie.minima[j] / ref - 1) * 100, 3), round((serie.fechamento[j] / ref - 1) * 100, 3),
                        round(serie.volume[j] / volm[i], 2) if volm[i] else None])
    dados = {
        "candles_ate_agora_mais_antigo_primeiro": {
            "colunas": ["abertura_%", "maxima_%", "minima_%", "fechamento_%", "volume_relativo"],
            "linhas": candles,
        },
        "indicadores_no_ultimo_candle": {
            "ema50_vs_preco_%": r((ema50[i] / ref - 1) * 100 if ema50[i] else None),
            "ema200_vs_preco_%": r((ema200[i] / ref - 1) * 100 if ema200[i] else None),
            "rsi14": r(rsi[i], 1),
            "atr14_%": r(atr[i] / ref * 100 if atr[i] else None, 3),
            "vwap20_vs_preco_%": r((vwap[i] / ref - 1) * 100 if vwap[i] else None),
            "volume_vs_media20": r(serie.volume[i] / volm[i] if volm[i] else None),
        },
        "eventos_no_ultimo_candle": {
            "rompeu_maxima_20": f[i] > topo,
            "rompeu_minima_20": f[i] < fundo,
            "engolfo": {1: "de alta", -1: "de baixa"}.get(eng, "nenhum"),
            "divergencia_rsi": {1: "de alta", -1: "de baixa"}.get(div, "nenhuma"),
        },
    }
    return json.dumps(dados, ensure_ascii=False)


def regras_texto(p) -> str:
    return (f"stop a {p.stop:g}% do preco de entrada, alvo a {p.stop * p.rr:g}%, encerramento a mercado "
            f"apos {p.max_barras} candles sem stop nem alvo, taxa de {p.taxa:g}% por lado")


# --------------------------------------------------------------------------- #
# leitura da resposta: tudo que nao for exatamente o formato vira NADA
# --------------------------------------------------------------------------- #

def ler_decisao(texto: str) -> tuple[int, str]:
    try:
        m = re.search(r"\{.*\}", texto or "", re.S)
        d = json.loads(m.group(0) if m else texto)
        lado = {"compra": 1, "venda": -1, "nada": 0}[d["lado"]]
        return lado, str(d.get("motivo", ""))[:200]
    except Exception:
        return 0, "resposta fora do formato: tratada como nada"


def ler_confianca(texto: str) -> float | None:
    """A confianca (0 a 1) que a IA deu. Fora do formato, fora da faixa ou ausente: None
    (a decisao vale, so nao entra na nota de acerto)."""
    try:
        m = re.search(r"\{.*\}", texto or "", re.S)
        v = json.loads(m.group(0) if m else texto).get("confianca")
    except Exception:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 <= v <= 1:
        return None
    return float(v)


def ler_veto(texto: str) -> tuple[bool, str]:
    try:
        m = re.search(r"\{.*\}", texto or "", re.S)
        d = json.loads(m.group(0) if m else texto)
        if d["veredito"] not in ("aprova", "veta"):
            raise ValueError
        return d["veredito"] == "aprova", str(d.get("motivo", ""))[:200]
    except Exception:
        return False, "resposta fora do formato: tratada como veto"


# --------------------------------------------------------------------------- #
# provedores
# --------------------------------------------------------------------------- #

class ModeloOpenRouter:
    """Um modelo pela OpenRouter (HTTP direto, sem dependencia): a Qwen e o DeepSeek.
    `preco` = (USD por milhao de tokens de entrada, de saida), lido da lista publica
    da OpenRouter na partida; None se nao deu para ler."""

    URL = "https://openrouter.ai/api/v1/chat/completions"

    def __init__(self, chave: str, modelo: str, preco: tuple[float, float] | None = None):
        self.chave, self.modelo, self.preco = chave, modelo, preco
        self.uso = None  # (tokens de entrada, de saida) da ultima chamada

    def perguntar(self, sistema: str, usuario: str) -> str:
        self.uso = None
        corpo = {"model": self.modelo, "temperature": 0,
                 "messages": [{"role": "system", "content": sistema}, {"role": "user", "content": usuario}]}
        req = urllib.request.Request(self.URL, data=json.dumps(corpo).encode(), method="POST", headers={
            "Authorization": f"Bearer {self.chave}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=90) as r:
            resp = json.loads(r.read().decode())
        u = resp.get("usage") or {}
        self.uso = (int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0))
        return resp["choices"][0]["message"]["content"]


Qwen = ModeloOpenRouter  # nome antigo, mantido


def modelos_openrouter() -> dict:
    """Lista publica de modelos da OpenRouter: {id: dados do modelo}."""
    with urllib.request.urlopen("https://openrouter.ai/api/v1/models", timeout=30) as r:
        return {m["id"]: m for m in json.loads(r.read().decode()).get("data", []) if "id" in m}


def conferir_modelo(modelo: str, listar=modelos_openrouter) -> tuple[str, tuple[float, float] | None, list[str]]:
    """Confere o nome do modelo ANTES de gastar chamada.
    Devolve (situacao, preco, parecidos): situacao e 'ok', 'nao_existe' ou 'sem_lista'
    (sem rede para a lista: segue com o nome do vigia.json e o erro, se houver, vira NADA).
    `parecidos` sao os modelos da mesma familia (mesmo prefixo, ex. 'qwen/')."""
    try:
        lista = listar()
    except Exception:
        return "sem_lista", None, []
    familia = modelo.split("/")[0] + "/"
    parecidos = sorted(k for k in lista if k.startswith(familia))
    if modelo not in lista:
        return "nao_existe", None, parecidos
    preco = None
    try:
        pr = lista[modelo].get("pricing") or {}
        preco = (float(pr["prompt"]) * 1e6, float(pr["completion"]) * 1e6)  # a lista da por token
    except (KeyError, TypeError, ValueError):
        pass
    return "ok", preco, parecidos


conferir_qwen = conferir_modelo  # nome antigo, mantido


class Recusou(Exception):
    pass


# USD por milhao de tokens (entrada, saida), da tabela de precos da Anthropic.
# Os tokens de pensamento sao cobrados como saida.
PRECO_CLAUDE = {"claude-opus-5-5": (4.0, 20.0)}


class Claude:
    """Claude pelo SDK oficial da Anthropic, com resposta em formato fixo (structured outputs)."""

    def __init__(self, cliente, modelo: str, esforco: str):
        self.cliente, self.modelo, self.esforco = cliente, modelo, esforco
        self.preco = PRECO_CLAUDE.get(modelo)
        self.uso = None

    def perguntar_formatado(self, sistema: str, usuario: str, esquema: dict) -> str:
        self.uso = None
        # Claude Opus 5.5: pensamento sempre ligado; a profundidade vem do esforco.
        # fallbacks "default": se o modelo recusar por politica, a API refaz no modelo
        # que a Anthropic recomenda para aquela categoria, dentro da mesma chamada.
        resp = self.cliente.beta.messages.create(
            model=self.modelo,
            max_tokens=16000,
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=sistema,
            output_config={"effort": self.esforco, "format": {"type": "json_schema", "schema": esquema}},
            messages=[{"role": "user", "content": usuario}],
        )
        u = getattr(resp, "usage", None)
        self.uso = (int(getattr(u, "input_tokens", 0) or 0), int(getattr(u, "output_tokens", 0) or 0))
        if resp.stop_reason == "refusal":
            raise Recusou("o Claude recusou responder")  # o juiz trata como nada / veto
        return next((b.text for b in resp.content if b.type == "text"), "")


def criar_claude(segredos: dict, modelo: str, esforco: str):
    """Cria o cliente do Claude, ou devolve (None, motivo) se nao der."""
    try:
        import anthropic
    except ImportError:
        return None, ("pacote 'anthropic' nao instalado. Para ligar o Claude na arena: "
                      "python3 -m venv .venv && .venv/bin/pip install anthropic, e rode o vigia com "
                      ".venv/bin/python vigia.py")
    chave = segredos.get("anthropic_api_key")
    try:
        cliente = anthropic.Anthropic(api_key=chave) if chave else anthropic.Anthropic()
    except Exception as e:
        return None, f"sem credencial da Anthropic ({type(e).__name__}): coloque anthropic_api_key no segredos.json"
    return Claude(cliente, modelo, esforco), ""


# --------------------------------------------------------------------------- #
# o juiz: consulta os competidores uma vez por candle e guarda as decisoes
# --------------------------------------------------------------------------- #

COMPETIDORES = ("ia:qwen", "ia:deepseek", "ia:claude", "ia:qwen+claude")

TETO = "teto diario de chamadas atingido"


class Juiz:
    def __init__(self, qwen: ModeloOpenRouter | None, claude: Claude | None, max_chamadas_dia: int, log=print,
                 deepseek: ModeloOpenRouter | None = None):
        self.qwen, self.claude, self.max_dia, self.log = qwen, claude, max_chamadas_dia, log
        self.deepseek = deepseek

    def competidores(self) -> list[str]:
        ativos = []
        if self.qwen:
            ativos.append("ia:qwen")
        if self.deepseek:
            ativos.append("ia:deepseek")
        if self.claude:
            ativos.append("ia:claude")
        if self.qwen and self.claude:
            ativos.append("ia:qwen+claude")
        return ativos

    def _pode(self, estado: dict, provedor: str) -> bool:
        hoje = time.strftime("%Y-%m-%d")
        cont = estado.setdefault("chamadas", {}).setdefault(hoje, {})
        if cont.get(provedor, 0) >= self.max_dia:
            return False
        cont[provedor] = cont.get(provedor, 0) + 1
        limite = time.strftime("%Y-%m-%d", time.localtime(time.time() - 7 * 86400))
        for dia in list(estado["chamadas"]):  # guarda so a ultima semana
            if dia < limite:
                del estado["chamadas"][dia]
        return True

    def _chamar(self, estado: dict, provedor: str, quem, pergunta):
        """Unico ponto que chama uma IA: confere o teto, chama, conta o custo.
        Devolve (texto, falha). Com falha (teto ou erro), quem chama trata como NADA."""
        if not self._pode(estado, provedor):
            return None, TETO
        try:
            return pergunta(), None
        except Exception as e:
            falha = f"erro em {provedor} ({type(e).__name__})"
            self.log(f"arena: {falha}: tratado como nada")
            return None, falha
        finally:
            uso = quem.uso or (0, 0)
            c = estado.setdefault("custo", {}).setdefault(
                provedor, {"chamadas": 0, "entrada": 0, "saida": 0, "usd": 0.0, "sem_preco": 0})
            c["chamadas"] += 1
            c["entrada"] += uso[0]
            c["saida"] += uso[1]
            if quem.preco:
                c["usd"] += (uso[0] * quem.preco[0] + uso[1] * quem.preco[1]) / 1e6
            else:
                c["sem_preco"] += 1

    def decidir(self, estado: dict, chave_candle: str, serie, i: int, p) -> dict:
        """Decisao de cada competidor neste candle: {competidor: (lado, motivo)}.
        Fica guardada no estado: religar o vigia nao repete chamada nem muda a decisao."""
        guardadas = estado.setdefault("decisoes", {})
        if chave_candle in guardadas:
            return {k: tuple(v) for k, v in guardadas[chave_candle].items()}

        sistema = INSTRUCAO.format(regras=regras_texto(p))
        usuario = "Dados do candle que acabou de fechar:\n" + montar_dados(serie, i, p)
        out: dict = {}

        pedido_json = usuario + ('\nResponda SO com JSON: {"lado": "compra"|"venda"|"nada", "motivo": "...", '
                                 '"confianca": numero de 0 a 1}')
        conf: dict = {}
        lado_q, mot_q = 0, "nao consultada"
        if self.qwen:
            texto, falha = self._chamar(estado, "qwen", self.qwen, lambda: self.qwen.perguntar(sistema, pedido_json))
            lado_q, mot_q = (0, falha + ": nada") if falha else ler_decisao(texto)
            out["ia:qwen"] = (lado_q, mot_q)
            conf["ia:qwen"] = None if falha else ler_confianca(texto)

        if self.deepseek:
            texto, falha = self._chamar(estado, "deepseek", self.deepseek,
                                        lambda: self.deepseek.perguntar(sistema, pedido_json))
            out["ia:deepseek"] = (0, falha + ": nada") if falha else ler_decisao(texto)
            conf["ia:deepseek"] = None if falha else ler_confianca(texto)

        if self.claude:
            texto, falha = self._chamar(estado, "claude", self.claude,
                                        lambda: self.claude.perguntar_formatado(sistema, usuario, ESQUEMA_DECISAO))
            out["ia:claude"] = (0, falha + ": nada") if falha else ler_decisao(texto)
            conf["ia:claude"] = None if falha else ler_confianca(texto)

        if self.qwen and self.claude:
            if lado_q == 0:
                out["ia:qwen+claude"] = (0, "a Qwen ficou de fora")
            else:
                proposta = {1: "compra", -1: "venda"}[lado_q]
                texto, falha = self._chamar(estado, "claude", self.claude, lambda: self.claude.perguntar_formatado(
                    sistema.replace("decide se abre", "revisa a proposta de outra IA para abrir"),
                    usuario + f"\nProposta da outra IA: {proposta}. Motivo dela: {mot_q}\n"
                              "Aprove so se os dados sustentam a proposta; senao, vete.",
                    ESQUEMA_VETO))
                ok, mot = (False, falha) if falha else ler_veto(texto)
                out["ia:qwen+claude"] = (lado_q if ok else 0, ("aprovou: " if ok else "vetou: ") + mot)
                conf["ia:qwen+claude"] = conf.get("ia:qwen") if ok else None

        guardadas[chave_candle] = {k: list(v) for k, v in out.items()}
        confiancas = estado.setdefault("confiancas", {})
        confiancas[chave_candle] = {k: v for k, v in conf.items() if v is not None}
        if len(guardadas) > 2000:  # nao cresce sem fim
            for k in sorted(guardadas)[:500]:
                del guardadas[k]
                confiancas.pop(k, None)
        return out
