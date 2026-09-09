#!/usr/bin/env python3
"""Claude Ads — auditoria de anúncios."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from motor import relatorio
from motor.auditoria import auditar
from motor.planilha import ler


def _carregar(args):
    linhas, col, cabecalho = ler(args.arquivo)
    if args.verboso:
        print(f"\n  {len(linhas)} linhas · colunas reconhecidas: {', '.join(sorted(col))}")
        naoUsadas = [c for i, c in enumerate(cabecalho) if i not in col.values()]
        if naoUsadas:
            print(f"  colunas ignoradas: {', '.join(n for n in naoUsadas if n.strip())}")
    return linhas


def cmd_auditar(args):
    a = auditar(_carregar(args), cpa_alvo=args.cpa_alvo, roas_alvo=args.roas_alvo)
    print(relatorio.completo(a))


def cmd_verba(args):
    a = auditar(_carregar(args), cpa_alvo=args.cpa_alvo, roas_alvo=args.roas_alvo)
    print(relatorio.resumo(a))
    print(relatorio.realocacao(a) or "\n  Nada a realocar.")
    print(relatorio.AVISO)


def cmd_criativo(args):
    linhas = _carregar(args)
    comCtr = [l for l in linhas if l.ctr is not None and l.impressoes >= 1000]
    if not comCtr:
        print("\n  Nenhuma linha com impressões suficientes para julgar criativo.\n")
        return
    comCtr.sort(key=lambda l: -(l.ctr or 0))
    print("\n  Criativos por CTR (mínimo 1.000 impressões)\n")
    print(f"  {'':4}{'CTR':>8}{'CPC':>12}{'gasto':>14}   anúncio")
    for i, l in enumerate(comCtr, 1):
        cpc = relatorio.dinheiro(l.cpc) if l.cpc else "—"
        print(f"  {i:<4}{l.ctr:>8.2%}{cpc:>12}{relatorio.dinheiro(l.gasto):>14}   {l.rotulo()[:56]}")
    melhor, pior = comCtr[0], comCtr[-1]
    if pior.ctr and melhor.ctr and pior.ctr > 0:
        print(f"\n  O melhor tem {melhor.ctr / pior.ctr:.1f}x o CTR do pior.")
        print("  Diferença de CTR é problema de criativo, não de verba: verba não")
        print("  conserta anúncio que ninguém clica.")
    print(relatorio.AVISO)


def cmd_plano(args):
    a = auditar(_carregar(args), cpa_alvo=args.cpa_alvo, roas_alvo=args.roas_alvo)
    print("\n  PLANO DE AÇÃO\n  =============")
    passo = 1
    for d in sorted(a.desperdicio, key=lambda x: -x.valor_em_risco)[:8]:
        print(f"\n  {passo}. {d.acao.split('—')[0].strip().capitalize()}: {d.rotulo}")
        print(f"     porque: {d.motivo}")
        print(f"     libera: {relatorio.dinheiro(d.valor_em_risco)}")
        passo += 1
    for p in a.realocacao:
        if p["para"] == "(sem destino)":
            print(f"\n  {passo}. Criativo/público novo para {relatorio.dinheiro(p['acrescimo'])}")
            print(f"     porque: {p['porque']}")
        else:
            print(f"\n  {passo}. Subir verba de {p['para']}")
            print(f"     {relatorio.dinheiro(p['gasto_atual'])} → {relatorio.dinheiro(p['novo_gasto'])}")
            print(f"     porque: {p['porque']}")
        passo += 1
    if passo == 1:
        print("\n  Nada a fazer com os limiares atuais.")
    print(relatorio.AVISO)


def principal(argv=None):
    p = argparse.ArgumentParser(prog="ads", description="Auditoria de anúncios a partir do export da plataforma.")
    sub = p.add_subparsers(dest="comando", required=True)
    for nome, ajuda, funcao in [
        ("auditar", "relatório completo", cmd_auditar),
        ("verba", "só o plano de realocação", cmd_verba),
        ("criativo", "ranking de criativo por CTR", cmd_criativo),
        ("plano", "lista numerada de ações", cmd_plano),
    ]:
        sp = sub.add_parser(nome, help=ajuda)
        sp.add_argument("arquivo", help="CSV exportado do Google Ads ou Meta Ads")
        sp.add_argument("--cpa-alvo", dest="cpa_alvo", type=float, help="CPA que você aceita pagar")
        sp.add_argument("--roas-alvo", dest="roas_alvo", type=float, help="ROAS mínimo aceitável")
        sp.add_argument("-v", "--verboso", action="store_true", help="mostra as colunas reconhecidas")
        sp.set_defaults(func=funcao)

    args = p.parse_args(argv)
    try:
        args.func(args)
    except (ValueError, FileNotFoundError) as erro:
        print(f"\n  erro: {erro}\n", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(principal())
