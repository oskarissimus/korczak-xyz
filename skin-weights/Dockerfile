# The SkinTokens skin-weights service (see skin.py and server.py). The model is baked into the
# image at a pinned revision rather than fetched at start: 2.3 GB from Hugging Face on every cold
# start would be slower than Cloud Run streaming the image, and would put a third party in the path.
FROM python:3.12-slim

ARG MODEL_REVISION=4506d42f83760bef2d29008ed14f5b77d0123706
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/* \
 && mkdir /model && cd /model \
 && for f in mesh_cond.onnx vae_cond.onnx embed.onnx skin_decode.onnx decoder.onnx decoder.onnx.data; do \
      curl -fsSL -o "$f" "https://huggingface.co/fernandotonon/QtMeshEditor-skintokens-onnx/resolve/${MODEL_REVISION}/$f"; \
    done

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY skin.py server.py ./
ENV MODEL_DIR=/model PYTHONUNBUFFERED=1
CMD ["python", "server.py"]
