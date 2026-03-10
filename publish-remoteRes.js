const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const SftpClient = require('ssh2-sftp-client');
const { Client: SshClient } = require('ssh2');
const archiver = require('archiver');

const ROOT_DIR = __dirname;
// 源目录：res_remote
const REMOTE_RES_DIR = path.join(ROOT_DIR, 'res_remote');
const SFTP_CONFIG_JSON = path.join(ROOT_DIR, 'sftp-config.json');
// 用于记录上一次发布时各文件状态的清单（增量发布用）
const MANIFEST_JSON = path.join(ROOT_DIR, '.res_remote_manifest.json');
// 环境：命令行第一个参数 > NODE_ENV > 默认 development
const ENV =
  (process.argv[2] || process.env.NODE_ENV || 'development').toLowerCase();

function getTimeSuffixToMinute() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const hh = pad(now.getHours());
  const mm = pad(now.getMinutes());
  // 形如 20260310_1423
  return `${y}${m}${d}_${hh}${mm}`;
}

async function readPublishConfig() {
  const raw = await fsp.readFile(SFTP_CONFIG_JSON, 'utf8');
  const cfg = JSON.parse(raw);
  console.log('读取到的 sftp-config.json 配置:', cfg);
  if (!cfg.sftp) {
    throw new Error(
      'sftp-config.json 中缺少 sftp 配置，请添加 { "sftp": { "host": "...", "port": 22, "username": "...", "password": "...", "remoteRoot": "/path/to/develop_remote" } }'
    );
  }
  const { host, port = 22, username, password, remoteRoot } = cfg.sftp;
  if (!host || !username || !password || !remoteRoot) {
    throw new Error(
      'sftp-config.json.sftp 配置不完整，需要 host、username、password、remoteRoot 字段'
    );
  }

  // remoteRoot 既可以是字符串，也可以是 { development, production } 之类的对象
  let resolvedRemoteRoot = remoteRoot;
  if (remoteRoot && typeof remoteRoot === 'object') {
    resolvedRemoteRoot = remoteRoot[ENV];
    if (!resolvedRemoteRoot) {
      throw new Error(
        `sftp-config.json.sftp.remoteRoot 中没有为环境 "${ENV}" 配置路径`
      );
    }
  }

  return {
    sftp: { host, port, username, password, remoteRoot: resolvedRemoteRoot },
    env: ENV,
  };
}

async function getCurrentFilesState(rootDir) {
  const files = {};

  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        const relPath = path
          .relative(rootDir, fullPath)
          .replace(/\\/g, '/');
        const stat = await fsp.stat(fullPath);
        files[relPath] = {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
        };
      }
    }
  }

  await walk(rootDir);
  return files;
}

async function loadPreviousManifest() {
  try {
    const raw = await fsp.readFile(MANIFEST_JSON, 'utf8');
    const data = JSON.parse(raw);
    console.log('读取到历史清单文件 .res_remote_manifest.json');
    return data.files || {};
  } catch {
    console.log('未找到历史清单文件，视为首次全量发布');
    return {};
  }
}

async function saveManifest(filesState) {
  const data = { files: filesState };
  await fsp.writeFile(MANIFEST_JSON, JSON.stringify(data, null, 2), 'utf8');
  console.log('已更新增量发布清单文件 .res_remote_manifest.json');
}

function getChangedFiles(currentState, previousState) {
  const changed = [];
  for (const [relPath, meta] of Object.entries(currentState)) {
    const prev = previousState[relPath];
    if (!prev) {
      changed.push(relPath);
      continue;
    }
    if (prev.mtimeMs !== meta.mtimeMs || prev.size !== meta.size) {
      changed.push(relPath);
    }
  }
  return changed;
}

function createZipFromFiles(files, baseDir, outPath) {
  return new Promise((resolve, reject) => {
    console.log('开始本地压缩以下变更文件:');
    files.forEach((f) => console.log('  -', f));

    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(
        `本地压缩完成: ${outPath}, 大小: ${archive.pointer()} bytes`
      );
      resolve();
    });
    output.on('error', reject);

    archive.on('error', reject);

    archive.pipe(output);

    for (const absPath of files) {
      const relPath = path.relative(baseDir, absPath).replace(/\\/g, '/');
      archive.file(absPath, { name: relPath });
    }

    archive.finalize();
  });
}

