/** 入口只准备固定会话；完整聊天页由 DSH 原生导航挂载。 */
import { useEffect, useState, type ReactNode } from "react";
import {
  Button,
  IconLoadingOutlineRegular,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type {
  InjectFace,
  PropsLocale,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
/** 面板通过注册侧注入的动作准备会话。 */
export interface KongmingPanelFace {
  prepare: (signal: AbortSignal) => Promise<void>;
}
type PanelProps = PropsRuntime<"main"> &
  PropsLocale<"kongming"> &
  InjectFace<KongmingPanelFace>;
type PanelState = { kind: "loading" } | { kind: "failed"; message: string };
/** 在原位展示准备状态，失败时提供原因和重试入口。 */
export function KongmingPanel({ prepare, t }: PanelProps): ReactNode {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  // 首次打开和点击重试时各启动一次可取消的准备请求。
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    // 只有仍在等待的面板才展示本次失败。
    prepare(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted)
        setState({ kind: "failed", message: String(error) });
    });
    // 离开面板或重新发起请求时取消旧请求。
    return () => {
      controller.abort();
    };
  }, [prepare, attempt]);
  const centered = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    gap: 12,
  } as const;
  return (
    <div
      data-kongming-panel=""
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      {state.kind === "loading" ? (
        <div style={centered} role="status" aria-label={t("panel")}>
          <IconLoadingOutlineRegular size={20} />
        </div>
      ) : (
        <div style={centered} role="alert">
          <span>{t("prepareFailed")}</span>
          <span
            style={{ color: "var(--dsw-alias-label-secondary)", fontSize: 12 }}
          >
            {state.message}
          </span>
          <Button
            onClick={
              // 点击重试后让准备请求重新执行。
              () => {
                // 基于当前计数累加，确保每次点击都有新的尝试编号。
                setAttempt((value) => value + 1);
              }
            }
          >
            {t("retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
