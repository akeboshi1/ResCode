/**
 * 图片转 bin（二进制）工具（Node.js）
 *
 * 用法：
 *   node tools/images-to-bin.js <input_dir> [output_dir]
 *   node tools/images-to-bin.js --in "<input_dir>" --out "<output_dir>" [--flat] [--ext "png,jpg,jpeg,webp,gif,bmp,svg"]
 *
 * 位置参数说明：
 * - output_dir 不传则默认为 "out"
 *
 * 默认行为：
 * - 递归扫描 --in 目录
 * - 仅处理图片扩展名（可通过 --ext 覆盖）
 * - 输出文件名：保留层级 + ".bin"（默认会包含输入目录的相对路径前缀）
 *   例如：--in res_remote/puzzle，里面有 a/b/c.png -> <out>/res_remote/puzzle/a/b/c.png.bin
 *
 * 说明：
 * - 这里的 “bin” 即原文件内容的原样二进制拷贝（Buffer），不做编码/压缩/加密。
 */

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {
    ext: "png,jpg,jpeg,webp,gif,bmp,svg",
    flat: false,
    positionals: [],
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") args.in = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--ext") args.ext = argv[++i];
    else if (a === "--flat") args.flat = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else if (a && !a.startsWith("-")) args.positionals.push(a);
  }
  return args;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function isDir(p) {
  return fs.statSync(p).isDirectory();
}

function listFilesRec(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...listFilesRec(p));
    else if (st.isFile()) out.push(p);
  }
  return out;
}

function normalizeExtSet(extCsv) {
  const parts = String(extCsv || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((s) => (s.startsWith(".") ? s.slice(1) : s));
  return new Set(parts);
}

function getInPrefix(inDirAbs) {
  // 优先使用相对当前工作目录的路径，才能把例如 res_remote/puzzle 这种层级也带进去
  let rel = path.relative(process.cwd(), inDirAbs);
  if (!rel || rel === "." || rel.startsWith("..") || path.isAbsolute(rel)) {
    rel = path.basename(inDirAbs) || "in";
  }
  return rel;
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.in && args.positionals[0]) args.in = args.positionals[0];
  if (!args.out && args.positionals[1]) args.out = args.positionals[1];
  if (!args.out) args.out = "out";

  if (args.help || !args.in) {
    console.log(
      [
        "Usage:",
        '  node tools/images-to-bin.js "<input_dir>" ["<output_dir>"]',
        '  node tools/images-to-bin.js --in "<input_dir>" --out "<output_dir>" [--flat] [--ext "png,jpg,jpeg,webp,gif,bmp,svg"]',
        "",
        "Examples:",
        '  node tools/images-to-bin.js "a" "out"',
        '  node tools/images-to-bin.js "res_remote/images" "res_remote_bin/images"',
        '  node tools/images-to-bin.js --in "res_remote/images" --out "res_remote_bin/images"',
        '  node tools/images-to-bin.js "assets" "out" --ext "png,jpg" --flat',
      ].join("\n")
    );
    process.exit(args.help ? 0 : 1);
  }

  const inDir = path.resolve(args.in);
  const outDir = path.resolve(args.out);

  if (!fs.existsSync(inDir) || !isDir(inDir)) {
    console.error("--in 必须是存在的目录:", inDir);
    process.exit(1);
  }

  ensureDir(outDir);

  const extSet = normalizeExtSet(args.ext);
  const files = listFilesRec(inDir);
  const inPrefix = getInPrefix(inDir);

  let total = 0;
  let processed = 0;

  for (const f of files) {
    total++;
    const ext = path.extname(f).slice(1).toLowerCase();
    if (!extSet.has(ext)) continue;

    const rel = path.relative(inDir, f);
    const outRel = args.flat ? path.basename(f) : path.join(inPrefix, rel);
    const outFile = path.join(outDir, outRel + ".bin");
    ensureDir(path.dirname(outFile));

    const buf = fs.readFileSync(f);
    fs.writeFileSync(outFile, buf);
    processed++;
    console.log("bin:", rel, "->", path.relative(process.cwd(), outFile));
  }

  console.log(`done. scanned=${total}, processed=${processed}`);
}

main();

