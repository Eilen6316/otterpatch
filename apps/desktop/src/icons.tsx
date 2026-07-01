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
export const IconRedo = (p: P) => (
  <Svg size={p.size}>
    <path d="M21 7v6h-6" />
    <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
  </Svg>
);
export const IconHorizontalRule = (p: P) => (
  <Svg size={p.size}>
    <line x1="3" y1="6" x2="21" y2="6" strokeOpacity={0.35} />
    <line x1="3" y1="12" x2="21" y2="12" />
    <line x1="3" y1="18" x2="21" y2="18" strokeOpacity={0.35} />
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

/* 功能区图标(第二批,补齐未覆盖功能)*/
export const IconZoom100Rb = (p: P) => (
  <Svg size={p.size}><circle cx="10" cy="10" r="6.5"/><line x1="14.8" y1="14.8" x2="20.5" y2="20.5"/><rect x="7.3" y="7.3" width="5.4" height="5.4" rx="0.8"/></Svg>
);
export const IconUmlRb = (p: P) => (
  <Svg size={p.size}><rect x="3" y="3" width="9" height="9" rx="1"/><line x1="3" y1="6" x2="12" y2="6"/><line x1="3" y1="9" x2="12" y2="9"/><rect x="13.5" y="13" width="7.5" height="8" rx="1"/><line x1="13.5" y1="16" x2="21" y2="16"/><line x1="12" y1="10" x2="13.5" y2="14"/></Svg>
);
export const IconWebLayoutRb = (p: P) => (
  <Svg size={p.size}><circle cx="12" cy="12" r="8.5"/><line x1="3.5" y1="12" x2="20.5" y2="12"/><path d="M12 3.5 a4.5 8.5 0 0 1 0 17 a4.5 8.5 0 0 1 0 -17"/><line x1="4.6" y1="8" x2="19.4" y2="8"/><line x1="4.6" y1="16" x2="19.4" y2="16"/></Svg>
);
export const IconLayoutRb = (p: P) => (
  <Svg size={p.size}><rect x="5" y="3" width="14" height="18" rx="1.2"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="16" x2="13" y2="16"/></Svg>
);
export const IconProtectWorkbookRb = (p: P) => (
  <Svg size={p.size}><rect x="2.5" y="3" width="11" height="11" rx="1"/><line x1="6.2" y1="3" x2="6.2" y2="14"/><line x1="9.8" y1="3" x2="9.8" y2="14"/><line x1="2.5" y1="6.7" x2="13.5" y2="6.7"/><line x1="2.5" y1="10.3" x2="13.5" y2="10.3"/><rect x="12.5" y="14.5" width="8.5" height="6.5" rx="1"/><path d="M14.5 14.5 v-1.6 a2.25 2.25 0 0 1 4.5 0 v1.6"/><circle cx="16.75" cy="17.7" r="0.9"/></Svg>
);
export const IconNumberingRb = (p: P) => (
  <Svg size={p.size}><path d="M3.2 6 L4 5.5 L4 8"/><polyline points="3,11.3 5,11.3 5,12.65 3,12.65 3,14 5,14"/><polyline points="3,16.9 5,16.9 5,18.2 3.9,18.2 5,18.2 5,19.5 3,19.5"/><line x1="8.5" y1="6.8" x2="20" y2="6.8"/><line x1="8.5" y1="12.65" x2="20" y2="12.65"/><line x1="8.5" y1="18.2" x2="20" y2="18.2"/></Svg>
);
export const IconFormulaBarRb = (p: P) => (
  <Svg size={p.size}><rect x="2" y="8.5" width="20" height="7" rx="1.2"/><line x1="8" y1="8.5" x2="8" y2="15.5"/><path d="M4 14 v-2.5 a1.3 1.3 0 0 1 2.5 0"/><line x1="4" y1="12.4" x2="6" y2="12.4"/><line x1="10.5" y1="12" x2="19" y2="12"/></Svg>
);
export const IconVariantsRb = (p: P) => (
  <Svg size={p.size}><rect x="3" y="3" width="8" height="8" rx="1" fill="currentColor"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></Svg>
);
export const IconRulerRb = (p: P) => (
  <Svg size={p.size}><rect x="2" y="8.5" width="20" height="7" rx="1.2"/><line x1="5" y1="8.5" x2="5" y2="12.2"/><line x1="7.5" y1="8.5" x2="7.5" y2="10.8"/><line x1="10" y1="8.5" x2="10" y2="12.2"/><line x1="12.5" y1="8.5" x2="12.5" y2="10.8"/><line x1="15" y1="8.5" x2="15" y2="12.2"/><line x1="17.5" y1="8.5" x2="17.5" y2="10.8"/><line x1="20" y1="8.5" x2="20" y2="12.2"/></Svg>
);
export const IconMarkEntryRb = (p: P) => (
  <Svg size={p.size}><line x1="4" y1="5" x2="20" y2="5"/><line x1="4" y1="8.5" x2="20" y2="8.5"/><path d="M9.5 11.8 h-1.8 v4.4 h1.8"/><line x1="11" y1="14" x2="13.2" y2="14"/><path d="M14.7 11.8 h1.8 v4.4 h-1.8"/><line x1="4" y1="19.7" x2="20" y2="19.7"/></Svg>
);
export const IconTableOfFiguresRb = (p: P) => (
  <Svg size={p.size}><rect x="4" y="3" width="16" height="18" rx="1.2"/><rect x="6.5" y="6" width="4" height="3.2" rx="0.4"/><path d="M6.5 9.2 l1.2 -1.4 l1 1 l1 -1.2 l0.8 1.6"/><circle cx="9.6" cy="7" r="0.5"/><line x1="12" y1="6.5" x2="17.5" y2="6.5"/><line x1="12" y1="8.7" x2="17.5" y2="8.7"/><line x1="6.5" y1="13" x2="17.5" y2="13"/><line x1="6.5" y1="16" x2="17.5" y2="16"/><line x1="6.5" y1="19" x2="14" y2="19"/></Svg>
);
export const IconFootnoteRb = (p: P) => (
  <Svg size={p.size}><rect x="4.5" y="3" width="15" height="18" rx="1.2"/><line x1="7" y1="6.5" x2="17" y2="6.5"/><line x1="7" y1="9.2" x2="15" y2="9.2"/><circle cx="16" cy="8" r="0.55" fill="currentColor"/><line x1="7" y1="13.8" x2="11" y2="13.8"/><circle cx="7.6" cy="16.2" r="0.5" fill="currentColor"/><line x1="9" y1="16.2" x2="17" y2="16.2"/><line x1="7" y1="18.6" x2="17" y2="18.6"/></Svg>
);
export const IconIndexRb = (p: P) => (
  <Svg size={p.size}><rect x="4" y="3" width="13" height="18" rx="1.2"/><line x1="6.5" y1="6.5" x2="14" y2="6.5"/><line x1="8" y1="9" x2="14" y2="9"/><line x1="8" y1="11.3" x2="14" y2="11.3"/><line x1="6.5" y1="14" x2="14" y2="14"/><line x1="8" y1="16.3" x2="14" y2="16.3"/><line x1="8" y1="18.6" x2="14" y2="18.6"/><rect x="17" y="6" width="3" height="3" rx="0.6"/><rect x="17" y="11.5" width="3" height="3" rx="0.6"/><rect x="17" y="17" width="3" height="3" rx="0.6"/></Svg>
);
export const IconCaptionRb = (p: P) => (
  <Svg size={p.size}><rect x="4" y="4" width="16" height="11" rx="1.2"/><circle cx="8" cy="8" r="1.3"/><path d="M5 14 l3.5 -4 l2.5 2.8 l3 -3.5 l4 4.7"/><line x1="6" y1="18.5" x2="18" y2="18.5"/><line x1="8" y1="21" x2="16" y2="21"/></Svg>
);
export const IconEndnoteRb = (p: P) => (
  <Svg size={p.size}><rect x="3.5" y="3" width="11.5" height="14" rx="1.2"/><rect x="8.5" y="7" width="11.5" height="14" rx="1.2"/><line x1="11" y1="11.2" x2="17.5" y2="11.2"/><line x1="11" y1="13.6" x2="17.5" y2="13.6"/><circle cx="11.5" cy="17.4" r="0.5" fill="currentColor"/><line x1="12.9" y1="17.4" x2="17.5" y2="17.4"/><line x1="11" y1="19.6" x2="17.5" y2="19.6"/></Svg>
);
export const IconCitationRb = (p: P) => (
  <Svg size={p.size}><circle cx="7" cy="9" r="1.6" fill="currentColor"/><polygon points="5.6,9.8 8.4,9.8 6.4,12.8" fill="currentColor"/><circle cx="11.4" cy="9" r="1.6" fill="currentColor"/><polygon points="10,9.8 12.8,9.8 10.8,12.8" fill="currentColor"/><line x1="5" y1="16.5" x2="19" y2="16.5"/><line x1="5" y1="19.5" x2="15" y2="19.5"/></Svg>
);
export const IconQueriesConnectRb = (p: P) => (
  <Svg size={p.size}><circle cx="8.5" cy="8.5" r="4.5"/><line x1="11.8" y1="11.8" x2="13.5" y2="13.5"/><circle cx="16" cy="15" r="1.6"/><circle cx="20" cy="19" r="1.6"/><line x1="17.2" y1="16.2" x2="18.8" y2="17.8"/></Svg>
);
export const IconVAlignMiddleRb = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="18" height="16" rx="1.5"/><line x1="6" y1="10.5" x2="18" y2="10.5"/><line x1="6" y1="13.5" x2="15" y2="13.5"/></Svg>
);
export const IconVerticalTreeRb = (p: P) => (
  <Svg size={p.size}><rect x="9" y="3" width="6" height="4" rx="1"/><rect x="3" y="16" width="6" height="4" rx="1"/><rect x="15" y="16" width="6" height="4" rx="1"/><path d="M12 7 V11 M6 11 H18 M6 11 V16 M18 11 V16"/></Svg>
);
export const IconFromCsvRb = (p: P) => (
  <Svg size={p.size}><path d="M7 3 H14 L18 7 V21 H7 Z"/><path d="M14 3 V7 H18"/><line x1="9" y1="12" x2="16" y2="12"/><line x1="9" y1="15.5" x2="16" y2="15.5"/><line x1="9" y1="19" x2="16" y2="19"/><line x1="12.5" y1="11" x2="12.5" y2="20"/></Svg>
);
export const IconFromMermaidRb = (p: P) => (
  <Svg size={p.size}><rect x="7" y="3" width="10" height="5" rx="2.5"/><path d="M12 8 V12"/><polygon points="12,12 17,16.5 12,21 7,16.5"/></Svg>
);
export const IconPrintTitlesRb = (p: P) => (
  <Svg size={p.size}><rect x="3.5" y="5" width="17" height="14" rx="1"/><rect x="3.5" y="5" width="17" height="3.8" fill="currentColor"/><rect x="3.5" y="5" width="4" height="14" fill="currentColor"/><path d="M7.5 13 H20.5 M7.5 16 H20.5 M12 9 V19 M16 9 V19"/></Svg>
);
export const IconOutlineRb = (p: P) => (
  <Svg size={p.size}><circle cx="6" cy="6" r="1" fill="currentColor"/><line x1="9" y1="6" x2="19" y2="6"/><circle cx="9" cy="10.5" r="1" fill="currentColor"/><line x1="12" y1="10.5" x2="19" y2="10.5"/><circle cx="9" cy="15" r="1" fill="currentColor"/><line x1="12" y1="15" x2="19" y2="15"/><circle cx="6" cy="19.5" r="1" fill="currentColor"/><line x1="9" y1="19.5" x2="19" y2="19.5"/></Svg>
);
export const IconSinglePageRb = (p: P) => (
  <Svg size={p.size}><rect x="7" y="3" width="10" height="18" rx="1.5"/><line x1="9.5" y1="8" x2="14.5" y2="8"/><line x1="9.5" y1="11" x2="14.5" y2="11"/><line x1="9.5" y1="14" x2="14.5" y2="14"/></Svg>
);
export const IconNavPaneRb = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="18" height="16" rx="1.5"/><line x1="9" y1="4" x2="9" y2="20"/><line x1="5" y1="8" x2="7" y2="8"/><line x1="5" y1="11.5" x2="7" y2="11.5"/><line x1="5" y1="15" x2="7" y2="15"/></Svg>
);
export const IconAlignBottomRb = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="18" height="16" rx="1.5"/><line x1="6" y1="13.5" x2="18" y2="13.5"/><line x1="6" y1="16.5" x2="15" y2="16.5"/></Svg>
);
export const IconShadingRb = (p: P) => (
  <Svg size={p.size}><rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M5 12 L12 5 M5 16 L16 5 M5 19 L19 5 M9 19 L19 9 M13 19 L19 13"/></Svg>
);
export const IconAlignTopRb = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="18" height="16" rx="1.5"/><line x1="6" y1="7.5" x2="18" y2="7.5"/><line x1="6" y1="10.5" x2="15" y2="10.5"/></Svg>
);
export const IconDefineNameRb = (p: P) => (
  <Svg size={p.size}><path d="M8 4.5 H20 V15.5 H8 L3 10 Z"/><circle cx="7" cy="10" r="1.2"/><line x1="11" y1="10" x2="16.5" y2="10"/></Svg>
);
export const IconSpaceAfterRb = (p: P) => (
  <Svg size={p.size}><path d="M5 6 H19 M5 9 H19 M5 12 H14"/><path d="M12 16 V21 M9 18.5 L12 21 L15 18.5"/></Svg>
);
export const IconSpaceBeforeRb = (p: P) => (
  <Svg size={p.size}><path d="M12 3 V8 M9 5.5 L12 3 L15 5.5"/><path d="M5 12 H19 M5 15 H19 M5 18 H14"/></Svg>
);
export const IconHyphenationRb = (p: P) => (
  <Svg size={p.size}><line x1="4" y1="7" x2="13" y2="7"/><line x1="15" y1="7" x2="19" y2="7"/><line x1="4" y1="12" x2="11" y2="12"/><line x1="4" y1="17" x2="19" y2="17"/></Svg>
);
export const IconAlignRb = (p: P) => (
  <Svg size={p.size}><line x1="4" y1="3" x2="4" y2="21"/><rect x="4" y="5.5" width="12" height="4.5" rx="0.8"/><rect x="4" y="14" width="8" height="4.5" rx="0.8"/></Svg>
);
export const IconMultilevelListRb = (p: P) => (
  <Svg size={p.size}><circle cx="4" cy="6" r="0.9" fill="currentColor"/><line x1="7" y1="6" x2="20" y2="6"/><circle cx="8" cy="11" r="0.9" fill="currentColor"/><line x1="11" y1="11" x2="20" y2="11"/><circle cx="12" cy="16" r="0.9" fill="currentColor"/><line x1="15" y1="16" x2="20" y2="16"/></Svg>
);
export const IconMultiPageRb = (p: P) => (
  <Svg size={p.size}><rect x="8" y="3.5" width="11" height="14" rx="1"/><rect x="5" y="6.5" width="11" height="14" rx="1"/><line x1="7.5" y1="11" x2="13.5" y2="11"/><line x1="7.5" y1="14" x2="13.5" y2="14"/><line x1="7.5" y1="17" x2="11.5" y2="17"/></Svg>
);
export const IconPageBreakRb = (p: P) => (
  <Svg size={p.size}><rect x="5" y="3" width="14" height="18" rx="1"/><line x1="8" y1="6.5" x2="16" y2="6.5"/><line x1="8" y1="9" x2="13" y2="9"/><line x1="7" y1="12.5" x2="9" y2="12.5"/><line x1="11" y1="12.5" x2="13" y2="12.5"/><line x1="15" y1="12.5" x2="17" y2="12.5"/><line x1="8" y1="16" x2="16" y2="16"/><line x1="8" y1="18.5" x2="13" y2="18.5"/></Svg>
);
export const IconCoverPageRb = (p: P) => (
  <Svg size={p.size}><rect x="5" y="3" width="14" height="18" rx="1"/><line x1="8" y1="7" x2="16" y2="7"/><rect x="8" y="10" width="8" height="5" rx="0.5"/><line x1="8" y1="17.5" x2="14" y2="17.5"/></Svg>
);
export const IconHeightRb = (p: P) => (
  <Svg size={p.size}><line x1="4" y1="4" x2="20" y2="4"/><line x1="4" y1="20" x2="20" y2="20"/><line x1="12" y1="6" x2="12" y2="18"/><polyline points="9 9 12 6 15 9"/><polyline points="9 15 12 18 15 15"/></Svg>
);
export const IconAdvancedRb = (p: P) => (
  <Svg size={p.size}><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/><circle cx="9" cy="7" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="11" cy="17" r="2"/></Svg>
);
export const IconGridPaperRb = (p: P) => (
  <Svg size={p.size}><rect x="4" y="4" width="16" height="16" rx="1"/><line x1="8" y1="4" x2="8" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/><line x1="16" y1="4" x2="16" y2="20"/><line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="16" x2="20" y2="16"/></Svg>
);
export const IconCreateFromSelectionRb = (p: P) => (
  <Svg size={p.size}><path d="M4 7V4h3"/><path d="M11 4h3v3"/><path d="M4 11v3h3"/><path d="M11 14h3v-3"/><line x1="6.5" y1="8" x2="11.5" y2="8"/><line x1="6.5" y1="10.5" x2="9.5" y2="10.5"/><line x1="18" y1="16" x2="18" y2="20"/><line x1="16" y1="18" x2="20" y2="18"/></Svg>
);
export const IconUpdateTocRb = (p: P) => (
  <Svg size={p.size}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/><line x1="8.5" y1="10.5" x2="15.5" y2="10.5"/><line x1="8.5" y1="12" x2="13" y2="12"/><line x1="8.5" y1="13.5" x2="15.5" y2="13.5"/></Svg>
);
export const IconUpdateIndexRb = (p: P) => (
  <Svg size={p.size}><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/><line x1="12" y1="10" x2="12" y2="14"/><line x1="8.5" y1="10.8" x2="10.6" y2="10.8"/><line x1="13.4" y1="10.8" x2="15.5" y2="10.8"/><line x1="8.5" y1="13.2" x2="10.6" y2="13.2"/><line x1="13.4" y1="13.2" x2="15.5" y2="13.2"/></Svg>
);
export const IconEvaluateFormulaRb = (p: P) => (
  <Svg size={p.size}><rect x="3" y="7" width="18" height="10" rx="1.5"/><line x1="6" y1="10.5" x2="9.5" y2="10.5"/><line x1="6" y1="13.5" x2="9.5" y2="13.5"/><polygon points="12.5 9.8 17.5 12 12.5 14.2"/></Svg>
);
export const IconManageSourcesRb = (p: P) => (
  <Svg size={p.size}><rect x="4" y="4" width="3.4" height="12" rx="0.6"/><rect x="8.2" y="4" width="3.4" height="12" rx="0.6"/><line x1="4" y1="7" x2="7.4" y2="7"/><line x1="8.2" y1="7" x2="11.6" y2="7"/><circle cx="16" cy="15" r="3.3"/><line x1="18.4" y1="17.4" x2="20.8" y2="19.8"/></Svg>
);
export const IconConsolidateRb = (p: P) => (
  <Svg size={p.size}><rect x="3" y="3.5" width="6.5" height="6" rx="1"/><rect x="3" y="14" width="6.5" height="6" rx="1"/><rect x="15" y="8.5" width="6" height="7" rx="1"/><path d="M9.5 6.5H13V12H15"/><path d="M9.5 17H13V12"/><polyline points="13.3 10.3 15.3 12 13.3 13.7"/></Svg>
);
export const IconWrapTextRb = (p: P) => (
  <Svg size={p.size}><rect x="4" y="5" width="6" height="6" rx="0.5"/><line x1="12" y1="6" x2="20" y2="6"/><line x1="12" y1="9" x2="20" y2="9"/><line x1="4" y1="14" x2="20" y2="14"/><line x1="4" y1="17" x2="20" y2="17"/><line x1="4" y1="20" x2="16" y2="20"/></Svg>
);
export const IconSlideSizeRb = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="14" height="9" rx="1"/><line x1="3" y1="16.5" x2="17" y2="16.5"/><polyline points="5 14.8 3 16.5 5 18.2"/><polyline points="15 14.8 17 16.5 15 18.2"/><line x1="20" y1="4" x2="20" y2="13"/><polyline points="18.3 6 20 4 21.7 6"/><polyline points="18.3 11 20 13 21.7 11"/></Svg>
);
export const IconCalcSheetRb = (p: P) => (
  <Svg size={p.size}><rect x="3.5" y="3" width="17" height="18" rx="2"/><line x1="3.5" y1="9" x2="20.5" y2="9"/><line x1="12" y1="9" x2="12" y2="21"/><line x1="6" y1="14" x2="9.5" y2="14"/><line x1="6" y1="17.5" x2="9.5" y2="17.5"/><line x1="14.5" y1="15.8" x2="18" y2="15.8"/></Svg>
);
export const IconCalcOptionsRb = (p: P) => (
  <Svg size={p.size}><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></Svg>
);
export const IconAcceptRb = (p: P) => (
  <Svg size={p.size}><circle cx="12" cy="12" r="9"/><polyline points="8 12.5 11 15.5 16.5 9"/></Svg>
);
export const IconSectionRb = (p: P) => (
  <Svg size={p.size}><rect x="5" y="3" width="14" height="18" rx="2"/><line x1="8" y1="7.5" x2="16" y2="7.5"/><line x1="8" y1="10" x2="13.5" y2="10"/><line x1="5" y1="13" x2="19" y2="13"/><line x1="5" y1="14.4" x2="19" y2="14.4"/><line x1="8" y1="17.5" x2="16" y2="17.5"/></Svg>
);
export const IconRejectRb = (p: P) => (
  <Svg size={p.size}><circle cx="12" cy="12" r="9"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></Svg>
);
export const IconCalcNowRb = (p: P) => (
  <Svg size={p.size}><rect x="5" y="2.5" width="14" height="19" rx="2.5"/><rect x="8" y="5.5" width="8" height="3.5" rx="0.8"/><circle cx="9" cy="13" r="1"/><circle cx="12" cy="13" r="1"/><circle cx="15" cy="13" r="1"/><circle cx="9" cy="16.5" r="1"/><circle cx="12" cy="16.5" r="1"/><circle cx="15" cy="16.5" r="1"/></Svg>
);
export const IconBlankPageRb = (p: P) => (
  <Svg size={p.size}><path d="M14 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V7.5z"/><path d="M14 3v4.5h4.5"/></Svg>
);
export const IconQuickStylesRb = (p: P) => (
  <Svg size={p.size}><line x1="4" y1="8" x2="13.5" y2="8"/><line x1="4" y1="12" x2="11.5" y2="12"/><line x1="4" y1="16" x2="14" y2="16"/><path d="M18.5 4.2l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="currentColor"/></Svg>
);
export const IconWidthRb = (p: P) => (
  <Svg size={p.size}><line x1="4" y1="5" x2="4" y2="19"/><line x1="20" y1="5" x2="20" y2="19"/><line x1="6.5" y1="12" x2="17.5" y2="12"/><polyline points="9 9 6.5 12 9 15"/><polyline points="15 9 17.5 12 15 15"/></Svg>
);
export const IconFromTableRangeRb = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="15" height="15" rx="1"/><line x1="3" y1="9" x2="18" y2="9"/><line x1="3" y1="14" x2="18" y2="14"/><line x1="8" y1="4" x2="8" y2="19"/><line x1="13" y1="4" x2="13" y2="19"/><rect x="8" y="9" width="5" height="5" fill="currentColor"/></Svg>
);
export const IconColumnsRb = (p: P) => (
  <Svg size={p.size}><rect x="3.5" y="3.5" width="17" height="17" rx="2"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="5.5" y1="8" x2="10" y2="8"/><line x1="5.5" y1="12" x2="10" y2="12"/><line x1="5.5" y1="16" x2="10" y2="16"/><line x1="14" y1="8" x2="18.5" y2="8"/><line x1="14" y1="12" x2="18.5" y2="12"/><line x1="14" y1="16" x2="18.5" y2="16"/></Svg>
);
export const IconConnectorRb = (p: P) => (
  <Svg size={p.size}><rect x="2.5" y="2.5" width="6" height="5" rx="1"/><rect x="15.5" y="16.5" width="6" height="5" rx="1"/><line x1="8" y1="7" x2="16" y2="17"/></Svg>
);
export const IconFlowchartRb = (p: P) => (
  <Svg size={p.size}><rect x="8.5" y="2.5" width="7" height="4.5" rx="0.8"/><rect x="2.5" y="13" width="7" height="4.5" rx="0.8"/><rect x="14.5" y="13" width="7" height="4.5" rx="0.8"/><path d="M12 7v3"/><path d="M6 13v-3h12v3"/></Svg>
);
export const IconTemplateRb = (p: P) => (
  <Svg size={p.size}><rect x="4" y="3" width="16" height="18" rx="2"/><rect x="7" y="6.5" width="10" height="3" rx="0.6" fill="currentColor"/><rect x="7" y="12" width="4.3" height="5.5" rx="0.6"/><rect x="12.7" y="12" width="4.3" height="5.5" rx="0.6"/></Svg>
);
export const IconTocRb = (p: P) => (
  <Svg size={p.size}><line x1="4" y1="6" x2="14" y2="6"/><line x1="17.5" y1="6" x2="20" y2="6"/><line x1="6" y1="11" x2="14.5" y2="11"/><line x1="17.5" y1="11" x2="20" y2="11"/><line x1="4" y1="16" x2="13" y2="16"/><line x1="17.5" y1="16" x2="20" y2="16"/></Svg>
);
export const IconArrangeRb = (p: P) => (
  <Svg size={p.size}><rect x="3" y="6.5" width="7.5" height="7.5" rx="1"/><circle cx="16.5" cy="10.5" r="3.8"/><line x1="2.5" y1="18" x2="21.5" y2="18"/></Svg>
);
export const IconSpellingRb = (p: P) => (
  <Svg size={p.size}><polyline points="4 11 8 15 15 6"/><path d="M4 19q1.5 -2 3 0 t3 0 t3 0 t3 0"/></Svg>
);
export const IconMoreFunctionsRb = (p: P) => (
  <Svg size={p.size}><path d="M4 4v16h16"/><path d="M6 17C9 17 10 9 13 9S17 11 19 7"/></Svg>
);
export const IconSignatureLineRb = (p: P) => (
  <Svg size={p.size}><path d="M9 16c1 -3 2 -3 2.5 -1.2s-.6 3.2 .3 3.2 2 -4.2 3.2 -4.2 1.4 2.2 2.5 2.2"/><path d="M3.5 16l2.5 2.5m0 -2.5l-2.5 2.5"/><line x1="3" y1="19" x2="21" y2="19"/></Svg>
);
export const IconUngroupRb = (p: P) => (
  <Svg size={p.size}><rect x="2" y="7" width="6.5" height="10" rx="1"/><rect x="15.5" y="7" width="6.5" height="10" rx="1"/><path d="M12 12H9.3m0 0l1.7 -1.7M9.3 12l1.7 1.7"/><path d="M12 12h2.7m0 0l-1.7 -1.7M14.7 12l-1.7 1.7"/></Svg>
);
export const IconArrangeAllRb = (p: P) => (
  <Svg size={p.size}><rect x="2.5" y="4" width="8.5" height="16" rx="1.5"/><rect x="13" y="4" width="8.5" height="16" rx="1.5"/><line x1="2.5" y1="8" x2="11" y2="8"/><line x1="13" y1="8" x2="21.5" y2="8"/></Svg>
);
export const IconPreviousRb = (p: P) => (
  <Svg size={p.size}><line x1="6" y1="4.5" x2="18" y2="4.5"/><polyline points="7 13 12 8 17 13"/><line x1="12" y1="8" x2="12" y2="20"/></Svg>
);
export const IconBringForwardRb = (p: P) => (
  <Svg size={p.size}><rect x="9" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="9" width="8" height="8" rx="1.5" fill="currentColor"/><line x1="20" y1="16" x2="20" y2="8"/><polyline points="18 10 20 8 22 10"/></Svg>
);
export const IconFormatBackgroundRb = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M5 13l5 -5M8 17l9 -9M13 18l6 -6"/></Svg>
);
export const IconVideoRb = (p: P) => (
  <Svg size={p.size}><rect x="3" y="5" width="18" height="14" rx="2"/><polygon points="10 9 16 12 10 15" fill="currentColor"/></Svg>
);
export const IconDropCapRb = (p: P) => (
  <Svg size={p.size}><path d="M3 13L6.5 4L10 13"/><line x1="4.3" y1="10" x2="8.7" y2="10"/><line x1="13" y1="5.5" x2="21" y2="5.5"/><line x1="13" y1="10.5" x2="21" y2="10.5"/><line x1="3" y1="16" x2="21" y2="16"/><line x1="3" y1="20" x2="21" y2="20"/></Svg>
);
export const IconBibliographyRb = (p: P) => (
  <Svg size={p.size}><path d="M12 7C10 5.3 7.3 4.5 4 4.5V18c3.3 0 6 .8 8 2.5"/><path d="M12 7c2 -1.7 4.7 -2.5 8 -2.5V18c-3.3 0 -6 .8 -8 2.5"/></Svg>
);
export const IconPropertiesRb = (p: P) => (
  <Svg size={p.size}><rect x="4" y="3" width="16" height="18" rx="1.5"/><rect x="7" y="6.5" width="2.6" height="2.6" rx="0.5" fill="currentColor"/><line x1="11" y1="7.8" x2="17" y2="7.8"/><rect x="7" y="11.7" width="2.6" height="2.6" rx="0.5" fill="currentColor"/><line x1="11" y1="13" x2="17" y2="13"/><rect x="7" y="16.9" width="2.6" height="2.6" rx="0.5" fill="currentColor"/><line x1="11" y1="18.2" x2="17" y2="18.2"/></Svg>
);
export const IconCenterHorizontalRb = (p: P) => (
  <Svg size={p.size}><line x1="12" y1="2.5" x2="12" y2="21.5"/><rect x="5" y="6.5" width="14" height="4" rx="1"/><rect x="8" y="13.5" width="8" height="4" rx="1"/></Svg>
);
export const IconHorizontalTreeRb = (p: P) => (
  <Svg size={p.size}><rect x="2" y="9" width="6" height="6" rx="1"/><rect x="16" y="3" width="6" height="5" rx="1"/><rect x="16" y="9.5" width="6" height="5" rx="1"/><rect x="16" y="16" width="6" height="5" rx="1"/><path d="M8 12h4M12 5.5v13M12 5.5h4M12 12h4M12 18.5h4"/></Svg>
);
export const IconZoomRb = (p: P) => (
  <Svg size={p.size}><circle cx="11" cy="11" r="7"/><line x1="16" y1="16" x2="21" y2="21"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></Svg>
);
export const IconZoomScaleRb = (p: P) => (
  <Svg size={p.size}><circle cx="10" cy="10" r="6.5"/><line x1="14.6" y1="14.6" x2="20" y2="20"/><circle cx="7.6" cy="7.6" r="1"/><circle cx="12.4" cy="12.4" r="1"/><line x1="12.8" y1="7.2" x2="7.2" y2="12.8"/></Svg>
);
export const IconZoomSelectionRb = (p: P) => (
  <Svg size={p.size}><path d="M3 7V3H7"/><path d="M17 3H21V7"/><path d="M3 17V21H7"/><path d="M21 17V21H17"/><circle cx="11" cy="11" r="3"/><line x1="13.2" y1="13.2" x2="15.6" y2="15.6"/></Svg>
);
export const IconAddNodeRb = (p: P) => (
  <Svg size={p.size}><circle cx="9" cy="9" r="5"/><line x1="12.7" y1="12.7" x2="14" y2="14"/><line x1="17" y1="14" x2="17" y2="20"/><line x1="14" y1="17" x2="20" y2="17"/></Svg>
);
export const IconAddTextRb = (p: P) => (
  <Svg size={p.size}><polyline points="5 17 9 7 13 17"/><line x1="6.4" y1="13.5" x2="11.6" y2="13.5"/><line x1="18.5" y1="8" x2="18.5" y2="14"/><line x1="15.5" y1="11" x2="21.5" y2="11"/></Svg>
);
export const IconGeneralRb = (p: P) => (
  <Svg size={p.size}><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.8"/><line x1="16.5" y1="12" x2="18.5" y2="12"/><line x1="12" y1="16.5" x2="12" y2="18.5"/><line x1="3.5" y1="12" x2="5.5" y2="12"/><line x1="12" y1="3.5" x2="12" y2="5.5"/><line x1="15.2" y1="15.2" x2="16.6" y2="16.6"/><line x1="8.8" y1="15.2" x2="7.4" y2="16.6"/><line x1="8.8" y1="8.8" x2="7.4" y2="7.4"/><line x1="15.2" y1="8.8" x2="16.6" y2="7.4"/></Svg>
);
export const IconPositionRb = (p: P) => (
  <Svg size={p.size}><path d="M12 21C16 16 18.5 12.5 18.5 9A6.5 6.5 0 1 0 5.5 9C5.5 12.5 8 16 12 21Z"/><circle cx="12" cy="9" r="2.3"/></Svg>
);
export const IconDocPartsRb = (p: P) => (
  <Svg size={p.size}><path d="M6 3H13L18 8V21H6Z"/><path d="M13 3V8H18"/><rect x="8.5" y="12" width="7" height="4.5" rx="0.5" fill="currentColor"/></Svg>
);
export const IconTextDirectionRb = (p: P) => (
  <Svg size={p.size}><polyline points="3 16 6.5 6 10 16"/><line x1="4.3" y1="12.8" x2="8.7" y2="12.8"/><line x1="16" y1="6" x2="16" y2="16"/><polyline points="13.5 13.5 16 16.5 18.5 13.5"/></Svg>
);
export const IconNextItemRb = (p: P) => (
  <Svg size={p.size}><polygon points="8 5 17 12 8 19"/><line x1="19" y1="5" x2="19" y2="19"/></Svg>
);
export const IconNextFootnoteRb = (p: P) => (
  <Svg size={p.size}><line x1="4" y1="11" x2="11" y2="11"/><line x1="6" y1="6" x2="6" y2="10"/><line x1="5" y1="7" x2="6" y2="6"/><line x1="4" y1="14.5" x2="13" y2="14.5"/><line x1="4" y1="18" x2="10" y2="18"/><line x1="18" y1="7" x2="18" y2="16"/><polyline points="15.5 13.5 18 16.5 20.5 13.5"/></Svg>
);
export const IconSendBackwardRb = (p: P) => (
  <Svg size={p.size}><rect x="4" y="4" width="10" height="10" rx="1"/><rect x="10" y="10" width="10" height="10" rx="1"/><line x1="9" y1="6.5" x2="9" y2="11.5"/><polyline points="6.8 9.3 9 11.7 11.2 9.3"/></Svg>
);
export const IconShowNotesRb = (p: P) => (
  <Svg size={p.size}><rect x="5" y="4" width="14" height="7" rx="1"/><line x1="5" y1="15" x2="19" y2="15"/><line x1="5" y1="18.5" x2="19" y2="18.5"/><line x1="5" y1="22" x2="12" y2="22"/></Svg>
);
export const IconShowMarkupRb = (p: P) => (
  <Svg size={p.size}><line x1="3" y1="6" x2="11" y2="6"/><line x1="3" y1="9.5" x2="8" y2="9.5"/><path d="M17 5L20 8L11.5 16.5L8.5 17.5L9.5 14.5Z"/><line x1="9.5" y1="14.5" x2="11.5" y2="16.5"/></Svg>
);
export const IconExistingConnRb = (p: P) => (
  <Svg size={p.size}><path d="M11 8H8.5A3.5 3.5 0 0 0 8.5 15H11"/><path d="M13 15H15.5A3.5 3.5 0 0 0 15.5 8H13"/><line x1="9" y1="11.5" x2="15" y2="11.5"/></Svg>
);
export const IconLineShapeRb = (p: P) => (
  <Svg size={p.size}><line x1="5" y1="19" x2="19" y2="5"/><circle cx="5" cy="19" r="1.4"/><circle cx="19" cy="5" r="1.4"/></Svg>
);
export const IconPhotoAlbumRb = (p: P) => (
  <Svg size={p.size}><rect x="7" y="4" width="13" height="10" rx="1.5"/><rect x="4" y="8" width="14" height="12" rx="1.5"/><circle cx="7.8" cy="11.8" r="1.4"/><polyline points="4.5 19.5 8 15 10.5 17 13.5 13 17.5 18.5"/></Svg>
);
export const IconBulletsRb = (p: P) => (
  <Svg size={p.size}><circle cx="5" cy="6.5" r="1.3" fill="currentColor"/><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="5" cy="17.5" r="1.3" fill="currentColor"/><line x1="9" y1="6.5" x2="20" y2="6.5"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="17.5" x2="20" y2="17.5"/></Svg>
);
export const IconNewWindowRb = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="12" height="12" rx="1.5"/><line x1="3" y1="7.5" x2="15" y2="7.5"/><line x1="19" y1="14" x2="19" y2="21"/><line x1="15.5" y1="17.5" x2="22.5" y2="17.5"/></Svg>
);
export const IconNewSlideRb = (p: P) => (
  <Svg size={p.size}><rect x="2.5" y="5" width="13" height="9.5" rx="1.5"/><line x1="5" y1="8.5" x2="11" y2="8.5"/><line x1="19" y1="14" x2="19" y2="21"/><line x1="15.5" y1="17.5" x2="22.5" y2="17.5"/></Svg>
);
export const IconLineNumbersRb = (p: P) => (
  <Svg size={p.size}><line x1="9" y1="4.5" x2="9" y2="19.5"/><line x1="3.5" y1="7" x2="6" y2="7"/><line x1="3.5" y1="12" x2="6" y2="12"/><line x1="3.5" y1="17" x2="6" y2="17"/><line x1="11.5" y1="7" x2="20" y2="7"/><line x1="11.5" y1="12" x2="20" y2="12"/><line x1="11.5" y1="17" x2="20" y2="17"/></Svg>
);
export const IconTrackChangesRb = (p: P) => (
  <Svg size={p.size}><line x1="4" y1="6" x2="17" y2="6"/><line x1="4" y1="10" x2="12" y2="10"/><line x1="4" y1="14" x2="9" y2="14"/><path d="M18.8 9.2a1.7 1.7 0 0 1 2.4 2.4l-7.5 7.5-3.2.8.8-3.2 7.5-7.5z"/></Svg>
);
export const IconRotateRb = (p: P) => (
  <Svg size={p.size}><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 8 16 8"/></Svg>
);
export const IconSelectionPaneRb = (p: P) => (
  <Svg size={p.size}><rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="6.5" cy="9" r="0.9" fill="currentColor"/><circle cx="6.5" cy="12" r="0.9" fill="currentColor"/><circle cx="6.5" cy="15" r="0.9" fill="currentColor"/><line x1="9.5" y1="9" x2="18" y2="9"/><line x1="9.5" y1="12" x2="18" y2="12"/><line x1="9.5" y1="15" x2="18" y2="15"/></Svg>
);
export const IconStylesRb = (p: P) => (
  <Svg size={p.size}><rect x="3.5" y="4" width="17" height="16" rx="2"/><rect x="6.5" y="8" width="8" height="2.2" rx="0.6" fill="currentColor"/><line x1="6.5" y1="13" x2="17.5" y2="13"/><line x1="6.5" y1="16" x2="13.5" y2="16"/></Svg>
);
export const IconPageLayoutRb = (p: P) => (
  <Svg size={p.size}><rect x="4" y="3" width="16" height="18" rx="1.5"/><line x1="4" y1="8" x2="20" y2="8"/><line x1="12" y1="8" x2="12" y2="21"/></Svg>
);
export const IconPageViewRb = (p: P) => (
  <Svg size={p.size}><rect x="3" y="4" width="18" height="16" rx="2"/><rect x="8.5" y="7" width="7" height="10" rx="0.8"/><line x1="10" y1="10" x2="14" y2="10"/><line x1="10" y1="12.5" x2="14" y2="12.5"/></Svg>
);
export const IconShadowRb = (p: P) => (
  <Svg size={p.size}><rect x="9" y="9" width="11" height="11" rx="2" fill="currentColor"/><rect x="4" y="4" width="11" height="11" rx="2"/></Svg>
);
export const IconAudioRb = (p: P) => (
  <Svg size={p.size}><polygon points="4 9 8 9 13 5 13 19 8 15 4 15"/><path d="M16.5 9a3.5 3.5 0 0 1 0 6"/><path d="M19 6.5a7 7 0 0 1 0 11"/></Svg>
);
export const IconOrganicLayoutRb = (p: P) => (
  <Svg size={p.size}><circle cx="6" cy="8" r="2.5"/><circle cx="16.5" cy="6.5" r="2"/><circle cx="15" cy="16.5" r="2.5"/><line x1="8.4" y1="9.1" x2="12.9" y2="14.8"/><line x1="8.4" y1="7.4" x2="14.6" y2="6.7"/><line x1="15.9" y1="8.4" x2="15.3" y2="14.1"/></Svg>
);
export const IconIndentRightRb = (p: P) => (
  <Svg size={p.size}><line x1="4" y1="6" x2="20" y2="6"/><line x1="10" y1="10" x2="20" y2="10"/><line x1="10" y1="14" x2="20" y2="14"/><line x1="4" y1="18" x2="20" y2="18"/><polygon points="4 9.5 7.5 12 4 14.5" fill="currentColor"/></Svg>
);
export const IconForecastSheetRb = (p: P) => (
  <Svg size={p.size}><path d="M4 3v17h17"/><polyline points="7 16 10 12 13 14 17 9"/><path d="M17 9l4-3"/><polyline points="17.5 6 21 6 21 9.5"/></Svg>
);
export const IconRoundedCornerRb = (p: P) => (
  <Svg size={p.size}><path d="M6 21V11a5 5 0 0 1 5-5h10"/><polyline points="6 11 6 6 11 6"/><circle cx="6" cy="11" r="1.2" fill="currentColor"/><circle cx="11" cy="6" r="1.2" fill="currentColor"/></Svg>
);
export const IconCircularLayoutRb = (p: P) => (
  <Svg size={p.size}><circle cx="12" cy="12" r="2"/><circle cx="12" cy="4.5" r="1.8"/><circle cx="18.7" cy="15.5" r="1.8"/><circle cx="5.3" cy="15.5" r="1.8"/><line x1="12" y1="10" x2="12" y2="6.3"/><line x1="13.6" y1="13.2" x2="17.3" y2="14.8"/><line x1="10.4" y1="13.2" x2="6.7" y2="14.8"/></Svg>
);
export const IconReadingViewRb = (p: P) => (
  <Svg size={p.size}><path d="M12 6c-2-1.3-4.5-1.6-7-1.2v12c2.5-0.4 5-0.1 7 1.2"/><path d="M12 6c2-1.3 4.5-1.6 7-1.2v12c-2.5-0.4-5-0.1-7 1.2"/><line x1="12" y1="6" x2="12" y2="19.2"/></Svg>
);
export const IconCloudArchitectureRb = (p: P) => (
  <Svg size={p.size}><path d="M7 12h10a2.3 2.3 0 0 0 .3-4.6 3.3 3.3 0 0 0-6.3-1.3A2.6 2.6 0 0 0 7 12z"/><line x1="12" y1="12" x2="12" y2="14.5"/><line x1="6" y1="14.5" x2="18" y2="14.5"/><line x1="6" y1="14.5" x2="6" y2="16.5"/><line x1="18" y1="14.5" x2="18" y2="16.5"/><line x1="12" y1="14.5" x2="12" y2="16.5"/><rect x="4.3" y="16.5" width="3.4" height="3" rx="0.5"/><rect x="10.3" y="16.5" width="3.4" height="3" rx="0.5"/><rect x="16.3" y="16.5" width="3.4" height="3" rx="0.5"/></Svg>
);
export const IconSendToBackRb = (p: P) => (
  <Svg size={p.size}><polygon points="4.5,4.5 14.5,4.5 14.5,9 9,9 9,14.5 4.5,14.5" fill="currentColor"/><rect x="9" y="9" width="10.5" height="10.5" rx="1.4"/></Svg>
);
export const IconBringToFrontRb = (p: P) => (
  <Svg size={p.size}><rect x="4.5" y="4.5" width="10" height="10" rx="1.4"/><rect x="9" y="9" width="10.5" height="10.5" rx="1.4" fill="currentColor"/></Svg>
);
export const IconChineseLayoutRb = (p: P) => (
  <Svg size={p.size}><line x1="11" y1="3.5" x2="12.5" y2="5.5"/><line x1="6" y1="8" x2="18" y2="8"/><path d="M14 8C12 13 9 17 5.5 20"/><path d="M10.5 11C13 15 15.5 18 18.5 20"/></Svg>
);
export const IconResetRb = (p: P) => (
  <Svg size={p.size}><polyline points="1.5 4 1.5 9.5 7 9.5"/><path d="M3.8 14.5a9 9 0 1 0 2.1-9.4L1.5 9.5"/></Svg>
);
export const IconConvertSmartArtRb = (p: P) => (
  <Svg size={p.size}><rect x="9" y="3.5" width="6" height="4" rx="0.8"/><rect x="3" y="16.5" width="6" height="4" rx="0.8"/><rect x="15" y="16.5" width="6" height="4" rx="0.8"/><path d="M12 7.5v4M6 11.5h12M6 11.5v5M18 11.5v5"/></Svg>
);
export const IconTraceDependentsRb = (p: P) => (
  <Svg size={p.size}><rect x="2.5" y="9" width="6" height="6" rx="0.8"/><circle cx="5.5" cy="12" r="1.1" fill="currentColor"/><line x1="9.2" y1="12" x2="15" y2="12"/><polyline points="12.8 9.9 15 12 12.8 14.1"/><rect x="15.5" y="9" width="6" height="6" rx="0.8"/></Svg>
);
export const IconTracePrecedentsRb = (p: P) => (
  <Svg size={p.size}><rect x="2.5" y="9" width="6" height="6" rx="0.8"/><line x1="9" y1="12" x2="14.8" y2="12"/><polyline points="12.6 9.9 14.8 12 12.6 14.1"/><rect x="15.5" y="9" width="6" height="6" rx="0.8"/><circle cx="18.5" cy="12" r="1.1" fill="currentColor"/></Svg>
);
export const IconFromWebRb = (p: P) => (
  <Svg size={p.size}><circle cx="12" cy="12" r="8.5"/><line x1="3.5" y1="12" x2="20.5" y2="12"/><path d="M12 3.5c-3.2 2.3-3.2 14.7 0 17M12 3.5c3.2 2.3 3.2 14.7 0 17"/><path d="M5 8.2h14M5 15.8h14"/></Svg>
);
export const IconFreeDrawRb = (p: P) => (
  <Svg size={p.size}><path d="M17 4.2 19.8 7 11 15.8 7.5 16.8 8.5 13.3z"/><line x1="15.2" y1="6" x2="18" y2="8.8"/><path d="M4 20.5c1-1.6 2.4-2.2 3.6-1.4 1 .7 2 0 2.6-1.1"/></Svg>
);
export const IconWordCountRb = (p: P) => (
  <Svg size={p.size}><line x1="4" y1="5.5" x2="20" y2="5.5"/><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="12.5" x2="14" y2="12.5"/><path d="M5 16.5v4.5M8 16.5v4.5M11 16.5v4.5M14 16.5v4.5"/><line x1="4" y1="21.3" x2="15" y2="16.2"/></Svg>
);
export const IconGroupRb = (p: P) => (
  <Svg size={p.size}><rect x="6" y="6" width="6" height="6" rx="0.8"/><rect x="11.5" y="11.5" width="6.5" height="6.5" rx="0.8"/><rect x="2.2" y="2.2" width="2.6" height="2.6" fill="currentColor"/><rect x="19.2" y="2.2" width="2.6" height="2.6" fill="currentColor"/><rect x="2.2" y="19.2" width="2.6" height="2.6" fill="currentColor"/><rect x="19.2" y="19.2" width="2.6" height="2.6" fill="currentColor"/></Svg>
);
export const IconIndentLeftRb = (p: P) => (
  <Svg size={p.size}><line x1="4" y1="5.5" x2="20" y2="5.5"/><line x1="9.5" y1="10" x2="20" y2="10"/><line x1="9.5" y1="14" x2="20" y2="14"/><line x1="4" y1="18.5" x2="20" y2="18.5"/><polyline points="3.5 9.5 6.5 12 3.5 14.5"/></Svg>
);

