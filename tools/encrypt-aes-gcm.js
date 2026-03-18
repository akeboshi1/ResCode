/**
 * AES-256-GCM 批量加密工具（Node.js）
 *
 * 用法：
 *   node tools/encrypt-aes-gcm.js --in "<input_file_or_dir>" --out "<output_dir>" --key "<64-hex>"
 *
 * 说明：
 * - 输出文件格式与 assets/resources/scripts/Core/Util/AesGcm.ts 一致：
 *   "AESG" + version(1) + iv(12) + tag(16) + ciphertext
 * - 输出文件扩展名默认保持原名并追加 ".bin"（比如 a.png -> a.png.bin）
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") args.in = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--key") args.key = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function isFile(p) {
  return fs.statSync(p).isFile();
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

function hexToBuf(hex) {
  const clean = String(hex || "").trim().replace(/^0x/i, "");
  if (clean.length !== 64) throw new Error("key 必须为 64 hex（32 bytes，AES-256）");
  return Buffer.from(clean, "hex");
}

function encryptFile(inFile, outFile, keyBuf) {
  const plain = fs.readFileSync(inFile);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBuf, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes

  const header = Buffer.concat([
    Buffer.from([0x41, 0x45, 0x53, 0x47]), // "AESG"
    Buffer.from([0x01]), // version 1
    iv,
    tag,
  ]);

  ensureDir(path.dirname(outFile));
  fs.writeFileSync(outFile, Buffer.concat([header, ciphertext]));
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.in || !args.out || !args.key) {
    console.log(
      [
        "Usage:",
        '  node tools/encrypt-aes-gcm.js --in "<input_file_or_dir>" --out "<output_dir>" --key "<64-hex>"',
      ].join("\n")
    );
    process.exit(args.help ? 0 : 1);
  }

  const inPath = path.resolve(args.in);
  const outDir = path.resolve(args.out);
  const keyBuf = hexToBuf(args.key);

  ensureDir(outDir);

  const files = isDir(inPath) ? listFilesRec(inPath) : [inPath];
  for (const f of files) {
    const rel = isDir(inPath) ? path.relative(inPath, f) : path.basename(f);
    const outFile = path.join(outDir, rel + ".bin");
    encryptFile(f, outFile, keyBuf);
    console.log("encrypted:", rel, "->", path.relative(process.cwd(), outFile));
  }
}

main();

