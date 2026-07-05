/*
 * OtterPatch 形状引擎:移植 drawio 参数化 stencil 语义。
 * 按节点实际 w,h 程序化重算路径(坐标直接落在 0..w×0..h),取代 40×30 viewBox + preserveAspectRatio=none;
 * 特征细节(箭头头深、折角、圆柱盖高、咬合深度等)是像素定值 + min() 钳制,不随缩放拉糊,描边永不畸变。
 * 约定:主轮廓不带 fill/stroke(外层 svg 控制);细节线自带 fill="none";donut 用 fill-rule="evenodd"。
 * 纯函数模块,零依赖。导出 shapeSvg / SHAPE_DEFS / SHAPE_ALIASES / styleToKind / roundedPoly。
 */

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** 坐标格式化:Math.round 到 0.1 精度,消 -0 */
const f = (n: number) => { const v = Math.round(n * 10) / 10; return String(v === 0 ? 0 : v); };
/** 缩放系数专用:0.1 精度太粗会导致图标偏移,保 2 位小数 */
const f2 = (n: number) => String(Math.round(n * 100) / 100);

type Pt = [number, number];
/** 顶点表 → 直角多边形路径 */
const polyD = (pts: Pt[]) => `M ${pts.map((p) => `${f(p[0])},${f(p[1])}`).join(' L ')} Z`;
const poly = (pts: Pt[]) => `<path d="${polyD(pts)}"/>`;
/** 细节线(不参与填充) */
const lines = (d: string) => `<path d="${d}" fill="none"/>`;

/** drawio mxShape.addPoints 圆角多边形:r=10px 定值,逐角被邻边半长钳制;exclude 索引处保持尖角 */
export function roundedPoly(pts: Pt[], r = 10, exclude: number[] = []): string {
  const n = pts.length;
  const first = pts[0]!, last = pts[n - 1]!;
  let d = `M ${f((last[0] + first[0]) / 2)},${f((last[1] + first[1]) / 2)}`; // 虚拟起点:末点与首点中点
  for (let i = 0; i < n; i++) {
    const P = pts[i]!, A = pts[(i - 1 + n) % n]!, B = pts[(i + 1) % n]!;
    if (exclude.includes(i)) { d += ` L ${f(P[0])},${f(P[1])}`; continue; }
    const dIn = Math.hypot(A[0] - P[0], A[1] - P[1]) || 1;
    const dOut = Math.hypot(B[0] - P[0], B[1] - P[1]) || 1;
    const r1 = Math.min(r, dIn / 2), r2 = Math.min(r, dOut / 2);
    const p1: Pt = [P[0] + ((A[0] - P[0]) / dIn) * r1, P[1] + ((A[1] - P[1]) / dIn) * r1]; // 入边收点
    const p2: Pt = [P[0] + ((B[0] - P[0]) / dOut) * r2, P[1] + ((B[1] - P[1]) / dOut) * r2]; // 出边出点
    d += ` L ${f(p1[0])},${f(p1[1])} Q ${f(P[0])},${f(P[1])} ${f(p2[0])},${f(p2[1])}`;
  }
  return d + ' Z';
}

export const LINE_ARCSIZE = 20; // rounded 圆角直径(半径 = /2 = 10px 定值)
export const RECTANGLE_ROUNDING_FACTOR = 0.15;

/* ―――― icons 组 40×30 glyph(等比 <g> 包裹,描边随 s 等比,永不畸变)―――― */
const ICON_GLYPHS: Record<string, string> = {
  user: '<circle cx="20" cy="9" r="5"/><path d="M8 27 Q8 17 20 17 Q32 17 32 27"/>',
  users: '<circle cx="14" cy="9" r="4.5"/><path d="M4 26 Q4 16 14 16 Q24 16 24 26"/><circle cx="27" cy="10" r="3.6"/><path d="M23 25 Q26 17 36 18 Q37 22 36 25"/>',
  gear: '<circle cx="20" cy="15" r="6"/><circle cx="20" cy="15" r="2.4"/><line x1="20" y1="4" x2="20" y2="9"/><line x1="20" y1="21" x2="20" y2="26"/><line x1="9" y1="15" x2="14" y2="15"/><line x1="26" y1="15" x2="31" y2="15"/><line x1="12" y1="7" x2="16" y2="11"/><line x1="24" y1="19" x2="28" y2="23"/><line x1="28" y1="7" x2="24" y2="11"/><line x1="16" y1="19" x2="12" y2="23"/>',
  clock: '<circle cx="20" cy="15" r="11"/><line x1="20" y1="15" x2="20" y2="8"/><line x1="20" y1="15" x2="26" y2="17"/>',
  lock: '<rect x="11" y="13" width="18" height="13" rx="2"/><path d="M14 13 V9 Q14 4 20 4 Q26 4 26 9 V13" fill="none"/>',
  key: '<circle cx="11" cy="15" r="6"/><line x1="17" y1="15" x2="35" y2="15"/><line x1="29" y1="15" x2="29" y2="20"/><line x1="34" y1="15" x2="34" y2="21"/>',
  envelope: '<rect x="4" y="7" width="32" height="17" rx="1.5"/><path d="M4 8 L20 18 L36 8" fill="none"/>',
  warning: '<polygon points="20,4 37,26 3,26"/><line x1="20" y1="12" x2="20" y2="19"/><circle cx="20" cy="22.5" r="0.9"/>',
  check: '<circle cx="20" cy="15" r="11"/><path d="M14 15 L18 19 L26 10" fill="none"/>',
  ban: '<circle cx="20" cy="15" r="11"/><line x1="12" y1="7" x2="28" y2="23"/>',
  mobile: '<rect x="13" y="3" width="14" height="24" rx="2.5"/><line x1="17" y1="23.5" x2="23" y2="23.5"/>',
  monitor: '<rect x="5" y="4" width="30" height="18" rx="1.5"/><line x1="14" y1="26" x2="26" y2="26"/><line x1="20" y1="22" x2="20" y2="26"/>',
  server: '<rect x="8" y="3" width="24" height="24" rx="2"/><line x1="8" y1="11" x2="32" y2="11"/><line x1="8" y1="19" x2="32" y2="19"/><circle cx="12.5" cy="7" r="1.2"/><circle cx="12.5" cy="15" r="1.2"/><circle cx="12.5" cy="23" r="1.2"/>',
  firewall: '<rect x="3" y="5" width="34" height="20"/><line x1="3" y1="12" x2="37" y2="12"/><line x1="3" y1="19" x2="37" y2="19"/><line x1="14" y1="5" x2="14" y2="12"/><line x1="26" y1="5" x2="26" y2="12"/><line x1="9" y1="12" x2="9" y2="19"/><line x1="21" y1="12" x2="21" y2="19"/><line x1="33" y1="12" x2="33" y2="19"/><line x1="14" y1="19" x2="14" y2="25"/><line x1="26" y1="19" x2="26" y2="25"/>',
  databaseIcon: '<ellipse cx="20" cy="7" rx="13" ry="3.5"/><line x1="7" y1="7" x2="7" y2="23"/><line x1="33" y1="7" x2="33" y2="23"/><path d="M7 23 A13 3.5 0 0 0 33 23" fill="none"/><path d="M7 13 A13 3.5 0 0 0 33 13" fill="none"/>',
};
/** 图标等比策略:s=min(w/40,h/30) 等比缩放 + 居中,等价 drawio stencil aspect=fixed(节点侧应配 aspect:'fixed' 锁比例) */
const icon = (glyph: string) => (w: number, h: number) => {
  const s = Math.min(w / 40, h / 30), tx = (w - 40 * s) / 2, ty = (h - 30 * s) / 2;
  return `<g transform="translate(${f(tx)},${f(ty)}) scale(${f2(s)})">${glyph}</g>`;
};

