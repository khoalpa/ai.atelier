from helpers.ai_source import read_source
"""Exercise the AI service guard over real HTTP without loading GPU models."""
import ast
import json
import sys
import threading
from pathlib import Path
from http.client import HTTPConnection
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_request_security import trusted_request

calls = []

class Handler(BaseHTTPRequestHandler):
    def reply(self, status, payload):
        data = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)
    def do_POST(self):
        self.rfile.read(int(self.headers.get('Content-Length', '0')))
        calls.append(self.path)
        self.reply(200, {'ok': True})
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
port = server.server_port
Handler.do_POST = trusted_request(port)(Handler.do_POST)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
try:
    for headers, expected in [({}, 200), ({'Origin': f'http://127.0.0.1:{port}'}, 200),
                              ({'Origin': 'https://other.example'}, 403), ({'Origin': 'null'}, 403),
                              ({'Sec-Fetch-Site': 'cross-site'}, 403), ({'Host': 'other.example'}, 403)]:
        connection = HTTPConnection('127.0.0.1', port, timeout=3)
        connection.request('POST', '/cancel-job', body='{}', headers=headers)
        response = connection.getresponse()
        assert response.status == expected
        response.read()
        connection.close()
    assert len(calls) == 2
finally:
    server.shutdown()
    server.server_close()
    thread.join()

tree = ast.parse(read_source(Path(__file__).resolve().parents[1] / 'ai_service.py', encoding='utf-8'))
handler = next(node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == 'Handler')
post = next(node for node in handler.body if isinstance(node, ast.FunctionDef) and node.name == 'do_POST')
assert ast.unparse(post.decorator_list[0]) == 'trusted_request(PORT)'
assert ast.unparse(post.decorator_list[1]) == 'serialized_inference'
print('OK: AI requests are checked before inference; foreign requests never reach the handler.')
