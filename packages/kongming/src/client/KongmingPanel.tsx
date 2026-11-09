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
/** 准备函数由注册侧关闭服务依赖。 */
export interface KongmingPanelFace {
  prepare: (signal: AbortSignal) => Promise<void>;
}
type PanelProps = PropsRuntime<"main"> &
  PropsLocale<"kongming"> &
  InjectFace<KongmingPanelFace>;
type PanelState = { kind: "loading" } | { kind: "failed"; message: string };
/** @param props - 面板份额、准备动作和词典。 @returns 固定会话或原位重试状态。 */
export function KongmingPanel({ prepare, t }: PanelProps): ReactNode {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<PanelState>({ kind: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });
    prepare(controller.signal).catch((error: unknown) => {
      if (!controller.signal.aborted)
        setState({ kind: "failed", message: String(error) });
    });
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
            onClick={() => {
              setAttempt((value) => value + 1);
            }}
          >
            {t("retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