/** folder/tab/package 通用:tab 定值宽高钳制,left 定标签位置 */
const tabbed = (tabW: number, tabH: number, left: boolean) => (w: number, h: number) => {
  const dx = Math.min(tabW, w), dy = Math.min(tabH, h);
  return left
    ? poly([[0, 0], [dx, 0], [dx, dy], [w, dy], [w, h], [0, h]]) + lines(`M 0,${f(dy)} L ${f(dx)},${f(dy)}`)
    : poly([[0, dy], [w - dx, dy], [w - dx, 0], [w, 0], [w, h], [0, h]]) + lines(`M ${f(w - dx)},${f(dy)} L ${f(w)},${f(dy)}`);
};

/* ―――― 形状生成器(每形一行注释注明几何来源)―――― */
const GEN: Record<string, (w: number, h: number) => string> = {
  /* ―― general ―― */
  // 矩形:drawio 基础 vertex
  rect: (w, h) => `<rect x="0" y="0" width="${f(w)}" height="${f(h)}"/>`,
  // 圆角矩形:drawio 相对模式 r=min(w,h)*0.15(取 min 保正圆角)
  roundRect: (w, h) => { const r = Math.min(w, h) * RECTANGLE_ROUNDING_FACTOR; return `<rect x="0" y="0" width="${f(w)}" height="${f(h)}" rx="${f(r)}" ry="${f(r)}"/>`; },
  // 文本:无几何,节点文字自渲染
  text: () => '',
  // 椭圆:drawio mxEllipse
  ellipse: (w, h) => `<ellipse cx="${f(w / 2)}" cy="${f(h / 2)}" rx="${f(w / 2)}" ry="${f(h / 2)}"/>`,
  // 菱形:drawio mxRhombus,纯比例
  rhombus: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]),
  // 三角形:drawio mxTriangle direction=east(顶点朝右),纯比例
  triangle: (w, h) => poly([[0, 0], [w, h / 2], [0, h]]),
  // 平行四边形:drawio ParallelogramShape fixedSize,斜边落差 20px 定值
  parallelogram: (w, h) => { const dx = Math.min(20, w); return poly([[0, h], [dx, 0], [w, 0], [w - dx, h]]); },
  // 六边形:drawio HexagonShape fixedSize,斜角 20px 定值
  hexagon: (w, h) => { const s = Math.min(20, w / 2); return poly([[s, 0], [w - s, 0], [w, h / 2], [w - s, h], [s, h], [0, h / 2]]); },
  // 梯形:drawio TrapezoidShape fixedSize,斜边 20px 定值
  trapezoid: (w, h) => { const dx = Math.min(20, w / 2); return poly([[0, h], [dx, 0], [w - dx, 0], [w, h]]); },
  // 圆柱:drawio cylinder3 语义,盖高 15px 钳 h/2(拉高不变扁);ry==0 退化 rect
  cylinder: (w, h) => {
    const ry = Math.min(15, h / 2), rx = w / 2;
    if (ry <= 0) return GEN.rect!(w, h);
    const body = `M 0,${f(ry)} A ${f(rx)},${f(ry)} 0 0 1 ${f(w / 2)},0 A ${f(rx)},${f(ry)} 0 0 1 ${f(w)},${f(ry)} L ${f(w)},${f(h - ry)} A ${f(rx)},${f(ry)} 0 0 1 ${f(w / 2)},${f(h)} A ${f(rx)},${f(ry)} 0 0 1 0,${f(h - ry)} Z`;
    const cap = `M ${f(w)},${f(ry)} A ${f(rx)},${f(ry)} 0 0 1 ${f(w / 2)},${f(2 * ry)} A ${f(rx)},${f(ry)} 0 0 1 0,${f(ry)}`;
    return `<path d="${body}"/>` + lines(cap);
  },
  // 云:drawio CloudShape 贝塞尔系数,纯比例
  cloud: (w, h) => `<path d="M ${f(0.25 * w)},${f(0.25 * h)} C ${f(0.05 * w)},${f(0.25 * h)} 0,${f(0.5 * h)} ${f(0.16 * w)},${f(0.55 * h)} C 0,${f(0.66 * h)} ${f(0.18 * w)},${f(0.9 * h)} ${f(0.31 * w)},${f(0.8 * h)} C ${f(0.4 * w)},${f(h)} ${f(0.7 * w)},${f(h)} ${f(0.8 * w)},${f(0.8 * h)} C ${f(w)},${f(0.8 * h)} ${f(w)},${f(0.6 * h)} ${f(0.875 * w)},${f(0.5 * h)} C ${f(w)},${f(0.3 * h)} ${f(0.8 * w)},${f(0.1 * h)} ${f(0.625 * w)},${f(0.2 * h)} C ${f(0.5 * w)},${f(0.05 * h)} ${f(0.3 * w)},${f(0.05 * h)} ${f(0.25 * w)},${f(0.25 * h)} Z"/>`,
  // 文档:drawio DocumentShape,底波 dy=0.3h、波形系数 fy=1.4 定值
  document: (w, h) => { const dy = 0.3 * h, fy = 1.4; return `<path d="M 0,0 L ${f(w)},0 L ${f(w)},${f(h - dy / 2)} Q ${f(0.75 * w)},${f(h - fy * dy)} ${f(w / 2)},${f(h - dy / 2)} Q ${f(0.25 * w)},${f(h + 0.4 * dy)} 0,${f(h - dy / 2)} Z"/>`; },
  // 内部存储:drawio InternalStorageShape,分隔线 20px 定值
  internalStorage: (w, h) => { const dx = Math.min(20, w), dy = Math.min(20, h); return GEN.rect!(w, h) + lines(`M 0,${f(dy)} L ${f(w)},${f(dy)} M ${f(dx)},0 L ${f(dx)},${f(h)}`); },
  // 立方体:drawio CubeShape,厚度 20px 定值;切角右上+左下,内棱交点 (s,s)(纠正旧 glyph 镜像)
  cube: (w, h) => {
    const s = Math.min(20, w, h);
    return poly([[0, 0], [w - s, 0], [w, s], [w, h], [s, h], [0, h - s]]) + lines(`M ${f(s)},${f(h)} L ${f(s)},${f(s)} L 0,0 M ${f(s)},${f(s)} L ${f(w)},${f(s)}`);
  },
  // 步骤:drawio StepShape fixedSize,咬合深度 20px 定值
  step: (w, h) => { const s = Math.min(20, w); return poly([[0, 0], [w - s, 0], [w, h / 2], [w - s, h], [0, h], [s, h / 2]]); },
  // 磁带:drawio TapeShape,上下波 dy=0.4h、fy=1.4 定值
  tape: (w, h) => { const dy = 0.4 * h, fy = 1.4; return `<path d="M 0,${f(dy / 2)} Q ${f(w / 4)},${f(fy * dy)} ${f(w / 2)},${f(dy / 2)} Q ${f(0.75 * w)},${f(-0.4 * dy)} ${f(w)},${f(dy / 2)} L ${f(w)},${f(h - dy / 2)} Q ${f(0.75 * w)},${f(h - fy * dy)} ${f(w / 2)},${f(h - dy / 2)} Q ${f(w / 4)},${f(h + 0.4 * dy)} 0,${f(h - dy / 2)} Z"/>`; },
  // 便条:drawio NoteShape,折角 30px 定值
  note: (w, h) => { const s = Math.min(30, w, h); return poly([[0, 0], [w - s, 0], [w, s], [w, h], [0, h]]) + lines(`M ${f(w - s)},0 L ${f(w - s)},${f(s)} L ${f(w)},${f(s)}`); },
  // 卡片:drawio CardShape,切角 30px 定值
  card: (w, h) => { const s = Math.min(30, w, h); return poly([[s, 0], [w, 0], [w, h], [0, h], [0, s]]); },
  // 标注:drawio CalloutShape,尾高 30px/尾根宽 20px 定值,尾尖居中
  callout: (w, h) => {
    const s = Math.min(30, h), base = Math.min(20, w), dx = 0.5 * w, dx2 = 0.5 * w;
    return poly([[0, 0], [w, 0], [w, h - s], [Math.min(w, dx + base), h - s], [dx2, h], [Math.max(0, dx), h - s], [0, h - s]]);
  },
  // 角色:drawio ActorShape 面具人形,纯比例(头=中 1/3 宽,肩线 2h/5)
  actor: (w, h) => `<path d="M 0,${f(h)} C 0,${f(0.6 * h)} 0,${f(0.4 * h)} ${f(w / 2)},${f(0.4 * h)} C ${f(w / 6)},${f(0.4 * h)} ${f(w / 6)},0 ${f(w / 2)},0 C ${f((5 * w) / 6)},0 ${f((5 * w) / 6)},${f(0.4 * h)} ${f(w / 2)},${f(0.4 * h)} C ${f(w)},${f(0.4 * h)} ${f(w)},${f(0.6 * h)} ${f(w)},${f(h)} Z"/>`,
  // 十字:drawio CrossShape,臂厚以 min(w,h) 为基(非等比拉伸保持等厚)
  cross: (w, h) => {
    const s = 0.2 * Math.min(w, h), t = (h - s) / 2, b = t + s, l = (w - s) / 2, r = l + s;
    return poly([[0, t], [l, t], [l, 0], [r, 0], [r, t], [w, t], [w, b], [r, b], [r, h], [l, h], [l, b], [0, b]]);
  },
  // 星形:drawio basic.star stencil 95×90 归一化,纯比例
  star: (w, h) => poly([[0, 0.3667 * h], [0.3832 * w, 0.3667 * h], [0.5 * w, 0], [0.6168 * w, 0.3667 * h], [w, 0.3667 * h], [0.6947 * w, 0.6122 * h], [0.8158 * w, h], [0.5 * w, 0.76 * h], [0.1842 * w, h], [0.3053 * w, 0.6122 * h]]),
  // 圆环:drawio basic.donut,环厚 25px 定值(放大不变粗),evenodd 挖孔
  donut: (w, h) => {
    const dx = Math.min(25, w / 2, h / 2), rx = w / 2, ry = h / 2, irx = rx - dx, iry = ry - dx;
    const outer = `M 0,${f(ry)} A ${f(rx)},${f(ry)} 0 0 1 ${f(rx)},0 A ${f(rx)},${f(ry)} 0 0 1 ${f(w)},${f(ry)} A ${f(rx)},${f(ry)} 0 0 1 ${f(rx)},${f(h)} A ${f(rx)},${f(ry)} 0 0 1 0,${f(ry)} Z`;
    const inner = `M ${f(rx)},${f(dx)} A ${f(irx)},${f(iry)} 0 0 0 ${f(dx)},${f(ry)} A ${f(irx)},${f(iry)} 0 0 0 ${f(rx)},${f(h - dx)} A ${f(irx)},${f(iry)} 0 0 0 ${f(w - dx)},${f(ry)} A ${f(irx)},${f(iry)} 0 0 0 ${f(rx)},${f(dx)} Z`;
    return `<path fill-rule="evenodd" d="${outer} ${inner}"/>`;
  },
  // 与:半圆封盖 D 形,纯比例(按现有 glyph 系数换算)
  and: (w, h) => `<path d="M 0,0 L ${f(w / 2)},0 A ${f(w / 2)},${f(h / 2)} 0 0 1 ${f(w / 2)},${f(h)} L 0,${f(h)} Z"/>`,
  // 或:双 Q 透镜形,纯比例(按现有 glyph 系数换算)
  or: (w, h) => `<path d="M 0,${f(h / 2)} Q ${f(w / 2)},${f(-0.2 * h)} ${f(w)},${f(h / 2)} Q ${f(w / 2)},${f(1.2 * h)} 0,${f(h / 2)} Z"/>`,

  /* ―― flow ―― */
  // 过程/预定义流程:drawio ProcessShape,inset=round(w*0.1) 相对(round 保竖线锐利)
  process: (w, h) => { const inset = Math.round(w * 0.1); return GEN.rect!(w, h) + lines(`M ${f(inset)},0 L ${f(inset)},${f(h)} M ${f(w - inset)},0 L ${f(w - inset)},${f(h)}`); },
  // 存储数据:drawio DataStorageShape,两竖曲线均向左弯、开口朝右(纠正旧 glyph 镜像)
  dataStorage: (w, h) => { const s = w * 0.1; return `<path d="M ${f(s)},0 L ${f(w)},0 Q ${f(w - 2 * s)},${f(h / 2)} ${f(w)},${f(h)} L ${f(s)},${f(h)} Q ${f(-s)},${f(h / 2)} ${f(s)},0 Z"/>`; },
  // 数据库(多环):drawio DataStoreShape,环高 h/8 封顶 h/2
  datastore: (w, h) => {
    const dy = Math.min(h / 2, Math.round(h / 8));
    let fg = '';
    for (let i = 0; i < 3; i++) fg += `M 0,${f(dy + (i * dy) / 2)} C 0,${f(2 * dy + (i * dy) / 2)} ${f(w)},${f(2 * dy + (i * dy) / 2)} ${f(w)},${f(dy + (i * dy) / 2)} `;
    return `<path d="M 0,${f(dy)} C 0,${f(-dy / 3)} ${f(w)},${f(-dy / 3)} ${f(w)},${f(dy)} L ${f(w)},${f(h - dy)} C ${f(w)},${f(h + dy / 3)} 0,${f(h + dy / 3)} 0,${f(h - dy)} Z"/>` + lines(fg.trim());
  },
  // 手动输入:drawio ManualInputShape,顶斜落差 30px 定值
  manualInput: (w, h) => { const s = Math.min(30, h); return poly([[0, h], [0, s], [w, 0], [w, h]]); },
  // 循环限制:drawio LoopLimitShape,切角 20px 定值
  loopLimit: (w, h) => { const s = Math.min(20, w / 2, h); return poly([[s, 0], [w - s, 0], [w, 0.8 * s], [w, h], [0, h], [0, 0.8 * s]]); },
  // 离页连接符:drawio OffPageConnectorShape,底尖落差 0.375h 比例值
  offPageConnector: (w, h) => { const s = 0.375 * h; return poly([[0, 0], [w, 0], [w, h - s], [w / 2, h], [0, h - s]]); },
  // 延迟:drawio DelayShape,右端 dx=min(w,h/2) 保正半圆
  delay: (w, h) => { const dx = Math.min(w, h / 2); return `<path d="M 0,0 L ${f(w - dx)},0 Q ${f(w)},0 ${f(w)},${f(h / 2)} Q ${f(w)},${f(h)} ${f(w - dx)},${f(h)} L 0,${f(h)} Z"/>`; },
  // 显示:drawio DisplayShape,右端保正半圆 + 左尖 s=min(w-dx,0.25w)
  display: (w, h) => { const dx = Math.min(w, h / 2), s = Math.min(w - dx, 0.25 * w); return `<path d="M 0,${f(h / 2)} L ${f(s)},0 L ${f(w - dx)},0 Q ${f(w)},0 ${f(w)},${f(h / 2)} Q ${f(w)},${f(h)} ${f(w - dx)},${f(h)} L ${f(s)},${f(h)} Z"/>`; },
  // 终止符(药丸):rounded rect,r=min(w,h)/2 保正圆端
  terminator: (w, h) => { const r = Math.min(w, h) / 2; return `<rect x="0" y="0" width="${f(w)}" height="${f(h)}" rx="${f(r)}" ry="${f(r)}"/>`; },
  // 队列:= cylinder3 + direction=north 横放(盖在左),盖宽 15px 钳 w/2
  queue: (w, h) => {
    const s = Math.min(15, w / 2), ry = h / 2;
    const body = `M ${f(s)},0 L ${f(w - s)},0 A ${f(s)},${f(ry)} 0 0 1 ${f(w - s)},${f(h)} L ${f(s)},${f(h)} A ${f(s)},${f(ry)} 0 0 1 ${f(s)},0 Z`;
    return `<path d="${body}"/>` + lines(`M ${f(s)},0 A ${f(s)},${f(ry)} 0 0 1 ${f(s)},${f(h)}`);
  },
  // 整理:drawio CollateShape 上下对顶三角,纯比例
  collate: (w, h) => `<path d="M 0,0 L ${f(w)},0 L ${f(w / 2)},${f(h / 2)} Z M 0,${f(h)} L ${f(w)},${f(h)} L ${f(w / 2)},${f(h / 2)} Z"/>`,
  // 排序:drawio SortShape 菱形+中线,纯比例
  sortShape: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) + lines(`M 0,${f(h / 2)} L ${f(w)},${f(h / 2)}`),
  // L形角:drawio CornerShape,臂厚 20px 定值
  corner: (w, h) => { const dx = Math.min(20, w), dy = Math.min(20, h); return poly([[0, 0], [w, 0], [w, dy], [dx, dy], [dx, h], [0, h]]); },
  // T形:drawio TeeShape,臂厚 20px 定值
  tee: (w, h) => {
    const dx = Math.min(20, w), dy = Math.min(20, h);
    return poly([[0, 0], [w, 0], [w, dy], [(w + dx) / 2, dy], [(w + dx) / 2, h], [(w - dx) / 2, h], [(w - dx) / 2, dy], [0, dy]]);
  },
  // UML火柴人:drawio UmlActorShape,纯比例,仅头部随 fill
  umlActor: (w, h) => `<ellipse cx="${f(w / 2)}" cy="${f(h / 8)}" rx="${f(w / 4)}" ry="${f(h / 8)}"/>` + lines(`M ${f(w / 2)},${f(h / 4)} L ${f(w / 2)},${f((2 * h) / 3)} M 0,${f(h / 3)} L ${f(w)},${f(h / 3)} M ${f(w / 2)},${f((2 * h) / 3)} L 0,${f(h)} M ${f(w / 2)},${f((2 * h) / 3)} L ${f(w)},${f(h)}`),
  // UML组件:drawio ComponentShape,凸块 32×12 定值骑跨左缘 x0=16(rect(0,y0,dx,dy),裁决 6);极小节点钳 w / h/3
  component: (w, h) => {
    const dx = Math.min(32, w), dy = Math.min(12, h / 3), x0 = dx / 2, y0 = 0.3 * h - dy / 2, y1 = 0.7 * h - dy / 2;
    const d = `M ${f(x0)},0 L ${f(w)},0 L ${f(w)},${f(h)} L ${f(x0)},${f(h)} L ${f(x0)},${f(y1 + dy)} L 0,${f(y1 + dy)} L 0,${f(y1)} L ${f(x0)},${f(y1)} L ${f(x0)},${f(y0 + dy)} L 0,${f(y0 + dy)} L 0,${f(y0)} L ${f(x0)},${f(y0)} Z`;
    return `<path d="${d}"/><rect x="0" y="${f(y0)}" width="${f(dx)}" height="${f(dy)}"/><rect x="0" y="${f(y1)}" width="${f(dx)}" height="${f(dy)}"/>`;
  },
  // 模块:component 变体,凸块 20×10 定值、x0=10、y 从顶部排布;极小节点钳 w / h/3
  module: (w, h) => {
    const dx = Math.min(20, w), dy = Math.min(10, h / 3), x0 = dx / 2, y0 = Math.min(dy, h - dy), y1 = Math.min(y0 + 2 * dy, h - dy);
    const d = `M ${f(x0)},0 L ${f(w)},0 L ${f(w)},${f(h)} L ${f(x0)},${f(h)} L ${f(x0)},${f(y1 + dy)} L 0,${f(y1 + dy)} L 0,${f(y1)} L ${f(x0)},${f(y1)} L ${f(x0)},${f(y0 + dy)} L 0,${f(y0 + dy)} L 0,${f(y0)} L ${f(x0)},${f(y0)} Z`;
    return `<path d="${d}"/><rect x="0" y="${f(y0)}" width="${f(dx)}" height="${f(dy)}"/><rect x="0" y="${f(y1)}" width="${f(dx)}" height="${f(dy)}"/>`;
  },
  // 文件夹:drawio FolderShape,标签 60×20 定值在右
  folder: tabbed(60, 20, false),
  // 标签页:drawio TabShape,标签 110×30 定值在左
  tab: tabbed(110, 30, true),
  // UML包:drawio PackageShape,标签 40×15 定值在左
  package: tabbed(40, 15, true),
  // 消息/信封框:drawio MessageShape,纯比例 V 线
  message: (w, h) => GEN.rect!(w, h) + lines(`M 0,0 L ${f(w / 2)},${f(h / 2)} L ${f(w)},0`),
  // 多文档:OtterPatch 自定(非 drawio 原式),层偏移 e=min(5,0.1w,0.1h) 定值
  multiDocument: (w, h) => {
    const e = Math.min(5, 0.1 * w, 0.1 * h), W = w - 2 * e, H = h - 2 * e, oy = 2 * e, dy = 0.3 * H, fy = 1.4;
    const bottom = `M 0,${f(oy)} L ${f(W)},${f(oy)} L ${f(W)},${f(oy + H - dy / 2)} Q ${f(0.75 * W)},${f(oy + H - fy * dy)} ${f(W / 2)},${f(oy + H - dy / 2)} Q ${f(0.25 * W)},${f(oy + H + 0.4 * dy)} 0,${f(oy + H - dy / 2)} Z`;
    return `<path d="${bottom}"/>` + lines(`M ${f(e)},${f(e)} L ${f(w - e)},${f(e)} L ${f(w - e)},${f(0.55 * h)} M ${f(2 * e)},0 L ${f(w)},0 L ${f(w)},${f(0.5 * h - e)}`);
  },
  // 提取:drawio Extract 下顶三角,纯比例
  extract: (w, h) => poly([[0, 0], [w, 0], [w / 2, h]]),
  // 合并:drawio Merge 上顶三角,纯比例
  merge: (w, h) => poly([[w / 2, 0], [w, h], [0, h]]),
  // 求和:drawio SummingFunction,对角线端点取椭圆 45° 参数点
  sum: (w, h) => {
    const c = Math.SQRT1_2, cx = w / 2, cy = h / 2, ox = (w / 2) * c, oy = (h / 2) * c;
    return GEN.ellipse!(w, h) + lines(`M ${f(cx - ox)},${f(cy - oy)} L ${f(cx + ox)},${f(cy + oy)} M ${f(cx - ox)},${f(cy + oy)} L ${f(cx + ox)},${f(cy - oy)}`);
  },
  // 或门:drawio Or ellipse + 十字线,纯比例
  orGate: (w, h) => GEN.ellipse!(w, h) + lines(`M 0,${f(h / 2)} L ${f(w)},${f(h / 2)} M ${f(w / 2)},0 L ${f(w / 2)},${f(h)}`),
  // 顺序数据:drawio SequentialData 圆 + 底切线,纯比例
  sequentialData: (w, h) => GEN.ellipse!(w, h) + lines(`M ${f(w / 2)},${f(h)} L ${f(w)},${f(h)}`),

  /* ―― arrows(arrows2 语义:头深/杆宽绝对 px)―― */
  // 右箭头:mxgraph.arrows2.arrow,头深 40px 定值、杆占中间 40% 高
  arrowRight: (w, h) => { const dx = Math.min(40, w), dp = 0.3 * h; return poly([[0, dp], [w - dx, dp], [w - dx, 0], [w, h / 2], [w - dx, h], [w - dx, h - dp], [0, h - dp], [0, h / 2]]); },
  // 斜向块箭头(↗,drawio mxArrow 语义:沿对角线绘制,头深/杆宽定值不随长度拉伸)
  diagArrow: (w, h) => {
    const L = Math.hypot(w, h) || 1; const ux = w / L, uy = -h / L; const vx = -uy, vy = ux; // u=对角单位向量(左下→右上),v=法向
    const ah = Math.min(40, L * 0.45); const sw2 = Math.min(7, Math.min(w, h) * 0.2); const aw2 = Math.min(15, Math.min(w, h) * 0.42);
    const sx = 0, sy = h, ex = w, ey = 0; const bx = ex - ux * ah, by = ey - uy * ah; // 箭头基点
    return poly([[sx + vx * sw2, sy + vy * sw2], [bx + vx * sw2, by + vy * sw2], [bx + vx * aw2, by + vy * aw2], [ex, ey], [bx - vx * aw2, by - vy * aw2], [bx - vx * sw2, by - vy * sw2], [sx - vx * sw2, sy - vy * sw2]]);
  },
  // 斜向双头块箭头(↙↗)
  diagArrowBoth: (w, h) => {
    const L = Math.hypot(w, h) || 1; const ux = w / L, uy = -h / L; const vx = -uy, vy = ux;
    const ah = Math.min(40, L * 0.32); const sw2 = Math.min(7, Math.min(w, h) * 0.2); const aw2 = Math.min(15, Math.min(w, h) * 0.42);
    const sx = 0, sy = h, ex = w, ey = 0;
    const b1x = sx + ux * ah, b1y = sy + uy * ah; const b2x = ex - ux * ah, b2y = ey - uy * ah;
    return poly([[sx, sy], [b1x + vx * aw2, b1y + vy * aw2], [b1x + vx * sw2, b1y + vy * sw2], [b2x + vx * sw2, b2y + vy * sw2], [b2x + vx * aw2, b2y + vy * aw2], [ex, ey], [b2x - vx * aw2, b2y - vy * aw2], [b2x - vx * sw2, b2y - vy * sw2], [b1x - vx * sw2, b1y - vy * sw2], [b1x - vx * aw2, b1y - vy * aw2]]);
  },
  // 左箭头:arrowRight flipH
  arrowLeft: (w, h) => { const dx = Math.min(40, w), dp = 0.3 * h; return poly([[w, dp], [dx, dp], [dx, 0], [0, h / 2], [dx, h], [dx, h - dp], [w, h - dp], [w, h / 2]]); },
  // 上箭头:arrowRight direction=north
  arrowUp: (w, h) => { const dx = Math.min(40, h), dp = 0.3 * w; return poly([[dp, h], [dp, dx], [0, dx], [w / 2, 0], [w, dx], [w - dp, dx], [w - dp, h], [w / 2, h]]); },
  // 下箭头:arrowRight direction=south
  arrowDown: (w, h) => { const dx = Math.min(40, h), dp = 0.3 * w; return poly([[dp, 0], [dp, h - dx], [0, h - dx], [w / 2, h], [w, h - dx], [w - dp, h - dx], [w - dp, 0], [w / 2, 0]]); },
  // 水平双向箭头:mxgraph.arrows2.twoWayArrow,头深 35px 钳 w/2
  twoWayArrow: (w, h) => {
    const dx = Math.min(35, w / 2), dp = 0.3 * h;
    return poly([[dx, dp], [w - dx, dp], [w - dx, 0], [w, h / 2], [w - dx, h], [w - dx, h - dp], [dx, h - dp], [dx, h], [0, h / 2], [dx, 0]]);
  },
  // 垂直双向箭头:twoWayArrow direction=north
  twoWayArrowV: (w, h) => {
    const dx = Math.min(35, h / 2), dp = 0.3 * w;
    return poly([[dp, dx], [dp, h - dx], [0, h - dx], [w / 2, h], [w, h - dx], [w - dp, h - dx], [w - dp, dx], [w, dx], [w / 2, 0], [0, dx]]);
  },
  // 四向箭头:mxgraph.arrows2.quadArrow,杆半宽 10/头肩 10/头深 20 定值钳制
  quadArrow: (w, h) => {
    const d = Math.min(10, h / 2, w / 2), a = Math.min(10, Math.max(0, Math.min(w, h) / 2 - d)), k = Math.min(20, Math.max(0, Math.min(w, h) / 2 - d - a));
    const cx = w / 2, cy = h / 2;
    return poly([
      [cx + d, cy - d], [w - k, cy - d], [w - k, cy - d - a], [w, cy], [w - k, cy + d + a], [w - k, cy + d],
      [cx + d, cy + d], [cx + d, h - k], [cx + d + a, h - k], [cx, h], [cx - d - a, h - k], [cx - d, h - k],
      [cx - d, cy + d], [k, cy + d], [k, cy + d + a], [0, cy], [k, cy - d - a], [k, cy - d],
      [cx - d, cy - d], [cx - d, k], [cx - d - a, k], [cx, 0], [cx + d + a, k], [cx + d, k],
    ]);
  },
  // 角箭头:mxgraph.arrows2.bendArrow,头深 38/杆半宽 15/头全宽 55 定值钳制
  bendArrow: (w, h) => {
    const dx = Math.min(38, w), dy = Math.min(15, h / 2, w / 4), ah = Math.max(2 * dy, Math.min(55, h));
    return poly([[w - dx, 0], [w, ah / 2], [w - dx, ah], [w - dx, ah / 2 + dy], [2 * dy, ah / 2 + dy], [2 * dy, h], [dy, h], [0, h], [0, ah / 2 - dy], [w - dx, ah / 2 - dy]]);
  },
  // 转角双头箭头:mxgraph.arrows2.bendDoubleArrow,bendArrow 同参数族,竖臂末端对称加头(臂中心线 ah/2)
  bendDoubleArrow: (w, h) => {
    const dx = Math.min(38, w), dy = Math.min(15, h / 2, w / 4), ah = Math.max(2 * dy, Math.min(55, w, h));
    const dx2 = Math.min(38, Math.max(0, h - ah)), c = ah / 2;
    return poly([
      [c - dy, c - dy], [w - dx, c - dy], [w - dx, 0], [w, c], [w - dx, ah], [w - dx, c + dy],
      [c + dy, c + dy], [c + dy, h - dx2], [ah, h - dx2], [c, h], [0, h - dx2], [c - dy, h - dx2],
    ]);
  },
  // U形箭头:mxgraph.arrows2.uTurnArrow,杆半宽 11 钳 h/4、头全宽 43 钳 h/2、头深 25 钳 w/2;弯臂 x 位随 h 增长,钳 w-dx2 防高瘦节点横向溢出
  uTurnArrow: (w, h) => {
    const dy = Math.min(11, h / 4), ah = Math.min(43, h / 2), dx2 = Math.min(25, w / 2), dx = Math.min((h - ah / 2 + dy) / 2, w - dx2);
    const r1 = Math.max(0, dx - 2 * dy), r2 = Math.max(0, (h - 2 * dy - ah / 2 - dy) / 2), xr = Math.max(w, dx);
    const d = `M ${f(dx)},0 L ${f(dx + dx2)},${f(ah / 2)} L ${f(dx)},${f(ah)} L ${f(dx)},${f(ah / 2 + dy)}`
      + ` A ${f(r1)},${f(r2)} 0 0 0 ${f(dx)},${f(h - 2 * dy)}`
      + ` L ${f(xr)},${f(h - 2 * dy)} L ${f(xr)},${f(h)} L ${f(dx)},${f(h)}`
      + ` A ${f(dx)},${f((h - ah / 2 + dy) / 2)} 0 0 1 ${f(dx)},${f(ah / 2 - dy)} Z`;
    return `<path d="${d}"/>`;
  },
  // 分叉箭头(三向):mxgraph.arrows2.triadArrow,头深 20/杆半宽 10/头全宽 40 定值钳制
  triadArrow: (w, h) => {
    const dx = Math.min(20, w / 4), dy = Math.min(10, h / 4), ah = Math.min(40, h / 2, w / 2);
    return poly([
      [w / 2 + ah / 2 - dy, h - ah + dy], [w - dx, h - ah + dy], [w - dx, h - ah], [w, h - ah / 2], [w - dx, h], [w - dx, h - dy],
      [dx, h - dy], [dx, h], [0, h - ah / 2], [dx, h - ah], [dx, h - ah + dy], [w / 2 - ah / 2 + dy, h - ah + dy],
      [w / 2 - ah / 2 + dy, dx], [w / 2 - ah / 2, dx], [w / 2, 0], [w / 2 + ah / 2, dx], [w / 2 + ah / 2 - dy, dx],
    ]);
  },
  // 标注箭头:mxgraph.arrows2.calloutArrow,标注块 60/杆半宽 10/头深 20/头肩 10 定值钳制
  calloutArrow: (w, h) => {
    const notch = Math.min(60, w / 2), dy = Math.min(10, h / 4), dx = Math.min(20, w - notch), a = Math.min(10, h / 2 - dy);
    return poly([
      [0, 0], [notch, 0], [notch, h / 2 - dy], [w - dx, h / 2 - dy], [w - dx, h / 2 - dy - a], [w, h / 2],
      [w - dx, h / 2 + dy + a], [w - dx, h / 2 + dy], [notch, h / 2 + dy], [notch, h], [0, h],
    ]);
  },
  // 闪电:纯比例(OtterPatch 自定,非 drawio 移植)
  lightning: (w, h) => poly([[0.175 * w, 0], [0.175 * w, 0.5 * h], [0.375 * w, 0.5 * h], [0.375 * w, h], [0.825 * w, 0.4 * h], [0.575 * w, 0.4 * h], [0.825 * w, 0]]),

  /* ―― icons(40×30 glyph 等比缩放居中,节点侧配 aspect:'fixed')―― */
  user: icon(ICON_GLYPHS.user!),               // 用户:现有 glyph 等比
  users: icon(ICON_GLYPHS.users!),             // 用户组:现有 glyph 等比
  gear: icon(ICON_GLYPHS.gear!),               // 齿轮:现有 glyph 等比
  clock: icon(ICON_GLYPHS.clock!),             // 时钟:现有 glyph 等比
  lock: icon(ICON_GLYPHS.lock!),               // 锁:现有 glyph 等比
  key: icon(ICON_GLYPHS.key!),                 // 钥匙:现有 glyph 等比
  envelope: icon(ICON_GLYPHS.envelope!),       // 信封:现有 glyph 等比
  warning: icon(ICON_GLYPHS.warning!),         // 警告三角:现有 glyph 等比
  check: icon(ICON_GLYPHS.check!),             // 对勾圆:现有 glyph 等比
  ban: icon(ICON_GLYPHS.ban!),                 // 禁止圆:现有 glyph 等比
  mobile: icon(ICON_GLYPHS.mobile!),           // 移动设备:现有 glyph 等比
  monitor: icon(ICON_GLYPHS.monitor!),         // 显示器:现有 glyph 等比
  server: icon(ICON_GLYPHS.server!),           // 服务器:现有 glyph 等比
  firewall: icon(ICON_GLYPHS.firewall!),       // 防火墙:现有 glyph 等比
  databaseIcon: icon(ICON_GLYPHS.databaseIcon!), // 数据库图标:现有 glyph 等比
};
GEN.circle = GEN.ellipse!; // 圆形 = 椭圆别名
GEN.decision = GEN.rhombus!; // 决策 = 菱形别名

