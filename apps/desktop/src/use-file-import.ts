import { useRef, useState, type RefObject } from 'react';
import type { BoardHandle } from './DrawioBoard.js';
import type { RichDocHandle } from './RichDoc.js';
import { docxToHtml } from './docximport.js';
import { makeFileSnapshot, type FileSnapshot } from './file-snapshot.js';

export type ImportFormat = 'excel' | 'word' | 'ppt' | 'drawio';

export interface UseFileImportOptions {
  format: ImportFormat;
  wordRef: RefObject<RichDocHandle | null>;
  boardRef: RefObject<BoardHandle | null>;
  notify: (message: string) => void;
  t: (key: string) => string;
}

export interface UseFileImportResult {
  fileB64: string;
  fileName: string;
  fileSnapshot: FileSnapshot | null;
  onFile: (file: File | undefined) => void;
  clearLoadedFile: () => void;
}

export function useFileImport({ format, wordRef, boardRef, notify, t }: UseFileImportOptions): UseFileImportResult {
  const [fileB64, setFileB64] = useState('');
  const [fileName, setFileName] = useState('');
  const [fileSnapshot, setFileSnapshot] = useState<FileSnapshot | null>(null);
  const fileLoadSeqRef = useRef(0);

  const setLoadedFile = (loadFormat: ImportFormat, name: string, b64: string): void => {
    setFileB64(b64);
    setFileName(name);
    setFileSnapshot(makeFileSnapshot(loadFormat, name, b64));
  };
  const clearLoadedFile = (): void => {
    setFileB64('');
    setFileName('');
    setFileSnapshot(null);
  };

  const onFile = (file: File | undefined): void => {
    if (!file) return;
    const loadFormat = format;
    const loadSeq = ++fileLoadSeqRef.current;
    const reader = new FileReader();
    reader.onload = () => {
      if (loadSeq !== fileLoadSeqRef.current) return;
      const res = String(reader.result);
      const b64 = res.slice(res.indexOf(',') + 1);
      if (loadFormat === 'word' && /\.docx$/i.test(file.name)) {
        try {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const imported = docxToHtml(bytes);
          wordRef.current?.loadHTML(imported.html);
          setLoadedFile(loadFormat, file.name, b64);
          notify(t('已载入并渲染') + ' · ' + file.name + (imported.skipped.length ? `(${imported.skipped.join('、')}${t('以占位显示')})` : ''));
          return;
        } catch (err) {
          setLoadedFile(loadFormat, file.name, b64);
          notify(t('已载入(渲染失败,仍可写回)') + ':' + (err instanceof Error ? err.message : String(err)));
          return;
        }
      }
      if (loadFormat === 'drawio' && /\.(drawio|xml)$/i.test(file.name)) {
        try {
          const xml = decodeURIComponent(escape(atob(b64)));
          void import('./drawio-io.js').then(({ parseDrawioFile }) => {
            if (loadSeq !== fileLoadSeqRef.current) return;
            const parsed = parseDrawioFile(xml);
            if (parsed.skipped.length) {
              clearLoadedFile();
              notify(`Drawio import blocked: ${parsed.skipped.length}/${parsed.total} page(s) could not be decoded. Exporting now would lose pages.`);
              return;
            }
            const pages = parsed.pages.filter((g) => g.nodes.length || g.edges.length);
            if (!pages.length) {
              clearLoadedFile();
              notify(t('未解析出图形(不是有效的 .drawio?)'));
              return;
            }
            boardRef.current?.loadPages(pages);
            setLoadedFile(loadFormat, file.name, b64);
            const nodes = pages.reduce((sum, g) => sum + g.nodes.length, 0);
            const edges = pages.reduce((sum, g) => sum + g.edges.length, 0);
            notify(`导入 drawio: ${pages.length} 页 / ${nodes} 节点 / ${edges} 连线`);
          }).catch((err: unknown) => {
            if (loadSeq !== fileLoadSeqRef.current) return;
            clearLoadedFile();
            notify('Drawio import failed: ' + (err instanceof Error ? err.message : String(err)));
          });
          return;
        } catch (err) {
          clearLoadedFile();
          notify(t('已载入(渲染失败)') + ':' + (err instanceof Error ? err.message : String(err)));
          return;
        }
      }
      setLoadedFile(loadFormat, file.name, b64);
      notify(t('已载入') + ' · ' + file.name);
    };
    reader.onerror = () => {
      if (loadSeq !== fileLoadSeqRef.current) return;
      clearLoadedFile();
      notify('File import failed: ' + (reader.error?.message ?? 'read failed'));
    };
    reader.readAsDataURL(file);
  };

  return { fileB64, fileName, fileSnapshot, onFile, clearLoadedFile };
}
