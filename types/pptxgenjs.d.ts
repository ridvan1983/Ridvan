declare module 'pptxgenjs' {
  export interface PptxGenJsSlide {
    addText(text: string, options?: Record<string, unknown>): void;
  }

  export default class PptxGenJS {
    layout?: string;
    addSlide(): PptxGenJsSlide;
    write(type: 'arraybuffer' | string): Promise<ArrayBuffer>;
  }
}
