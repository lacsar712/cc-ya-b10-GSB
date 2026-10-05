# 风机偏航对中台

现场技师登记机组编号与偏航误差（度）；后台 worker 用数据库行锁认领待处理记录，按 ±1.5° 阈值写入「合格」或「偏航超差」。前端为 Lit 组件 + Vite，接口为 Quart + Hypercorn。

## 端口

| 服务 | 地址 |
|------|------|
| 页面 | http://localhost:3199 |
| 接口 | http://localhost:8199 |
| PostgreSQL | localhost:54399（库名 `yawalign`） |

## 账号

| 用户 | 密码 | 权限 |
|------|------|------|
| technician | tech123456 | 可提交 |
| observer | obs123456 | 只读 |

## 启动

```bash
cd projects/20-yaw-align-log
docker compose up --build
```

健康检查：`GET http://localhost:8199/api/health` → `{"status":"ok","service":"yaw-align-log"}`。

## 验收

1. 种子数据：机组 W01 误差 0.4° 结论「合格」；机组 W07 误差 3.2° 结论「偏航超差」。
2. technician 提交新记录后，列表先显示「待处理」，数秒内 worker 处理后变为对应结论。
3. observer 可查看列表，无提交表单。

### 夜间稀采样提醒（顶栏灯 + 专页）

夜间运维稀疏时段办结条数过少时，顶栏亮「夜间稀采样提醒」灯并在专页记一条流水；**提醒仅提示，任何情况下都不拦截报送**（`POST /api/logs` 与提醒判定完全解耦）。判定只使用**服务端时钟**（数据库 `CURRENT_TIMESTAMP`），不采信浏览器时钟。

- 专页（点顶栏灯进入）：展示服务端时钟、当前是否夜间窗、窗内办结数、阈值与灯状态；technician 可设置夜间起止小时（支持跨午夜，如 22→6）与低样本阈值、清空当前窗内办结；observer 只读阈值与提醒流水。
- 亮灯：处于夜间窗 且 窗内 `done` 办结数 < 阈值；边沿触发写流水（恢复到阈值以上自动解除）。
- 灭灯：办结数恢复至阈值及以上，或窗被挪到白天。
- 接口：`GET /api/night-alert/status|config|events`（登录可读），`PUT /api/night-alert/config`、`POST /api/night-alert/clear-recent-done`（仅 technician）。
- 复现：把夜间窗调到覆盖服务端当前时间 → 清空近窗办结 → 灯亮并有流水，期间报送照常受理并被 worker 处理；把窗挪到白天 → 灯灭并记解除流水。

## 技术栈

- 后端：Quart、psycopg、`worker.py`（`FOR UPDATE SKIP LOCKED`）、Hypercorn
- 前端：Lit、TypeScript、Vite；生产镜像内 nginx 反代 `/api`
- 镜像源：DaoCloud 基础镜像、清华 PyPI、npmmirror npm
