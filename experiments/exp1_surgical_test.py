# 杀手实验一(写回保真):外科补丁 vs 模型往返
# 验证"改一处、其余部件字节不动"是否成立,并与模型往返(python-docx 零编辑)对比扰动面。
# 用法: python exp1_surgical_test.py <真实 .docx>
import zipfile, os, sys
sys.stdout.reconfigure(encoding="utf-8")

src = sys.argv[1] if len(sys.argv) > 1 else None
if not src or not os.path.exists(src):
    print("用法: python exp1_surgical_test.py <真实 .docx>"); sys.exit(1)
if not src.lower().endswith(".docx"):
    print("当前脚本针对 .docx;.xlsx 同理(改 xl/worksheets/sheetN.xml,留待补)"); sys.exit(1)

work = os.path.dirname(os.path.abspath(src))

def read_parts(path):
    with zipfile.ZipFile(path) as z:
        return {n: z.read(n) for n in z.namelist()}

def compare(a, b):
    changed = []; identical = 0
    for n in sorted(set(a) | set(b)):
        x, y = a.get(n), b.get(n)
        if x is None:   changed.append("+ " + n)
        elif y is None: changed.append("- " + n)
        elif x == y:    identical += 1
        else:           changed.append("~ %s  (%db->%db)" % (n, len(x), len(y)))
    return identical, changed

oparts = read_parts(src)
total = len(oparts)

# ---------- 策略 C:外科补丁(只改 document.xml 里一处文字,其余字节原样)----------
print("=== 策略 C:外科补丁(改一处文字,其余部件字节不动)===")
doc = oparts["word/document.xml"].decode("utf-8")
patched_doc = doc.replace("</w:t>", "[外科补丁测试XYZ]</w:t>", 1)   # 给第一个文本 run 追加标记
patched = os.path.join(work, "_surgical.docx")
with zipfile.ZipFile(src) as zin, zipfile.ZipFile(patched, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        data = patched_doc.encode("utf-8") if item.filename == "word/document.xml" else oparts[item.filename]
        zi = zipfile.ZipInfo(item.filename, date_time=item.date_time); zi.compress_type = item.compress_type
        zout.writestr(zi, data)
ident, changed = compare(oparts, read_parts(patched))
print("  字节级不变部件: %d/%d" % (ident, total))
print("  改动部件: %s" % changed)
intact = all(not c.split()[1].startswith(("word/media", "word/footer", "word/styles", "word/theme")) for c in changed)
print("  图片/页脚/样式/主题是否全部原样: %s" % ("YES" if intact else "NO"))

# ---------- 策略 B:模型往返基线(python-docx 开+存,零编辑)----------
print("\n=== 策略 B:模型往返基线(python-docx 开+存,不做任何编辑)===")
try:
    from docx import Document
    rt = os.path.join(work, "_roundtrip.docx"); Document(src).save(rt)
    ident2, changed2 = compare(oparts, read_parts(rt))
    print("  字节级不变部件: %d/%d" % (ident2, total))
    print("  被改/增/删部件(%d): %s" % (len(changed2), changed2))
except ImportError:
    print("  python-docx 未安装(pip install python-docx 可补测);此腿略过")

print("\n判定:策略 C 若 '改动部件' 仅含 document.xml 且其余字节不变 → 写回走外科补丁。")
