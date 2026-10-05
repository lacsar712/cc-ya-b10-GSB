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

type NightStatus = {
  server_time: string;
  server_local_time: string;
  timezone: string;
  window_start: string;
  window_end: string;
  threshold: number;
  in_night_window: boolean;
  recent_done_count: number | null;
  alert: boolean;
  active_window_start: string | null;
  current_alert: NightAlert | null;
  updated_by: string | null;
  updated_at: string | null;
};

type NightAlert = {
  id: number;
  window_start: string;
  triggered_at: string;
  recent_done_count: number;
  threshold: number;
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
      justify-content: flex-end;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.5rem;
    }
    .alert-light {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      cursor: pointer;
      border: 1px solid #334155;
      background: #1e293b;
      color: #94a3b8;
      padding: 0.35rem 0.8rem;
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .dot {
      width: 0.7rem;
      height: 0.7rem;
      border-radius: 50%;
      background: #475569;
      flex: none;
    }
    .alert-light.on {
      border-color: #fca5a5;
      color: #fecaca;
      background: #450a0a;
    }
    .alert-light.on .dot {
      background: #ef4444;
      box-shadow: 0 0 8px 2px rgba(239, 68, 68, 0.8);
      animation: blink 1.2s ease-in-out infinite;
    }
    @keyframes blink {
      50% { opacity: 0.35; }
    }
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 0.75rem;
      margin: 0.75rem 0 1rem;
    }
    .stat {
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 0.6rem 0.75rem;
    }
    .stat .k {
      font-size: 0.75rem;
      color: #94a3b8;
    }
    .stat .v {
      font-size: 1.1rem;
      font-weight: 600;
      margin-top: 0.15rem;
    }
    .badge-on { color: #fca5a5; }
    .badge-off { color: #86efac; }
    fieldset {
      border: 1px solid #334155;
      border-radius: 6px;
      margin: 0 0 1rem;
      padding: 0.75rem 1rem;
    }
    legend { color: #cbd5e1; font-size: 0.9rem; padding: 0 0.4rem; }
    .form-row {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      align-items: flex-end;
    }
    .form-row > div {
      flex: 1 1 8rem;
    }
    .readonly-note {
      color: #94a3b8;
      font-size: 0.85rem;
      background: #0f172a;
      border: 1px dashed #475569;
      border-radius: 6px;
      padding: 0.5rem 0.75rem;
    }
  `;

  @state() private session: Session | null = null;
  @state() private logs: LogRow[] = [];
  @state() private page: "logs" | "night" = "logs";
  @state() private nightStatus: NightStatus | null = null;
  @state() private nightHistory: NightAlert[] = [];
  @state() private nightError = "";
  @state() private savingNight = false;
  @state() private windowStart = "22:00";
  @state() private windowEnd = "06:00";
  @state() private threshold = "5";
  @state() private timezoneName = "Asia/Shanghai";
  @state() private loginUser = "technician";
  @state() private loginPass = "tech123456";
  @state() private turbineCode = "";
  @state() private yawErr = "";
  @state() private error = "";
  @state() private loading = false;

  connectedCallback() {
    super.connectedCallback();
    const raw = localStorage.getItem("yaw_session");
    if (raw) {
      try {
        this.session = JSON.parse(raw) as Session;
        void this.refreshAll();
        this._pollTimer = window.setInterval(() => void this.refreshAll(), 2000);
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

  private async refreshAll() {
    await Promise.all([this.refreshLogs(), this.refreshNight()]);
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

  private async refreshNight() {
    if (!this.session) return;
    try {
      const [statusRes, historyRes] = await Promise.all([
        fetch("/api/night/status", { headers: this.authHeaders() }),
        fetch("/api/night/history", { headers: this.authHeaders() }),
      ]);
      if (statusRes.status === 401) {
        this.logout();
        return;
      }
      if (!statusRes.ok) return;
      const status = (await statusRes.json()) as NightStatus;
      this.nightStatus = status;
      // 仅在未进入编辑态时用服务端值同步表单，避免覆盖正在输入的内容
      if (!this._nightFormDirty) {
        this.windowStart = status.window_start;
        this.windowEnd = status.window_end;
        this.threshold = String(status.threshold);
        this.timezoneName = status.timezone;
      }
      if (historyRes.ok) {
        this.nightHistory = (await historyRes.json()) as NightAlert[];
      }
    } catch {
      /* ignore transient network errors */
    }
  }

  private _nightFormDirty = false;

  private markFormDirty() {
    this._nightFormDirty = true;
  }

  private async saveNightSettings() {
    if (!this.session) return;
    this.nightError = "";
    this.savingNight = true;
    try {
      const res = await fetch("/api/night/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...this.authHeaders(),
        },
        body: JSON.stringify({
          timezone: this.timezoneName,
          window_start: this.windowStart,
          window_end: this.windowEnd,
          low_sample_threshold: Number(this.threshold),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.nightError = data.detail || "保存失败";
        return;
      }
      this._nightFormDirty = false;
      await this.refreshNight();
    } catch {
      this.nightError = "保存时网络异常";
    } finally {
      this.savingNight = false;
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
      await this.refreshAll();
      this._pollTimer = window.setInterval(() => void this.refreshAll(), 2000);
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
    this.page = "logs";
    this.nightStatus = null;
    this.nightHistory = [];
    this.nightError = "";
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

    return html`
      <h1>风机偏航对中台</h1>
      <div class="topbar">
        <button
          class="alert-light ${this.nightStatus?.alert ? "on" : ""}"
          title="夜间稀采样提醒专页"
          @click=${() => (this.page = "night")}
        >
          <span class="dot"></span>
          ${this.nightStatus?.alert
            ? "夜间稀采样提醒：办结偏少"
            : "夜间稀采样提醒：正常"}
        </button>
      </div>
      <p class="sub">
        已登录：${this.session.username}
        (${this.isWriter ? "可提交" : "只读"})
      </p>
      <section>
        <div class="row-actions">
          <button class="secondary" @click=${this.logout}>退出</button>
          <button
            class="secondary"
            ?disabled=${this.loading}
            @click=${() => {
              this.page = "logs";
              return this.refreshLogs();
            }}
          >
            刷新列表
          </button>
          <button class="secondary" @click=${() => (this.page = "night")}>
            夜间提醒专页
          </button>
        </div>
      </section>

      ${this.page === "night"
        ? this.renderNightPage()
        : html`
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
                          <span
                            class="tag ${row.status === "pending"
                              ? "pending"
                              : "ok"}"
                          >
                            ${row.status === "pending" ? "待处理" : "已完成"}
                          </span>
                        </td>
                        <td>
                          ${row.verdict
                            ? html`<span class="tag ${this.verdictClass(row)}"
                                >${row.verdict}</span
                              >`
                            : "—"}
                        </td>
                        <td>${row.reason ?? "—"}</td>
                      </tr>
                    `
                  )}
                </tbody>
              </table>
            </section>
          `}
    `;
  }

  private fmtTime(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  }

  private renderNightPage() {
    const s = this.nightStatus;
    return html`
      <section>
        <div class="row-actions" style="justify-content:space-between;">
          <h2 style="margin:0;font-size:1.1rem;">夜间稀采样提醒专页</h2>
          <button class="secondary" @click=${() => (this.page = "logs")}>
            返回列表
          </button>
        </div>

        <div class="stat-grid">
          <div class="stat">
            <div class="k">提醒灯（服务端时钟判定）</div>
            <div class="v ${s?.alert ? "badge-on" : "badge-off"}">
              ${s ? (s.alert ? "● 已点亮" : "○ 熄灭") : "加载中…"}
            </div>
          </div>
          <div class="stat">
            <div class="k">当前是否夜间窗</div>
            <div class="v">${s ? (s.in_night_window ? "窗内" : "窗外") : "—"}</div>
          </div>
          <div class="stat">
            <div class="k">近窗办结数 / 低样本阈值</div>
            <div class="v">
              ${s ? `${s.recent_done_count ?? "—"} / ${s.threshold}` : "—"}
            </div>
          </div>
          <div class="stat">
            <div class="k">夜间时段（${s?.timezone ?? "—"}）</div>
            <div class="v">
              ${s ? `${s.window_start}–${s.window_end}` : "—"}
            </div>
          </div>
          <div class="stat">
            <div class="k">服务端当前时间</div>
            <div class="v" style="font-size:0.95rem;">
              ${this.fmtTime(s?.server_local_time)}
            </div>
          </div>
        </div>

        <p style="color:#94a3b8;font-size:0.85rem;margin:0 0 0.75rem;">
          提醒仅点亮本灯并记录流水，不会拦截任何白天/夜间的正常报送。
        </p>

        ${this.isWriter
          ? html`
              <fieldset>
                <legend>夜间时段与低样本阈值（仅现场技师可改）</legend>
                <div class="form-row">
                  <div>
                    <label>窗开始</label>
                    <input
                      type="time"
                      .value=${this.windowStart}
                      @input=${(e: Event) => {
                        this.markFormDirty();
                        this.windowStart = (e.target as HTMLInputElement).value;
                      }}
                    />
                  </div>
                  <div>
                    <label>窗结束</label>
                    <input
                      type="time"
                      .value=${this.windowEnd}
                      @input=${(e: Event) => {
                        this.markFormDirty();
                        this.windowEnd = (e.target as HTMLInputElement).value;
                      }}
                    />
                  </div>
                  <div>
                    <label>低样本阈值</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      .value=${this.threshold}
                      @input=${(e: Event) => {
                        this.markFormDirty();
                        this.threshold = (e.target as HTMLInputElement).value;
                      }}
                    />
                  </div>
                  <div>
                    <label>时区（IANA）</label>
                    <input
                      .value=${this.timezoneName}
                      @input=${(e: Event) => {
                        this.markFormDirty();
                        this.timezoneName = (e.target as HTMLInputElement).value;
                      }}
                    />
                  </div>
                </div>
                <button
                  ?disabled=${this.savingNight}
                  @click=${this.saveNightSettings}
                >
                  保存设置
                </button>
                ${this.nightError
                  ? html`<p class="err">${this.nightError}</p>`
                  : null}
                ${s?.updated_by
                  ? html`<p style="color:#64748b;font-size:0.78rem;margin:0.5rem 0 0;">
                      最近修改：${s.updated_by} · ${this.fmtTime(s.updated_at)}
                    </p>`
                  : null}
              </fieldset>
            `
          : html`
              <p class="readonly-note">
                观察员为只读账号：可查看阈值与提醒历史，但不能修改夜间设置。
              </p>
            `}
      </section>

      <section>
        <h2 style="margin-top:0;font-size:1.1rem;">提醒流水</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>夜间窗起点</th>
              <th>首次触发时间</th>
              <th>近窗办结数</th>
              <th>阈值</th>
            </tr>
          </thead>
          <tbody>
            ${this.nightHistory.length === 0
              ? html`<tr><td colspan="5" style="color:#94a3b8;">暂无提醒流水</td></tr>`
              : this.nightHistory.map(
                  (a) => html`
                    <tr>
                      <td>${a.id}</td>
                      <td>${this.fmtTime(a.window_start)}</td>
                      <td>${this.fmtTime(a.triggered_at)}</td>
                      <td>${a.recent_done_count}</td>
                      <td>${a.threshold}</td>
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
