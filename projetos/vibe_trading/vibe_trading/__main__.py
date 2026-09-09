"""CLI do Vibe Trading."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .backtest import Backtest, comprar_e_segurar
from .debate import debater, dossie_markdown
from .estrategias import REGISTRO
from .metricas import calcular
from .serie import carregar_csv, serie_sintetica

AVISO = (
    "  Backtest é o passado medido com custo, não previsão. Nenhuma ordem é\n"
    "  enviada para corretora nenhuma. Isto não é recomendação de investimento."
)


def _serie(args):
    if args.dados:
        return carregar_csv(args.dados, args.papel)
    print("  [dado sintético — série FALSA, gerada por semente, só para exercitar o motor]\n")
    return serie_sintetica(papel=args.papel or "SINTETICO", pregoes=args.pregoes, semente=args.semente)


def _estrategia(nome, params):
    if nome not in REGISTRO:
        raise SystemExit(f"estratégia desconhecida: {nome}. Disponíveis: {', '.join(REGISTRO)}")
    kwargs = {}
    for p in params or []:
        if "=" not in p:
            raise SystemExit(f"parâmetro precisa ser chave=valor: {p!r}")
        k, v = p.split("=", 1)
        kwargs[k] = float(v) if "." in v else int(v)
    return REGISTRO[nome](**kwargs)


def cmd_backtest(args):
    serie = _serie(args)
    est = _estrategia(args.estrategia, args.param)
    r = Backtest(serie, est, capital=args.capital, corretagem=args.corretagem,
                 deslize_bps=args.deslize, permitir_venda=args.vender).rodar()
    m = calcular(r, taxa_livre_risco=args.livre_risco)
    print(f"\n  {serie.papel} · {est!r}")
    print(f"  {serie[0].data} a {serie[-1].data} · {len(serie)} pregões\n")
    print(m.como_texto())
    ref = calcular(comprar_e_segurar(serie, args.capital), taxa_livre_risco=args.livre_risco)
    print(f"\n  {'comprar e segurar'.ljust(30)} {ref.retorno_total:+10.1%}")
    diferenca = m.retorno_total - ref.retorno_total
    print(f"  {'diferença'.ljust(30)} {diferenca:+10.1%}"
          f"   {'a estratégia justificou o trabalho' if diferenca > 0 else 'não bateu a referência'}")
    print(f"\n{AVISO}\n")


def cmd_comparar(args):
    serie = _serie(args)
    print(f"\n  {serie.papel} · {serie[0].data} a {serie[-1].data} · {len(serie)} pregões\n")
    cab = f"  {'estratégia'.ljust(22)}{'retorno':>9}{'sharpe':>8}{'DD':>8}{'neg':>5}{'exposto':>9}"
    print(cab)
    print("  " + "-" * (len(cab) - 2))
    ref = calcular(comprar_e_segurar(serie, args.capital), taxa_livre_risco=args.livre_risco)
    print(f"  {'comprar e segurar'.ljust(22)}{ref.retorno_total:>9.1%}{ref.sharpe:>8.2f}"
          f"{ref.rebaixamento_maximo:>8.1%}{ref.negocios:>5}{ref.exposicao:>9.0%}")
    for nome, cls in REGISTRO.items():
        r = Backtest(serie, cls(), capital=args.capital, corretagem=args.corretagem,
                     deslize_bps=args.deslize).rodar()
        m = calcular(r, taxa_livre_risco=args.livre_risco)
        print(f"  {nome.ljust(22)}{m.retorno_total:>9.1%}{m.sharpe:>8.2f}"
              f"{m.rebaixamento_maximo:>8.1%}{m.negocios:>5}{m.exposicao:>9.0%}")
    print(f"\n{AVISO}\n")


def cmd_validar(args):
    """Treino e validação. O teste que a maioria das ferramentas não faz."""
    serie = _serie(args)
    treino, validacao = serie.dividir(args.fracao)
    est_cls = REGISTRO[args.estrategia] if args.estrategia in REGISTRO else None
    if est_cls is None:
        raise SystemExit(f"estratégia desconhecida: {args.estrategia}")
    print(f"\n  {serie.papel} · {args.estrategia}")
    print(f"  treino    {treino[0].data} a {treino[-1].data}  ({len(treino)} pregões)")
    print(f"  validação {validacao[0].data} a {validacao[-1].data}  ({len(validacao)} pregões)\n")

    linhas = []
    for rotulo, s in (("treino", treino), ("validação", validacao)):
        r = Backtest(s, _estrategia(args.estrategia, args.param), capital=args.capital,
                     corretagem=args.corretagem, deslize_bps=args.deslize).rodar()
        m = calcular(r, taxa_livre_risco=args.livre_risco)
        linhas.append((rotulo, m))
        print(f"  {rotulo.ljust(12)} retorno {m.retorno_total:+7.1%}   sharpe {m.sharpe:5.2f}"
              f"   DD {m.rebaixamento_maximo:6.1%}   neg {m.negocios}")

    t, v = linhas[0][1], linhas[1][1]
    print()
    # A ordem importa: "se manteve" só pode ser dito de algo que funcionou no
    # treino. Sem esta primeira condição, uma estratégia que perde nos DOIS
    # períodos era anunciada como consistente — que é verdade e é inútil.
    if t.sharpe <= 0:
        print("  A estratégia não funcionou nem no treino (Sharpe "
              f"{t.sharpe:.2f}). Validar o que já falhou não acrescenta nada.")
    elif v.sharpe < 0:
        print("  NÃO se sustenta fora do treino: positiva no treino, negativa na validação.")
        print("  O que parecia sinal era memória do próprio período.")
    elif v.sharpe < t.sharpe * 0.5:
        print(f"  Cai muito fora do treino (Sharpe {t.sharpe:.2f} -> {v.sharpe:.2f}).")
        print("  Desconfie do ajuste de parâmetro.")
    else:
        print(f"  Se manteve fora do treino (Sharpe {t.sharpe:.2f} -> {v.sharpe:.2f}).")
    print(f"\n{AVISO}\n")


def cmd_debate(args):
    serie = _serie(args)
    dossie, teses, veredito, conviccao, porque = debater(serie, janela=args.janela)
    texto = dossie_markdown(serie, dossie, teses, veredito, conviccao, porque)
    if args.saida:
        Path(args.saida).write_text(texto, encoding="utf-8")
        print(f"\n  dossiê escrito em {args.saida}\n")
    else:
        print("\n" + texto + "\n")


def cmd_estrategias(_args):
    print("\n  Estratégias disponíveis:\n")
    for nome, cls in REGISTRO.items():
        inst = cls()
        print(f"  {nome.ljust(14)} {inst.nome}")
        print(f"  {' ' * 14} padrões: {inst.parametros}")
    print("\n  Use --param chave=valor para mudar. Ex: --param curta=10 --param longa=40\n")


def principal(argv=None):
    p = argparse.ArgumentParser(prog="vibe", description="Agente de pesquisa de trading — backtest, validação e debate.")
    sub = p.add_subparsers(dest="comando", required=True)

    def comuns(sp):
        sp.add_argument("--dados", help="CSV de preços (data, abertura, maxima, minima, fechamento)")
        sp.add_argument("--papel", help="nome do papel")
        sp.add_argument("--pregoes", type=int, default=750, help="tamanho da série sintética")
        sp.add_argument("--semente", type=int, default=42)
        sp.add_argument("--capital", type=float, default=10_000.0)
        sp.add_argument("--corretagem", type=float, default=0.0005, help="fração por ordem (0.0005 = 0,05%%)")
        sp.add_argument("--deslize", type=float, default=5.0, help="slippage em pontos-base por ordem")
        sp.add_argument("--livre-risco", dest="livre_risco", type=float, default=0.10,
                        help="taxa livre de risco ao ano para o Sharpe (padrão 10%% ~ CDI)")
        return sp

    b = comuns(sub.add_parser("backtest", help="roda uma estratégia"))
    b.add_argument("--estrategia", required=True)
    b.add_argument("--param", action="append")
    b.add_argument("--vender", action="store_true", help="permite posição vendida")
    b.set_defaults(func=cmd_backtest)

    c = comuns(sub.add_parser("comparar", help="todas as estratégias contra comprar e segurar"))
    c.set_defaults(func=cmd_comparar)

    v = comuns(sub.add_parser("validar", help="treino x validação — o teste anti-sobreajuste"))
    v.add_argument("--estrategia", required=True)
    v.add_argument("--param", action="append")
    v.add_argument("--fracao", type=float, default=0.7)
    v.set_defaults(func=cmd_validar)

    d = comuns(sub.add_parser("debate", help="dossiê de evidências e placar dos analistas"))
    d.add_argument("--janela", type=int, default=252)
    d.add_argument("--saida", help="escreve o dossiê em markdown")
    d.set_defaults(func=cmd_debate)

    e = sub.add_parser("estrategias", help="lista as estratégias")
    e.set_defaults(func=cmd_estrategias)

    args = p.parse_args(argv)
    try:
        args.func(args)
    except (ValueError, FileNotFoundError) as erro:
        print(f"\n  erro: {erro}\n", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(principal())
