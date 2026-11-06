#!/usr/bin/env python3
"""
Monitor de Sinal TV Digital - servidor web.

Serve a pasta web/ (site + dados). Só usa a biblioteca padrão do Python 3.

Uso:
    python3 servidor.py                      # http://0.0.0.0:8080
    python3 servidor.py --porta 80 --host 0.0.0.0
Variáveis de ambiente (opcionais):
    MONITOR_PORTA, MONITOR_HOST
    MONITOR_USUARIO e MONITOR_SENHA  -> liga login simples (HTTP Basic) no site todo
"""
import argparse
import base64
import gzip
import hmac
import io
import os
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(BASE, "web")
USUARIO = os.environ.get("MONITOR_USUARIO", "")
SENHA = os.environ.get("MONITOR_SENHA", "")
COMPRIMIR = (".json", ".js", ".css", ".html", ".csv")


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".json": "application/json; charset=utf-8",
                      ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
                      ".html": "text/html; charset=utf-8"}

    def _autorizado(self):
        if not (USUARIO and SENHA):
            return True
        h = self.headers.get("Authorization", "")
        if h.startswith("Basic "):
            try:
                u, _, s = base64.b64decode(h[6:]).decode("utf-8").partition(":")
                return hmac.compare_digest(u, USUARIO) and hmac.compare_digest(s, SENHA)
            except Exception:
                return False
        return False

    def do_GET(self):
        if not self._autorizado():
            self.send_response(401)
            self.send_header("WWW-Authenticate", 'Basic realm="Monitor de Sinal", charset="UTF-8"')
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        caminho = self.translate_path(self.path)
        if os.path.isdir(caminho):
            caminho = os.path.join(caminho, "index.html")
        if (os.path.isfile(caminho) and caminho.endswith(COMPRIMIR)
                and "gzip" in self.headers.get("Accept-Encoding", "")):
            with open(caminho, "rb") as f:
                dados = gzip.compress(f.read(), 6)
            self.send_response(200)
            self.send_header("Content-Type", self.guess_type(caminho))
            self.send_header("Content-Encoding", "gzip")
            self.send_header("Content-Length", str(len(dados)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(dados)
            return
        super().do_GET()

    def do_HEAD(self):
        if not self._autorizado():
            self.send_response(401)
            self.end_headers()
            return
        super().do_HEAD()

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}", flush=True)


def main():
    ap = argparse.ArgumentParser(description="Servidor do Monitor de Sinal TV Digital")
    ap.add_argument("--porta", type=int, default=int(os.environ.get("MONITOR_PORTA", 8080)))
    ap.add_argument("--host", default=os.environ.get("MONITOR_HOST", "0.0.0.0"))
    a = ap.parse_args()
    if not os.path.isfile(os.path.join(WEB, "dados", "resumo.json")):
        print("Aviso: web/dados está vazio. Rode antes: python3 processar.py")
    srv = ThreadingHTTPServer((a.host, a.porta), partial(Handler, directory=WEB))
    print(f"Monitor de Sinal no ar: http://{a.host}:{a.porta}/" + ("  (com login)" if USUARIO and SENHA else ""), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