/** 按 kind 与节点实际 w,h 生成 SVG 内部标记串;w/h 下限 8 保护,任何输入不产出 NaN/Infinity;未知 kind 回退 rect */
export function shapeSvg(kind: string, w: number, h: number): string {
  const W = Number.isFinite(w) ? Math.max(8, w) : 8;
  const H = Number.isFinite(h) ? Math.max(8, h) : 8;
  const gen = GEN[kind] ?? GEN.rect!;
  return gen(W, H);
}

/* ―――― 形状注册表 ―――― */
export const SHAPE_DEFS: Array<{ kind: string; name: string; cat: 'general' | 'flow' | 'arrows' | 'icons' }> = [
  // general
  { kind: 'rect', name: '矩形', cat: 'general' },
  { kind: 'roundRect', name: '圆角矩形', cat: 'general' },
  { kind: 'text', name: '文本', cat: 'general' },
  { kind: 'ellipse', name: '椭圆', cat: 'general' },
  { kind: 'rhombus', name: '菱形', cat: 'general' },
  { kind: 'triangle', name: '三角形', cat: 'general' },
  { kind: 'parallelogram', name: '平行四边形', cat: 'general' },
  { kind: 'hexagon', name: '六边形', cat: 'general' },
  { kind: 'trapezoid', name: '梯形', cat: 'general' },
  { kind: 'cylinder', name: '圆柱', cat: 'general' },
  { kind: 'cloud', name: '云', cat: 'general' },
  { kind: 'document', name: '文档', cat: 'general' },
  { kind: 'internalStorage', name: '内部存储', cat: 'general' },
  { kind: 'cube', name: '立方体', cat: 'general' },
  { kind: 'step', name: '步骤', cat: 'general' },
  { kind: 'tape', name: '磁带', cat: 'general' },
  { kind: 'note', name: '便条', cat: 'general' },
  { kind: 'card', name: '卡片', cat: 'general' },
  { kind: 'callout', name: '标注', cat: 'general' },
  { kind: 'actor', name: '角色', cat: 'general' },
  { kind: 'cross', name: '十字', cat: 'general' },
  { kind: 'star', name: '星形', cat: 'general' },
  { kind: 'donut', name: '圆环', cat: 'general' },
  { kind: 'and', name: '与', cat: 'general' },
  { kind: 'or', name: '或', cat: 'general' },
  // flow
  { kind: 'process', name: '过程', cat: 'flow' },
  { kind: 'dataStorage', name: '存储数据', cat: 'flow' },
  { kind: 'datastore', name: '数据库', cat: 'flow' },
  { kind: 'manualInput', name: '手动输入', cat: 'flow' },
  { kind: 'loopLimit', name: '循环限制', cat: 'flow' },
  { kind: 'offPageConnector', name: '离页连接符', cat: 'flow' },
  { kind: 'delay', name: '延迟', cat: 'flow' },
  { kind: 'display', name: '显示', cat: 'flow' },
  { kind: 'terminator', name: '终止符', cat: 'flow' },
  { kind: 'queue', name: '队列', cat: 'flow' },
  { kind: 'collate', name: '整理', cat: 'flow' },
  { kind: 'sortShape', name: '排序', cat: 'flow' },
  { kind: 'corner', name: 'L形角', cat: 'flow' },
  { kind: 'tee', name: 'T形', cat: 'flow' },
  { kind: 'umlActor', name: 'UML角色', cat: 'flow' },
  { kind: 'component', name: '组件', cat: 'flow' },
  { kind: 'module', name: '模块', cat: 'flow' },
  { kind: 'folder', name: '文件夹', cat: 'flow' },
  { kind: 'tab', name: '标签页', cat: 'flow' },
  { kind: 'package', name: '包', cat: 'flow' },
  { kind: 'message', name: '消息', cat: 'flow' },
  { kind: 'multiDocument', name: '多文档', cat: 'flow' },
  { kind: 'extract', name: '提取', cat: 'flow' },
  { kind: 'merge', name: '合并', cat: 'flow' },
  { kind: 'sum', name: '求和', cat: 'flow' },
  { kind: 'orGate', name: '或门', cat: 'flow' },
  { kind: 'sequentialData', name: '顺序数据', cat: 'flow' },
  // arrows
  { kind: 'arrowRight', name: '右箭头', cat: 'arrows' },
  { kind: 'diagArrow', name: '斜向箭头', cat: 'arrows' },
  { kind: 'diagArrowBoth', name: '斜向双头箭头', cat: 'arrows' },
  { kind: 'arrowLeft', name: '左箭头', cat: 'arrows' },
  { kind: 'arrowUp', name: '上箭头', cat: 'arrows' },
  { kind: 'arrowDown', name: '下箭头', cat: 'arrows' },
  { kind: 'twoWayArrow', name: '水平双向箭头', cat: 'arrows' },
  { kind: 'twoWayArrowV', name: '垂直双向箭头', cat: 'arrows' },
  { kind: 'quadArrow', name: '四向箭头', cat: 'arrows' },
  { kind: 'bendArrow', name: '角箭头', cat: 'arrows' },
  { kind: 'bendDoubleArrow', name: '转角双头箭头', cat: 'arrows' },
  { kind: 'uTurnArrow', name: 'U形箭头', cat: 'arrows' },
  { kind: 'triadArrow', name: '分叉箭头', cat: 'arrows' },
  { kind: 'calloutArrow', name: '标注箭头', cat: 'arrows' },
  { kind: 'lightning', name: '闪电箭头', cat: 'arrows' },
  // icons(等比 <g> 包裹策略 + aspect:'fixed')
  { kind: 'user', name: '用户', cat: 'icons' },
  { kind: 'users', name: '用户组', cat: 'icons' },
  { kind: 'gear', name: '齿轮', cat: 'icons' },
  { kind: 'clock', name: '时钟', cat: 'icons' },
  { kind: 'lock', name: '锁', cat: 'icons' },
  { kind: 'key', name: '钥匙', cat: 'icons' },
  { kind: 'envelope', name: '信封', cat: 'icons' },
  { kind: 'warning', name: '警告三角', cat: 'icons' },
  { kind: 'check', name: '对勾圆', cat: 'icons' },
  { kind: 'ban', name: '禁止圆', cat: 'icons' },
  { kind: 'mobile', name: '移动设备', cat: 'icons' },
  { kind: 'monitor', name: '显示器', cat: 'icons' },
  { kind: 'server', name: '服务器', cat: 'icons' },
  { kind: 'firewall', name: '防火墙', cat: 'icons' },
  { kind: 'databaseIcon', name: '数据库图标', cat: 'icons' },
];

