<h1 align="center">ChatGPT2API</h1>


<p align="center">ChatGPT2API 主要是对 ChatGPT 官网相关能力进行逆向整理与封装，提供面向 ChatGPT 图片生成、图片编辑、多图组图编辑场景的 OpenAI 兼容图片 API / 代理，并集成在线画图、号池管理、多种账号导入方式与 Docker 自托管部署能力。</p>

> [!WARNING]
> 免责声明：
>
> 本项目涉及对 ChatGPT 官网文本生成、图片生成与图片编辑等相关接口的逆向研究，仅供个人学习、技术研究与非商业性技术交流使用。
>
> - 严禁将本项目用于任何商业用途、盈利性使用、批量操作、自动化滥用或规模化调用。
> - 严禁将本项目用于破坏市场秩序、恶意竞争、套利倒卖、二次售卖相关服务，以及任何违反 OpenAI 服务条款或当地法律法规的行为。
> - 严禁将本项目用于生成、传播或协助生成违法、暴力、色情、未成年人相关内容，或用于诈骗、欺诈、骚扰等非法或不当用途。
> - 使用者应自行承担全部风险，包括但不限于账号被限制、临时封禁或永久封禁以及因违规使用等所导致的法律责任。
> - 使用本项目即视为你已充分理解并同意本免责声明全部内容；如因滥用、违规或违法使用造成任何后果，均由使用者自行承担。

> [!IMPORTANT]
> 本项目基于对 ChatGPT 官网相关能力的逆向研究实现，存在账号受限、临时封禁或永久封禁的风险。请勿使用你自己的重要账号、常用账号或高价值账号进行测试。

> [!CAUTION]
> 旧版本存在已知漏洞，请尽快升级到最新版本。公网部署时请尽量不要放置敏感信息，并自行做好访问控制与隔离。

## 快速开始

已发布镜像支持 `linux/amd64` 与 `linux/arm64`，在 x86 服务器和 Apple Silicon / ARM Linux 设备上都会自动拉取匹配架构的版本。

### Docker 运行

```bash
git clone git@github.com:basketikun/chatgpt2api.git
cd chatgpt2api
docker compose up -d
```

启动前请先在 `config.json` 中设置 `auth-key`，也可以在 `docker-compose.yml` 中通过 `CHATGPT2API_AUTH_KEY` 覆盖。

- Web 面板：`http://localhost:3000`
- API 地址：`http://localhost:3000/v1`
- 数据目录：`./data`

### VPS 完整部署教程

下面以 Ubuntu / Debian 系 VPS 为例，采用 Docker Compose + Nginx 反向代理 + HTTPS 的部署方式。其他发行版也可以使用，只要先按对应系统安装好 Docker Engine 和 Docker Compose v2 插件。

