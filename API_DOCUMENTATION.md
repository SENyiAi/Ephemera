# Ephemera API 2.0 完整文档

## 概述

Ephemera API 2.0 是 Alice EVO Cloud 的 RESTful 风格 API，用于管理云计算实例和账户信息。

**基础 URL**: `https://app.alice.ws`

**API 版本**: v1

**文档更新日期**: 2025-11-23

## 认证

所有 API 请求都需要使用 Bearer Token 认证。

### 认证方式

在 HTTP 请求头中添加：

```
Authorization: Bearer {CLIENT_ID}:{SECRET}
```

### 示例认证令牌格式

```
cli_3513398930150a8:8b82a40a06e53e3a5d70ccc8fe6376abdea07eae532634f6e03ba47c138f2b51
```

## 响应格式

所有 API 响应均为 JSON 格式，标准响应结构如下：

```json
{
  "code": 200,
  "data": {},
  "message": "success"
}
```

---

## API 端点

### 1. 账户管理 (Account)

#### 1.1 获取用户资料

获取当前登录用户的基本信息。

**端点**: `GET /cli/v1/account/profile`

**请求头**:
```
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "code": 200,
  "data": {
    "address_1": " Default address",
    "address_2": null,
    "city": "Default City",
    "country": "Zimbabwe",
    "credit": 11111,
    "default_card": -1,
    "email": "test@alice.ws",
    "fullname": "Default Full Name",
    "github_id": null,
    "google_id": null,
    "grade": 1,
    "id": 1,
    "language": "zh-cn",
    "lastlogin_date": "2025-11-23T10:43:09Z",
    "lastlogin_ip": "127.0.0.1",
    "max_instances": 10,
    "points": 126970,
    "points_spent": 19960,
    "postcode": "00001",
    "register_date": "2024-10-26T17:29:57+01:00",
    "register_ip": "127.0.0.1",
    "risk_amnesty_period": "2024-11-17T22:40:58Z",
    "status": 1,
    "total_spent": 13853400,
    "updated_at": "2025-11-23T12:00:43Z",
    "username": "test"
  },
  "message": "success"
}
```

**字段说明**:
- `credit`: 账户余额
- `max_instances`: 最大可创建实例数
- `points`: 当前积分
- `points_spent`: 已使用积分
- `total_spent`: 总消费金额
- `grade`: 用户等级

---

#### 1.2 获取 SSH 密钥列表

获取当前用户的所有 SSH 密钥。

**端点**: `GET /cli/v1/account/ssh-keys`

**请求头**:
```
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "code": 200,
  "data": [
    {
      "id": 1095,
      "user_id": 1,
      "name": "1",
      "node": 1,
      "sid": 1101,
      "publickey": "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC...",
      "created_at": "2025-10-13T06:36:29+01:00"
    }
  ],
  "message": "Success"
}
```

**字段说明**:
- `id`: SSH 密钥 ID
- `name`: 密钥名称
- `publickey`: SSH 公钥内容
- `created_at`: 创建时间

---

### 2. EVO 实例管理 (EVO Instances)

#### 2.1 获取 EVO 权限信息

查询当前用户的 EVO 服务权限和限制。

**端点**: `GET /cli/v1/evo/permissions`

**请求头**:
```
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "code": 200,
  "data": {
    "allow_packages": "38|39|40|41|42",
    "max_time": 999,
    "plan": "Ephemera.VelocityX",
    "plan_id": 3,
    "user_id": 1
  },
  "message": "EVO permissions"
}
```

**字段说明**:
- `allow_packages`: 允许使用的套餐 ID 列表（用 `|` 分隔）
- `max_time`: 最大使用时长（小时）
- `plan`: 当前订阅计划名称
- `plan_id`: 计划 ID

---

#### 2.2 获取 EVO 套餐列表

获取所有可用的 EVO 实例套餐配置。

**端点**: `GET /cli/v1/evo/plans`

