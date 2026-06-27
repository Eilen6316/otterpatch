/** 线性图标集(Lucide 风格,stroke=currentColor)。全站不用 emoji。 */
import type { ReactNode } from 'react';

function Svg({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
type P = { size?: number };

export const IconGrid = (p: P) => (
  <Svg size={p.size}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18M3 15h18M12 3v18" />
  </Svg>
);
export const IconSelect = (p: P) => (
  <Svg size={p.size}>
    <path d="M5 3a2 2 0 0 0-2 2M19 3a2 2 0 0 1 2 2M21 19a2 2 0 0 1-2 2M5 21a2 2 0 0 1-2-2M9 3h1M14 3h1M9 21h1M14 21h1M3 9v1M21 9v1M3 14v1M21 14v1" />
  </Svg>
);
export const IconArrow = (p: P) => (
  <Svg size={p.size}>
    <path d="M5 12h14M12 5l7 7-7 7" />
  </Svg>
);
export const IconStrike = (p: P) => (
  <Svg size={p.size}>
    <path d="M16 4H9a3 3 0 0 0-2.83 4M14 12a4 4 0 0 1 0 8H6M4 12h16" />
  </Svg>
);
export const IconPencil = (p: P) => (
  <Svg size={p.size}>
    <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Svg>
);
export const IconHelp = (p: P) => (
  <Svg size={p.size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
    <path d="M12 17h.01" />
  </Svg>
);
export const IconFilter = (p: P) => (
  <Svg size={p.size}>
    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
  </Svg>
);
export const IconFlag = (p: P) => (
  <Svg size={p.size}>
    <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <path d="M4 22v-7" />
  </Svg>
);
export const IconSigma = (p: P) => (
  <Svg size={p.size}>
    <path d="M18 7V4H6l6 8-6 8h12v-3" />
  </Svg>
);
export const IconPaperclip = (p: P) => (
  <Svg size={p.size}>
    <path d="M21.4 11 12.2 20.2a6 6 0 0 1-8.5-8.5l8.6-8.6a4 4 0 0 1 5.7 5.7l-8.5 8.5a2 2 0 0 1-2.9-2.8l8.5-8.5" />
  </Svg>
);
export const IconImage = (p: P) => (
  <Svg size={p.size}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
  </Svg>
);
export const IconClock = (p: P) => (
  <Svg size={p.size}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Svg>
);
export const IconSend = (p: P) => (
  <Svg size={p.size}>
    <path d="m22 2-7 20-4-9-9-4 20-7z" />
    <path d="M22 2 11 13" />
  </Svg>
);
export const IconChevron = (p: P) => (
  <Svg size={p.size}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const IconSearch = (p: P) => (
  <Svg size={p.size}>
    <circle cx="11" cy="11" r="7" />
    <path d="m21 21-4.3-4.3" />
  </Svg>
);
export const IconDots = (p: P) => (
  <Svg size={p.size}>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </Svg>
);
export const IconUndo = (p: P) => (
  <Svg size={p.size}>
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg size={p.size}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
);
export const IconX = (p: P) => (
  <Svg size={p.size}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Svg>
);
export const IconDoc = (p: P) => (
  <Svg size={p.size}>
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg size={p.size}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);


/* ── 功能区图标(工作流产出,统一规格)+ 功能名→图标映射 ── */
export const IconClipboard = (p: P) => (
  <Svg size={p.size}><rect x="8" y="3" width="8" height="4" rx="1.2"/><path d="M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2"/></Svg>
);
export const IconScissors = (p: P) => (
  <Svg size={p.size}><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></Svg>
);
export const IconCopy = (p: P) => (
  <Svg size={p.size}><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></Svg>
);
export const IconFormatBrush = (p: P) => (
  <Svg size={p.size}><path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/></Svg>
);
export const IconBorders = (p: P) => (
  <Svg size={p.size}><rect x="4" y="4" width="16" height="16" rx="1"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="4" y1="12" x2="20" y2="12"/></Svg>
);
export const IconFillColor = (p: P) => (
  <Svg size={p.size}><path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z"/><path d="m5 2 5 5"/><path d="M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z" fill="currentColor"/></Svg>
);
export const IconFontColor = (p: P) => (
  <Svg size={p.size}><path d="M5.5 16 10 5l4.5 11"/><line x1="7" y1="12.5" x2="13" y2="12.5"/><rect x="4" y="18.5" width="16" height="2.5" rx="0.6" fill="currentColor"/></Svg>
);
export const IconStrikethrough = (p: P) => (
  <Svg size={p.size}><circle cx="5.5" cy="13" r="2.1"/><line x1="7.6" y1="11" x2="7.6" y2="15.5"/><line x1="10.2" y1="8" x2="10.2" y2="15.5"/><circle cx="12.4" cy="13.4" r="2.1"/><path d="M19 11.5a2.2 2.2 0 1 0 0 3.6"/><line x1="3" y1="13" x2="21" y2="13"/></Svg>
);
export const IconSuperscript = (p: P) => (
  <Svg size={p.size}><line x1="3.5" y1="18" x2="11.5" y2="9"/><line x1="3.5" y1="9" x2="11.5" y2="18"/><path d="M14.9 5.5a1.6 1.6 0 0 1 3.1 .7c0 1-1 1.6-1.8 2.2L14.8 10H18.2"/></Svg>
);
export const IconSubscript = (p: P) => (
  <Svg size={p.size}><line x1="3.5" y1="6" x2="11.5" y2="15"/><line x1="3.5" y1="15" x2="11.5" y2="6"/><path d="M14.9 15.1a1.6 1.6 0 0 1 3.1 .7c0 1-1 1.6-1.8 2.2L14.8 19.6H18.2"/></Svg>
);
export const IconHighlighter = (p: P) => (
  <Svg size={p.size}><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></Svg>
);
export const IconFontGrow = (p: P) => (
  <Svg size={p.size}><path d="M3.5 18 8.5 5l5 13"/><line x1="5" y1="14" x2="12" y2="14"/><line x1="19" y1="19" x2="19" y2="8"/><polyline points="16 11 19 8 22 11"/></Svg>
);
export const IconFontShrink = (p: P) => (
  <Svg size={p.size}><path d="M4 18 8 9.5l4 8.5"/><line x1="5.5" y1="15" x2="10.5" y2="15"/><line x1="19" y1="8" x2="19" y2="19"/><polyline points="16 16 19 19 22 16"/></Svg>
);
export const IconClearFormat = (p: P) => (
  <Svg size={p.size}><path d="M3 18 6 9l3 9"/><line x1="4" y1="15" x2="8" y2="15"/><polygon points="11 17 16 12 20.5 16.5 15.5 21.5"/><line x1="13.25" y1="14.75" x2="17.75" y2="19.25"/></Svg>
);
export const IconPhonetic = (p: P) => (
  <Svg size={p.size}><line x1="7.5" y1="6.5" x2="9.5" y2="6.5"/><line x1="11" y1="6.5" x2="13" y2="6.5"/><line x1="14.5" y1="6.5" x2="16.5" y2="6.5"/><line x1="10.5" y1="11" x2="13.5" y2="11"/><line x1="7.5" y1="13.5" x2="16.5" y2="13.5"/><line x1="13" y1="13.5" x2="8" y2="20"/><line x1="11" y1="13.5" x2="16" y2="20"/></Svg>
);
export const IconAlignLeft = (p: P) => (
  <Svg size={p.size}><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="10" x2="15" y2="10"/><line x1="3" y1="14" x2="19" y2="14"/><line x1="3" y1="18" x2="13" y2="18"/></Svg>
);
export const IconAlignCenter = (p: P) => (
  <Svg size={p.size}><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="10" x2="18" y2="10"/><line x1="4" y1="14" x2="20" y2="14"/><line x1="7" y1="18" x2="17" y2="18"/></Svg>
);
export const IconAlignRight = (p: P) => (
  <Svg size={p.size}><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="10" x2="21" y2="10"/><line x1="5" y1="14" x2="21" y2="14"/><line x1="11" y1="18" x2="21" y2="18"/></Svg>
);
export const IconAlignJustify = (p: P) => (
  <Svg size={p.size}><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="3" y1="14" x2="21" y2="14"/><line x1="3" y1="18" x2="21" y2="18"/></Svg>
);
export const IconAlignTop = (p: P) => (
  <Svg size={p.size}><line x1="3" y1="4" x2="21" y2="4"/><line x1="7" y1="4" x2="7" y2="15"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="17" y1="4" x2="17" y2="12"/></Svg>
);
export const IconWrapText = (p: P) => (
  <Svg size={p.size}><line x1="3" y1="6" x2="21" y2="6"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="16 16 14 18 16 20"/><line x1="3" y1="18" x2="10" y2="18"/></Svg>
);
export const IconMergeCenter = (p: P) => (
  <Svg size={p.size}><rect x="2" y="7" width="20" height="10" rx="1.5"/><line x1="4" y1="12" x2="10" y2="12"/><polyline points="8 10 10 12 8 14"/><line x1="20" y1="12" x2="14" y2="12"/><polyline points="16 10 14 12 16 14"/></Svg>
);
export const IconIndentIncrease = (p: P) => (
  <Svg size={p.size}><line x1="21" y1="6" x2="10" y2="6"/><line x1="21" y1="12" x2="10" y2="12"/><line x1="21" y1="18" x2="10" y2="18"/><polyline points="3 8 7 12 3 16"/></Svg>
);
export const IconIndentDecrease = (p: P) => (
  <Svg size={p.size}><line x1="21" y1="6" x2="10" y2="6"/><line x1="21" y1="12" x2="10" y2="12"/><line x1="21" y1="18" x2="10" y2="18"/><polyline points="7 8 3 12 7 16"/></Svg>
);
export const IconLineSpacing = (p: P) => (
  <Svg size={p.size}><line x1="10" y1="5" x2="21" y2="5"/><line x1="10" y1="10" x2="21" y2="10"/><line x1="10" y1="14" x2="21" y2="14"/><line x1="10" y1="19" x2="21" y2="19"/><line x1="5" y1="4" x2="5" y2="20"/><polyline points="3 6 5 4 7 6"/><polyline points="3 18 5 20 7 18"/></Svg>
);
export const IconCurrency = (p: P) => (
  <Svg size={p.size}><line x1="7" y1="5" x2="12" y2="12"/><line x1="17" y1="5" x2="12" y2="12"/><line x1="12" y1="12" x2="12" y2="19"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="16" x2="16" y2="16"/></Svg>
);
export const IconPercent = (p: P) => (
  <Svg size={p.size}><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></Svg>
);
export const IconThousands = (p: P) => (
  <Svg size={p.size}><line x1="3.5" y1="8" x2="3.5" y2="15"/><path d="M6 13c1 .3 1.1 1.7 0 2.8"/><circle cx="10" cy="11.5" r="2.3"/><circle cx="15" cy="11.5" r="2.3"/><circle cx="19.5" cy="11.5" r="2.3"/></Svg>
);
export const IconDecimalIncrease = (p: P) => (
  <Svg size={p.size}><circle cx="4" cy="16" r="1.1" fill="currentColor"/><circle cx="8.5" cy="14.5" r="2.2"/><circle cx="13" cy="14.5" r="2.2"/><line x1="19" y1="18" x2="19" y2="8"/><polyline points="16.5 11 19 8 21.5 11"/></Svg>
);
export const IconDecimalDecrease = (p: P) => (
  <Svg size={p.size}><circle cx="4" cy="16" r="1.1" fill="currentColor"/><circle cx="8.5" cy="14.5" r="2.2"/><circle cx="13" cy="14.5" r="2.2"/><line x1="19" y1="7" x2="19" y2="17"/><polyline points="16.5 14 19 17 21.5 14"/></Svg>
);
export const IconCondFormat = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="10" y1="4" x2="10" y2="20"/><line x1="3" y1="12" x2="21" y2="12"/><circle cx="6.5" cy="8" r="1.5" fill="currentColor"/><circle cx="6.5" cy="16" r="1.5" fill="currentColor"/></Svg>
);
export const IconFormatTable = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="18" height="14" rx="1.5"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="13.5" x2="21" y2="13.5"/><line x1="9" y1="4" x2="9" y2="18"/><line x1="15" y1="4" x2="15" y2="18"/><line x1="13.5" y1="21.5" x2="21.5" y2="13.5"/></Svg>
);
export const IconCellStyle = (p: P) => (
  <Svg size={p.size}><rect x="3" y="12" width="9" height="9" rx="1.5"/><line x1="3" y1="16.5" x2="12" y2="16.5"/><line x1="7.5" y1="12" x2="7.5" y2="21"/><line x1="21" y1="3" x2="16.5" y2="7.5"/><path d="M13.5 10.5l3-3 3 3-3 3z"/></Svg>
);
export const IconInsertCell = (p: P) => (
  <Svg size={p.size}><rect x="3" y="3" width="14" height="14" rx="1.5"/><line x1="3" y1="7.7" x2="17" y2="7.7"/><line x1="3" y1="12.3" x2="17" y2="12.3"/><line x1="7.7" y1="3" x2="7.7" y2="17"/><line x1="12.3" y1="3" x2="12.3" y2="17"/><line x1="19" y1="16" x2="19" y2="22"/><line x1="16" y1="19" x2="22" y2="19"/></Svg>
);
export const IconDeleteCell = (p: P) => (
  <Svg size={p.size}><rect x="3" y="3" width="14" height="14" rx="1.5"/><line x1="3" y1="7.7" x2="17" y2="7.7"/><line x1="3" y1="12.3" x2="17" y2="12.3"/><line x1="7.7" y1="3" x2="7.7" y2="17"/><line x1="12.3" y1="3" x2="12.3" y2="17"/><line x1="16.7" y1="16.7" x2="21.5" y2="21.5"/><line x1="21.5" y1="16.7" x2="16.7" y2="21.5"/></Svg>
);
export const IconGear = (p: P) => (
  <Svg size={p.size}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></Svg>
);
export const IconFillDown = (p: P) => (
  <Svg size={p.size}><polyline points="8 7 12 11 16 7"/><line x1="12" y1="3" x2="12" y2="11"/><rect x="5" y="14" width="14" height="7" rx="1"/></Svg>
);
export const IconEraser = (p: P) => (
  <Svg size={p.size}><path d="M7 21l-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><line x1="22" y1="21" x2="7" y2="21"/><line x1="5" y1="11" x2="14" y2="20"/></Svg>
);
export const IconPivot = (p: P) => (
  <Svg size={p.size}><rect x="3" y="3" width="18" height="18" rx="1.5"/><path d="M3 3h6v6H3z" fill="currentColor"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="15" y1="9" x2="15" y2="21"/><line x1="3" y1="15" x2="21" y2="15"/></Svg>
);
export const IconTable = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="18" height="16" rx="1.5"/><line x1="3" y1="9.3" x2="21" y2="9.3"/><line x1="3" y1="14.6" x2="21" y2="14.6"/><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/></Svg>
);
export const IconShapes = (p: P) => (
  <Svg size={p.size}><circle cx="6.8" cy="7" r="3.6"/><rect x="13.4" y="3.4" width="7.2" height="7.2" rx="1"/><polygon points="12 13 19.5 21 4.5 21"/></Svg>
);
export const IconStar = (p: P) => (
  <Svg size={p.size}><polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3"/></Svg>
);
export const IconSmartArt = (p: P) => (
  <Svg size={p.size}><rect x="9" y="3" width="6" height="5" rx="1"/><rect x="3" y="16" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="6" y1="12" x2="6" y2="16"/><line x1="18" y1="12" x2="18" y2="16"/></Svg>
);
export const IconScreenshot = (p: P) => (
  <Svg size={p.size}><path d="M4 8V5a1 1 0 0 1 1-1h3"/><path d="M16 4h3a1 1 0 0 1 1 1v3"/><path d="M20 16v3a1 1 0 0 1-1 1h-3"/><path d="M8 20H5a1 1 0 0 1-1-1v-3"/><rect x="9.5" y="9.5" width="5" height="5" rx="0.5"/></Svg>
);
export const IconBarChart = (p: P) => (
  <Svg size={p.size}><polyline points="3 4 3 21 21 21"/><rect x="6" y="11" width="3" height="10"/><rect x="11" y="7" width="3" height="14"/><rect x="16" y="14" width="3" height="7"/></Svg>
);
export const IconLineChart = (p: P) => (
  <Svg size={p.size}><polyline points="3 4 3 21 21 21"/><polyline points="6 15 10 10 14 13 19 6"/></Svg>
);
export const IconPieChart = (p: P) => (
  <Svg size={p.size}><circle cx="12" cy="12" r="9"/><line x1="12" y1="12" x2="12" y2="3"/><line x1="12" y1="12" x2="19.8" y2="16.5"/></Svg>
);
export const IconSlicer = (p: P) => (
  <Svg size={p.size}><rect x="3" y="3" width="18" height="18" rx="2"/><polygon points="7 7 17 7 13 11.5 13 17 11 17 11 11.5"/></Svg>
);
export const IconTimeline = (p: P) => (
  <Svg size={p.size}><rect x="3" y="8" width="18" height="8" rx="1.5"/><line x1="9" y1="8" x2="9" y2="16"/><line x1="15" y1="8" x2="15" y2="16"/><rect x="9" y="8" width="6" height="8" fill="currentColor"/></Svg>
);
export const IconTextBox = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M9.5 15.5 L12 8.5 L14.5 15.5"/><line x1="10.5" y1="12.8" x2="13.5" y2="12.8"/></Svg>
);
export const IconHeaderFooter = (p: P) => (
  <Svg size={p.size}><rect x="5" y="3" width="14" height="18" rx="1.5"/><rect x="7.5" y="6" width="9" height="1.6" rx="0.4" fill="currentColor"/><rect x="7.5" y="16.4" width="9" height="1.6" rx="0.4" fill="currentColor"/></Svg>
);
export const IconWordArt = (p: P) => (
  <Svg size={p.size}><path d="M6.5 18 L12.5 5 L16.5 18"/><line x1="8.8" y1="13" x2="15" y2="13"/><path d="M5 20 Q9.5 21.5 14 20"/></Svg>
);
export const IconObject = (p: P) => (
  <Svg size={p.size}><rect x="4" y="4" width="12" height="12" rx="1.5"/><rect x="8" y="8" width="12" height="12" rx="1.5"/></Svg>
);
export const IconRoot = (p: P) => (
  <Svg size={p.size}><path d="M4 13 L6.5 13 L9 19 L12.5 5 L20 5"/></Svg>
);
export const IconOmega = (p: P) => (
  <Svg size={p.size}><path d="M6 19 L9.5 19 C9.5 19 5 17 5 11 C5 6.5 8 4 12 4 C16 4 19 6.5 19 11 C19 17 14.5 19 14.5 19 L18 19"/></Svg>
);
export const IconLink = (p: P) => (
  <Svg size={p.size}><path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 0 10h-2"/><line x1="8" y1="12" x2="16" y2="12"/></Svg>
);
export const IconBookmark = (p: P) => (
  <Svg size={p.size}><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></Svg>
);
export const IconCrossRef = (p: P) => (
  <Svg size={p.size}><line x1="11" y1="6" x2="20" y2="6"/><line x1="11" y1="11" x2="20" y2="11"/><line x1="11" y1="16" x2="20" y2="16"/><path d="M4 20 C4 14 5 11 11 11"/><polyline points="8.5 8.8 11 11 8.5 13.2"/></Svg>
);
export const IconComment = (p: P) => (
  <Svg size={p.size}><path d="M4 5.5 A1.5 1.5 0 0 1 5.5 4 H18.5 A1.5 1.5 0 0 1 20 5.5 V14.5 A1.5 1.5 0 0 1 18.5 16 H8 L4 20 Z"/><line x1="8" y1="8.5" x2="16" y2="8.5"/><line x1="8" y1="11.5" x2="14" y2="11.5"/></Svg>
);
export const IconPalette = (p: P) => (
  <Svg size={p.size}><path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67A2.5 2.5 0 0 1 12 22z"/><circle cx="6.5" cy="11.5" r="1" fill="currentColor"/><circle cx="9.5" cy="7.5" r="1" fill="currentColor"/><circle cx="14.5" cy="7.5" r="1" fill="currentColor"/><circle cx="17.5" cy="11.5" r="1" fill="currentColor"/></Svg>
);
export const IconColorWheel = (p: P) => (
  <Svg size={p.size}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><line x1="12" y1="3" x2="12" y2="8.5"/><line x1="12" y1="15.5" x2="12" y2="21"/><line x1="3" y1="12" x2="8.5" y2="12"/><line x1="15.5" y1="12" x2="21" y2="12"/></Svg>
);
export const IconSparkle = (p: P) => (
  <Svg size={p.size}><path d="M12 4 L13.2 10.8 L20 12 L13.2 13.2 L12 20 L10.8 13.2 L4 12 L10.8 10.8 Z"/><path d="M18.5 4.5 L19 6.3 L20.8 6.8 L19 7.3 L18.5 9.1 L18 7.3 L16.2 6.8 L18 6.3 Z"/></Svg>
);
export const IconMargins = (p: P) => (
  <Svg size={p.size}><rect x="4" y="3" width="16" height="18" rx="1"/><rect x="7" y="6" width="10" height="12"/></Svg>
);
export const IconOrientation = (p: P) => (
  <Svg size={p.size}><rect x="3.5" y="5" width="9.5" height="13" rx="1.5"/><path d="M13 5.5 A7 7 0 0 1 20.5 13"/><polyline points="19 11.5 20.5 13.2 21.8 11.5"/></Svg>
);
export const IconPaperSize = (p: P) => (
  <Svg size={p.size}><rect x="6" y="4" width="12" height="16" rx="1.5"/><line x1="10" y1="16" x2="15" y2="11"/><polyline points="12.2 11 15 11 15 13.8"/><polyline points="10 13.2 10 16 12.8 16"/></Svg>
);
export const IconPrintArea = (p: P) => (
  <Svg size={p.size}><polyline points="3 6.5 3 3 6.5 3"/><polyline points="17.5 3 21 3 21 6.5"/><polyline points="3 17.5 3 21 6.5 21"/><polyline points="17.5 21 21 21 21 17.5"/><path d="M8.5 10.5 V8 H15.5 V10.5"/><rect x="6.5" y="10.5" width="11" height="5" rx="1"/><rect x="9" y="13.5" width="6" height="4"/></Svg>
);
export const IconSeparator = (p: P) => (
  <Svg size={p.size}><line x1="4" y1="5" x2="20" y2="5"/><line x1="4" y1="8" x2="16" y2="8"/><line x1="4" y1="12" x2="7" y2="12"/><line x1="10" y1="12" x2="14" y2="12"/><line x1="17" y1="12" x2="20" y2="12"/><line x1="4" y1="16" x2="20" y2="16"/><line x1="4" y1="19" x2="16" y2="19"/></Svg>
);
export const IconBackground = (p: P) => (
  <Svg size={p.size}><rect x="5" y="3" width="14" height="18" rx="1.5"/><circle cx="9" cy="8" r="1.4"/><path d="M5 19 L10 13 L13.5 16.5 L16 14 L19 18"/></Svg>
);
export const IconGridlines = (p: P) => (
  <Svg size={p.size}><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="7.5" x2="21" y2="7.5"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="16.5" x2="21" y2="16.5"/><line x1="7.5" y1="3" x2="7.5" y2="21"/><line x1="12" y1="3" x2="12" y2="21"/><line x1="16.5" y1="3" x2="16.5" y2="21"/></Svg>
);
export const IconFx = (p: P) => (
  <Svg size={p.size}><path d="M11 19 L11 9 C11 6.5 12.2 5 14.5 5.5"/><line x1="7" y1="11" x2="12" y2="11"/><line x1="14" y1="13" x2="19" y2="19"/><line x1="19" y1="13" x2="14" y2="19"/></Svg>
);
export const IconFinance = (p: P) => (
  <Svg size={p.size}><rect x="4" y="4" width="16" height="16" rx="2"/><line x1="4" y1="9" x2="20" y2="9"/><line x1="12" y1="11" x2="12" y2="18.5"/><path d="M14.5 12 C13.5 11.2 10 11 10 13 C10 14.8 14 14.2 14 16.2 C14 18.2 10.5 18 9.5 17"/></Svg>
);
export const IconLogic = (p: P) => (
  <Svg size={p.size}><circle cx="5" cy="12" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="19" cy="18" r="2"/><path d="M7 12 C12 12 13 6 17 6"/><path d="M7 12 C12 12 13 18 17 18"/></Svg>
);
export const IconTextFunc = (p: P) => (
  <Svg size={p.size}><path d="M6 6 C4 8.5 4 15.5 6 18"/><path d="M18 6 C20 8.5 20 15.5 18 18"/><line x1="8.5" y1="17" x2="11.5" y2="7"/><line x1="14.5" y1="17" x2="11.5" y2="7"/><line x1="9.3" y1="13" x2="13.7" y2="13"/></Svg>
);
export const IconDateTime = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="12" height="12" rx="2"/><line x1="6.5" y1="2.5" x2="6.5" y2="5.5"/><line x1="11.5" y1="2.5" x2="11.5" y2="5.5"/><line x1="3" y1="8" x2="15" y2="8"/><circle cx="16.5" cy="16.5" r="5"/><line x1="16.5" y1="13.5" x2="16.5" y2="16.5"/><line x1="16.5" y1="16.5" x2="19" y2="18"/></Svg>
);
export const IconLookup = (p: P) => (
  <Svg size={p.size}><rect x="3" y="3" width="12" height="12" rx="1.5"/><line x1="3" y1="7.5" x2="15" y2="7.5"/><line x1="3" y1="11.25" x2="15" y2="11.25"/><line x1="9" y1="3" x2="9" y2="15"/><circle cx="15.5" cy="15.5" r="4"/><line x1="18.4" y1="18.4" x2="21" y2="21"/></Svg>
);
export const IconMath = (p: P) => (
  <Svg size={p.size}><circle cx="12" cy="12" r="7"/><line x1="7" y1="12" x2="17" y2="12"/></Svg>
);
export const IconNameManager = (p: P) => (
  <Svg size={p.size}><path d="M4 4 L4 11 C4 11.5 4.2 12 4.6 12.4 L11.6 19.4 C12.4 20.2 13.6 20.2 14.4 19.4 L19.4 14.4 C20.2 13.6 20.2 12.4 19.4 11.6 L12.4 4.6 C12 4.2 11.5 4 11 4 Z"/><circle cx="7.5" cy="7.5" r="1.3"/></Svg>
);
export const IconShowFormula = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/></Svg>
);
export const IconErrorCheck = (p: P) => (
  <Svg size={p.size}><path d="M12 4 L21 19 L3 19 Z"/><line x1="12" y1="10" x2="12" y2="14"/><circle cx="12" cy="16.8" r="0.7" fill="currentColor"/></Svg>
);
export const IconGetData = (p: P) => (
  <Svg size={p.size}><path d="M5 5 C5 3.9 8.1 3 12 3 C15.9 3 19 3.9 19 5 C19 6.1 15.9 7 12 7 C8.1 7 5 6.1 5 5 Z"/><path d="M5 5 V11 C5 12.1 8.1 13 12 13 C15.9 13 19 12.1 19 11 V5"/><line x1="12" y1="14.5" x2="12" y2="20.5"/><polyline points="8.5 17 12 20.5 15.5 17"/></Svg>
);
export const IconFromText = (p: P) => (
  <Svg size={p.size}><path d="M7 3 H13 L19 9 V19 C19 20.1 18.1 21 17 21 H7 C5.9 21 5 20.1 5 19 V5 C5 3.9 5.9 3 7 3 Z"/><path d="M13 3 V8 C13 8.6 13.4 9 14 9 H19"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="16.5" x2="16" y2="16.5"/><line x1="12" y1="11.5" x2="12" y2="18"/></Svg>
);
export const IconRefreshAll = (p: P) => (
  <Svg size={p.size}><path d="M3 12 A9 9 0 0 1 12 3 C14.5 3 16.8 4 18.5 5.7 L21 8"/><polyline points="21 3 21 8 16 8"/><path d="M21 12 A9 9 0 0 1 12 21 C9.5 21 7.2 20 5.5 18.3 L3 16"/><polyline points="3 21 3 16 8 16"/></Svg>
);
export const IconSortAsc = (p: P) => (
  <Svg size={p.size}><line x1="4" y1="10.5" x2="6.5" y2="3.5"/><line x1="9" y1="10.5" x2="6.5" y2="3.5"/><line x1="5" y1="8" x2="8" y2="8"/><polyline points="4.5 14 9 14 4.5 21 9 21"/><line x1="16" y1="4" x2="16" y2="19.5"/><polyline points="13 16.5 16 20 19 16.5"/></Svg>
);
export const IconSortDesc = (p: P) => (
  <Svg size={p.size}><polyline points="4.5 4 9 4 4.5 11 9 11"/><line x1="4" y1="21" x2="6.5" y2="14"/><line x1="9" y1="21" x2="6.5" y2="14"/><line x1="5" y1="18" x2="8" y2="18"/><line x1="16" y1="4" x2="16" y2="19.5"/><polyline points="13 16.5 16 20 19 16.5"/></Svg>
);
export const IconColumns = (p: P) => (
  <Svg size={p.size}><rect x="3" y="6" width="18" height="12" rx="1.5"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="5.5" y1="10" x2="9" y2="10"/><line x1="5.5" y1="14" x2="9" y2="14"/><line x1="15" y1="10" x2="18.5" y2="10"/><line x1="15" y1="14" x2="18.5" y2="14"/></Svg>
);
export const IconFlashFill = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="8" height="16" rx="1"/><line x1="3" y1="9.33" x2="11" y2="9.33"/><line x1="3" y1="14.66" x2="11" y2="14.66"/><polygon points="17 4 13 13 15.5 13 14.5 20 19 11 15.5 11"/></Svg>
);
export const IconRemoveDuplicates = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="11" height="7" rx="1.5"/><rect x="3" y="13" width="11" height="7" rx="1.5"/><line x1="16" y1="13.5" x2="21" y2="18.5"/><line x1="21" y1="13.5" x2="16" y2="18.5"/></Svg>
);
export const IconDataValidation = (p: P) => (
  <Svg size={p.size}><rect x="4" y="4" width="16" height="16" rx="2"/><polyline points="8 12.5 11 15.5 16 9"/></Svg>
);
export const IconWhatIf = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><path d="M10 12 C10 10.3 11.2 9.5 12.3 9.5 C13.7 9.5 14.8 10.4 14.8 11.9 C14.8 13.5 12.4 13.7 12.4 15.3"/><circle cx="12.4" cy="17.8" r="0.7" fill="currentColor"/></Svg>
);
export const IconSubtotal = (p: P) => (
  <Svg size={p.size}><line x1="9" y1="5" x2="20" y2="5"/><line x1="9" y1="9" x2="20" y2="9"/><line x1="9" y1="13" x2="20" y2="13"/><path d="M6 4.5 H4.5 V13.5 H6"/><line x1="4.5" y1="17.5" x2="20" y2="17.5"/></Svg>
);
export const IconSpellCheck = (p: P) => (
  <Svg size={p.size}><line x1="2.5" y1="12.5" x2="4.3" y2="5"/><line x1="6.1" y1="12.5" x2="4.3" y2="5"/><line x1="3.3" y1="9.5" x2="5.3" y2="9.5"/><line x1="8.2" y1="5" x2="8.2" y2="12.5"/><path d="M8.2 5 H10.3 C11.8 5 11.8 8.6 10.3 8.6 H8.2"/><path d="M8.2 8.6 H10.6 C12.2 8.6 12.2 12.5 10.6 12.5 H8.2"/><path d="M16.8 6.3 C15.9 5 13.4 5.1 13.4 8.75 C13.4 12.4 15.9 12.5 16.8 11.2"/><polyline points="13 16.5 16 19.5 21.5 13.5"/></Svg>
);
export const IconProtect = (p: P) => (
  <Svg size={p.size}><path d="M12 3 L20 6 V11 C20 16 16.5 19.6 12 21 C7.5 19.6 4 16 4 11 V6 Z"/><polyline points="9 12 11.3 14.3 15.5 9.5"/></Svg>
);
export const IconNormalView = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9.33" x2="21" y2="9.33"/><line x1="3" y1="14.66" x2="21" y2="14.66"/><line x1="9" y1="4" x2="9" y2="20"/><line x1="15" y1="4" x2="15" y2="20"/></Svg>
);
export const IconPageBreak = (p: P) => (
  <Svg size={p.size}><rect x="4" y="3" width="16" height="18" rx="2"/><line x1="4" y1="12" x2="8" y2="12"/><line x1="10" y1="12" x2="14" y2="12"/><line x1="16" y1="12" x2="20" y2="12"/></Svg>
);
export const IconFreeze = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="18" height="16" rx="1.5"/><line x1="3" y1="11" x2="21" y2="11"/><line x1="10" y1="4" x2="10" y2="20"/><rect x="4.8" y="7" width="3.4" height="2.6" rx="0.4"/><path d="M5.6 7 V6 C5.6 5 7.4 5 7.4 6 V7"/></Svg>
);
export const IconSplit = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="3" y1="12" x2="21" y2="12"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></Svg>
);

