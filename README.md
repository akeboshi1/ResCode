### 项目介绍

本仓库 `paipai-res` 用于管理 Cocos 项目的远程资源，并提供一套基于 Node.js 的**远程资源发布工具链**，支持：

- **SFTP 上传到远程服务器**
- **远端自动解压覆盖资源**
- **增量发布（只上传本次有改动的资源）**
- **多环境发布（development / production）**

### 目录与配置约定

- **`res_remote/`**：本地待发布的远程资源根目录（图片、音频、配置等）。
- **`sftp-config.json`**：SFTP 连接与远程目录配置，示例结构如下：

  ```json
  {
    "sftp": {
      "host": "47.103.82.48",
      "port": 22,
      "username": "dev",
      "password": "xxx",
      "remoteRoot": {
        "development": "/var/www/kele/",
        "production": "/var/www/colapai/app/"
      }
    }
  }
  ```

- **`.res_remote_manifest.json`**：发布脚本自动生成/更新，用于记录上一次发布时 `res_remote` 下所有文件的时间戳和大小，用于增量发布对比。

### 发布脚本说明

- **核心脚本**：`publish-remoteRes.js`

主要流程：

1. 读取 `sftp-config.json`，根据命令行参数或 `NODE_ENV` 判断当前环境（`development` / `production`）。
2. 扫描 `res_remote/`，生成当前文件清单（相对路径 + `mtimeMs` + `size`）。
3. 读取 `.res_remote_manifest.json`（如不存在视为首次全量发布），对比得到**有变更的文件列表**。
4. 将**有变更的文件**按原相对路径打包成 zip，文件名中带有时间后缀（精确到分钟），例如：
   - `res_remote_development_20260310_1423.zip`
5. 通过 `ssh2-sftp-client` 将 zip 上传到对应环境的 `remoteRoot` 目录。
6. 通过 `ssh2` 连接服务器，在远程执行：
   - `cd <remoteRoot>`
   - `unzip -o <zip文件名>` 覆盖解压
   - `rm -f <zip文件名>` 删除压缩包
7. 更新本地 `.res_remote_manifest.json`，作为下一次增量发布的基线。

> 注意：脚本依赖服务器上已安装 `unzip` 命令，并且对 `remoteRoot` 目录有写权限。

### NPM 指令

`package.json` 中已配置以下指令：

- **发布到 development 环境**

  ```bash
  npm run publish:dev
  ```

  等价于：

  ```bash
  node publish-remoteRes.js development
  ```

- **发布到 production 环境**

  ```bash
  npm run publish:prod
  ```

  等价于：

  ```bash
  node publish-remoteRes.js production
  ```

#### 发布 out/res_remote（用于发布序列化/加密后的输出）

当你把资源处理到 `out/res_remote/` 后（例如图片序列化成 `.bin`），可以直接发布该目录：

- **发布 out/res_remote 到 development**

  ```bash
  npm run publish:out:dev
  ```

  等价于：

  ```bash
  node publish-remoteRes.js development out/res_remote
  ```

- **发布 out/res_remote 到 production**

  ```bash
  npm run publish:out:prod
  ```

  等价于：

  ```bash
  node publish-remoteRes.js production out/res_remote
  ```

#### 图片转 bin（加密序列化）

脚本：`tools/images-to-bin.js`，npm 命令：`img:bin`。

- **将 `res_remote/puzzle` 转为加密后的 `.bin` 并输出到 `out/`（保留层级）**

  ```bash
  npm run img:bin -- "res_remote/puzzle" "out"
  ```

  会生成形如：
  - `out/res_remote/puzzle/a/b/c.png.bin`

### 首次使用步骤

1. **安装依赖**

   在项目根目录执行：

   ```bash
   npm install
   ```

2. **配置 SFTP**

   根据实际服务器信息修改 `sftp-config.json` 中的：

   - `host` / `port`
   - `username` / `password`
   - `remoteRoot.development` / `remoteRoot.production`

3. **准备资源目录**

   将需要作为远程资源的文件放入 `res_remote/` 目录下，保持你期望的目录结构。

4. **执行首次发布**

   ```bash
   npm run publish:dev
   # 或
   npm run publish:prod
   ```

   首次没有历史清单，会被视为全量发布，之后再执行就会仅上传有变更的文件。

5. **（可选）先处理资源再发布**

   例如先把 `res_remote/puzzle` 下图片转换为加密后的 `.bin` 到 `out/`，再发布 `out/res_remote`：

   ```bash
   npm run img:bin -- "res_remote/puzzle" "out"
   npm run publish:out:dev
   ```

### 注意事项

- **不要手动编辑 `.res_remote_manifest.json`**，该文件由脚本自动维护。
- 如需“强制全量重传”，可以删除 `.res_remote_manifest.json` 后再执行发布指令。
- 如服务器不支持 `unzip` 或解压命令有差异，可以根据实际情况调整 `publish-remoteRes.js` 中的远程命令。