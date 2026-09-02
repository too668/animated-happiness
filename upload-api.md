# YOO Upload API

上传任意文件到 S3 存储（iDrive e2），支持最大 5GB，不限格式。

---

## 认证

所有请求需要携带 API Key，两种方式任选：

```
Authorization: Bearer yoo_xxxxxxxxxxxxxxxxxxxxxxxx
```

或查询参数：

```
?key=yoo_xxxxxxxxxxxxxxxxxxxxxxxx
```

> API Key 在管理后台 → API Keys 卡片创建，需勾选 `upload` 权限。

---

## 上传流程（两步）

### 第 1 步：获取签名上传地址

```
POST https://yooy.cc.cd/api/upload-url?storage=s3
Content-Type: application/json
Authorization: Bearer yoo_xxxxxxxxxxxxxxxxxxxxxxxx
```

**请求体：**

```json
{
  "filename": "video.mp4",
  "size": 104857600,
  "contentType": "video/mp4",
  "folder": "videos/2024"
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `filename` | 是 | 原始文件名，用于生成唯一 key |
| `size` | 是 | 文件大小（字节），S3 上限 5GB |
| `contentType` | 否 | MIME 类型，默认 `application/octet-stream` |
| `folder` | 否 | 目标文件夹路径，如 `photos/vacation` |

**成功响应：**

```json
{
  "ok": true,
  "key": "uploads/videos/2024/a1b2c3-video.mp4",
  "url": "https://yooy.cc.cd/i/uploads/videos/2024/a1b2c3-video.mp4",
  "uploadUrl": "https://s3.ap-northeast-1.idrivee2.com/yoo/uploads/...?X-Amz-Signature=...",
  "expiresAt": 1725123456000,
  "contentType": "video/mp4",
  "method": "PUT",
  "storage": "s3"
}
```

| 字段 | 说明 |
|---|---|
| `key` | 文件在存储中的唯一路径 |
| `url` | 文件公开访问地址（通过 `/i/` 出图/出文件） |
| `uploadUrl` | 签名上传地址，有效期 10 分钟 |
| `expiresAt` | 签名过期时间戳（毫秒） |

---

### 第 2 步：直传文件到 S3

用第 1 步返回的 `uploadUrl`，直接 PUT 文件：

```
PUT {uploadUrl}
Content-Type: {contentType}

<文件二进制内容>
```

**示例（curl）：**

```bash
curl -X PUT \
  -H "Content-Type: video/mp4" \
  --data-binary @video.mp4 \
  "https://s3.ap-northeast-1.idrivee2.com/yoo/uploads/...?X-Amz-Signature=..."
```

成功返回 HTTP 200/204，无响应体。

---

## 完整示例

### curl

```bash
# 1. 获取签名 URL
UPLOAD_URL=$(curl -s -X POST "https://yooy.cc.cd/api/upload-url?storage=s3" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer yoo_xxxxxxxxxxxxxxxxxxxxxxxx" \
  -d '{"filename":"archive.zip","size":52428800,"contentType":"application/zip"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['uploadUrl'])")

# 2. 上传文件
curl -X PUT \
  -H "Content-Type: application/zip" \
  --data-binary @archive.zip \
  "$UPLOAD_URL"
```

### JavaScript (fetch)

```javascript
async function uploadToS3(file, folder) {
  // 1. 获取签名 URL
  const res = await fetch('/api/upload-url?storage=s3', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer yoo_xxxxxxxxxxxxxxxxxxxxxxxx'
    },
    body: JSON.stringify({
      filename: file.name,
      size: file.size,
      contentType: file.type || 'application/octet-stream',
      folder: folder || ''
    })
  });
  const { ok, uploadUrl, url } = await res.json();
  if (!ok) throw new Error('获取上传地址失败');

  // 2. 直传
  await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file
  });

  return url; // 文件公开访问地址
}
```

### Python

```python
import requests

API_KEY = "yoo_xxxxxxxxxxxxxxxxxxxxxxxx"
BASE = "https://yooy.cc.cd"

def upload(filepath, folder=""):
    with open(filepath, "rb") as f:
        import os
        size = os.path.getsize(filepath)
        name = os.path.basename(filepath)

    # 1. 获取签名 URL
    res = requests.post(f"{BASE}/api/upload-url", 
        params={"storage": "s3"},
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}"
        },
        json={
            "filename": name,
            "size": size,
            "contentType": "application/octet-stream",
            "folder": folder
        }
    ).json()

    if not res["ok"]:
        raise Exception(res["error"])

    # 2. 直传
    with open(filepath, "rb") as f:
        requests.put(res["uploadUrl"],
            headers={"Content-Type": "application/octet-stream"},
            data=f
        )

    return res["url"]

# 使用
url = upload("bigfile.iso", folder="isos")
print(f"上传完成：{url}")
```

---

## 文件访问

上传完成后，文件通过 `/i/` 路由访问：

```
https://yooy.cc.cd/i/{key}
```

例如：`https://yooy.cc.cd/i/uploads/videos/2024/a1b2c3-video.mp4`

---

## 限制

| 项目 | 限制 |
|---|---|
| 单文件大小 | S3: 5GB / Blob: 20MB |
| 签名有效期 | 10 分钟 |
| 文件格式 | 无限制 |
| 并发上传 | 无限制 |

> 如果需要上传到腾讯 Blob 存储，将 `storage=s3` 改为 `storage=blob`（上限 20MB）。
