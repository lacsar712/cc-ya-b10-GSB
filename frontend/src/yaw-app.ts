import { css, html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";

type LogRow = {
  id: number;
  turbine_code: string;
  yaw_err_deg: number;
  status: string;
  verdict: string | null;
  reason: string | null;
  created_by: string;
  created_at: string;
  processed_at: string | null;
};

type Session = {
  token: string;
  username: string;
  role: string;
};

type NightAlertStatus = {
  server_time: string;
  server_timezone: string;
  server_hour: number;
  in_night_window: boolean;
  window_start_hour: number;
  window_end_hour: number;
  window_start_at: string;
  low_sample_threshold: number;
  done_count_in_window: number;
  alert_active: boolean;
  alert_raised_at: string | null;
  last_evaluated_at: string;
};

type NightAlertConfig = {
  night_start: number;
  night_end: number;
  low_sample_threshold: number;
  alert_active: boolean;
  alert_raised_at: string | null;
  updated_by: string | null;
  updated_at: string | null;
};

type NightAlertEvent = {
  id: number;
  kind: "raised" | "resolved";
  window_start: number;
  window_end: number;
  threshold: number;
  done_count: number;
  note: string;
  created_by: string;
  created_at: string;
};

@customElement("yaw-align-app")
export class YawAlignApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      box-sizing: border-box;
      padding: 1.5rem;
      max-width: 960px;
      margin: 0 auto;
    }
    h1 {
      margin: 0 0 0.25rem;
      font-size: 1.75rem;
      color: #38bdf8;
    }
    .sub {
      color: #94a3b8;
      margin-bottom: 1.5rem;
    }
    section {
      background: #1e293b;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      margin-bottom: 1rem;
      border: 1px solid #334155;
    }
    label {
      display: block;
      font-size: 0.85rem;
      color: #cbd5e1;
      margin-bottom: 0.25rem;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #f1f5f9;
      margin-bottom: 0.75rem;
    }
    button {
      cursor: pointer;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      border: none;
      background: #0284c7;
      color: #fff;
      font-weight: 600;
    }
    button.secondary {
      background: #475569;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.5rem 0.4rem;
      border-bottom: 1px solid #334155;
    }
    th {
      color: #94a3b8;
      font-weight: 600;
    }
    .tag {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.8rem;
    }
    .ok {
      background: #14532d;
      color: #86efac;
    }
    .bad {
      background: #7f1d1d;
      color: #fca5a5;
    }
    .pending {
      background: #713f12;
      color: #fde68a;
    }
    .err {
      color: #f87171;
      margin-top: 0.5rem;
    }
    .row-actions {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      align-items: center;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
      margin-bottom: 1rem;
    }
    .lamp-box {
      display: inline-flex;
      align-items: center;
      gap: 0.55rem;
      border: 1px solid #334155;
      background: #1e293b;
      border-radius: 999px;
      padding: 0.4rem 0.9rem;
      cursor: pointer;
      font-size: 0.9rem;
      color: #cbd5e1;
    }
    .lamp-dot {
      width: 0.8rem;
      height: 0.8rem;
      border-radius: 50%;
      background: #475569;
      flex: none;
    }
    .lamp-dot.on {
      background: #f59e0b;
      box-shadow: 0 0 10px 2px rgba(245, 158, 11, 0.7);
      animation: lamp-pulse 1.2s ease-in-out infinite;
    }
    @keyframes lamp-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.45; }
    }
    .lamp-box.on {
      border-color: #f59e0b;
      color: #fde68a;
    }
    .kv {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 0.35rem 1rem;
      font-size: 0.9rem;
    }
    .kv .k { color: #94a3b8; }
    select {
      width: 100%;
      box-sizing: border-box;
      padding: 0.5rem 0.65rem;
      border-radius: 6px;
      border: 1px solid #475569;
      background: #0f172a;
      color: #f1f5f9;
      margin-bottom: 0.75rem;
    }
    .form-row {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .form-row > div { flex: 1; min-width: 160px; }
    .badge-raised {
      background: #7f1d1d;
      color: #fca5a5;
    }
    .badge-resolved {
      background: #14532d;
      color: #86efac;
    }
    .readonly-note {
      color: #94a3b8;
      font-size: 0.85rem;
      margin-top: 0.5rem;
    }
    .muted { color: #94a3b8; font-size: 0.85rem; }
  `;

  @state() private session: Session | null = null;
  @state() private logs: LogRow[] = [];
  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private yawErr = "";
  @state() private error = "";
  @state() private loading = false;
  @state() private view: "home" | "night" = "home";
  @state() private nightStatus: NightAlertStatus | null = null;
  @state() private nightConfig: NightAlertConfig | null = null;
  @state() private nightEvents: NightAlertEvent[] = [];
  @state() private cfgStart = "22";
  @state() private cfgEnd = "6";
  @state() private cfgThreshold = "2";
  @state() private nightError = "";
  @state() private nightLoading = false;

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        void this.tick();
        this._pollTimer = window.setInterval(() => void this.tick(), 2000);
      } catch {
        localStorage.removeItem("yaw_session");
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
    }
  }

  private _pollTimer?: number;

  private authHeaders(): HeadersInit {
    return this.session
      ? { Authorization: `Bearer ${this.session.token}` }
      : {};
  }

  private async tick() {
    await this.refreshLogs();
    await this.refreshNightStatus();
  }

  private async refreshLogs() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/logs", { headers: this.authHeaders() });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) return;
      this.logs = (await res.json()) as LogRow[];
    } catch {
      /* ignore transient network errors */
    }
  }

  private async refreshNightStatus() {
    if (!this.session) return;
    try {
      const res = await fetch("/api/night-alert/status", {
        headers: this.authHeaders(),
      });
      if (res.status === 401) {
        this.logout();
        return;
      }
      if (!res.ok) return;
      this.nightStatus = (await res.json()) as NightAlertStatus;
      if (this.view === "night") {
        void this.loadNightPage();
      }
    } catch {
      /* ignore transient network errors */
    }
  }

  private async loadNightPage() {
    if (!this.session) return;
    const [cfgRes, evRes] = await Promise.all([
      fetch("/api/night-alert/config", { headers: this.authHeaders() }),
      fetch("/api/night-alert/events", { headers: this.authHeaders() }),
    ]);
    if (cfgRes.ok) {
      const cfg = (await cfgRes.json()) as NightAlertConfig;
      this.nightConfig = cfg;
      this.cfgStart = String(cfg.night_start);
      this.cfgEnd = String(cfg.night_end);
      this.cfgThreshold = String(cfg.low_sample_threshold);
    }
    if (evRes.ok) {
      this.nightEvents = (await evRes.json()) as NightAlertEvent[];
    }
  }

  private goNight() {
    this.view = "night";
    this.nightError = "";
    void this.loadNightPage();
  }

  private async saveNightConfig() {
    this.nightError = "";
    this.nightLoading = true;
    try {
      const res = await fetch("/api/night-alert/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          night_start: Number(this.cfgStart),
          night_end: Number(this.cfgEnd),
          low_sample_threshold: Number(this.cfgThreshold),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.nightError = data.detail || "保存失败";
        return;
      }
      this.nightStatus = data as NightAlertStatus;
      await this.loadNightPage();
    } catch {
      this.nightError = "保存时网络异常";
    } finally {
      this.nightLoading = false;
    }
  }

  private async clearRecentDone() {
    this.nightError = "";
    this.nightLoading = true;
    try {
      const res = await fetch("/api/night-alert/clear-recent-done", {
        method: "POST",
        headers: this.authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        this.nightError = data.detail || "清空失败";
        return;
      }
      this.nightStatus = data.status as NightAlertStatus;
      await this.refreshLogs();
      await this.loadNightPage();
    } catch {
      this.nightError = "清空时网络异常";
    } finally {
      this.nightLoading = false;
    }
  }

  private async login() {
    this.error = "";
    this.loading = true;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: this.loginUser,
          password: this.loginPass,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "登录失败";
        return;
      }
      this.session = {
        token: data.access_token,
        username: data.username,
        role: data.role,
      };
      localStorage.setItem("yaw_session", JSON.stringify(this.session));
      await this.tick();
      this._pollTimer = window.setInterval(() => void this.tick(), 2000);
    } catch {
      this.error = "无法连接接口";
    } finally {
      this.loading = false;
    }
  }

  private logout() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this.session = null;
    this.logs = [];
    this.view = "home";
    this.nightStatus = null;
    this.nightConfig = null;
    this.nightEvents = [];
    localStorage.removeItem("yaw_session");
  }

  private get isWriter() {
    return this.session?.role === "writer";
  }

  private async submitLog() {
    this.error = "";
    this.loading = true;
    try {
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          turbine_code: this.turbineCode,
          yaw_err_deg: Number(this.yawErr),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.error = data.detail || "提交失败";
        return;
      }
      this.turbineCode = "";
      this.yawErr = "";
      await this.refreshLogs();
    } catch {
      this.error = "提交时网络异常";
    } finally {
      this.loading = false;
    }
  }

  private verdictClass(row: LogRow) {
    if (row.status === "pending") return "pending";
    if (row.verdict === "合格") return "ok";
    if (row.verdict === "偏航超差") return "bad";
    return "";
  }

  private fmtHour(h: number) {
    return `${String(h).padStart(2, "0")}:00`;
  }

  private fmtTime(iso: string | null) {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
  }

  private renderTopbar() {
    const s = this.nightStatus;
    const on = s?.alert_active === true;
    const label = !s
      ? "夜间采样状态判定中…"
      : on
        ? "夜间稀采样提醒：办结数偏低"
        : "夜间采样正常";
    return html`
      <section class="topbar">
        <div class="row-actions">
          <button class="secondary" @click=${this.logout}>退出</button>
          <button class="secondary" ?disabled=${this.loading} @click=${this.tick}>
            刷新列表
          </button>
        </div>
        <button
          class="lamp-box ${on ? "on" : ""}"
          title="查看夜间稀采样提醒专页"
          @click=${this.goNight}
        >
          <span class="lamp-dot ${on ? "on" : ""}"></span>
          <span>${label}</span>
          <span class="muted">›</span>
        </button>
      </section>
    `;
  }

  private renderNight() {
    const s = this.nightStatus;
    const cfg = this.nightConfig;
    const hourOptions = Array.from({ length: 24 }, (_, i) => i);
    return html`
      <h1>夜间稀采样提醒</h1>
      <p class="sub">
        夜间运维稀疏时段办结条数过少时点亮提醒；提醒仅提示，不会拦截任何报送。
        判定基于服务端时钟。
      </p>
      <section class="topbar">
        <div class="row-actions">
          <button class="secondary" @click=${() => (this.view = "home")}>
            ‹ 返回主页
          </button>
        </div>
        ${s
          ? html`
              <span class="lamp-box ${s.alert_active ? "on" : ""}" style="cursor:default">
                <span class="lamp-dot ${s.alert_active ? "on" : ""}"></span>
                <span>${s.alert_active ? "提醒中：夜间办结数低于阈值" : "提醒灯熄灭"}</span>
              </span>
            `
          : null}
      </section>

      <section>
        <h2 style="margin-top:0;font-size:1.1rem;">当前判定</h2>
        ${s
          ? html`
              <div class="kv">
                <span class="k">服务端时钟</span>
                <span>${this.fmtTime(s.server_time)}（${s.server_timezone}，${this.fmtHour(s.server_hour)}）</span>
                <span class="k">夜间时段</span>
                <span>${this.fmtHour(s.window_start_hour)} – 次日 ${this.fmtHour(s.window_end_hour)}</span>
                <span class="k">当前是否夜间窗</span>
                <span>${s.in_night_window ? "是" : "否（白天）"}</span>
                <span class="k">窗内办结数</span>
                <span><strong>${s.done_count_in_window}</strong> 条</span>
                <span class="k">低样本阈值</span>
                <span>${s.low_sample_threshold} 条</span>
                <span class="k">提醒灯</span>
                <span style="color:${s.alert_active ? "#fde68a" : "#86efac"}">
                  ${s.alert_active ? "● 亮（" + this.fmtTime(s.alert_raised_at) + " 点亮）" : "○ 灭"}
                </span>
              </div>
            `
          : html`<p class="muted">判定加载中…</p>`}
      </section>

      <section>
        <h2 style="margin-top:0;font-size:1.1rem;">
          夜间时段与低样本阈值${this.isWriter ? "" : "（只读）"}
        </h2>
        ${this.isWriter
          ? html`
              <div class="form-row">
                <div>
                  <label>夜间窗起始（整点）</label>
                  <select
                    .value=${this.cfgStart}
                    @change=${(e: Event) =>
                      (this.cfgStart = (e.target as HTMLSelectElement).value)}
                  >
                    ${hourOptions.map(
                      (h) =>
                        html`<option value=${h} ?selected=${String(h) === this.cfgStart}>
                          ${this.fmtHour(h)}
                        </option>`
                    )}
                  </select>
                </div>
                <div>
                  <label>夜间窗结束（整点，可跨午夜）</label>
                  <select
                    .value=${this.cfgEnd}
                    @change=${(e: Event) =>
                      (this.cfgEnd = (e.target as HTMLSelectElement).value)}
                  >
                    ${hourOptions.map(
                      (h) =>
                        html`<option value=${h} ?selected=${String(h) === this.cfgEnd}>
                          ${this.fmtHour(h)}
                        </option>`
                    )}
                  </select>
                </div>
                <div>
                  <label>低样本阈值（条）</label>
                  <input
                    type="number"
                    min="0"
                    .value=${this.cfgThreshold}
                    @input=${(e: Event) =>
                      (this.cfgThreshold = (e.target as HTMLInputElement).value)}
                  />
                </div>
              </div>
              <div class="row-actions">
                <button
                  ?disabled=${this.nightLoading}
                  @click=${this.saveNightConfig}
                >
                  保存并重新判定
                </button>
                <button
                  class="secondary"
                  ?disabled=${this.nightLoading || !s?.in_night_window}
                  title=${s?.in_night_window
                    ? "删除当前夜间窗内已办结的记录"
                    : "仅夜间窗内可清空"}
                  @click=${this.clearRecentDone}
                >
                  清空近窗办结
                </button>
              </div>
              <p class="readonly-note">
                提示：把夜间窗调到覆盖服务端当前时间并清空近窗办结，可复现亮灯；
                把窗挪到白天，灯自动熄灭。亮灯不会影响正常报送。
              </p>
            `
          : html`
              <div class="kv">
                <span class="k">夜间时段</span>
                <span>${cfg ? `${this.fmtHour(cfg.night_start)} – 次日 ${this.fmtHour(cfg.night_end)}` : "—"}</span>
                <span class="k">低样本阈值</span>
                <span>${cfg ? `${cfg.low_sample_threshold} 条` : "—"}</span>
                <span class="k">最近修改</span>
                <span>${cfg?.updated_by ? `${cfg.updated_by} / ${this.fmtTime(cfg.updated_at)}` : "—"}</span>
              </div>
              <p class="readonly-note">观察员为只读账号，可查看阈值与提醒流水，不能修改配置或清空办结。</p>
            `}
        ${this.nightError ? html`<p class="err">${this.nightError}</p>` : null}
      </section>

      <section>
        <h2 style="margin-top:0;font-size:1.1rem;">提醒流水</h2>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>事件</th>
              <th>夜间窗</th>
              <th>阈值</th>
              <th>窗内办结</th>
              <th>操作人</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            ${this.nightEvents.map(
              (e) => html`
                <tr>
                  <td>${this.fmtTime(e.created_at)}</td>
                  <td>
                    <span
                      class="tag ${e.kind === "raised" ? "badge-raised" : "badge-resolved"}"
                    >
                      ${e.kind === "raised" ? "亮灯" : "灭灯"}
                    </span>
                  </td>
                  <td>${this.fmtHour(e.window_start)}–${this.fmtHour(e.window_end)}</td>
                  <td>${e.threshold}</td>
                  <td>${e.done_count}</td>
                  <td>${e.created_by}</td>
                  <td>${e.note}</td>
                </tr>
              `
            )}
            ${this.nightEvents.length === 0
              ? html`<tr><td colspan="7" class="muted">暂无提醒流水</td></tr>`
              : null}
          </tbody>
        </table>
      </section>
    `;
  }

  render() {
    if (!this.session) {
      return html`
        <h1>风机偏航对中台</h1>
        <p class="sub">现场技师提交偏航误差，后台 worker 认领后给出合格或偏航超差结论。</p>
        <section>
          <label>用户名</label>
          <input
            .value=${this.loginUser}
            @input=${(e: Event) =>
              (this.loginUser = (e.target as HTMLInputElement).value)}
          />
          <label>密码</label>
          <input
            type="password"
            .value=${this.loginPass}
            @input=${(e: Event) =>
              (this.loginPass = (e.target as HTMLInputElement).value)}
          />
          <button ?disabled=${this.loading} @click=${this.login}>登录</button>
          ${this.error ? html`<p class="err">${this.error}</p>` : null}
        </section>
      `;
    }

    if (this.view === "night") {
      return this.renderNight();
    }

    return html`
      <h1>风机偏航对中台</h1>
      <p class="sub">
        已登录：${this.session.username}
        (${this.isWriter ? "可提交" : "只读"})
      </p>
      ${this.renderTopbar()}

      ${this.isWriter
        ? html`
            <section>
              <h2 style="margin-top:0;font-size:1.1rem;">提交偏航记录</h2>
              <label>机组编号</label>
              <input
                placeholder="例如 W12"
                .value=${this.turbineCode}
                @input=${(e: Event) =>
                  (this.turbineCode = (e.target as HTMLInputElement).value)}
              />
              <label>偏航误差（度，可正可负）</label>
              <input
                type="number"
                step="0.1"
                .value=${this.yawErr}
                @input=${(e: Event) =>
                  (this.yawErr = (e.target as HTMLInputElement).value)}
              />
              <button ?disabled=${this.loading} @click=${this.submitLog}>
                提交（进入待认领队列）
              </button>
              ${this.error ? html`<p class="err">${this.error}</p>` : null}
            </section>
          `
        : null}

      <section>
        <h2 style="margin-top:0;font-size:1.1rem;">对中记录</h2>
        <table>
          <thead>
            <tr>
              <th>编号</th>
              <th>机组</th>
              <th>误差°</th>
              <th>状态</th>
              <th>结论</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>
            ${this.logs.map(
              (row) => html`
                <tr>
                  <td>${row.id}</td>
                  <td>${row.turbine_code}</td>
                  <td>${row.yaw_err_deg}</td>
                  <td>
                    <span class="tag ${row.status === "pending" ? "pending" : "ok"}">
                      ${row.status === "pending" ? "待处理" : "已完成"}
                    </span>
                  </td>
                  <td>
                    ${row.verdict
                      ? html`<span class="tag ${this.verdictClass(row)}">${row.verdict}</span>`
                      : "—"}
                  </td>
                  <td>${row.reason ?? "—"}</td>
                </tr>
              `
            )}
          </tbody>
        </table>
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "yaw-align-app": YawAlignApp;
  }
}
