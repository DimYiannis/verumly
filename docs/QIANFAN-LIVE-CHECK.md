# Qianfan live check: findings and open issues

> **Temporary file. Delete it once the open issues below are resolved** (issues 1 to 5), together with ISSUES #25 and #26 in `docs/ISSUES.md`. The lasting record of the live check stays in the "Live Qianfan check" section of `docs/FINDINGS.md`.

Run on 2026-10-17 against `baidu/Qianfan-OCR` on a Google Colab T4 (vLLM 0.31.0, model revision `623bf5d20d446abdb36606aa4547cd0c18886fe5`), reached through a Cloudflare quick tunnel with an API key. Branch `feat/qianfan-photo`.

This file lists what was observed and what is still open. It is not an accuracy measurement: it covers two mock images and one real photo.

## What was observed

| Check | Result |
| --- | --- |
| Endpoint without key / with key | 401 / lists `baidu/Qianfan-OCR` |
| Worker extractor and parser on 2 **MOCK** images | Both `done`. Gross, VAT per rate and shop identity match the truth files. 51 s and 57 s per image. |
| Full stack (`EXTRACTOR=http`), wallet `/add`, one MOCK image | `done` after 51 s, with 8 lines carrying category and VAT rate |
| Real PLUS receipt, uncropped (1512 x 1512, receipt is a thin strip in the frame) | No result. See issue 1. |
| Same receipt cropped to the strip (430 x 1512) | Model read it in 46 s. Through the wallet: `needs_review` after 87 s. See issues 2 and 3. |

The zero-false-`done` rule held: nothing wrong reached `done`.

## Open issues

### 1. Photos where the receipt is small in the frame never finish

- **Status: mostly fixed, re-measured live.** The wallet now crops and checks the photo before upload (`apps/wallet/app/utils/photo-analysis.ts`); on the real sample the upload shrinks from 1512 x 1512 to 419 x 1512 px (about 72% fewer pixels). Measured later the same day: the prepared real photo is read in 100 s with the requests one after the other and in 62 s with them sent together; an uncropped photo never finished. Remaining: the long wait before `failed` when the model always times out.

- **What happened:** the uncropped photo made the model run longer than the worker's 120 s request timeout, and longer than Cloudflare's roughly 100 s limit (a direct request returned an HTML error page after 126 s). The upload stayed on "Reading" through all retries, for minutes, and the buyer was never told what to do.
- **Cropping fixed it:** the same receipt cropped to the strip was read in 46 s.
- **Fix ideas:**
  - Fail with a clear reason and "retake closer" advice instead of retrying for minutes.
  - Lower `max_tokens` (the extractor asks for 4096; `tools/qianfan/serve.md` shows 2048).
  - Crop or resize on the device before upload.
- Tracked as ISSUES #25.

### 2. The parser cannot read this receipt's VAT table

- **What happened:** the model read the table correctly (`BTW laag 9% 4,69 56,76`, `BTW hoog 21% 1,30 7,49`, total `5,99 / 64,50`), but the rows differ from the mock layout: the 0% row has no percent sign and the labels are `BTW laag` and `BTW hoog`. The parser reported `vat_row_unreadable` and `vat_missing_rate` and stored no VAT rows.
- **Fix:** add this layout to the corpus (it needs a hand-checked truth file) and make the table parser tolerant of it.
- Tracked as ISSUES #26.

### 3. OCR errors on a real photo

- **Total misread:** the markdown output read the printed total as `664,50` (the euro sign became a 6). The KIE output gave `64,50`. The parser stored 6450, which is right, but the two answers disagreed.
- **Garbled item names:** for example "HORLOGEEN WOEL HEIK" for the milk line.
- **Discount line lost:** the "-3,00" line was dropped, so the lines do not add up to the total (`gross_sum`).
- **Result:** `needs_review`, the correct outcome. The buyer would have to correct the lines by hand.
- **Not measured:** this is one photo. A real corpus is still needed for any accuracy figure (ISSUES, "No real receipt corpus").

### 4. The real photo is not in the repository

- `receipt.jpeg` is untracked in the repo root and is not committed.
- It shows a masked card number (`516882xxxxxx9944`).
- To use it as a fixture it would go into `fixtures/receipts-nl/` with a hand-written `<id>.truth.json` copied from what is printed. That is the owner's decision.

### 5. The Colab setup is demo-only

- The tunnel address changes on every run, and the session ends when the Colab tab closes or goes idle.
- Cloudflare's roughly 100 s edge limit constrains slow requests (see issue 1).
- A longer-lived setup needs a GPU host with a stable address (Modal, a Hugging Face endpoint, or a rented GPU).

## What changed on the way

- `tools/qianfan/colab_serve.ipynb` installs vLLM into its own virtual environment. The first attempt failed with `CUDNN_STATUS_SUBLIBRARY_VERSION_MISMATCH` in the vision encoder, caused by Colab's own CUDA libraries mixing with vLLM's. The notebook now also runs a one-second GPU convolution check before it starts the server.
- `tools/qianfan/serve.md` has a troubleshooting section for this error.
- `QIANFAN_URL` is the base URL (the worker appends `/v1/chat/completions`), 408 and 429 are retried, `QIANFAN_REVISION` sets the stored revision, and `QIANFAN_API_KEY` is optional.

## How to repeat the check

1. On Colab, with a T4 GPU runtime, run `tools/qianfan/colab_serve.ipynb`. It prints `QIANFAN_URL` and `QIANFAN_REVISION`.
2. Start the stack in a new shell. Do not commit these values.
   ```sh
   EXTRACTOR=http QIANFAN_URL=https://<name>.trycloudflare.com QIANFAN_API_KEY=<key> \
     QIANFAN_REVISION=<revision> pnpm dev --env-mode=loose
   ```
3. In the wallet, open **Add receipt** and upload a JPEG, PNG or WEBP photo, cropped close to the receipt.
