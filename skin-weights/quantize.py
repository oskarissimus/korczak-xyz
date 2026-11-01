"""Build step: the four small graphs to int8 weights (dynamic quantisation of MatMul/Gemm).

Not the decoder. Measured on 1 Nov 2026 on the blacksmith and the maid: int8 everywhere ran 2x
faster but changed the decoder's greedy choices, and the maid's apron hem came apart in a walk
(the most likely bone agreed with fp32 on 53 % of her vertices). With the decoder left fp32 the
weights matched on 97-98 % and the rig was ~25 % faster (31-34 s -> 23-27 s on four cores).
"""
import sys
from onnxruntime.quantization import QuantType, quantize_dynamic

folder = sys.argv[1]
for name in ('mesh_cond', 'vae_cond', 'embed', 'skin_decode'):
    path = f'{folder}/{name}.onnx'
    quantize_dynamic(path, path + '.q8', weight_type=QuantType.QInt8, op_types_to_quantize=['MatMul', 'Gemm'])
    print(name, 'int8', flush=True)
