/** mock 用例声明：只保留测试入口和中文判据，执行与断言由后续实现。 */
import type { MemoryMockHost } from "./fixtures/mock-host.ts";

/**
 * S01：验证正常收尾后同一轮通过一次提醒进入原始记忆维护。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyReminderContinuation(
  host: MemoryMockHost,
): Promise<void>;

/**
 * S02：验证工具结果和正常回复处理完成后才追加提醒。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyReminderAfterToolResults(
  host: MemoryMockHost,
): Promise<void>;

/**
 * S03：验证寒暄、重复信息和更新旧偏好的受控脚本分支。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyMemoryValueBranches(
  host: MemoryMockHost,
): Promise<void>;

/**
 * S04：验证记忆维护再次收尾时保持一次提醒并正常结束。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifySingleReminderPerTurn(
  host: MemoryMockHost,
): Promise<void>;

/**
 * S05：验证相同 turn 编号在不同会话隔离，普通会话保持自身行为。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyReminderSessionIsolation(
  host: MemoryMockHost,
): Promise<void>;

/**
 * S06：验证 max-tokens 轮次跳过提醒并保留本轮输出上限事实。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyOutputLimitSkipping(
  host: MemoryMockHost,
): Promise<void>;

/**
 * S07：验证用户停止和普通任务模型失败后回调收敛。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyCancellationAndModelErrors(
  host: MemoryMockHost,
): Promise<void>;

/**
 * S08：验证审批拒绝、权限与磁盘保存失败的真实反馈和文件保护。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyOriginalWriteFailure(
  host: MemoryMockHost,
): Promise<void>;

/**
 * S09：验证原始读取失败后保留已有条目并反馈原因。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyOriginalReadFailure(
  host: MemoryMockHost,
): Promise<void>;

/**
 * S10：验证记忆可选启停，准备失败后移除能力可继续基础聊天。正常变体见 O01–O05。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyOptionalMemoryLifecycle(
  host: MemoryMockHost,
): Promise<void>;

/**
 * S11：验证插件重建后从已有提醒及队列记录恢复去重。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyReminderReloadRecovery(
  host: MemoryMockHost,
): Promise<void>;

/**
 * S12：验证记忆维护中断与卸载后异步工作收敛。
 * @param host - 当前用例独占的真实能力与模型替身宿主。
 * @returns 该用例全部观察与资源收敛完成后的结果。
 * @throws 预期结果、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyMaintenanceDisposal(
  host: MemoryMockHost,
): Promise<void>;