/* ―――― 别名映射(drawio style 关键字 → kind)―――― */
export const SHAPE_ALIASES: Record<string, string> = {
  // general
  'rounded': 'roundRect',                    // rounded=1 的普通 vertex
  'ellipse': 'ellipse', 'doubleEllipse': 'ellipse',
  'rhombus': 'rhombus', 'decision': 'rhombus',
  'triangle': 'triangle', 'mxgraph.basic.acute_triangle': 'triangle',
  'parallelogram': 'parallelogram', 'data': 'parallelogram',   // 流程图"数据"
  'hexagon': 'hexagon', 'preparation': 'hexagon',              // 流程图"准备"
  'trapezoid': 'trapezoid',
  'cylinder': 'cylinder', 'cylinder2': 'cylinder', 'cylinder3': 'cylinder',
  'database': 'datastore', 'datastore': 'datastore',
  'cloud': 'cloud', 'document': 'document',
  'internalStorage': 'internalStorage',
  'cube': 'cube', 'step': 'step', 'tape': 'tape',
  'note': 'note', 'note2': 'note',
  'card': 'card',
  'callout': 'callout', 'mxgraph.basic.rectCallout': 'callout',
  'actor': 'actor', 'person': 'actor',
  'cross': 'cross', 'mxgraph.basic.cross2': 'cross',
  'star': 'star', 'mxgraph.basic.star': 'star',
  'mxgraph.basic.donut': 'donut',
  'or': 'or', 'and': 'and',
  'text': 'text',                            // 裸关键字 text;...
  // flow
  'process': 'process', 'process2': 'process', 'predefinedProcess': 'process',
  'dataStorage': 'dataStorage',
  'manualInput': 'manualInput', 'loopLimit': 'loopLimit',
  'offPageConnector': 'offPageConnector',
  'delay': 'delay', 'display': 'display',
  'terminator': 'terminator',                // 或 rounded=1;arcSize=50 的 rect
  'queue': 'queue',                          // cylinder3 + direction=north 也 → queue
  'collate': 'collate', 'sort': 'sortShape',
  'corner': 'corner', 'tee': 'tee',
  'umlActor': 'umlActor',
  'component': 'component', 'module': 'module',
  'folder': 'folder',                        // tabWidth≈110 → tab;40×15+UML 语境 → package
  'tab': 'tab', 'package': 'package',
  'message': 'message', 'mail': 'message',
  'mxgraph.flowchart.multi-document': 'multiDocument',
  'extract': 'extract', 'merge': 'merge',
  'summingFunction': 'sum', 'sum': 'sum',
  'orEllipse': 'orGate', 'sequentialData': 'sequentialData',
  // arrows(arrows2 为主)
  'mxgraph.arrows2.arrow': 'arrowRight',     // flipH=1→arrowLeft; direction=north→arrowUp; south→arrowDown
  'mxgraph.arrows2.twoWayArrow': 'twoWayArrow',  // direction=north/south→twoWayArrowV
  'mxgraph.arrows2.quadArrow': 'quadArrow',
  'mxgraph.arrows2.bendArrow': 'bendArrow',
  'mxgraph.arrows2.bendDoubleArrow': 'bendDoubleArrow',
  'mxgraph.arrows2.uTurnArrow': 'uTurnArrow',
  'mxgraph.arrows2.triadArrow': 'triadArrow',
  'mxgraph.arrows2.calloutArrow': 'calloutArrow',
  'mxgraph.arrows2.calloutDoubleArrow': 'calloutArrow',
  'singleArrow': 'arrowRight',
  'diagArrow': 'diagArrow',
  'diagArrowBoth': 'diagArrowBoth',   // 旧比例式别名(arrows2 绝对 px 语义近似,裁决 1)
  'doubleArrow': 'twoWayArrow',  // 同上
};