**请求头**:
```
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "code": 200,
  "data": [
    {
      "id": 38,
      "group_id": 7,
      "type": "evo-server",
      "name": "SLC.Evo.Micro",
      "billing_mode": 1,
      "hidden": 1,
      "stock": 87,
      "vm_hour_price": 0,
      "backup_hour_price": 0,
      "additional_hour_price": 0,
      "traffic_price": 0,
      "disk_type": "NVMe",
      "cpu": 2,
      "memory": 4096,
      "disk": 60,
      "upload_speed": 64000,
      "download_speed": 640000,
      "show_speed": "500↑ / 5000↓ Mbps",
      "os": "1|2|3|4|5|6|7|8|9|10|13",
      "region": 2,
      "node": 1,
      "resource_pricing_group": 3,
      "supports_ipv4": 1,
      "supports_ipv6": 1,
      "default_ipv4_count": 1,
      "max_ipv4_count": 1,
      "supports_backup": 0,
      "backup_count": 0,
      "cpu_name": "AMD EPYC™ 9654 Genoa",
      "routes": "No Route Guarantee",
      "recommend": 0,
      "status": 1
    }
  ],
  "message": "Success"
}
```

**可用套餐**:
1. **SLC.Evo.Micro** (ID: 38)
   - CPU: 2 核 AMD EPYC™ 9654 Genoa
   - 内存: 4 GB
   - 磁盘: 60 GB NVMe
   - 网络: 500↑ / 5000↓ Mbps

2. **SLC.Evo.Standard** (ID: 39)
   - CPU: 4 核 AMD EPYC™ 9654 Genoa
   - 内存: 8 GB
   - 磁盘: 120 GB NVMe
   - 网络: 500↑ / 5000↓ Mbps

3. **SLC.Evo.Pro** (ID: 40)
   - CPU: 8 核 AMD EPYC™ 9654 Genoa
   - 内存: 16 GB
   - 磁盘: 200 GB NVMe
   - 网络: 500↑ / 5000↓ Mbps

4. **SLC.Evo.Ultra** (ID: 41)
   - CPU: 16 核 AMD EPYC™ 9654 Genoa
   - 内存: 32 GB
   - 磁盘: 300 GB NVMe
   - 网络: 500↑ / 5000↓ Mbps

5. **SLC.Evo.GPU-Ultra** (ID: 42)
   - CPU: 8 核 AMD EPYC™ 9654 Genoa
   - GPU: NVIDIA RTX A4000
   - 内存: 32 GB
   - 磁盘: 1000 GB NVMe
   - 网络: 500↑ / 5000↓ Mbps

**字段说明**:
- `stock`: 库存数量
- `disk_type`: 磁盘类型
- `memory`: 内存大小（MB）
- `disk`: 磁盘大小（GB）
- `supports_ipv4`/`supports_ipv6`: 是否支持 IPv4/IPv6

---

#### 2.3 获取套餐可用操作系统

根据套餐 ID 获取该套餐支持的所有操作系统镜像。

**端点**: `GET /cli/v1/evo/plans/:id/os-images`

**路径参数**:
- `id` (必需): 套餐 ID

**请求示例**:
```
GET /cli/v1/evo/plans/38/os-images
```

**响应示例**:
```json
{
  "code": 200,
  "data": [
    {
      "group_id": 4,
      "group_name": "AlmaLinux",
      "logo": "/assets/image/logos/os-alma-linux.svg",
      "os_list": [
        {
          "id": 7,
          "name": "AlmaLinux 8 Minimal",
          "port": 22,
          "username": "root"
        },
        {
          "id": 8,
          "name": "AlmaLinux 9 Latest",
          "port": 22,
          "username": "root"
        }
      ]
    },
    {
      "group_id": 1,
      "group_name": "Debian",
      "logo": "/assets/image/logos/os-debian.svg",
      "os_list": [
        {
          "id": 1,
          "name": "Debian 12 (Bookworm) Minimal",
          "port": 22,
          "username": "root"
        },
        {
          "id": 2,
          "name": "Debian 11 (Bullseye) Minimal",
          "port": 22,
          "username": "root"
        },
        {
          "id": 10,
          "name": "Debian 12 DevKit",
          "port": 22,
          "username": "root"
        },
        {
          "id": 13,
          "name": "Debian 13 (Trixie) Minimal",
          "port": 22,
          "username": "root"
        }
      ]
    }
  ],
  "message": "Success"
}
```

