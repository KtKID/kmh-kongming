/** mock 用例声明：只保留测试入口和中文判据，执行与断言由后续实现。 */
import type { MemoryMockHost } from "./fixtures/mock-host.ts";

/**
 * F01：验证空目录、已有原始记忆和已有冻结版本三个初始化起点。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyMemoryInitialization(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F02：验证每次请求完整读取冻结正文，以及原始修改等待刷新。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyFrozenReadPerRequest(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F03：验证重启沿用冻结、压缩刷新后再重启保留新版本。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyFrozenRestartRetention(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F04：验证手动、自动及超限恢复成功后的完整替换和第一条请求。
 * 准备：冻结 A、原始 B、真实可压缩历史；三个入口分别运行，普通会话作为对照。
 * 操作：暂停冻结发布并发起后续请求，放行后核对 B；原始改 C 后再成功压缩一次。
 * 预期：发布期间请求等待；两次发布和首条后续请求分别完整使用 B、C，身份与原始保留。
 * 组合与边界：F09 承接真实工具维护后的完整循环，F10–F36 承接内容、恢复和时序。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyCompactionRefresh(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F05：验证失败、取消、空操作、裁剪及 end 后保存失败保持冻结。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyUnsuccessfulCompaction(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F06：验证复制故障保留完整文件、暂停请求及修复后继续。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyRefreshFailureRecovery(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F07：验证冻结缺失或读取失败阻止请求，修复后继续原消息。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyFrozenReadFailure(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F08：验证超长冻结内容完整保留、容量错误与换模型恢复。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyOversizedFrozenMemory(
  host: MemoryMockHost,
): Promise<void>;