/** 解析 drawio style 串映射到 kind:先 shape=xxx 精确匹配,无 shape= 时按裸关键字;direction/flipH 选箭头方向变体;认不出返回 null */
export function styleToKind(style?: string): string | null {
  if (!style) return null;
  const kv: Record<string, string> = {};
  let bare = '';
  for (const part of style.split(';')) {
    if (!part) continue;
    const i = part.indexOf('=');
    if (i < 0) { if (!bare) bare = part; continue; }
    kv[part.slice(0, i)] = part.slice(i + 1);
  }
  const shape = kv['shape'] ?? bare;
  let kind: string | null = shape ? SHAPE_ALIASES[shape] ?? null : null;
  // 无 shape 关键字:rounded=1 → roundRect;arcSize≈50 的药丸 → terminator
  if (!kind && !shape && kv['rounded'] === '1') kind = clamp(parseFloat(kv['arcSize'] ?? '0'), 0, 100) >= 50 ? 'terminator' : 'roundRect';
  if (!kind) return null;
  const dir = kv['direction'], flipH = kv['flipH'] === '1';
  // cylinder3 横放(direction=north)= queue(裁决 4)
  if (kind === 'cylinder' && (dir === 'north' || dir === 'south')) kind = 'queue';
  // 箭头族按 direction/flipH 选方向变体
  if (kind === 'arrowRight') { if (dir === 'north') kind = 'arrowUp'; else if (dir === 'south') kind = 'arrowDown'; else if (flipH) kind = 'arrowLeft'; }
  if (kind === 'twoWayArrow' && (dir === 'north' || dir === 'south')) kind = 'twoWayArrowV';
  // folder 宽标签(tabWidth≈110)按 tab 处理
  if (kind === 'folder') { const tw = parseFloat(kv['tabWidth'] ?? '60'); if (Number.isFinite(tw) && tw >= 90) kind = 'tab'; }
  return kind;
}
