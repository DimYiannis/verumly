# Demo photos

Photos that are read in demo mode (`EXTRACTOR=recorded`) because a real Qianfan answer for exactly these bytes is
recorded in `fixtures/receipts-nl/<sha256>.qianfan.json`. They are not part of the evaluation corpus (no truth file).

| File | Receipt | Recorded answer | Result in the wallet |
|---|---|---|---|
| `lidl-demo.png` | Lidl Amsterdam Bezaanjachtplein, 21-08-2026 16:37, €34,22, 11 lines | `62a8d71f7f279ae6e278ad46aea3452c0f567949010dc9a8db0246068ea9562c.qianfan.json` (revision `623bf5d2…`, served on a T4, float16) | **Needs a check**: lines and total match; the Lidl/PLUS-style VAT table is not parsed yet (`docs/ISSUES.md`) |

**Keep the bytes identical.** The recorded extractor finds an answer by the SHA-256 of the uploaded file, not by its
name. Do not re-save, crop, recompress or convert the file.

- The wallet uploads a PNG that is already cropped to the receipt and at most 2000 px **unchanged**; a JPEG is always
  re-encoded in the browser, so a JPEG can never match a recording.
- On a phone, pick the file through **Files**, not the photo library (which may convert it), and do not send it through
  a messenger that recompresses images.

To add another demo photo: crop it to the receipt as a PNG (≤ 2000 px), check that `planPhoto` in
`apps/wallet/app/utils/prepare-photo.ts` keeps it (`keepOriginal`), run it once through the live server
(`httpExtractor`, `EXTRACTOR=http`), and save the answer as `fixtures/receipts-nl/<sha256>.qianfan.json`.
