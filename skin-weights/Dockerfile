# The SkinTokens skin-weights service (see skin.py and server.py). The model is baked into the
# image at a pinned revision rather than fetched at start: 2.3 GB from Hugging Face on every cold
# start would be slower than Cloud Run streaming the image, and would put a third party in the path.
#
# Two stages so the image holds only what runs: the build stage downloads the fp32 export and turns
# the four small graphs to int8 (`quantize.py`, which says why not the decoder); the final stage
# copies the result. Replacing files in a later layer of one stage would still ship the originals.
FROM python:3.12-slim AS model

ARG MODEL_REVISION=4506d42f83760bef2d29008ed14f5b77d0123706
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /model
RUN for f in mesh_cond.onnx vae_cond.onnx embed.onnx skin_decode.onnx decoder.onnx decoder.onnx.data; do \
      curl -fsSL -o "$f" "https://huggingface.co/fernandotonon/QtMeshEditor-skintokens-onnx/resolve/${MODEL_REVISION}/$f"; \
    done
COPY requirements.txt quantize.py /build/
RUN pip install --no-cache-dir -r /build/requirements.txt onnx==1.17.0 \
 && python /build/quantize.py /model \
 && for f in mesh_cond vae_cond embed skin_decode; do mv "/model/$f.onnx.q8" "/model/$f.onnx"; done

FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY --from=model /model /model
COPY skin.py server.py ./
ENV MODEL_DIR=/model PYTHONUNBUFFERED=1
CMD ["python", "server.py"]
