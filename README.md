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
4. 夜间稀采样提醒（只亮灯、不挡报送）：
   - 顶栏有「夜间稀采样提醒」灯，点击进入专页，可看服务端当前时间、是否夜间窗、
     近窗办结数/阈值与提醒流水。
   - 把夜间时段调到覆盖当前时刻、且近窗办结数低于阈值时，提醒灯点亮并新增一条流水；
     同一夜间窗重复判定只记一条。
   - 灯亮期间 technician 报送仍返回 201，worker 照常处理——提醒不参与写口，
     任何情况下都不会拒收白天/夜间正常报送。
   - 把夜间时段挪到白天（不覆盖当前）后，提醒灯熄灭，不再产生流水，报送照常。
   - observer 只读：可看阈值与提醒历史，修改设置返回 403。
   - 判定一律以服务端时钟与站点时区（默认 `Asia/Shanghai`）为准，支持跨午夜窗口
     （默认 22:00–06:00）。

## 夜间稀采样接口

| 方法 | 路径 | 权限 | 说明 |
|------|------|------|------|
| GET | `/api/night/status` | 登录 | 服务端时钟判定的灯状态（并幂等补写流水） |
| GET | `/api/night/history` | 登录 | 提醒流水（每个夜间窗一条） |
| PUT | `/api/night/settings` | 仅 technician | 设置时区、窗起止 `HH:MM`、低样本阈值 |

相关环境变量：`NIGHT_TIMEZONE`（默认 Asia/Shanghai）、`NIGHT_WINDOW_START`、
`NIGHT_WINDOW_END`、`NIGHT_LOW_SAMPLE_THRESHOLD`（默认 5）、
`NIGHT_EVAL_INTERVAL_SEC`（worker 判定周期，默认 10 秒）。

## 技术栈

- 后端：Quart、psycopg、`worker.py`（`FOR UPDATE SKIP LOCKED`）、Hypercorn
- 前端：Lit、TypeScript、Vite；生产镜像内 nginx 反代 `/api`
- 镜像源：DaoCloud 基础镜像、清华 PyPI、npmmirror npm