// ── Word 功能区专用:去重 + 更贴合 Office 语义的图标(2026 补) ──
/** 更改大小写:Aa。 */
export const IconChangeCase = (p: P) => (
  <Svg size={p.size}><text x="12" y="16.5" textAnchor="middle" fontSize="13" fontWeight="600" fontFamily="Georgia, serif" fill="currentColor" stroke="none">Aa</text></Svg>
);
/** 文本效果:A + 星芒。 */
export const IconTextEffect = (p: P) => (
  <Svg size={p.size}><text x="3.5" y="19" fontSize="16" fontWeight="700" fill="currentColor" stroke="none">A</text><path d="M17.2 3.5l1.1 2.5 2.5 1.1-2.5 1.1-1.1 2.5-1.1-2.5-2.5-1.1 2.5-1.1z" fill="currentColor" stroke="none"/></Svg>
);
/** 带圈字符:圆圈内一个"字"。 */
export const IconEncloseChar = (p: P) => (
  <Svg size={p.size}><circle cx="12" cy="12" r="8.4"/><text x="12" y="15.6" textAnchor="middle" fontSize="9.5" fill="currentColor" stroke="none">字</text></Svg>
);
/** 替换:两行文字 + 反向箭头(交换)。 */
export const IconReplace = (p: P) => (
  <Svg size={p.size}><path d="M5 8h8"/><path d="M11 6l2.4 2-2.4 2"/><path d="M19 15.5H11"/><path d="M13 13.5l-2.4 2 2.4 2"/></Svg>
);
/** 页眉:纸张 + 顶部粗条。 */
export const IconHeader = (p: P) => (
  <Svg size={p.size}><rect x="5" y="3.5" width="14" height="17" rx="1.6"/><path d="M8 7.5h8" strokeWidth={2.4}/><path d="M8 12h8M8 15h6" opacity={0.5}/></Svg>
);
/** 页脚:纸张 + 底部粗条。 */
export const IconFooter = (p: P) => (
  <Svg size={p.size}><rect x="5" y="3.5" width="14" height="17" rx="1.6"/><path d="M8 16.5h8" strokeWidth={2.4}/><path d="M8 9h8M8 12h6" opacity={0.5}/></Svg>
);
/** 页码:纸张 + #。 */
export const IconPageNumber = (p: P) => (
  <Svg size={p.size}><rect x="5" y="3.5" width="14" height="17" rx="1.6"/><text x="12" y="15.2" textAnchor="middle" fontSize="9" fontWeight="700" fill="currentColor" stroke="none">#</text></Svg>
);
/** 加载项:购物袋(获取加载项)。 */
export const IconAddin = (p: P) => (
  <Svg size={p.size}><path d="M5.5 8h13l-1 11.5H6.5z"/><path d="M9 8V6.2a3 3 0 0 1 6 0V8"/></Svg>
);
/** 翻译:文 → A。 */
export const IconTranslate = (p: P) => (
  <Svg size={p.size}><text x="2.5" y="11" fontSize="9" fill="currentColor" stroke="none">文</text><text x="13.5" y="21" fontSize="9.5" fontWeight="600" fill="currentColor" stroke="none">A</text><path d="M12 6.2h7"/><path d="M16.5 4.2l2.6 2-2.6 2"/></Svg>
);
/** 语言:地球。 */
export const IconLanguage = (p: P) => (
  <Svg size={p.size}><circle cx="12" cy="12" r="8.2"/><path d="M3.8 12h16.4"/><path d="M12 3.8c2.3 2 3.4 5 3.4 8.2s-1.1 6.2-3.4 8.2c-2.3-2-3.4-5-3.4-8.2S9.7 5.8 12 3.8z"/></Svg>
);
/** 显示批注:气泡 + 眼睛。 */
export const IconShowComments = (p: P) => (
  <Svg size={p.size}><path d="M4 4.5h16v9.5H9.5L5.5 18v-4H4z"/><path d="M8.4 9.3c1.3-1.7 5.9-1.7 7.2 0-1.3 1.7-5.9 1.7-7.2 0z"/><circle cx="12" cy="9.3" r="1.1" fill="currentColor" stroke="none"/></Svg>
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
  '100%': IconZoom100Rb,
  'UML': IconUmlRb,
  'Web 版式': IconWebLayoutRb,
  '版式': IconLayoutRb,
  '保护工作簿': IconProtectWorkbookRb,
  '编号': IconNumberingRb,
  '编辑栏': IconFormulaBarRb,
  '变体': IconVariantsRb,
  '标尺': IconRulerRb,
  '标记条目': IconMarkEntryRb,
  '插入表目录': IconTableOfFiguresRb,
  '插入脚注': IconFootnoteRb,
  '插入索引': IconIndexRb,
  '插入题注': IconCaptionRb,
  '插入尾注': IconEndnoteRb,
  '插入引文': IconCitationRb,
  '查询和连接': IconQueriesConnectRb,
  '垂直居中': IconVAlignMiddleRb,
  '垂直树': IconVerticalTreeRb,
  '从 CSV': IconFromCsvRb,
  '从 Mermaid': IconFromMermaidRb,
  '打印标题': IconPrintTitlesRb,
  '大纲': IconOutlineRb,
  '单页': IconSinglePageRb,
  '导航窗格': IconNavPaneRb,
  '底对齐': IconAlignBottomRb,
  '底纹': IconShadingRb,
  '顶对齐': IconAlignTopRb,
  '定义名称': IconDefineNameRb,
  '段后间距': IconSpaceAfterRb,
  '段前间距': IconSpaceBeforeRb,
  '断字': IconHyphenationRb,
  '对齐': IconAlignRb,
  '多级列表': IconMultilevelListRb,
  '多页': IconMultiPageRb,
  '分页': IconPageBreakRb,
  '封面': IconCoverPageRb,
  '高度': IconHeightRb,
  '高级': IconAdvancedRb,
  '稿纸设置': IconGridPaperRb,
  '根据所选内容创建': IconCreateFromSelectionRb,
  '更新目录': IconUpdateTocRb,
  '更新索引': IconUpdateIndexRb,
  '公式求值': IconEvaluateFormulaRb,
  '管理源': IconManageSourcesRb,
  '合并计算': IconConsolidateRb,
  '环绕文字': IconWrapTextRb,
  '幻灯片大小': IconSlideSizeRb,
  '计算工作表': IconCalcSheetRb,
  '计算选项': IconCalcOptionsRb,
  '接受': IconAcceptRb,
  '节': IconSectionRb,
  '拒绝': IconRejectRb,
  '开始计算': IconCalcNowRb,
  '空白页': IconBlankPageRb,
  '快速样式': IconQuickStylesRb,
  '宽度': IconWidthRb,
  '来自表格/区域': IconFromTableRangeRb,
  '栏': IconColumnsRb,
  '连线': IconConnectorRb,
  '流程图': IconFlowchartRb,
  '模板': IconTemplateRb,
  '目录': IconTocRb,
  '排列': IconArrangeRb,
  '拼写和语法': IconSpellingRb,
  '其他函数': IconMoreFunctionsRb,
  '签名行': IconSignatureLineRb,
  '取消组合': IconUngroupRb,
  '全部重排': IconArrangeAllRb,
  '上一条': IconPreviousRb,
  '上移一层': IconBringForwardRb,
  '设置背景格式': IconFormatBackgroundRb,
  '视频': IconVideoRb,
  '首字下沉': IconDropCapRb,
  '书目': IconBibliographyRb,
  '属性': IconPropertiesRb,
  '水平居中': IconCenterHorizontalRb,
  '水平树': IconHorizontalTreeRb,
  '缩放': IconZoomRb,
  '缩放比例': IconZoomScaleRb,
  '缩放到选定区域': IconZoomSelectionRb,
  '添加节点': IconAddNodeRb,
  '添加文字': IconAddTextRb,
  '通用': IconGeneralRb,
  '位置': IconPositionRb,
  '文档部件': IconDocPartsRb,
  '文字方向': IconTextDirectionRb,
  '下一条': IconNextItemRb,
  '下一条脚注': IconNextFootnoteRb,
  '下移一层': IconSendBackwardRb,
  '显示备注': IconShowNotesRb,
  '显示标记': IconShowMarkupRb,
  '现有连接': IconExistingConnRb,
  '线条': IconLineShapeRb,
  '相册': IconPhotoAlbumRb,
  '项目符号': IconBulletsRb,
  '新建窗口': IconNewWindowRb,
  '新建幻灯片': IconNewSlideRb,
  '行号': IconLineNumbersRb,
  '修订': IconTrackChangesRb,
  '旋转': IconRotateRb,
  '选择窗格': IconSelectionPaneRb,
  '样式': IconStylesRb,
  '页面布局': IconPageLayoutRb,
  '页面视图': IconPageViewRb,
  '阴影': IconShadowRb,
  '音频': IconAudioRb,
  '有机布局': IconOrganicLayoutRb,
  '右缩进': IconIndentRightRb,
  '预测工作表': IconForecastSheetRb,
  '圆角': IconRoundedCornerRb,
  '圆形布局': IconCircularLayoutRb,
  '阅读视图': IconReadingViewRb,
  '云架构': IconCloudArchitectureRb,
  '置于底层': IconSendToBackRb,
  '置于顶层': IconBringToFrontRb,
  '中文版式': IconChineseLayoutRb,
  '重置': IconResetRb,
  '转换为 SmartArt': IconConvertSmartArtRb,
  '追踪从属单元格': IconTraceDependentsRb,
  '追踪引用单元格': IconTracePrecedentsRb,
  '自网站': IconFromWebRb,
  '自由绘制': IconFreeDrawRb,
  '字数统计': IconWordCountRb,
  '组合': IconGroupRb,
  '左缩进': IconIndentLeftRb,
};