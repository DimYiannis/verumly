import { z } from 'zod';

/**
 * Receipt template: how a merchant wants its receipts to look in the wallet (a layout, not content).
 * Pure presentation, strict everywhere: static text only (rendered as text, never as HTML), no buyer data,
 * no remote URLs (the logo is an inline image).
 */

/** Blocks the merchant can add, move, style and hide. */
export const TEMPLATE_BLOCK_TYPES = ['logo', 'merchantName', 'merchantIds', 'text', 'divider', 'spacer', 'lines', 'vatTable', 'totals', 'payment', 'fiscal'] as const;
export const templateBlockType = z.enum(TEMPLATE_BLOCK_TYPES);
export type TemplateBlockType = z.infer<typeof templateBlockType>;

/**
 * Blocks that carry legally required content on every receipt: they can be moved and styled but not removed.
 * (Which fields a country needs is in `@lr/compliance`; these blocks are where they are printed.)
 */
export const LOCKED_BLOCK_TYPES: readonly TemplateBlockType[] = ['merchantIds', 'lines', 'vatTable', 'totals', 'fiscal'];

export const TEMPLATE_FONTS = ['sans', 'serif', 'mono'] as const;
export const TEMPLATE_PAPERS = ['plain', 'thermal', 'card'] as const;
export const TEMPLATE_SIZES = ['sm', 'md', 'lg', 'xl'] as const;
export const TEMPLATE_ALIGNS = ['left', 'center', 'right'] as const;

export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
/** Inline raster image only (no SVG: it can carry script). About 150 KB of base64. */
export const LOGO_DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
export const MAX_LOGO_CHARS = 200_000;
export const MAX_TEMPLATE_BLOCKS = 30;
export const MAX_TEMPLATE_TEXT = 280;

export const templateBlock = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9-]{1,40}$/),
    type: templateBlockType,
    align: z.enum(TEMPLATE_ALIGNS).default('left'),
    size: z.enum(TEMPLATE_SIZES).default('md'),
    bold: z.boolean().default(false),
    /** hex colour override for this block, or null for the template text colour */
    color: z.string().regex(HEX_COLOR_RE).nullable().default(null),
    /** the static text of a `text` block (ignored by other types) */
    text: z.string().max(MAX_TEMPLATE_TEXT).default(''),
    hidden: z.boolean().default(false),
  })
  .strict();
export type TemplateBlock = z.infer<typeof templateBlock>;

export const receiptTemplate = z
  .object({
    version: z.literal(1),
    style: z
      .object({
        accent: z.string().regex(HEX_COLOR_RE).default('#3338B8'),
        text: z.string().regex(HEX_COLOR_RE).default('#14152B'),
        background: z.string().regex(HEX_COLOR_RE).default('#FDFCFA'),
        font: z.enum(TEMPLATE_FONTS).default('sans'),
        paper: z.enum(TEMPLATE_PAPERS).default('card'),
      })
      .strict()
      .default({ accent: '#3338B8', text: '#14152B', background: '#FDFCFA', font: 'sans', paper: 'card' }),
    logo: z.string().max(MAX_LOGO_CHARS).regex(LOGO_DATA_URL_RE).nullable().default(null),
    blocks: z.array(templateBlock).min(1).max(MAX_TEMPLATE_BLOCKS),
  })
  .strict()
  .superRefine((tpl, ctx) => {
    const ids = new Set<string>();
    for (const [i, b] of tpl.blocks.entries()) {
      if (ids.has(b.id)) ctx.addIssue({ code: 'custom', path: ['blocks', i, 'id'], message: 'duplicate block id' });
      ids.add(b.id);
    }
    for (const type of LOCKED_BLOCK_TYPES) {
      const block = tpl.blocks.find((b) => b.type === type);
      if (!block) ctx.addIssue({ code: 'custom', path: ['blocks'], message: `the ${type} block is required by law and cannot be removed` });
      else if (block.hidden) ctx.addIssue({ code: 'custom', path: ['blocks'], message: `the ${type} block is required by law and cannot be hidden` });
    }
  });
export type ReceiptTemplate = z.infer<typeof receiptTemplate>;

let seq = 0;
const block = (type: TemplateBlockType, over: Partial<TemplateBlock> = {}): TemplateBlock => ({
  id: `${type}-${++seq}`,
  type,
  align: 'left',
  size: 'md',
  bold: false,
  color: null,
  text: '',
  hidden: false,
  ...over,
});

/** The template every organisation starts with (and what the wallet draws when none was saved). */
export function defaultReceiptTemplate(): ReceiptTemplate {
  seq = 0;
  return {
    version: 1,
    style: { accent: '#3338B8', text: '#14152B', background: '#FDFCFA', font: 'sans', paper: 'card' },
    logo: null,
    blocks: [
      block('logo', { align: 'center' }),
      block('merchantName', { align: 'center', size: 'xl', bold: true }),
      block('merchantIds', { align: 'center', size: 'sm' }),
      block('divider'),
      block('lines'),
      block('divider'),
      block('totals', { size: 'lg', bold: true }),
      block('vatTable', { size: 'sm' }),
      block('payment', { size: 'sm' }),
      block('fiscal', { size: 'sm', align: 'center' }),
      block('text', { align: 'center', text: 'Thank you for your visit' }),
    ],
  };
}
