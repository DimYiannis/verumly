# Serving Qianfan-OCR (vLLM, OpenAI-compatible)

The worker's `EXTRACTOR=http` mode POSTs each uploaded receipt image to `<QIANFAN_URL>/v1/chat/completions` (OpenAI-compatible). `QIANFAN_URL` is the server
**base URL**; a URL that already ends in `/v1/chat/completions` is accepted too. This is how to stand one up. No GPU? Use
`colab_serve.ipynb` (free Colab T4 + a `cloudflared` quick tunnel). **Not exercised in this repo's test run** (no GPU here);
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
export QIANFAN_URL=http://<gpu-host>:8000      # base URL; the worker calls <QIANFAN_URL>/v1/chat/completions
export QIANFAN_REVISION=<HF commit sha>        # recorded as modelRevision; "unknown" when unset
export QIANFAN_API_KEY=<key>                   # only if the server was started with --api-key
```

To protect a server that is reachable from the internet (e.g. a tunnel), start vLLM with `--api-key <key>`; the worker then
sends `Authorization: Bearer <key>` (never logged). Transient answers (408, 429, 5xx, network errors) are retried; other
4xx answers mark the upload failed.

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

## 3. Colab + tunnel (no local GPU)

`colab_serve.ipynb` installs vLLM, serves the model with `--dtype float16` (T4), optionally with `--api-key`, pinned with
`--revision`, opens a `cloudflared` quick tunnel and prints the base URL and revision to paste into `QIANFAN_URL` /
`QIANFAN_REVISION`. The tunnel URL changes every session; never commit it.

## 4. Batch runs without a server

`colab_extract.ipynb` in this directory runs the same two prompts with `transformers` on Colab and writes the
`<sha256>.qianfan.json` files that `EXTRACTOR=recorded` and `pnpm eval:extraction` read.

## Troubleshooting

- **`CUDNN_STATUS_SUBLIBRARY_VERSION_MISMATCH` during start-up (Colab).** Seen on a T4: vLLM crashed in the vision encoder's `conv2d`. Colab ships its own torch and CUDA libraries, and installing vLLM into the same Python mixes two cuDNN versions. `colab_serve.ipynb` therefore installs vLLM into a separate virtual environment (`/content/vllm-env`), puts that environment's cuDNN first on `LD_LIBRARY_PATH`, and runs a one-second GPU convolution check before it starts the server. On other machines, use a clean virtual environment too.
- **"Engine core initialization failed. See root cause above."** is vLLM's generic last line; the cause is further up in `vllm.log`. Skip the harmless `ERROR … fa_utils … FA2 is only supported on devices with compute capability >= 8` line (the T4 falls back to another attention backend).