**可用操作系统**:
- **AlmaLinux**: 7 (AlmaLinux 8), 8 (AlmaLinux 9)
- **Alpine Linux**: 9 (Alpine Linux 3.19)
- **Debian**: 1 (Debian 12), 2 (Debian 11), 10 (Debian 12 DevKit), 13 (Debian 13)
- **Ubuntu**: 3 (Ubuntu 20.04 LTS), 4 (Ubuntu 22.04 LTS)
- **CentOS**: 5 (CentOS 7), 6 (CentOS Stream 9)

---

#### 2.4 部署 EVO 实例

创建并部署一个新的 EVO 实例。

**端点**: `POST /cli/v1/evo/instances/deploy`

**请求头**:
```
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:
```json
{
  "product_id": 38,
  "os_id": 1,
  "time": 24,
  "ssh_key_id": null,
  "boot_script": "c3VkbyBhcHQtZ2V0IGluc3RhbGwgY3VybA=="
}
```

**参数说明**:
- `product_id` (必需): 套餐 ID
- `os_id` (必需): 操作系统 ID
- `time` (必需): 使用时长（小时）
- `ssh_key_id` (可选): SSH 密钥 ID
- `boot_script` (可选): Base64 编码的启动脚本

**响应示例**:
```json
{
  "code": 200,
  "data": {
    "boot_script_uid": "82b0996d-301b-4a8e-b3a8-dcb2024ce5c4",
    "cpu": 2,
    "cpu_name": "AMD EPYC™ 9654 Genoa",
    "creation_at": "2025-11-23 14:25:25",
    "disk": 60,
    "disk_type": "NVMe",
    "download_speed": 640000,
    "expiration_at": "2025-11-24 14:25:25",
    "hostname": "kuraya.evo.host.aliceinit.dev",
    "id": 15238,
    "ipv4": "31.22.111.24",
    "ipv6": "2a14:67c0:601::16",
    "memory": 4096,
    "os": "Debian 12 (Bookworm) Minimal",
    "os_group": "Debian",
    "os_group_id": 1,
    "os_id": 1,
    "password": "BKyOxmy01fKiB3jU4zeJ",
    "plan": "SLC.Evo.Micro",
    "plan_id": 38,
    "region": "Salt Lake City",
    "region_id": 2,
    "routes": "No Route Guarantee",
    "show_speed": "500↑ / 5000↓ Mbps",
    "status": "active",
    "uid": "89d69459-f25d-4c38-96bb-ee452de88b9f",
    "upload_speed": 64000,
    "user": "root"
  },
  "message": "Created successfully!"
}
```

**返回字段说明**:
- `id`: 实例数据库 ID
- `uid`: 实例唯一标识符
- `hostname`: 实例主机名
- `ipv4`/`ipv6`: IP 地址
- `password`: root 用户密码
- `creation_at`: 创建时间
- `expiration_at`: 到期时间

---

#### 2.5 获取实例列表

获取当前用户的所有 EVO 实例。

**端点**: `GET /cli/v1/evo/instances`

**请求头**:
```
Authorization: Bearer <token>
```

**响应示例**:
```json
{
  "code": 200,
  "data": [
    {
      "cpu": 2,
      "cpu_name": "AMD EPYC™ 9654 Genoa",
      "creation_at": "2025-11-23T14:25:25Z",
      "disk": "60",
      "disk_type": "NVMe",
      "download_speed": 640000,
      "expiration_at": "2025-11-24T14:25:25Z",
      "hostname": "test.evo.host.aliceinit.dev",
      "id": 15238,
      "ipv4": "31.22.111.24",
      "ipv6": "2a14:67c0:601::16",
      "last_recorded_traffic": null,
      "last_reset_at": null,
      "memory": 4096,
      "os": "Debian 12 (Bookworm) Minimal",
      "os_group": "Debian",
      "os_group_id": 1,
      "os_id": 1,
      "password": "BKyOxmy01fKiB3jU4zeJ",
      "plan": "SLC.Evo.Micro",
      "plan_id": 38,
      "region": "Salt Lake City",
      "region_id": 2,
      "routes": "No Route Guarantee",
      "show_speed": "500↑ / 5000↓ Mbps",
      "status": "active",
      "uid": "89d69459-f25d-4c38-96bb-ee452de88b9f",
      "upload_speed": 64000,
      "user": "root"
    }
  ],
  "message": "success"
}
```

---

#### 2.6 删除 EVO 实例

删除（销毁）指定的 EVO 实例。

**端点**: `DELETE /cli/v1/evo/instances/:id`

**路径参数**:
- `id` (必需): 实例 ID

**请求示例**:
```
DELETE /cli/v1/evo/instances/15238
```

**响应示例**:
```json
{
  "code": 200,
  "data": null,
  "message": "Destroyed successfully!"
}
```

---

#### 2.7 获取实例状态

获取 EVO 实例的详细状态信息，包括 CPU、内存、网络等实时数据。

**端点**: `GET /cli/v1/evo/instances/:id/state`

**路径参数**:
- `id` (必需): 实例 ID

**请求示例**:
```
GET /cli/v1/evo/instances/15242/state
```

**响应示例**:
```json
{
  "code": 200,
  "data": {
    "cpu": 2,
    "cpu_name": "AMD EPYC™ 9654 Genoa",
    "disk": 60,
    "download_speed": 640000,
    "ipv4": [
      {
        "address": "31.22.111.24",
        "gateway": "31.22.111.1",
        "netmask": "255.255.255.0",
        "resolver1": "8.8.8.8",
        "resolver2": "8.8.4.4"
      }
    ],
    "ipv4_primary": "31.22.111.24",
    "ipv6": [
      {
        "subnet": "2a14:67c0:601::16",
        "cidr": 128,
        "gateway": "2a14:67c0:601::1",
        "resolver1": "2001:4860:4860::8888",
        "resolver2": "2001:4860:4860::8844",
        "addresses": [
          "2a14:67c0:601::16"
        ]
      }
    ],
    "ipv6_primary": "2a14:67c0:601::16",
    "memory": 4096,
    "name": "SLC.Evo.Micro",
    "state": {
      "memory": {
        "memtotal": 3861012,
        "memfree": 3375160,
        "memavailable": 3369640
      },
      "cpu": 0,
      "state": "running",
      "traffic": {
        "in": 137527,
        "out": 23452,
        "total": 160979
      }
    },
    "status": "complete",
    "system": {
      "group_name": "Debian",
      "logo": "/assets/image/logos/os-debian.svg",
      "name": "Debian 12 (Bookworm) Minimal",
      "path": "15"
    },
    "upload_speed": 64000
  },
  "message": null
}
```

**字段说明**:
- `state.state`: 实例运行状态（running, stopped 等）
- `state.cpu`: CPU 使用率（百分比）
- `state.memory`: 内存使用情况（KB）
- `state.traffic`: 流量统计（字节）
- `ipv4`/`ipv6`: 网络配置详情

---

#### 2.8 实例电源操作

控制实例的电源状态（启动、关机、重启等）。

**端点**: `POST /cli/v1/evo/instances/:id/power`

**路径参数**:
- `id` (必需): 实例 ID

**请求头**:
```
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:
```json
{
  "action": "shutdown"
}
```