> Docker 与 Certbot 的安装方式会随系统版本变化，生产环境建议优先参考官方文档：
>
> - [Docker Engine Ubuntu 安装文档](https://docs.docker.com/engine/install/ubuntu/)
> - [Docker Compose 安装文档](https://docs.docker.com/compose/install/)
> - [Certbot Nginx 安装文档](https://certbot.eff.org/instructions?ws=nginx&os=snap)

#### 1. 准备 VPS 和域名

1. 准备一台可访问公网的 VPS，建议至少 `1C1G`，图片任务较多时建议更高配置。
2. 准备一个域名，例如 `api.example.com`，在 DNS 服务商处添加 `A` 记录指向 VPS 公网 IP。
3. 在云厂商安全组 / 防火墙放行 `22`、`80`、`443` 端口。
4. 不建议直接把容器的 `3000` 端口暴露到公网。生产部署建议只让 Nginx 访问本机 `127.0.0.1:3000`。

#### 2. 安装 Docker、Compose 和 Nginx

如果系统里已经有可用的 `docker compose`，可以跳过 Docker 安装步骤。

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg nginx
sudo install -m 0755 -d '/etc/apt/keyrings'
curl -fsSL 'https://download.docker.com/linux/ubuntu/gpg' | sudo tee '/etc/apt/keyrings/docker.asc' > '/dev/null'
sudo chmod a+r '/etc/apt/keyrings/docker.asc'
. '/etc/os-release'
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" | sudo tee '/etc/apt/sources.list.d/docker.list' > '/dev/null'
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker compose version
```

Debian 系统把上面仓库地址中的 `linux/ubuntu` 改成 `linux/debian`。如果你的系统不是 Ubuntu / Debian，按 Docker 官方文档安装即可，核心要求是 `docker compose version` 能正常输出版本。

#### 3. 创建部署目录和配置文件

```bash
sudo mkdir -p '/opt/chatgpt2api/data'
sudo chown -R "$USER":"$USER" '/opt/chatgpt2api'
cd '/opt/chatgpt2api'
openssl rand -hex 32
```

保存好上一步生成的随机字符串，后面作为 `auth-key` 使用。然后创建 `config.json`：

```bash
tee 'config.json' > '/dev/null' <<'JSON'
{
  "auth-key": "replace-with-your-long-random-auth-key",
  "refresh_account_interval_minute": 60,
  "image_retention_days": 15,
  "image_poll_timeout_secs": 500,
  "auto_remove_rate_limited_accounts": false,
  "auto_remove_invalid_accounts": true,
  "log_levels": [
    "debug",
    "error",
    "info",
    "warning"
  ],
  "proxy": "",
  "base_url": "https://api.example.com",
  "sensitive_words": [],
  "global_system_prompt": "",
  "ai_review": {
    "enabled": false,
    "base_url": "",
    "api_key": "",
    "model": "",
    "prompt": ""
  },
  "backup": {
    "enabled": false,
    "provider": "cloudflare_r2",
    "account_id": "",
    "access_key_id": "",
    "secret_access_key": "",
    "bucket": "",
    "prefix": "backups",
    "interval_minutes": 1440,
    "rotation_keep": 10,
    "encrypt": false,
    "passphrase": "",
    "include": {
      "config": true,
      "register": true,
      "cpa": true,
      "sub2api": true,
      "logs": true,
      "image_tasks": true,
      "accounts_snapshot": true,
      "auth_keys_snapshot": true,
      "images": false
    }
  },
  "image_account_concurrency": 3
}
JSON
chmod 600 'config.json'
```

把 `replace-with-your-long-random-auth-key` 替换成刚才生成的随机字符串，把 `https://api.example.com` 替换成你的实际域名。`base_url` 用于生成图片结果访问地址，公网部署时不要留成空值。

#### 4. 创建 Docker Compose 文件

注意：下面命令会完整写入 `docker-compose.yml`，请从 `tee` 这一行一直复制到最后的 `YAML` 结束标记。不要只复制中间的 `app:` 片段，否则会缺少最外层 `services:`，运行时就会报 `yaml: line 11: did not find expected key`。

```bash
tee 'docker-compose.yml' > '/dev/null' <<'YAML'
services:
  app:
    image: ghcr.io/basketikun/chatgpt2api:latest
    container_name: chatgpt2api
    restart: unless-stopped
    ports:
      - '127.0.0.1:3000:80'
    volumes:
      - './data:/app/data'
      - './config.json:/app/config.json'
    environment:
      STORAGE_BACKEND: json
      CHATGPT2API_AUTH_KEY: 'replace-with-your-long-random-auth-key'
      CHATGPT2API_BASE_URL: 'https://api.example.com'
      # 可选：使用 NewAPI 作为生图上游时打开下面几行
      # CHATGPT2API_IMAGE_PROVIDER: 'newapi'
      # CHATGPT2API_NEWAPI_BASE_URL: 'https://newapi.example.com'
      # CHATGPT2API_NEWAPI_API_KEY: 'sk-...'
      # CHATGPT2API_NEWAPI_IMAGE_MODEL: 'gpt-image-1'
      # CHATGPT2API_NEWAPI_TIMEOUT_SEC: '300'
YAML
```

同样把 `replace-with-your-long-random-auth-key` 和 `https://api.example.com` 替换成实际值。这里同时配置 `CHATGPT2API_AUTH_KEY`，用于覆盖 `config.json` 中的 `auth-key`，避免误用默认密钥。

启动前可以先检查 YAML 是否能被 Compose 正确解析：

```bash
docker compose config
```

如果你暂时没有域名，只想用 `http://服务器IP:3000` 测试，可以把端口映射改成：

```yaml
ports:
  - '3000:80'
```

这种方式会把服务直接暴露到公网，只建议临时排查使用。

#### 5. 启动服务并本机验证

```bash
cd '/opt/chatgpt2api'
docker compose pull
docker compose up -d
docker compose ps
docker logs --tail 100 'chatgpt2api'
curl -i 'http://127.0.0.1:3000/v1/models' -H 'Authorization: Bearer replace-with-your-long-random-auth-key'
```

能看到 `200 OK` 或模型列表，说明容器本身已经启动成功。如果这里都不通，先看 `docker logs --tail 200 'chatgpt2api'`，不要急着配 Nginx。

#### 6. 配置 Nginx 反向代理

创建站点配置：

```bash
sudo tee '/etc/nginx/sites-available/chatgpt2api.conf' > '/dev/null' <<'NGINX'
server {
    listen 80;
    server_name api.example.com;

    client_max_body_size 50m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_buffering off;
    }
}
NGINX
sudo ln -sf '/etc/nginx/sites-available/chatgpt2api.conf' '/etc/nginx/sites-enabled/chatgpt2api.conf'
sudo nginx -t
sudo systemctl reload nginx
```

把 `api.example.com` 换成你的域名。此时可以先访问：

```bash
curl -i 'http://api.example.com/v1/models' -H 'Authorization: Bearer replace-with-your-long-random-auth-key'
```

#### 7. 申请 HTTPS 证书

Certbot 官方推荐使用 snap 安装：

```bash
sudo apt install -y snapd
sudo snap install core
sudo snap refresh core
sudo snap install --classic certbot
sudo ln -sf '/snap/bin/certbot' '/usr/local/bin/certbot'
sudo certbot --nginx -d 'api.example.com'
sudo certbot renew --dry-run
```

证书签发成功后，访问地址就是：

- Web 面板：`https://api.example.com`
- OpenAI 兼容 API Base URL：`https://api.example.com/v1`
- API Key：填写你的 `auth-key`

#### 8. 更新版本

```bash
cd '/opt/chatgpt2api'
docker compose pull
docker compose up -d
docker image prune -f
docker logs --tail 100 'chatgpt2api'
```

#### 9. 备份与恢复

至少备份 `config.json` 和 `data/`。其中 `data/` 包含账号池、授权密钥、图片任务、日志与本地缓存图片等运行数据。

```bash
cd '/opt'
sudo tar -czf 'chatgpt2api-backup.tar.gz' 'chatgpt2api/config.json' 'chatgpt2api/data'
```

恢复时：

```bash
cd '/opt'
sudo tar -xzf 'chatgpt2api-backup.tar.gz' -C '/opt'
cd '/opt/chatgpt2api'
docker compose up -d
```

#### 10. 常见问题

| 现象 | 处理方式 |
|:---|:---|
| 启动时报 `auth-key 未设置` | 检查 `config.json` 的 `auth-key` 或 `docker-compose.yml` 的 `CHATGPT2API_AUTH_KEY`，不要使用空值或默认值 |
| Nginx 返回 `502 Bad Gateway` | 先执行 `docker compose ps` 和 `curl -i 'http://127.0.0.1:3000/v1/models' -H 'Authorization: Bearer <auth-key>'`，确认容器本机端口可访问 |
| 公网图片链接打不开 | 检查 `CHATGPT2API_BASE_URL` 或设置页里的基础地址是否为 `https://你的域名` |
| 上传图片时报 `413 Request Entity Too Large` | 调大 Nginx 配置里的 `client_max_body_size` |
| 访问 `服务器IP:3000` 不通 | 如果 Compose 使用 `127.0.0.1:3000:80`，这是正常的；公网入口应走 Nginx 的 `80/443` |
| 使用云防火墙仍能访问容器端口 | Docker 暴露端口可能绕过部分主机防火墙规则，生产环境优先使用 `127.0.0.1:3000:80` 再由 Nginx 反代 |

### 本地开发

启动后端：

```bash
git clone git@github.com:basketikun/chatgpt2api.git
cd chatgpt2api
uv sync
uv run main.py
```

启动前端：

```bash
cd chatgpt2api/web
bun install
bun run dev
```

后续更新新版本：

```bash
docker pull ghcr.io/basketikun/chatgpt2api:latest
docker compose down
docker compose up -d

```

### 存储后端配置

支持通过环境变量 `STORAGE_BACKEND` 切换存储方式：

- `json` - 本地 JSON 文件（默认）
- `sqlite` - 本地 SQLite 数据库
- `postgres` - 外部 PostgreSQL（需配置 `DATABASE_URL`）
- `git` - Git 私有仓库（需配置 `GIT_REPO_URL` 和 `GIT_TOKEN`）

示例：使用 PostgreSQL

```yaml
environment:
  - STORAGE_BACKEND=postgres
  - DATABASE_URL=postgresql://user:password@host:5432/dbname
```

## 功能

### API 兼容能力

- 兼容 `POST /v1/images/generations` 图片生成接口
- 兼容 `POST /v1/images/edits` 图片编辑接口
- 兼容面向图片场景的 `POST /v1/chat/completions`
- 兼容面向图片场景的 `POST /v1/responses`
- `GET /v1/models` 返回 `gpt-image-2`、`codex-gpt-image-2`、`auto`、`gpt-5`、`gpt-5-1`、`gpt-5-2`、`gpt-5-3`、`gpt-5-3-mini`、
  `gpt-5-mini`
- 支持通过 `n` 返回多张生成结果
- 支持 Codex 中的画图接口逆向，仅 `Plus` / `Team` / `Pro` 订阅可用，模型别名为 `codex-gpt-image-2`，如有需要可自行在其他场景映射回
  `gpt-image-2`，用于和官网画图区分；也就意味着同一账号会同时有官网和 Codex 两份生图额度

### 在线画图功能

- 内置在线画图工作台，支持生成、图片编辑与多图组图编辑
- 支持 `gpt-image-2`、`codex-gpt-image-2`、`auto`、`gpt-5`、`gpt-5-1`、`gpt-5-2`、`gpt-5-3`、`gpt-5-3-mini`、`gpt-5-mini` 模型选择
- 编辑模式支持参考图上传
- 前端支持多图生成交互
- 本地保存图片会话历史，支持回看、删除和清空
- 支持服务端缓存图片URL
- **预设提示词库**：内置多风格图片提示词，`/prompts` 页面浏览/收藏/检索，工作台一键应用
- **画布工作台**：`/canvas` 节点化编排，节点连线后下游节点自动把上游图作为参考图喂入图片编辑接口

### 号池管理功能

- 自动刷新账号邮箱、类型、额度和恢复时间
- 轮询可用账号执行图片生成与图片编辑
- 遇到 Token 失效类错误时自动剔除无效 Token
- 定时检查限流账号并自动刷新
- 支持网页端配置全局 HTTP / HTTPS / SOCKS5 / SOCKS5H 代理
- 支持搜索、筛选、批量刷新、导出、手动编辑和清理账号
- 支持四种导入方式：本地 CPA JSON 文件导入、远程 CPA 服务器导入、`sub2api` 服务器导入、`access_token` 导入
- 支持在设置页配置 `sub2api` 服务器，筛选并批量导入其中的 OpenAI OAuth 账号

### NewAPI 生图提供商

设置页支持在 `ChatGPT 官网号池` 和 `NewAPI 号池` 之间切换生图提供商。默认仍使用本项目内置 ChatGPT 官网号池；切换为 NewAPI 后，`/v1/images/generations`、`/v1/images/edits`、图片版 `/v1/chat/completions`、图片版 `/v1/responses` 和在线画图都会转发到 NewAPI。

NewAPI 的上游凭证只读取环境变量，不会写入 `config.json`，前端只展示是否已配置：

```bash
CHATGPT2API_NEWAPI_BASE_URL=https://newapi.example.com
CHATGPT2API_NEWAPI_API_KEY=sk-...
CHATGPT2API_NEWAPI_IMAGE_MODEL=gpt-image-1
CHATGPT2API_NEWAPI_TIMEOUT_SEC=300
```

- `CHATGPT2API_NEWAPI_BASE_URL` 可填写站点根地址或 `/v1` 地址。
- `CHATGPT2API_NEWAPI_IMAGE_MODEL` 留空时默认 `gpt-image-1`；设为 `passthrough` 时会把请求中的 `model` 原样传给 NewAPI。
- NewAPI 内部的渠道 / Multi-Key 号池调度由 NewAPI 自己负责，本项目只作为 OpenAI 兼容图片请求的上游客户端。

### 实验性 / 规划中

- `/v1/complete` 文本补全与流式输出已实现，但仍在测试，目前会出现对话重复的问题，请谨慎测试使用
- 详细状态说明见：[功能清单](./docs/feature-status.en.md)

## Screenshots

文生图界面：

![image](assets/image.png)

编辑图：

![image](assets/image_edit.png)

Cherry Studio 中使用，支持作为绘图接口接入：

![image](assets/chery_studio.png)

号池管理：

![image](assets/account_pool.png)

New Api 接入：

![image](assets/new_api.png)

## API

所有 AI 接口都需要请求头：

```http
Authorization: Bearer <auth-key>
```

<details>
<summary><code>GET /v1/models</code></summary>
<br>

返回当前暴露的图片模型列表。

```bash
curl http://localhost:8001/v1/models \
  -H "Authorization: Bearer <auth-key>"
```

<details>
<summary>说明</summary>
<br>

| 字段   | 说明                                                                                                         |
|:-----|:-----------------------------------------------------------------------------------------------------------|
| 返回模型 | `gpt-image-2`、`codex-gpt-image-2`、`auto`、`gpt-5`、`gpt-5-1`、`gpt-5-2`、`gpt-5-3`、`gpt-5-3-mini`、`gpt-5-mini` |
| 接入场景 | 可接入 Cherry Studio、New API 等上游或客户端                                                                          |

<br>
</details>
</details>

<details>
<summary><code>POST /v1/images/generations</code></summary>
<br>

OpenAI 兼容图片生成接口，用于文生图。

```bash
curl http://localhost:8001/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <auth-key>" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一只漂浮在太空里的猫",
    "n": 1,
    "response_format": "b64_json"
  }'
```

<details>
<summary>字段说明</summary>
<br>

| 字段                | 说明                                                 |
|:------------------|:---------------------------------------------------|
| `model`           | 图片模型，当前可用值以 `/v1/models` 返回结果为准，推荐使用 `gpt-image-2` |
| `prompt`          | 图片生成提示词                                            |
| `n`               | 生成数量，当前后端限制为 `1-4`                                 |
| `response_format` | 当前请求模型中包含该字段，默认值为 `b64_json`                       |

<br>
</details>
</details>

<details>
<summary><code>POST /v1/images/edits</code></summary>
<br>

OpenAI 兼容图片编辑接口，可上传图片文件，也可按官方 JSON 格式传入图片链接并生成编辑结果。

```bash
curl http://localhost:8001/v1/images/edits \
  -H "Authorization: Bearer <auth-key>" \
  -F "model=gpt-image-2" \
  -F "prompt=把这张图改成赛博朋克夜景风格" \
  -F "n=1" \
  -F "image=@./input.png"
```

也可以直接传图片 URL：

```bash
curl http://localhost:8001/v1/images/edits \
  -H "Authorization: Bearer <auth-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "把这张图改成赛博朋克夜景风格",
    "images": [
      {"image_url": "https://example.com/input.png"}
    ]
  }'
```

<details>
<summary>字段说明</summary>
<br>

| 字段          | 说明                                            |
|:------------|:----------------------------------------------|
| `model`     | 图片模型， `gpt-image-2`                           |
| `prompt`    | 图片编辑提示词                                       |
| `n`         | 生成数量，当前后端限制为 `1-4`                            |
| `image`     | 需要编辑的图片文件，使用 multipart/form-data 上传           |
| `images`    | JSON 图片引用数组，支持 `{"image_url": "https://..."}` |
| `image_url` | 表单模式下也可直接传图片链接，支持重复字段传多张图                     |

<br>
</details>
</details>

<details>
<summary><code>POST /v1/chat/completions</code></summary>
<br>

面向图片场景的 Chat Completions 兼容接口，不是完整通用聊天代理。

```bash
curl http://localhost:8001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <auth-key>" \
  -d '{
    "model": "gpt-image-2",
    "messages": [
      {
        "role": "user",
        "content": "生成一张雨夜东京街头的赛博朋克猫"
      }
    ],
    "n": 1
  }'
```

<details>
<summary>字段说明</summary>
<br>

| 字段         | 说明                |
|:-----------|:------------------|
| `model`    | 图片模型，默认按图片生成场景处理  |
| `messages` | 消息数组，需要是图片相关请求内容  |
| `n`        | 生成数量，按当前实现解析为图片数量 |
| `stream`   | 已实现，但仍在测试         |

<br>
</details>
</details>

<details>
<summary><code>POST /v1/responses</code></summary>
<br>

面向图片生成工具调用的 Responses API 兼容接口，不是完整通用 Responses API 代理。

```bash
curl http://localhost:8001/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <auth-key>" \
  -d '{
    "model": "gpt-5",
    "input": "生成一张未来感城市天际线图片",
    "tools": [
      {
        "type": "image_generation"
      }
    ]
  }'
```

<details>
<summary>字段说明</summary>
<br>

| 字段       | 说明                            |
|:---------|:------------------------------|
| `model`  | 响应中会回显该模型字段，但图片生成当前仍走图片生成兼容逻辑 |
| `input`  | 输入内容，需要能解析出图片生成提示词            |
| `tools`  | 必须包含 `image_generation` 工具请求  |
| `stream` | 已实现，但仍在测试                     |

<br>
</details>
</details>

## 社区支持

学 AI , 上 L 站：[LinuxDO](https://linux.do)

## Contributors

感谢所有为本项目做出贡献的开发者：

<a href="https://github.com/basketikun/chatgpt2api/graphs/contributors">
  <img alt="Contributors" src="https://contrib.rocks/image?repo=basketikun/chatgpt2api" />
</a>

## Star History

[![Star History Chart](https://api.star-history.com/chart?repos=basketikun/chatgpt2api&type=date&legend=top-left)](https://www.star-history.com/?repos=basketikun%2Fchatgpt2api&type=date&legend=top-left)

