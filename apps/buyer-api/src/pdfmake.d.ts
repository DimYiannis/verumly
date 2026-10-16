declare module 'pdfmake' {
  interface PdfDocument {
    getBuffer(): Promise<Uint8Array>;
  }
  interface PdfMake {
    setFonts(fonts: Record<string, { normal: string; bold: string; italics: string; bolditalics: string }>): void;
    createPdf(definition: object): PdfDocument;
  }
  const pdfmake: PdfMake;
  export default pdfmake;
}