**可用操作**:
- `boot`: 启动实例
- `shutdown`: 正常关机
- `restart`: 重启实例
- `poweroff`: 强制关机

**响应示例**:
```json
{
  "code": 200,
  "data": null,
  "message": "Success"
}
```

---

#### 2.9 重装实例系统

重新安装 EVO 实例的操作系统。

**端点**: `POST /cli/v1/evo/instances/:id/rebuild`

**路径参数**:
- `id` (必需): 实例 ID

**请求头**:
```
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:
```json
{
  "os_id": 1,
  "ssh_key_id": null,
  "boot_script": "c3VkbyBhcHQtZ2V0IGluc3RhbGwgY3VybA=="
}
```

**参数说明**:
- `os_id` (必需): 新的操作系统 ID
- `ssh_key_id` (可选): SSH 密钥 ID
- `boot_script` (可选): Base64 编码的启动脚本

**响应示例**:
```json
{
  "code": 200,
  "data": {
    "boot_script_uid": "0c9bbec9-99c0-44d0-bf79-9516f88862fa",
    "hostname": "test.evo.host.aliceinit.dev",
    "ipv4": "31.22.111.24",
    "ipv6": "2a14:67c0:601::16",
    "password": "nPczBLOcPBqYpJbZZAYK",
    "sshkey": null
  },
  "message": "Success"
}
```

**注意**: 重装系统会生成新的 root 密码。

---

#### 2.10 续费实例

为 EVO 实例增加使用时长。

**端点**: `POST /cli/v1/evo/instances/:id/renewals`

**路径参数**:
- `id` (必需): 实例 ID

**请求头**:
```
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:
```json
{
  "time": 1
}
```

