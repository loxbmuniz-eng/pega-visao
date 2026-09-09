"""Formatação do relatório. Números vêm do motor; aqui só se escolhe o que
mostrar e em que ordem."""
from __future__ import annotations


def dinheiro(v: float) -> str:
    return f"R$ {v:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def _titulo(texto: str) -> str:
    return f"\n  {texto}\n  {'-' * len(texto)}"


def resumo(a) -> str:
    linhas = [_titulo("Panorama")]
    linhas.append(f"  Investido           {dinheiro(a.total_gasto)}")
    linhas.append(f"  Impressões          {a.total_impressoes:,.0f}".replace(",", "."))
    linhas.append(f"  Cliques             {a.total_cliques:,.0f}".replace(",", "."))
    if a.ctr_geral is not None:
        linhas.append(f"  CTR                 {a.ctr_geral:.2%}")
    if a.tem_conversao:
        linhas.append(f"  Conversões          {a.total_conversoes:,.0f}".replace(",", "."))
        linhas.append(f"  CPA                 {dinheiro(a.cpa_geral)}")
    else:
        linhas.append("  Conversões          nenhuma no relatório")
    if a.tem_receita:
        linhas.append(f"  Receita             {dinheiro(a.total_receita)}")
        linhas.append(f"  ROAS                {a.roas_geral:.2f}x")
    return "\n".join(linhas)


def desperdicio(a, limite: int = 12) -> str:
    if not getattr(a, "base_de_comparacao", True):
        return (_titulo("Gasto desperdiçado")
                + "\n  Sem base de comparação: menos de 3 linhas têm conversão suficiente."
                + "\n  Com tão poucas linhas a mediana é a própria linha, e julgar aí é"
                + "\n  sortear. Passe --cpa-alvo (ou --roas-alvo) com o número que o seu"
                + "\n  negócio aceita pagar, e a auditoria roda.")
    if not a.desperdicio:
        return _titulo("Gasto desperdiçado") + "\n  Nada acima dos limiares. "
    ordenado = sorted(a.desperdicio, key=lambda x: -x.valor_em_risco)
    fatia = a.desperdicio_total / a.total_gasto if a.total_gasto else 0
    linhas = [_titulo("Gasto desperdiçado")]
    linhas.append(f"  {dinheiro(a.desperdicio_total)} em risco — {fatia:.0%} do investido\n")
    for i, d in enumerate(ordenado[:limite], 1):
        linhas.append(f"  {i}. {d.rotulo}")
        linhas.append(f"     {d.motivo}")
        linhas.append(f"     em risco: {dinheiro(d.valor_em_risco)}  ·  {d.acao}")
        linhas.append("")
    if len(ordenado) > limite:
        linhas.append(f"  (+{len(ordenado) - limite} outras linhas)")
    return "\n".join(linhas)


def vencedores(a, limite: int = 8) -> str:
    if not a.vencedores:
        return _titulo("Vencedores") + "\n  Nenhuma linha bateu os critérios com volume suficiente."
    linhas = [_titulo("Vencedores")]
    for v in sorted(a.vencedores, key=lambda x: -x.gasto)[:limite]:
        linhas.append(f"  · {v.rotulo}")
        linhas.append(f"    {v.motivo}  ·  gasta {dinheiro(v.gasto)}")
    return "\n".join(linhas)


def sem_volume(a, limite: int = 8) -> str:
    if not a.sem_volume:
        return ""
    linhas = [_titulo("Sem volume para julgar")]
    linhas.append("  Não são perdedores: ainda não há amostra. Matar criativo aqui é o")
    linhas.append("  erro mais caro da otimização manual.\n")
    total = sum(s.gasto for s in a.sem_volume)
    for s in sorted(a.sem_volume, key=lambda x: -x.gasto)[:limite]:
        linhas.append(f"  · {s.rotulo} — {s.motivo}")
    if len(a.sem_volume) > limite:
        linhas.append(f"  (+{len(a.sem_volume) - limite} outras)")
    linhas.append(f"\n  Somam {dinheiro(total)}.")
    return "\n".join(linhas)


def realocacao(a) -> str:
    if not a.realocacao:
        if not a.desperdicio:
            return ""
        return (_titulo("Realocação")
                + "\n  Há verba a liberar, mas nenhum vencedor com volume para recebê-la."
                + "\n  O caminho é criativo novo, não remanejamento.")
    linhas = [_titulo("Plano de realocação")]
    linhas.append(f"  Liberar {dinheiro(a.desperdicio_total)} e mover assim:\n")
    for p in a.realocacao:
        if p["para"] == "(sem destino)":
            linhas.append(f"  ! {p['porque']}")
            continue
        linhas.append(f"  → {p['para']}")
        linhas.append(f"    {dinheiro(p['gasto_atual'])} → {dinheiro(p['novo_gasto'])} "
                      f"(+{dinheiro(p['acrescimo'])})")
        linhas.append(f"    {p['porque']}")
        linhas.append("")
    return "\n".join(linhas)


AVISO = """
  Como ler isto
  -------------
  Os números vêm do arquivo que você passou — não há estimativa nem
  benchmark de mercado inventado aqui. A referência de CPA e CTR é a
  MEDIANA das suas próprias linhas com volume, salvo se você passou um alvo.

  O que este relatório NÃO sabe: sazonalidade, estoque, margem por produto,
  o que mudou na landing page, e se a conversão registrada é a que importa
  para o negócio. Nada aqui deve virar pausa automática sem alguém olhar.
"""


def completo(a) -> str:
    partes = [resumo(a), desperdicio(a), vencedores(a), sem_volume(a), realocacao(a), AVISO]
    return "\n".join(p for p in partes if p)
