"""
POST / : skin weights for a T-posed TRELLIS mesh on the donor's skeleton (`skin.py`).

Body (JSON): positions, joints (base64 little-endian float32, metres, +y up, facing +z), index
(base64 uint32), parents (list, -1 at the root). Answer: skinIndex (base64 uint16, 4 a vertex),
skinWeight (base64 float32, 4 a vertex), ms, timings.

Private: Cloud Run lets in only callers with `roles/run.invoker`, which is the RPG's gateway
(`rpgApi`, `functions/src/rpg/skin.ts`). The gateway checks the reader is a signed-in, approved
account and calls this with its own identity token. Each call is ~30-40 s of four vCPUs, about half
a cent, so it is never reachable from a browser directly.
"""
import base64
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

from skin import SkinTokens

MODEL = SkinTokens(os.environ.get('MODEL_DIR', '/model'))
# One at a time: the model already uses every core, and Cloud Run runs this at concurrency 1.
LOCK = threading.Lock()
MAX_VERTICES, MAX_BONES = 100_000, 64


def b64(a: np.ndarray) -> str:
    return base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()


def unb64(s: str, dtype) -> np.ndarray:
    return np.frombuffer(base64.b64decode(s), dtype=np.dtype(dtype).newbyteorder('<'))


class Handler(BaseHTTPRequestHandler):
    def answer(self, code: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.answer(200, {'ok': True})

    def do_POST(self):
        started = time.time()
        try:
            body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', '0'))))
            positions = unb64(body['positions'], np.float32).reshape(-1, 3)
            index = unb64(body['index'], np.uint32).reshape(-1, 3)
            joints = unb64(body['joints'], np.float32).reshape(-1, 3)
            parents = [int(p) for p in body['parents']]
            if not 0 < len(positions) <= MAX_VERTICES or not 0 < len(parents) <= MAX_BONES or index.max(initial=0) >= len(positions):
                return self.answer(400, {'error': 'mesh or skeleton out of bounds'})
        except Exception as e:
            return self.answer(400, {'error': f'bad request: {e}'})
        try:
            with LOCK:
                si, sw, timings = MODEL.weights(positions, index, joints, parents)
        except ValueError as e:
            return self.answer(400, {'error': str(e)})
        self.answer(200, {'skinIndex': b64(si.astype('<u2')), 'skinWeight': b64(sw.astype('<f4')), 'ms': round((time.time() - started) * 1000), 'timings': timings})

    def log_message(self, fmt, *args):
        print(fmt % args, flush=True)


if __name__ == '__main__':
    ThreadingHTTPServer(('', int(os.environ.get('PORT', '8080'))), Handler).serve_forever()