async function uploadZipViaSftp(localZipPath, sftpConfig, remoteZipPath) {
  const sftp = new SftpClient();
  const { host, port, username, password } = sftpConfig;

  console.log(
    `准备通过 SFTP 上传压缩包，连接信息: ${username}@${host}:${port}`
  );
  console.log('本地压缩包路径:', localZipPath);
  console.log('目标远程路径:', remoteZipPath);

  await sftp.connect({ host, port, username, password });

  try {
    const remoteDir = path.dirname(remoteZipPath).replace(/\\/g, '/');
    console.log(`确保远程目录存在(若不存在会尝试创建): ${remoteDir}`);
    await sftp.mkdir(remoteDir, true).catch(() => {});

    console.log(`上传压缩包: ${localZipPath} -> ${remoteZipPath}`);
    await sftp.put(localZipPath, remoteZipPath);
  } finally {
    await sftp.end();
  }
}

function runRemoteUnzip(sshConfig, remoteRoot, remoteZipPath) {
  const { host, port, username, password } = sshConfig;
  const conn = new SshClient();

  const remoteZipName = path.basename(remoteZipPath);
  const cmd = [
    `cd '${remoteRoot}'`,
    // 解压并覆盖同名文件
    `unzip -o '${remoteZipName}'`,
    // 解压后删除压缩包
    `rm -f '${remoteZipName}'`,
  ].join(' && ');

  console.log('即将通过 SSH 执行远程解压...');
  console.log(`远程解压命令: ${cmd}`);

  return new Promise((resolve, reject) => {
    conn
      .on('ready', () => {
        conn.exec(cmd, (err, stream) => {
          if (err) {
            conn.end();
            reject(err);
            return;
          }

          let stdout = '';
          let stderr = '';

          stream
            .on('close', (code) => {
              conn.end();
              if (code === 0) {
                console.log('远程解压完成，命令输出:');
                console.log(stdout);
                resolve();
              } else {
                reject(
                  new Error(
                    `远程解压失败，退出码 ${code}，错误信息: ${stderr || stdout}`
                  )
                );
              }
            })
            .on('data', (data) => {
              stdout += data.toString();
            })
            .stderr.on('data', (data) => {
              stderr += data.toString();
            });
        });
      })
      .on('error', reject)
      .connect({ host, port, username, password });
  });
}

async function main() {
  try {
    if (!fs.existsSync(REMOTE_RES_DIR)) {
      console.error(`res_remote 目录不存在: ${REMOTE_RES_DIR}`);
      process.exit(1);
    }

    const { sftp: sftpConfig, env } = await readPublishConfig();

    console.log(`当前环境: ${env}`);
    console.log('模式: 增量发布（仅压缩并上传有变更的资源），再远程解压');

    // 1. 计算当前文件状态 & 与历史清单对比，得到有变更的文件列表
    const currentState = await getCurrentFilesState(REMOTE_RES_DIR);
    const previousState = await loadPreviousManifest();
    const changedRelPaths = getChangedFiles(currentState, previousState);

    if (changedRelPaths.length === 0) {
      console.log('没有检测到任何变更文件，本次不发布。');
      return;
    }

    console.log(`本次共检测到变更文件数量: ${changedRelPaths.length}`);

    const changedAbsFiles = changedRelPaths.map((rel) =>
      path.join(REMOTE_RES_DIR, rel)
    );

    // 2. 本地压缩这些有变更的文件（文件名带到分钟的时间后缀，便于区分版本）
    const timeSuffix = getTimeSuffixToMinute();
    const localZipPath = path.join(
      ROOT_DIR,
      `res_remote_${env}_${timeSuffix}.zip`
    );
    await createZipFromFiles(changedAbsFiles, REMOTE_RES_DIR, localZipPath);

    // 3. 上传 zip 到远程 remoteRoot 目录
    const remoteZipPath = path
      .join(sftpConfig.remoteRoot, path.basename(localZipPath))
      .replace(/\\/g, '/');
    await uploadZipViaSftp(localZipPath, sftpConfig, remoteZipPath);

    // 4. 在远程服务器上解压并删除 zip
    await runRemoteUnzip(sftpConfig, sftpConfig.remoteRoot, remoteZipPath);

    // 5. 更新本地清单文件，作为下次增量发布的基准
    await saveManifest(currentState);

    // 6. 清理本地 zip
    await fsp.unlink(localZipPath).catch(() => {});

    console.log('发布完成！');
  } catch (err) {
    console.error('发布过程出错：', err.message || err);
    process.exit(1);
  }
}

main();

