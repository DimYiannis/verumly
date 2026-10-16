/** The two fixed Qianfan-OCR prompts (v2 Appendix A). Shared by the Colab notebook, serve.md and the worker's http extractor. */
export const QIANFAN_PROMPTS = {
  markdown: 'Parse this document to Markdown.',
  kie: 'Extract from this Dutch receipt as JSON: merchant_name, kvk_number, btw_number, postcode, date, time, lines[{description, qty, unit_price, total, btw_rate}], btw_breakdown[{rate, base, btw}], total, rounding, payment_method. Use null for missing fields. Copy numbers exactly as printed.',
} as const;