export const FUNC_ICONS: Record<string, (p: { size?: number }) => ReactNode> = {
  '粘贴': IconClipboard,
  '剪切': IconScissors,
  '复制': IconCopy,
  '格式刷': IconFormatBrush,
  '边框': IconBorders,
  '填充色': IconFillColor,
  '字体颜色': IconFontColor,
  '删除线': IconStrikethrough,
  '上标': IconSuperscript,
  '下标': IconSubscript,
  '突出显示': IconHighlighter,
  '增大字号': IconFontGrow,
  '减小字号': IconFontShrink,
  '清除格式': IconClearFormat,
  '拼音指南': IconPhonetic,
  '左对齐': IconAlignLeft,
  '居中对齐': IconAlignCenter,
  '右对齐': IconAlignRight,
  '两端对齐': IconAlignJustify,
  '顶端对齐': IconAlignTop,
  '自动换行': IconWrapText,
  '合并后居中': IconMergeCenter,
  '增加缩进': IconIndentIncrease,
  '减少缩进': IconIndentDecrease,
  '行距': IconLineSpacing,
  '货币': IconCurrency,
  '百分比': IconPercent,
  '千分位分隔': IconThousands,
  '增加小数位': IconDecimalIncrease,
  '减少小数位': IconDecimalDecrease,
  '条件格式': IconCondFormat,
  '套用表格格式': IconFormatTable,
  '单元格样式': IconCellStyle,
  '插入': IconInsertCell,
  '删除': IconDeleteCell,
  '格式': IconGear,
  '填充': IconFillDown,
  '清除': IconEraser,
  '数据透视表': IconPivot,
  '表格': IconTable,
  '形状': IconShapes,
  '图标': IconStar,
  'SmartArt': IconSmartArt,
  '屏幕截图': IconScreenshot,
  '柱形图': IconBarChart,
  '折线图': IconLineChart,
  '饼图': IconPieChart,
  '切片器': IconSlicer,
  '日程表': IconTimeline,
  '文本框': IconTextBox,
  '页眉页脚': IconHeaderFooter,
  '艺术字': IconWordArt,
  '对象': IconObject,
  '公式': IconRoot,
  '符号': IconOmega,
  '链接': IconLink,
  '书签': IconBookmark,
  '交叉引用': IconCrossRef,
  '批注': IconComment,
  '主题': IconPalette,
  '颜色': IconColorWheel,
  '效果': IconSparkle,
  '页边距': IconMargins,
  '纸张方向': IconOrientation,
  '纸张大小': IconPaperSize,
  '打印区域': IconPrintArea,
  '分隔符': IconSeparator,
  '背景': IconBackground,
  '网格线': IconGridlines,
  'fx插入函数': IconFx,
  '财务': IconFinance,
  '逻辑': IconLogic,
  '文本函数': IconTextFunc,
  '日期和时间': IconDateTime,
  '查找与引用': IconLookup,
  '数学和三角': IconMath,
  '名称管理器': IconNameManager,
  '显示公式': IconShowFormula,
  '错误检查': IconErrorCheck,
  '获取数据': IconGetData,
  '从文本CSV': IconFromText,
  '全部刷新': IconRefreshAll,
  '升序': IconSortAsc,
  '降序': IconSortDesc,
  '分列': IconColumns,
  '快速填充': IconFlashFill,
  '删除重复值': IconRemoveDuplicates,
  '数据验证': IconDataValidation,
  '模拟分析': IconWhatIf,
  '分类汇总': IconSubtotal,
  '拼写检查': IconSpellCheck,
  '保护工作表': IconProtect,
  '普通视图': IconNormalView,
  '分页预览': IconPageBreak,
  '冻结窗格': IconFreeze,
  '拆分': IconSplit,
  '居中': IconAlignCenter,
  '页眉和页脚': IconHeaderFooter,
  '插入函数': IconFx,
  '文本': IconTextFunc,
  '千分位': IconThousands,
  '增加小数': IconDecimalIncrease,
  '减少小数': IconDecimalDecrease,
  '从文本/CSV': IconFromText,
  '图表': IconBarChart,
  '排序': IconSortAsc,
  '文本效果': IconWordArt,
  '排序和筛选': IconFilter,
  '查找和选择': IconSearch,
  '筛选': IconFilter,
  '自动求和': IconSigma,
  '图片': IconImage,
  '查找': IconSearch,
  '替换': IconSearch,
  '选择': IconSelect,
  '折线': IconLineChart,
  '柱形': IconBarChart,
  '盈亏': IconBarChart,
  '推荐的图表': IconBarChart,
  '数据透视图': IconPivot,
  '推荐的数据透视表': IconPivot,
  '新建批注': IconComment,
  '显示批注': IconComment,
  '页眉': IconHeaderFooter,
  '页脚': IconHeaderFooter,
  '页码': IconHeaderFooter,
  '普通': IconNormalView,
};