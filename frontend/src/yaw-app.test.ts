// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./yaw-app";

const writerSession = {
  token: "t",
  username: "technician",
  role: "writer",
};
const readerSession = { token: "o", username: "observer", role: "reader" };

function status(over: Record<string, unknown> = {}) {
  return {
    server_time: "2026-10-05T01:00:00+00:00",
    server_timezone: "Etc/UTC",
    server_hour: 1,
    in_night_window: true,
    window_start_hour: 0,
    window_end_hour: 3,
    window_start_at: "2026-10-05T00:00:00",
    low_sample_threshold: 2,
    done_count_in_window: 0,
    alert_active: true,
    alert_raised_at: "2026-10-05T01:00:00+00:00",
    last_evaluated_at: "2026-10-05T01:00:00+00:00",
    ...over,
  };
}

const config = {
  night_start: 0,
  night_end: 3,
  low_sample_threshold: 2,
  alert_active: true,
  alert_raised_at: "2026-10-05T01:00:00+00:00",
  updated_by: "technician",
  updated_at: "2026-10-05T00:00:00+00:00",
};

const events = [
  {
    id: 1,
    kind: "raised",
    window_start: 0,
    window_end: 3,
    threshold: 2,
    done_count: 0,
    note: "夜间窗内办结 0 条",
    created_by: "technician",
    created_at: "2026-10-05T01:00:00+00:00",
  },
];

function makeFetch() {
  return vi.fn(async (url: any) => {
    const u = String(url);
    if (u.endsWith("/api/logs")) {
      return new Response(JSON.stringify([]), { status: 200 });
    }
    if (u.endsWith("/api/night-alert/status")) {
      return new Response(JSON.stringify(status()), { status: 200 });
    }
    if (u.endsWith("/api/night-alert/config")) {
      return new Response(JSON.stringify(config), { status: 200 });
    }
    if (u.endsWith("/api/night-alert/events")) {
      return new Response(JSON.stringify(events), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  });
}

function mount() {
  const el = document.createElement("yaw-align-app") as any;
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.stubGlobal("fetch", makeFetch());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("夜间稀采样提醒 UI", () => {
  it("亮灯时顶栏显示提醒文案并进入专页，writer 可见配置与清空按钮、流水", async () => {
    localStorage.setItem("yaw_session", JSON.stringify(writerSession));
    const el = mount();
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    const lamp = el.shadowRoot.querySelector(".lamp-box");
    expect(lamp.textContent).toContain("办结数偏低");
    expect(lamp.querySelector(".lamp-dot").classList.contains("on")).toBe(true);

    lamp.click();
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;

    const text = el.shadowRoot.textContent;
    expect(text).toContain("当前判定");
    expect(text).toContain("窗内办结数");
    expect(text).toContain("0 条");
    expect(text).toContain("提醒流水");
    expect(text).toContain("亮灯");
    // writer 写口
    expect(el.shadowRoot.querySelector("button[title='删除当前夜间窗内已办结的记录']")).toBeTruthy();
    expect(text).toContain("保存并重新判定");
    expect(text).toContain("清空近窗办结");
  });

  it("灭灯（白天）时顶栏灯不亮", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: any) => {
        const u = String(url);
        if (u.endsWith("/api/night-alert/status"))
          return new Response(
            JSON.stringify(status({ alert_active: false, in_night_window: false, server_hour: 12 })),
            { status: 200 }
          );
        if (u.endsWith("/api/logs")) return new Response(JSON.stringify([]), { status: 200 });
        return new Response("{}", { status: 404 });
      })
    );
    localStorage.setItem("yaw_session", JSON.stringify(writerSession));
    const el = mount();
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    const lamp = el.shadowRoot.querySelector(".lamp-box");
    expect(lamp.textContent).toContain("夜间采样正常");
    expect(lamp.querySelector(".lamp-dot").classList.contains("on")).toBe(false);
  });

  it("observer 进入专页只读：无保存/清空控件，无提交表单", async () => {
    localStorage.setItem("yaw_session", JSON.stringify(readerSession));
    const el = mount();
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    el.shadowRoot.querySelector(".lamp-box").click();
    await el.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await el.updateComplete;
    const root = el.shadowRoot;
    expect(root.textContent).toContain("只读");
    expect(root.textContent).toContain("提醒流水");
    expect(root.textContent).toContain("观察员为只读账号");
    expect(root.textContent).not.toContain("保存并重新判定");
    expect(root.textContent).not.toContain("清空近窗办结");
    expect(root.querySelector("select")).toBeNull();
    expect(root.querySelector('input[type="number"]')).toBeNull();
  });
});
