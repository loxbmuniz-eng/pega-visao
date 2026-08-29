"""Debate entre analistas — a parte "múltiplos agentes" do projeto.

A escolha que faz este módulo valer alguma coisa: **os agentes não inventam os
números, eles argumentam sobre um dossiê de evidências calculado aqui.** Cada
papel recebe os mesmos fatos medidos da série e defende uma leitura. Um juiz
pontua.

POR QUE assim: LLM debatendo preço sem dado na mão produz texto convincente e
vazio — e num assunto onde o texto convincente custa dinheiro, isso é pior do
que não ter nada. Com dossiê, o que o modelo acrescenta é interpretação, e a
interpretação fica verificável contra os números que estão do lado.

O placar é determinístico (regra, não modelo), então roda offline e dá o mesmo
resultado duas vezes. O texto dos analistas é opcional: `dossie_markdown()`
gera o material para você colar num LLM se quiser a prosa.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .indicadores import amplitude_media, desvio_padrao, ifr, media_exponencial
from .metricas import rebaixamento
from .serie import Serie


@dataclass(frozen=True)
class Evidencia:
    chave: str
    rotulo: str
    valor: float | None
    unidade: str = ""
    observacao: str = ""

    def formatado(self) -> str:
        if self.valor is None:
            return "sem dado"
        if self.unidade == "%":
            return f"{self.valor:+.1%}"
        if self.unidade == "%s":          # percentual SEM sinal: volatilidade
            return f"{self.valor:.1%}"
        if self.unidade == "x":
            return f"{self.valor:.2f}x"
        return f"{self.valor:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


@dataclass
class Tese:
    papel: str
    posicao: str            # "comprar", "esperar", "reduzir"
    forca: float            # 0..1
    argumentos: list[str] = field(default_factory=list)
    contra: list[str] = field(default_factory=list)


def montar_dossie(serie: Serie, janela: int = 252) -> dict[str, Evidencia]:
    """Os fatos medidos. Nenhum juízo, só medida."""
    f = serie.fechamentos
    n = len(f)
    corte = max(0, n - janela)
    recorte = f[corte:]

    ema50 = media_exponencial(f, 50)[-1]
    ema200 = media_exponencial(f, 200)[-1]
    rsi = ifr(f, 14)[-1]
    atr = amplitude_media(serie.barras, 14)[-1]
    desv = desvio_padrao(f, 20)[-1]
    pior, _ = rebaixamento(recorte)
    ultimo = f[-1]

    retorno_janela = (recorte[-1] / recorte[0] - 1) if recorte and recorte[0] else None
    dist_ema200 = (ultimo / ema200 - 1) if ema200 else None
    vol_rel = (desv / ultimo) if (desv and ultimo) else None
    atr_rel = (atr / ultimo) if (atr and ultimo) else None
    maxima = max(recorte) if recorte else None
    dist_topo = (ultimo / maxima - 1) if maxima else None

    return {e.chave: e for e in [
        Evidencia("preco", "Último fechamento", ultimo),
        Evidencia("retorno_janela", f"Retorno em {len(recorte)} pregões", retorno_janela, "%"),
        Evidencia("tendencia_curta", "Preço vs. média de 50", (ultimo / ema50 - 1) if ema50 else None, "%"),
        Evidencia("tendencia_longa", "Preço vs. média de 200", dist_ema200, "%",
                  "acima de zero = tendência de alta pelo critério mais usado"),
        Evidencia("ifr", "IFR (14)", rsi, "",
                  "abaixo de 30 = sobrevenda; acima de 70 = sobrecompra"),
        Evidencia("vol_rel", "Volatilidade de 20 pregões", vol_rel, "%s", "desvio padrão sobre o preço"),
        Evidencia("atr_rel", "Amplitude média (14)", atr_rel, "%s", "quanto o papel anda por dia"),
        Evidencia("rebaixamento", "Pior queda desde o topo da janela", pior, "%"),
        Evidencia("dist_topo", "Distância do topo da janela", dist_topo, "%"),
    ]}


def _v(dossie, chave):
    e = dossie.get(chave)
    return e.valor if e else None


def analistas(dossie: dict[str, Evidencia]) -> list[Tese]:
    """Quatro papéis, cada um lendo o MESMO dossiê com um viés declarado.

    O viés é explícito de propósito: um comitê onde todos pensam igual não é
    comitê, é eco. O valor está no juiz ver a discordância."""
    teses: list[Tese] = []

    # 1. Tendência — só compra o que já está subindo.
    longa, curta = _v(dossie, "tendencia_longa"), _v(dossie, "tendencia_curta")
    t = Tese("tendência", "esperar", 0.0)
    if longa is not None and curta is not None:
        if longa > 0 and curta > 0:
            t.posicao, t.forca = "comprar", min(1.0, 0.5 + abs(longa) * 2)
            t.argumentos.append(f"preço acima da média longa ({longa:+.1%}) e da curta ({curta:+.1%})")
        elif longa < 0:
            t.posicao, t.forca = "reduzir", min(1.0, 0.5 + abs(longa) * 2)
            t.argumentos.append(f"preço {longa:+.1%} abaixo da média de 200 — tendência principal contra")
        else:
            t.argumentos.append("médias em desacordo: tendência longa e curta apontam para lados diferentes")
        if longa is not None and longa > 0.25:
            t.contra.append(f"esticado {longa:+.1%} acima da média longa — entrada tardia")
    teses.append(t)

    # 2. Risco — só fala de perda.
    rebaixa, vol = _v(dossie, "rebaixamento"), _v(dossie, "vol_rel")
    r = Tese("risco", "esperar", 0.0)
    if rebaixa is not None:
        r.argumentos.append(f"a janela já entregou uma queda de {rebaixa:.1%} desde o topo")
        if rebaixa < -0.30:
            r.posicao, r.forca = "reduzir", 0.8
            r.contra.append("queda acima de 30% na janela: dimensionar posição pela volatilidade, não pelo capital")
    if vol is not None:
        r.argumentos.append(f"volatilidade de 20 pregões em {vol:.1%} do preço")
        if vol > 0.04:
            r.forca = max(r.forca, 0.6)
            r.posicao = "reduzir"
            r.contra.append("volatilidade alta: o mesmo stop em reais vira um stop muito mais apertado em %")
    teses.append(r)

    # 3. Contra — procura o argumento que derruba os outros.
    ifr_v, topo = _v(dossie, "ifr"), _v(dossie, "dist_topo")
    c = Tese("contra", "esperar", 0.4)
    if ifr_v is not None:
        if ifr_v > 70:
            c.posicao, c.forca = "reduzir", 0.7
            c.argumentos.append(f"IFR em {ifr_v:.0f}: quem compra aqui compra de quem entrou embaixo")
        elif ifr_v < 30:
            c.posicao, c.forca = "comprar", 0.6
            c.argumentos.append(f"IFR em {ifr_v:.0f}: sobrevenda — mas só vale com tendência longa a favor")
            c.contra.append("comprar sobrevenda contra a tendência principal é o erro clássico da reversão")
    if topo is not None and topo < -0.15:
        c.argumentos.append(f"ainda {topo:.1%} abaixo do topo da janela: a recuperação não se confirmou")
    teses.append(c)

    # 4. Custo — o papel que quase ninguém coloca na mesa.
    atr = _v(dossie, "atr_rel")
    k = Tese("custo", "esperar", 0.3)
    if atr is not None:
        k.argumentos.append(f"o papel anda {atr:.1%} por dia: giro diário come o resultado em corretagem e spread")
        if atr < 0.01:
            k.posicao, k.forca = "reduzir", 0.5
            k.contra.append("amplitude diária abaixo de 1%: o custo de operar tende a superar o movimento capturado")
    teses.append(k)

    return teses


def julgar(teses: list[Tese]) -> tuple[str, float, str]:
    """Placar determinístico. Devolve (veredito, convicção 0..1, por quê)."""
    peso = {"comprar": 1.0, "esperar": 0.0, "reduzir": -1.0}
    soma = sum(peso[t.posicao] * t.forca for t in teses)
    total = sum(t.forca for t in teses) or 1.0
    nota = soma / total

    if nota > 0.35:
        veredito = "comprar"
    elif nota < -0.35:
        veredito = "reduzir"
    else:
        veredito = "esperar"

    a_favor = [t.papel for t in teses if t.posicao == "comprar" and t.forca > 0.2]
    contra = [t.papel for t in teses if t.posicao == "reduzir" and t.forca > 0.2]
    porque = (
        f"{len(a_favor)} a favor ({', '.join(a_favor) or '—'}) · "
        f"{len(contra)} contra ({', '.join(contra) or '—'})"
    )
    return veredito, abs(nota), porque


def dossie_markdown(serie: Serie, dossie: dict[str, Evidencia], teses: list[Tese],
                    veredito: str, conviccao: float, porque: str) -> str:
    """O material para colar num LLM, se você quiser a prosa do debate.

    Sai com os números junto de propósito: assim dá para conferir se o texto
    que voltar corresponde ao que foi medido."""
    linhas = [
        f"# Dossiê — {serie.papel}",
        f"Período: {serie[0].data} a {serie[-1].data} · {len(serie)} pregões",
        "",
        "## Evidências (medidas, não opiniões)",
        "",
        "| | valor | nota |",
        "|---|---|---|",
    ]
    for e in dossie.values():
        linhas.append(f"| {e.rotulo} | {e.formatado()} | {e.observacao} |")
    linhas += ["", "## Teses", ""]
    for t in teses:
        linhas.append(f"### {t.papel} — {t.posicao} (força {t.forca:.2f})")
        for a in t.argumentos:
            linhas.append(f"- {a}")
        for c in t.contra:
            linhas.append(f"- ⚠ {c}")
        linhas.append("")
    linhas += [
        "## Placar",
        "",
        f"**{veredito}** · convicção {conviccao:.0%} · {porque}",
        "",
        "> Isto é leitura de indicador sobre dado passado. Não é recomendação",
        "> de investimento, não prevê preço, e nenhuma ordem foi enviada.",
    ]
    return "\n".join(linhas)


def debater(serie: Serie, janela: int = 252):
    dossie = montar_dossie(serie, janela)
    teses = analistas(dossie)
    veredito, conviccao, porque = julgar(teses)
    return dossie, teses, veredito, conviccao, porque
