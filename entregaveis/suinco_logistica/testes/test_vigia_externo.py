#!/usr/bin/env python3
"""O vigia de fora reprova quando deve (02/10/2026).

PEDIDO DO DONO: "no raio-X, tudo que fala 'se quebrar', você vai criar uma
prevenção de quebra pra cada possibilidade apontada". O vigia
(backend/scripts/vigia_externo.mjs) roda no GitHub — fora do servidor — e
responde duas perguntas: "o que o portão publicou é o que está no ar, e a
tela abre?" e "o painel e o servidor estão de pé agora?".

Um vigia que nunca reprova é pior que nenhum: dá a sensação de proteção sem
a proteção. Este teste aponta o vigia para servidores LOCAIS e exige que ele:
  1. aprove o site que serve o build publicado e abre sem erro;
  2. reprove o site que continua servindo o build ANTIGO;
  3. reprove o site que serve o build novo mas quebra com erro de JavaScript;
  4. aprove "no ar" com o site e o /health respondendo;
  5. reprove "no ar" com o servidor fora (porta morta);
  6. reprove "no ar" com o servidor de pé e o banco fora (/health 503).

    bash testes/rodar_tudo.sh test_vigia_externo
"""
import http.server
import json
import os
import re
import shutil
import socketserver
import subprocess
import sys
import tempfile
import threading

AQUI = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(AQUI)
VIGIA = os.path.join(BASE, 'backend', 'scripts', 'vigia_externo.mjs')
falhas = []


def ck(nome, ok, detalhe=''):
    print(f"  [{'OK ' if ok else 'FALHA'}] {nome}" + (f" — {detalhe}" if detalhe else ''))
    if not ok:
        falhas.append(nome)


class Silencioso(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def servir(pasta):
    h = lambda *a, **k: Silencioso(*a, directory=pasta, **k)
    s = socketserver.TCPServer(('127.0.0.1', 0), h)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s, f'http://127.0.0.1:{s.server_address[1]}/'


def servir_health(status, corpo):
    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(corpo).encode())

        def log_message(self, *a):
            pass
    s = socketserver.TCPServer(('127.0.0.1', 0), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s, f'http://127.0.0.1:{s.server_address[1]}'


def porta_morta():
    s = socketserver.TCPServer(('127.0.0.1', 0), Silencioso)
    p = s.server_address[1]
    s.server_close()
    return f'http://127.0.0.1:{p}'


def vigia(args, **env):
    e = dict(os.environ, VIGIA_ESPERA_MS='4000', VIGIA_INTERVALO_MS='500', VIGIA_TENTATIVAS='2',
             PLAYWRIGHT_CHROMIUM_PATH=os.environ.get('PLAYWRIGHT_CHROMIUM_PATH') or '/opt/pw-browsers/chromium')
    e.update(env)
    r = subprocess.run(['node', VIGIA] + args, env=e, capture_output=True, text=True, timeout=180)
    return r.returncode, (r.stdout + r.stderr).strip().splitlines()[-1:] or ['']


def main():
    original = open(os.path.join(BASE, 'index.html'), encoding='utf-8').read()
    m = re.search(r'window\.SUINCO_BUILD_EM\s*=\s*"([^"]+)"', original)
    ck('o index.html tem o carimbo de build que o vigia compara', bool(m))
    if not m:
        return
    novo = original
    antigo = original.replace(m.group(1), '2000-01-01T00:00:00+00:00')
    quebrado = original.replace('</body>', '<script>throw new Error("tela quebrada de propósito")</script></body>')

    pastas = {}
    for nome, html in (('novo', novo), ('antigo', antigo), ('quebrado', quebrado)):
        d = tempfile.mkdtemp(prefix=f'vigia_{nome}_')
        open(os.path.join(d, 'index.html'), 'w', encoding='utf-8').write(html)
        pastas[nome] = d
    publicado = os.path.join(pastas['novo'], 'index.html')
    servidores = []
    try:
        print('\n=== O QUE O PORTÃO PUBLICOU ESTÁ NO AR? ===')
        s, url = servir(pastas['novo']); servidores.append(s)
        cod, ult = vigia(['--publicado', publicado], VIGIA_SITE=url)
        ck('site com o build publicado, tela sem erro → aprova', cod == 0, ult[0])

        s, url = servir(pastas['antigo']); servidores.append(s)
        cod, ult = vigia(['--publicado', publicado], VIGIA_SITE=url)
        ck('site ainda no build antigo → REPROVA e diz o build no ar', cod == 1 and '2000-01-01' in ult[0], ult[0])

        s, url = servir(pastas['quebrado']); servidores.append(s)
        cod, ult = vigia(['--publicado', publicado], VIGIA_SITE=url)
        ck('build novo com erro de JavaScript → REPROVA', cod == 1 and 'erro de JavaScript' in ult[0], ult[0])

        print('\n=== O PAINEL E O SERVIDOR ESTÃO DE PÉ? ===')
        s, site = servir(pastas['novo']); servidores.append(s)
        s, api_ok = servir_health(200, {'ok': True, 'banco': 'conectado'}); servidores.append(s)
        cod, ult = vigia(['--no-ar'], VIGIA_SITE=site, VIGIA_API=api_ok)
        ck('site no ar e /health ok → aprova', cod == 0, ult[0])

        cod, ult = vigia(['--no-ar'], VIGIA_SITE=site, VIGIA_API=porta_morta())
        ck('servidor fora (porta morta) → REPROVA', cod == 1 and 'não respondeu /health' in ult[0], ult[0])

        s, api_sem_banco = servir_health(503, {'ok': False, 'banco': 'inacessível'}); servidores.append(s)
        cod, ult = vigia(['--no-ar'], VIGIA_SITE=site, VIGIA_API=api_sem_banco)
        ck('servidor de pé e banco fora (/health 503) → REPROVA', cod == 1 and 'inacessível' in ult[0], ult[0])

        cod, ult = vigia(['--no-ar'], VIGIA_SITE=porta_morta(), VIGIA_API=api_ok)
        ck('site fora → REPROVA', cod == 1 and 'site não respondeu' in ult[0], ult[0])
    finally:
        for s in servidores:
            s.shutdown(); s.server_close()
        for d in pastas.values():
            shutil.rmtree(d, ignore_errors=True)


main()
print('\n=== RESULTADO ===')
print('  FALHAS: ' + (', '.join(falhas) if falhas else 'NENHUMA'))
sys.exit(1 if falhas else 0)
