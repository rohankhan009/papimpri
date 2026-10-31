import http.server, socketserver, json

CLIENTS = {
    "d1": {"name": "Galaxy-A05", "status": "online", "battery": 90},
    "d2": {"name": "Redmi-12", "status": "offline"},
    "d3": {"name": "Vivo-Y17", "status": "online", "battery": 44},
}
SENT = []

class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, obj):
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers()
        self.wfile.write(json.dumps(obj).encode())
    def do_GET(self):
        if self.path.startswith("/clients.json"): return self._send(CLIENTS)
        if "webhookEvent/sendSms.json" in self.path: return self._send({"isSended": True})
        self._send(None)
    def do_PUT(self):
        n = int(self.headers.get("Content-Length", 0)); body = self.rfile.read(n)
        if "webhookEvent/sendSms.json" in self.path:
            SENT.append(self.path)
        self._send(json.loads(body) if body else {})
    def do_POST(self):
        if self.path == "/__count":
            return self._send({"sent": len(SENT)})
        self._send({})

with socketserver.ThreadingTCPServer(("127.0.0.1", 9999), H) as httpd:
    httpd.daemon_threads = True
    httpd.serve_forever()
