# Static dev server that tells the browser never to cache, so a normal reload always picks up
# edited JS modules. Usage: python3 tools/serve.py [port]   (default 8000)
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
print(f"Serving on http://localhost:{port}  (Ctrl+C to stop)")
ThreadingHTTPServer(("", port), NoCache).serve_forever()
