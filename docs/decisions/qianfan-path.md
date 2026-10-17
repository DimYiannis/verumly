# Qianfan path (ISSUES #11, #12)

- `QIANFAN_URL` is the server base URL; `chatCompletionsUrl()` appends `/v1/chat/completions` once, tolerating trailing slashes and a full URL. Default `http://127.0.0.1:8000`.
- 408 and 429 are transient (extractor throws a plain Error, so the existing job retry/backoff applies); other 4xx stay permanent.
- `modelRevision` = `QIANFAN_REVISION` else `"unknown"`; the served model name / response `model` is never used.
- `QIANFAN_API_KEY` optional, sent as `Authorization: Bearer`, never logged. Pair with `vllm serve --api-key`.
- `tools/qianfan/colab_serve.ipynb`: vLLM (float16, T4) + cloudflared quick tunnel; if the revision field is empty it pins the model repo's current HEAD sha and prints it.
- Corpus: `loadCorpus({ only: 'mock' })` forces the mock corpus. Worker test helpers use it and a recorded extractor on `fixtures/receipts-nl/mock`. receipt-nl corpus/eval tests deliberately keep real-if-present (they measure the corpus).
- Seed: `loadSeedCorpus` uses the real corpus only with >= 3 receipts that have truth + image (hash-checked) + recording (`MIN_REAL_FOR_SEED`), else mock; it prints which. Seed reads the corpus dir from `env.FIXTURES_DIR`.
