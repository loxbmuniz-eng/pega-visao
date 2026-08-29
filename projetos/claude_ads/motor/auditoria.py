"""Auditoria de campanha: onde o dinheiro está sendo queimado, o que está
ganhando, e para onde mover a verba.

Duas travas dão sentido ao resto:

1. **Volume mínimo antes de julgar.** Matar um criativo com 3 cliques é o erro
   mais caro e mais comum da otimização manual: o que se está medindo ali é
   ruído, e o anúncio que seria vencedor morre antes de existir amostra.
   Tudo abaixo do limiar vai para "sem volume para julgar" — não para
   "perdedor".

2. **Teto na realocação.** Dobrar a verba de um vencedor não dobra o
   resultado: o leilão fica mais caro e o público bom satura. O plano nunca
   sugere mais que `TETO_CRESCIMENTO`x o gasto atual de uma linha.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from statistics import median

# Volume mínimo POR DIMENSÃO — não existe um número que sirva para tudo.
IMPRESSOES_MINIMAS = 1000     # para falar de CTR
CLIQUES_MINIMOS = 30          # para dizer "teve tráfego e não converteu"
CONVERSOES_MINIMAS = 5        # para comparar CPA ou eleger vencedor
LINHAS_PARA_MEDIANA = 3       # abaixo disso a mediana não é referência, é a própria linha
TETO_CRESCIMENTO = 2.0        # não sugerir mais que 2x o gasto atual de uma linha


def _dinheiro(v: float) -> str:
    return f"R$ {v:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


@dataclass
class Achado:
    tipo: str
    rotulo: str
    gasto: float
    motivo: str
    valor_em_risco: float = 0.0
    acao: str = ""


@dataclass
class Auditoria:
    total_gasto: float
    total_conversoes: float
    total_receita: float
    total_cliques: float
    total_impressoes: float
    cpa_geral: float | None
    roas_geral: float | None
    ctr_geral: float | None
    desperdicio: list[Achado] = field(default_factory=list)
    vencedores: list[Achado] = field(default_factory=list)
    sem_volume: list[Achado] = field(default_factory=list)
    realocacao: list[dict] = field(default_factory=list)
    tem_conversao: bool = True
    tem_receita: bool = True
    base_de_comparacao: bool = True

    @property
    def desperdicio_total(self) -> float:
        return sum(a.valor_em_risco for a in self.desperdicio)


def _volume_ctr(linha) -> bool:
    """Suficiente para falar de CTR."""
    return linha.impressoes >= IMPRESSOES_MINIMAS


def _volume_trafego(linha) -> bool:
    """Suficiente para dizer que teve tráfego e não converteu."""
    return linha.cliques >= CLIQUES_MINIMOS


def _volume_cpa(linha) -> bool:
    """Suficiente para COMPARAR CPA ou eleger vencedor.

    POR QUE exige conversão e não só clique: com 1 conversão o CPA é uma
    amostra de tamanho um. A primeira versão elegia vencedor assim, e um
    'vencedor' de uma conversão manda verba real para o lugar errado.
    """
    return linha.cliques >= CLIQUES_MINIMOS and linha.conversoes >= CONVERSOES_MINIMAS


def _com_volume(linha) -> bool:
    """Alguma coisa pode ser dita sobre esta linha?"""
    return _volume_ctr(linha) or _volume_trafego(linha)


def auditar(linhas, cpa_alvo: float | None = None, roas_alvo: float | None = None) -> Auditoria:
    total_gasto = sum(l.gasto for l in linhas)
    total_conv = sum(l.conversoes for l in linhas)
    total_receita = sum(l.receita for l in linhas)
    total_cliques = sum(l.cliques for l in linhas)
    total_impr = sum(l.impressoes for l in linhas)

    a = Auditoria(
        total_gasto=total_gasto, total_conversoes=total_conv, total_receita=total_receita,
        total_cliques=total_cliques, total_impressoes=total_impr,
        cpa_geral=(total_gasto / total_conv) if total_conv else None,
        roas_geral=(total_receita / total_gasto) if total_gasto else None,
        ctr_geral=(total_cliques / total_impr) if total_impr else None,
        tem_conversao=total_conv > 0,
        tem_receita=total_receita > 0,
    )

    # Referência: mediana das linhas que têm volume. Mediana, não média — uma
    # campanha gigante com CPA ruim puxaria a média e absolveria todo o resto.
    cpas = [l.cpa for l in linhas if _volume_cpa(l) and l.cpa]
    ctrs = [l.ctr for l in linhas if _volume_ctr(l) and l.ctr is not None]
    # Com menos de LINHAS_PARA_MEDIANA linhas comparáveis, a mediana É a
    # própria linha: nada pode ser 30% melhor que si mesmo, e "acima de 1,5x a
    # mediana" acusa metade da conta por acaso. Sem base, só julga com alvo
    # informado por quem conhece o negócio.
    cpa_referencia = cpa_alvo or (median(cpas) if len(cpas) >= LINHAS_PARA_MEDIANA else None)
    ctr_referencia = median(ctrs) if len(ctrs) >= LINHAS_PARA_MEDIANA else None
    a.base_de_comparacao = cpa_referencia is not None

    for l in linhas:
        if l.gasto <= 0:
            continue
        if not _com_volume(l):
            a.sem_volume.append(Achado(
                "sem_volume", l.rotulo(), l.gasto,
                f"{l.cliques:.0f} cliques, {l.impressoes:.0f} impressões, {l.conversoes:.0f} conversões "
                f"— abaixo do mínimo ({CLIQUES_MINIMOS} cliques / {IMPRESSOES_MINIMAS} impressões)",
                acao="deixe rodar até ter amostra, ou corte por decisão de portfólio — não por desempenho",
            ))
            continue

        # 1. Gasto sem nenhuma conversão, com volume suficiente para saber.
        if a.tem_conversao and l.conversoes == 0 and _volume_trafego(l):
            a.desperdicio.append(Achado(
                "sem_conversao", l.rotulo(), l.gasto,
                f"{_dinheiro(l.gasto)} gastos, {l.cliques:.0f} cliques, ZERO conversão",
                valor_em_risco=l.gasto,
                acao="pausar e realocar — teve tráfego suficiente para converter e não converteu",
            ))
            continue

        # 2. CPA muito acima da referência.
        if cpa_referencia and l.cpa and _volume_cpa(l) and l.cpa > cpa_referencia * 1.5:
            excesso = l.gasto - (l.conversoes * cpa_referencia)
            a.desperdicio.append(Achado(
                "cpa_alto", l.rotulo(), l.gasto,
                f"CPA {_dinheiro(l.cpa)} contra referência de {_dinheiro(cpa_referencia)} "
                f"({l.cpa / cpa_referencia:.1f}x)",
                valor_em_risco=max(0.0, excesso),
                acao="reduzir verba ou reescrever o criativo — está pagando caro pela mesma conversão",
            ))
            continue

        # 3. ROAS abaixo do alvo (só quando há receita no relatório).
        if a.tem_receita and roas_alvo and l.roas is not None and _volume_cpa(l) and l.roas < roas_alvo:
            a.desperdicio.append(Achado(
                "roas_baixo", l.rotulo(), l.gasto,
                f"ROAS {l.roas:.2f}x contra alvo de {roas_alvo:.2f}x",
                valor_em_risco=l.gasto * max(0.0, 1 - (l.roas / roas_alvo)),
                acao="reduzir verba até o ROAS voltar ao alvo",
            ))
            continue

        # 4. CTR muito abaixo do conjunto: problema de criativo, não de verba.
        if (ctr_referencia and l.ctr is not None and _volume_ctr(l)
                and l.ctr < ctr_referencia * 0.5 and l.gasto > total_gasto * 0.02):
            a.desperdicio.append(Achado(
                "ctr_baixo", l.rotulo(), l.gasto,
                f"CTR {l.ctr:.2%} contra mediana de {ctr_referencia:.2%} — o criativo não para o dedo",
                valor_em_risco=l.gasto * 0.3,
                acao="trocar o criativo antes de mexer na verba: verba não conserta anúncio que ninguém clica",
            ))
            continue

        # 5. Vencedores — quem merece receber a verba liberada.
        # Vencedor exige amostra de conversão. Sem isso é sorte com nome bonito.
        if not _volume_cpa(l):
            continue
        vence_por_roas = a.tem_receita and roas_alvo and l.roas and l.roas >= roas_alvo * 1.2
        vence_por_cpa = cpa_referencia and l.cpa and l.cpa <= cpa_referencia * 0.7
        if vence_por_roas or vence_por_cpa:
            razao = []
            if vence_por_cpa:
                razao.append(f"CPA {_dinheiro(l.cpa)} ({l.cpa / cpa_referencia:.0%} da referência)")
            if vence_por_roas:
                razao.append(f"ROAS {l.roas:.2f}x")
            a.vencedores.append(Achado(
                "vencedor", l.rotulo(), l.gasto, " · ".join(razao),
                valor_em_risco=0.0,
                acao=f"pode receber até {_dinheiro(l.gasto * (TETO_CRESCIMENTO - 1))} a mais",
            ))

    a.realocacao = _plano(a)
    return a


def _plano(a: Auditoria) -> list[dict]:
    """Distribui o que foi liberado entre os vencedores, proporcional ao gasto
    atual e limitado pelo teto de crescimento."""
    liberado = a.desperdicio_total
    if liberado <= 0 or not a.vencedores:
        return []

    capacidade = [(v, v.gasto * (TETO_CRESCIMENTO - 1)) for v in a.vencedores]
    total_capacidade = sum(c for _, c in capacidade)
    if total_capacidade <= 0:
        return []

    distribuir = min(liberado, total_capacidade)
    plano = []
    for v, cap in capacidade:
        parte = distribuir * (cap / total_capacidade)
        if parte < 0.01:
            continue
        plano.append({
            "para": v.rotulo, "gasto_atual": v.gasto, "acrescimo": parte,
            "novo_gasto": v.gasto + parte, "porque": v.motivo,
        })

    if liberado > total_capacidade:
        plano.append({
            "para": "(sem destino)",
            "gasto_atual": 0.0,
            "acrescimo": liberado - total_capacidade,
            "novo_gasto": 0.0,
            "porque": (
                f"{_dinheiro(liberado - total_capacidade)} sobram: os vencedores atuais não "
                f"absorvem mais que {TETO_CRESCIMENTO:.0f}x a verba sem perder eficiência. "
                "Esse dinheiro pede criativo novo ou público novo, não mais verba no mesmo lugar."
            ),
        })
    return plano