**参数说明**:
- `time` (必需): 续费时长（小时）

**响应示例**:
```json
{
  "code": 200,
  "data": {
    "added_hours": 1,
    "expiration_at": "2025-11-24 16:42:26",
    "total_service_hours": 25
  },
  "message": "Server renewal successful. New expiration date: 2025-11-24 16:42:26"
}
```

---

#### 2.11 在实例上执行命令

在指定的 EVO 实例上异步执行远程命令。

**端点**: `POST /cli/v1/evo/instances/:id/exec`

**路径参数**:
- `id` (必需): 实例 ID

**请求头**:
```
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:
```json
{
  "command": "Y3VybCAtZnNTTCBodHRwczovL2dldC5kb2NrZXIuY29tIHwgc2gK"
}
```

**参数说明**:
- `command` (必需): Base64 编码的 Shell 命令

**响应示例**:
```json
{
  "code": 200,
  "data": {
    "command_uid": "44313048-1f5b-4c34-bae9-46135bf76a4e"
  },
  "message": "Command created successfully"
}
```

**命令编码示例** (Bash):
```bash
echo -n "curl -fsSL https://get.docker.com | sh" | base64
```

**返回的 `command_uid` 用于后续查询命令执行结果。**

---

#### 2.12 获取命令执行结果

查询之前执行的远程命令的结果。

**端点**: `GET /cli/v1/evo/instances/:id/exec/:uid`

**路径参数**:
- `id` (必需): 实例 ID
- `uid` (必需): 命令 UID（从执行命令 API 返回）

**请求示例**:
```
GET /cli/v1/evo/instances/15242/exec/44313048-1f5b-4c34-bae9-46135bf76a4e
```

**响应示例**:
```json
{
  "code": 200,
  "data": {
    "output": "IyBFeGVjdXRpbmcgZG9ja2VyIGluc3RhbGwgc2NyaXB0...",
    "result": "success",
    "status": "fetched"
  },
  "message": "success"
}
```

**字段说明**:
- `status`: 命令状态
  - `pending`: 等待执行
  - `running`: 执行中
  - `fetched`: 已获取结果
- `result`: 执行结果（`success` 或 `error`）
- `output`: Base64 编码的命令输出

**解码输出示例** (Bash):
```bash
echo "IyBFeGVjdXRpbmcgZG9ja2VyIGluc3RhbGwgc2NyaXB0..." | base64 -d
```

---

## 错误代码

API 使用标准 HTTP 状态码：

| 状态码 | 说明 |
|--------|------|
| 200 | 请求成功 |
| 400 | 请求参数错误 |
| 401 | 未授权（认证失败） |
| 403 | 禁止访问（权限不足） |
| 404 | 资源不存在 |
| 429 | 请求过于频繁 |
| 500 | 服务器内部错误 |

**错误响应格式**:
```json
{
  "code": 400,
  "data": null,
  "message": "Invalid parameters"
}
```

---

## 使用示例

### 完整工作流示例

以下是使用 API 创建和管理 EVO 实例的完整流程：

#### 1. 获取用户信息
```bash
curl -X GET https://app.alice.ws/cli/v1/account/profile \
  -H "Authorization: Bearer cli_3513398930150a8:8b82a40a..."
```

#### 2. 查看可用套餐
```bash
curl -X GET https://app.alice.ws/cli/v1/evo/plans \
  -H "Authorization: Bearer cli_3513398930150a8:8b82a40a..."
```

#### 3. 查看套餐支持的操作系统
```bash
curl -X GET https://app.alice.ws/cli/v1/evo/plans/38/os-images \
  -H "Authorization: Bearer cli_3513398930150a8:8b82a40a..."
