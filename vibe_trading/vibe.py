#!/usr/bin/env python3
"""
Vibe trading — um comando so para tudo. Nada aqui envia ordem ou pede chave de corretora.

    python3 vibe.py                     este menu
    python3 vibe.py analisar BTC        a ficha completa de uma operacao, agora (risco 2%, intraday)
    python3 vibe.py analisar SOL 10 scalp    ... com risco de 10% da banca, no scalp
    python3 vibe.py radar               as moedas que mais oscilam agora na Pionex
    python3 vibe.py fichas              o placar das fichas: o veredito acerta?
    python3 vibe.py fontes              testa, uma a uma, cada fonte de dado da ficha
    python3 vibe.py bateria             fase 1: todas as estrategias, ultimos 90 dias
    python3 vibe.py historico           fase 1: o historico inteiro de cada par, ano a ano
    python3 vibe.py vigia               fase 2: papel ao vivo, 24 horas (Ctrl+C para parar)
    python3 vibe.py placar              o placar do vigia
    python3 vibe.py telegram            configura os alertas no Telegram, passo a passo
    python3 vibe.py arena ligar         liga a arena das IAs (precisa de chave de IA)
    python3 vibe.py arena desligar
    python3 vibe.py monitor             abre o monitor em tempo real no navegador
    python3 vibe.py backtest ...        o backtest com as opcoes dele (veja: backtest --help)
    python3 vibe.py testes              a bateria de guardas do motor

No Mac, para o vigia nao parar quando a tela apaga:  caffeinate -i python3 vibe.py vigia
"""

from __future__ import annotations

import getpass
import os
import subprocess
import sys
import webbrowser

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)


def _rodar_main(modulo: str, args: list[str]) -> None:
    """Chama o main() do script como se ele tivesse sido chamado direto."""
    import importlib
    m = importlib.import_module(modulo)
    sys.argv = [f"{modulo}.py"] + args
    m.main()


def configurar_telegram() -> None:
    import vigia
    seg = vigia.carregar_segredos()
    print("\nALERTAS NO TELEGRAM (2 minutos)\n")
    print("1. No Telegram, procure @BotFather, mande /newbot e escolha um nome.")
    print("   Ele responde com um token (uma linha comprida com dois-pontos).")
    if seg.get("telegram_token"):
        print("   (ja existe um token guardado; ENTER vazio mantem o atual)")
    tok = getpass.getpass("2. Cole o token aqui (nao aparece na tela) e aperte ENTER: ").strip()
    if tok:
        vigia.guardar_segredo("telegram_token", tok)
        seg = vigia.carregar_segredos()
    if not seg.get("telegram_token"):
        sys.exit("Sem token, sem Telegram. Rode de novo quando tiver o token.")
    for tentativa in range(3):
        input("3. Mande qualquer mensagem (um 'oi') para o seu robo no Telegram e aperte ENTER aqui: ")
        if vigia.telegram_descobrir(seg, gravar=True):
            break
    else:
        sys.exit("Nao achei a conversa. Confira se mandou a mensagem para o robo certo e rode de novo.")
    ok = vigia.telegram(vigia.carregar_segredos(), "Teste do vigia: se esta mensagem chegou, os alertas funcionam.")
    print("4. Mensagem de teste enviada. Confira no Telegram." if ok else
          "4. Nao consegui mandar a mensagem de teste. Confira a internet e rode de novo.")


def conferir_fontes(par: str = "BTCUSDT") -> None:
    import fatores
    import ficha
    print(f"\nTESTE DAS FONTES ({par}) - cada uma chamada uma vez, de verdade\n")
    falhas = 0
    for nome, ok, resumo in fatores.conferir_fontes(ficha.par_de(par)):
        falhas += not ok
        print(f"  {'ok   ' if ok else 'FALHA'} {nome}\n        {resumo}")
    print(f"\n{'Todas responderam.' if not falhas else f'{falhas} fonte(s) fora do ar: a ficha mostra FORA DO AR nelas.'}")


def main() -> None:
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help", "ajuda"):
        print(__doc__)
        return
    cmd, resto = args[0], args[1:]
    if cmd in ("analisar", "radar", "fichas"):
        import time
        import vigia
        cfg = vigia.carregar_config()
        agora = int(time.time() * 1000)
        try:
            if cmd == "analisar":
                estado = vigia.ler_json(os.path.join(vigia.PASTA, "estado.json"), {"trilhas": {}})
                print(vigia.fazer_ficha(resto, cfg, estado, agora))
            elif cmd == "radar":
                print(vigia.texto_radar(cfg))
            else:
                print(vigia.texto_fichas(vigia.PASTA, agora))
        except Exception as e:
            sys.exit(f"Nao consegui ({type(e).__name__}: {str(e)[:150]}). Confira a internet e rode "
                     f"'python3 vibe.py fontes' para ver qual fonte esta fora do ar.")
    elif cmd == "fontes":
        conferir_fontes(resto[0] if resto else "BTC")
    elif cmd == "bateria":
        _rodar_main("bateria", resto)
    elif cmd == "historico":
        _rodar_main("bateria", ["--historico"] + resto)
    elif cmd == "vigia":
        _rodar_main("vigia", resto)
    elif cmd == "placar":
        _rodar_main("vigia", ["--placar"])
    elif cmd == "telegram":
        configurar_telegram()
    elif cmd == "arena":
        if resto[:1] not in (["ligar"], ["desligar"]):
            sys.exit("use: python3 vibe.py arena ligar   (ou desligar)")
        _rodar_main("vigia", ["--arena", resto[0]])
    elif cmd == "monitor":
        caminho = os.path.join(AQUI, "monitor.html")
        print(f"abrindo {caminho}")
        webbrowser.open("file://" + caminho)
    elif cmd == "backtest":
        _rodar_main("backtest", resto)
    elif cmd == "testes":
        sys.exit(subprocess.call([sys.executable, os.path.join(AQUI, "testes", "test_motor.py")]))
    else:
        print(f"comando '{cmd}' nao existe.\n")
        print(__doc__)
        sys.exit(2)


if __name__ == "__main__":
    main()
