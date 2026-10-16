# Serving Qianfan-OCR (vLLM, OpenAI-compatible)

The worker's `EXTRACTOR=http` mode POSTs each uploaded receipt image to `QIANFAN_URL`, an OpenAI-compatible
`/v1/chat/completions` endpoint. This is how to stand one up. **Not exercised in this repo's test run** (no GPU here);
the commands follow the model card at <https://huggingface.co/baidu/Qianfan-OCR>.

## 1. Start the server

Needs a CUDA GPU (a single A100 or L4 is enough; ~4B parameters, bf16). Python 3.10+.

```bash
pip install vllm            # the model card benchmarks with vLLM 0.10.2
vllm serve baidu/Qianfan-OCR \
  --trust-remote-code \
  --hf-overrides '{"architectures": ["InternVLChatModel"]}' \
  --port 8000
```

On a T4 (no bf16) add `--dtype float16`.

Pin the model revision you evaluated, so recorded outputs can be reproduced later:

```bash
vllm serve baidu/Qianfan-OCR --revision <HF commit sha> --trust-remote-code \
  --hf-overrides '{"architectures": ["InternVLChatModel"]}'
```

Then point the worker at it:

```bash
export EXTRACTOR=http
export QIANFAN_URL=http://<gpu-host>:8000      # the worker calls <QIANFAN_URL>/v1/chat/completions
```

## 2. The request the worker sends

Two requests per image, with the two fixed prompts from `QIANFAN_PROMPTS` in `@lr/receipt-nl` (they are the prompts of
v2 Appendix A, character for character). Greedy decoding (`temperature: 0` is vLLM's equivalent of `do_sample=False`):

```bash
IMG=$(base64 < receipt.jpg | tr -d '\n')

# 1. markdown
curl -s "$QIANFAN_URL/v1/chat/completions" -H 'content-type: application/json' -d @- <<JSON
{
  "model": "baidu/Qianfan-OCR",
  "temperature": 0,
  "max_tokens": 2048,
  "messages": [{
    "role": "user",
    "content": [
      {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,$IMG"}},
      {"type": "text", "text": "Parse this document to Markdown."}
    ]
  }]
}
JSON

# 2. kie: same request, other prompt (the answer is stored as a raw string; receipt-nl strips code fences and parses it)
#    "text": "Extract from this Dutch receipt as JSON: merchant_name, kvk_number, btw_number, postcode, date, time, lines[{description, qty, unit_price, total, btw_rate}], btw_breakdown[{rate, base, btw}], total, rounding, payment_method. Use null for missing fields. Copy numbers exactly as printed."
```

The text of the answer is `choices[0].message.content`; the worker stores `{ markdown, kie, modelRevision }` and hands
the first two to `parseExtraction`.

Layout-as-Thought (`enable_thinking`) is left off: the model card recommends it only for heterogeneous page layouts, and a
kassabon is a single column.

## 3. Batch runs without a server

`colab_extract.ipynb` in this directory runs the same two prompts with `transformers` on Colab and writes the
`<sha256>.qianfan.json` files that `EXTRACTOR=recorded` and `pnpm eval:extraction` read.
