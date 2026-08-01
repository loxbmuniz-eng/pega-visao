#!/usr/bin/env python3
"""
Servidor de SIMULAÇÃO do Microsoft Graph — apenas para testes.

Implementa o subconjunto de endpoints que o painel usa, com um armazenamento
em memória compartilhado entre todos os clientes conectados. Serve para provar
a operação multiusuário sem depender de um tenant real da Suinco:

    GET    /v1.0/sites/{siteId}/lists/{lista}/items?expand=fields&$filter=...
    POST   /v1.0/sites/{siteId}/lists/{lista}/items
    PATCH  /v1.0/sites/{siteId}/lists/{lista}/items/{id}

NÃO é um substituto do SharePoint e não deve ser usado em produção: não tem
autenticação, não persiste em disco e implementa só o mínimo necessário.
O que ele prova é que a camada de sincronia do painel está correta — quando o
TI provisionar o ambiente real, o mesmo código passa a falar com o Graph de
verdade trocando `graphBaseUrl` de volta.

Uso:
    python3 mock_graph_server.py [porta]
"""
import json
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

PORTA = int(sys.argv[1]) if len(sys.argv) > 1 else 8899

# lista -> [ {id, fields{}} ]. Um só dicionário para todos os clientes: é
# justamente esse compartilhamento que o teste precisa exercitar.
BANCO = {}
PROXIMO_ID = {"n": 1}
TRAVA = threading.Lock()   # o servidor é multithread; escrita precisa serializar

CAMINHO = re.compile(r"^/v1\.0/sites/([^/]+)/lists/([^/]+)/items(?:/(\d+))?$")

# Só suporta o formato de filtro que o painel realmente emite:
#   fields/Campo eq 'valor'     e     fields/Campo gt 'valor'
FILTRO = re.compile(r"fields/(\w+)\s+(eq|gt)\s+'([^']*)'")


def _filtrar(itens, filtro_bruto):
    if not filtro_bruto:
        return itens
    m = FILTRO.search(unquote(filtro_bruto))
    if not m:
        return itens
    campo, op, valor = m.group(1), m.group(2), m.group(3)
    if op == "eq":
        return [i for i in itens if str(i["fields"].get(campo, "")) == valor]
    return [i for i in itens if str(i["fields"].get(campo, "")) > valor]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass  # silencia o log padrão; o teste já reporta o que importa

    def _responder(self, codigo, corpo=None):
        dados = b"" if corpo is None else json.dumps(corpo).encode()
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(dados)))
        # O painel é servido de file:// ou de outra porta durante o teste.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization,Content-Type,Accept")
        self.end_headers()
        if dados:
            self.wfile.write(dados)

    def do_OPTIONS(self):
        self._responder(204)

    def _rota(self):
        u = urlparse(self.path)
        m = CAMINHO.match(u.path)
        return (m, u) if m else (None, u)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/__admin/estado":                 # inspeção pelo teste
            with TRAVA:
                return self._responder(200, {k: len(v) for k, v in BANCO.items()})
        if u.path == "/__admin/limpar":
            with TRAVA:
                BANCO.clear()
                PROXIMO_ID["n"] = 1
            return self._responder(200, {"ok": True})

        m, u = self._rota()
        if not m:
            return self._responder(404, {"error": "rota desconhecida"})
        lista = m.group(2)
        with TRAVA:
            itens = list(BANCO.get(lista, []))
        itens = _filtrar(itens, u.query)
        self._responder(200, {"value": itens})

    def _corpo(self):
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return {}

    def do_POST(self):
        m, _ = self._rota()
        if not m:
            return self._responder(404, {"error": "rota desconhecida"})
        lista = m.group(2)
        campos = (self._corpo() or {}).get("fields", {})
        with TRAVA:
            novo = {"id": str(PROXIMO_ID["n"]), "fields": campos}
            PROXIMO_ID["n"] += 1
            BANCO.setdefault(lista, []).append(novo)
        self._responder(201, novo)

    def do_PATCH(self):
        m, _ = self._rota()
        if not m or not m.group(3):
            return self._responder(404, {"error": "id ausente"})
        lista, item_id = m.group(2), m.group(3)
        campos = (self._corpo() or {}).get("fields", {})
        with TRAVA:
            for it in BANCO.get(lista, []):
                if it["id"] == item_id:
                    it["fields"].update(campos)
                    return self._responder(200, it)
        self._responder(404, {"error": "item não encontrado"})


if __name__ == "__main__":
    srv = ThreadingHTTPServer(("127.0.0.1", PORTA), Handler)
    print(f"Graph de simulação em http://127.0.0.1:{PORTA}", flush=True)
    srv.serve_forever()