```

#### 4. 部署实例
```bash
curl -X POST https://app.alice.ws/cli/v1/evo/instances/deploy \
  -H "Authorization: Bearer cli_3513398930150a8:8b82a40a..." \
  -H "Content-Type: application/json" \
  -d '{
    "product_id": 38,
    "os_id": 1,
    "time": 24,
    "ssh_key_id": null,
    "boot_script": null
  }'
```

#### 5. 查看实例状态
```bash
curl -X GET https://app.alice.ws/cli/v1/evo/instances/15238/state \
  -H "Authorization: Bearer cli_3513398930150a8:8b82a40a..."
```

#### 6. 在实例上执行命令
```bash
# 准备命令（Base64 编码）
COMMAND=$(echo -n "apt update && apt upgrade -y" | base64)

# 执行命令
curl -X POST https://app.alice.ws/cli/v1/evo/instances/15238/exec \
  -H "Authorization: Bearer cli_3513398930150a8:8b82a40a..." \
  -H "Content-Type: application/json" \
  -d "{\"command\": \"$COMMAND\"}"
```

#### 7. 查询命令结果
```bash
curl -X GET https://app.alice.ws/cli/v1/evo/instances/15238/exec/44313048-1f5b-4c34-bae9-46135bf76a4e \
  -H "Authorization: Bearer cli_3513398930150a8:8b82a40a..."
```

#### 8. 续费实例
```bash
curl -X POST https://app.alice.ws/cli/v1/evo/instances/15238/renewals \
  -H "Authorization: Bearer cli_3513398930150a8:8b82a40a..." \
  -H "Content-Type: application/json" \
  -d '{"time": 24}'
```

#### 9. 删除实例
```bash
curl -X DELETE https://app.alice.ws/cli/v1/evo/instances/15238 \
  -H "Authorization: Bearer cli_3513398930150a8:8b82a40a..."
```

---

## 最佳实践

### 1. 启动脚本最佳实践

使用启动脚本自动配置新实例：

```bash
#!/bin/bash
# 更新系统
apt update && apt upgrade -y

# 安装常用工具
apt install -y curl wget git vim htop

# 配置时区
timedatectl set-timezone Asia/Shanghai

# 安装 Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker
```

编码为 Base64：
```bash
cat startup.sh | base64 -w 0
```

### 2. 命令执行监控

执行长时间运行的命令时，建议轮询检查状态：

```bash
#!/bin/bash
INSTANCE_ID=15238
COMMAND_UID="44313048-1f5b-4c34-bae9-46135bf76a4e"

while true; do
  RESULT=$(curl -s -X GET \
    "https://app.alice.ws/cli/v1/evo/instances/$INSTANCE_ID/exec/$COMMAND_UID" \
    -H "Authorization: Bearer cli_xxx:xxx")
  
  STATUS=$(echo $RESULT | jq -r '.data.status')
  
  if [ "$STATUS" = "fetched" ]; then
    echo "命令执行完成"
    echo $RESULT | jq -r '.data.output' | base64 -d
    break
  fi
  
  echo "等待命令执行... 状态: $STATUS"
  sleep 5
done
```

### 3. 实例管理建议

- **定期续费**: 在实例到期前续费，避免实例被销毁
- **监控状态**: 定期调用状态 API 监控实例健康状况
- **备份数据**: 重要数据应定期备份，重装系统会清空所有数据
- **SSH 密钥**: 建议使用 SSH 密钥而非密码登录，更安全

---

## 速率限制

API 请求受到以下速率限制：

- **默认限制**: 每分钟 60 次请求
- **部署/删除实例**: 每小时 10 次
- **命令执行**: 每分钟 30 次

超过限制将返回 HTTP 429 错误。

---

## 支持与反馈

- **官方网站**: https://aliceinit.io
- **API 文档**: https://api.aliceinit.io
- **技术支持**: 通过官网联系支持团队

---

## 更新日志

### v2.0 (2025-11-23)
- 更新为 RESTful 风格 API
- 新增实例状态查询接口
- 新增远程命令执行功能
- 优化响应格式

---

**文档版本**: 2.0  
**最后更新**: 2025-11-23  
**API 基础 URL**: https://app.alice.ws
