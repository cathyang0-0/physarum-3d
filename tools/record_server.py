# Receives frames from tools/record-teaser.js (running in the page) and saves them as PNGs.
# Usage: python3 tools/record_server.py [out/frames] [port 8001]
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out/frames'
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8001
os.makedirs(OUT, exist_ok=True)


class Frames(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_POST(self):  # POST /frame/<n>  body = PNG bytes
        n = int(self.path.rstrip('/').split('/')[-1])
        data = self.rfile.read(int(self.headers['Content-Length']))
        with open(os.path.join(OUT, f'frame_{n:04d}.png'), 'wb') as f:
            f.write(data)
        self.send_response(200)
        self.cors()
        self.end_headers()

    def log_message(self, *args):
        pass


print(f'saving frames to {OUT}/ on http://localhost:{PORT}')
ThreadingHTTPServer(('', PORT), Frames).serve_forever()
