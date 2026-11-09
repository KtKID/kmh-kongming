/**
 * 冻结快照边界用例声明：F09–F36 承接覆盖审查 B1–B7，全部保留中文准备、操作和预期。
 * 每例使用私有 home、真实文件与宿主链路；模型输出和指定故障受控，竞争通过屏障同步。
 * 标有“待确认”的场景先保留问题与共用保证，具体分支断言在规则确认后实现。
 * 本文件仅导入类型并声明函数；业务执行、测试注册和断言由后续实现。
 */
import type { MemoryMockHost } from "./fixtures/mock-host.ts";

/**
 * F09：验证维护原始记忆、刷新冻结、继续维护的完整循环，承接 B1。
 * 准备：同一 Agent 与服务实例，原始和冻结均为 A，脚本通过真实 read/edit/write 保存记忆。
 * 操作：工具写原始 B，连续请求；成功压缩后再工具写 C，再次连续请求并成功压缩。
 * 预期：两次压缩前后请求的冻结段落依次为 A、B、B、C，文件逐字节对应；普通写入只改变原始。
 * 观察：工具结果、每条实际请求、两份文件、sessionId 与两次压缩结果，防止分组测试遗漏衔接状态。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在预期、文件或事件次序不符时失败；当前仅声明。
 */
export declare function verifyRawMaintenanceRefreshCycle(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F10：验证原始记忆增长后完整替换冻结，承接 B2。
 * 准备：旧冻结 A 较短，原始 B 增加独有的首、中、尾条目，保留中文、空行和换行变体。
 * 操作：先发普通请求，再完成真实成功压缩并捕获第一条后续请求。
 * 预期：压缩前使用 A，压缩后冻结字节及系统记忆完整等于 B，原始 B 与身份保留。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在内容或请求版本不符时失败；当前仅声明。
 */
export declare function verifyGrowingRawRefresh(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F11：验证同字节长度的原始修改仍会刷新，承接 B2。
 * 准备：A、B 的 UTF-8 字节数相同，目标条目及内容不同，期望字节由独立输入保存。
 * 操作：将原始 A 改成 B，检查压缩前请求，再成功压缩并继续请求。
 * 预期：压缩前冻结 A 保持，压缩后完整使用 B；文件长度相等时同样按内容复制。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在同长度修改丢失或内容不符时失败；当前仅声明。
 */
export declare function verifyEqualLengthRawRefresh(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F12：验证删除条目、缩短原始后完整覆盖旧冻结，承接 B2。
 * 准备：长冻结 A 带独有中段与尾段；原始 B 删除这些条目，字节数严格减少。
 * 操作：成功压缩，读取最终文件并捕获下一条实际系统提示词。
 * 预期：冻结逐字节等于 B，旧条目和旧尾段残留为零；原始与会话身份保留。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在删除内容残留或长度不符时失败；当前仅声明。
 */
export declare function verifyDeletedRawEntriesRefresh(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F13：验证清空原始记忆后发布零字节冻结，承接 B2。
 * 准备：冻结 A 含旧条目，原始文件已被清空且仍存在；当前有真实可压缩历史。
 * 操作：先验证普通请求仍用 A，再成功压缩并继续请求。
 * 预期：冻结文件存在且长度为零，系统记忆正文为空、路径说明保留，原始仍为空。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在空内容被跳过或旧内容残留时失败；当前仅声明。
 */
export declare function verifyEmptyRawRefresh(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F14：验证已有空冻结是一份合法快照，承接 B2、B3。
 * 准备：冻结文件存在且为零字节，原始 B 非空；与首次缺少冻结文件的状态分别准备。
 * 操作：重复初始化、打开孔明和绑定 Agent，连续请求，然后成功压缩。
 * 预期：压缩前空冻结保持，请求携带空记忆及路径说明；成功压缩后才完整使用 B。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在空快照提前变成原始内容时失败；当前仅声明。
 */
export declare function verifyExistingEmptyFrozenSnapshot(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F15：验证原始内容相同时连续刷新保持幂等，承接 B2。
 * 准备：两份文件均为 B；两次操作前分别准备真实可压缩历史，保证各自确实成功。
 * 操作：连续完成两次真实压缩，每次都继续请求并读取两份文件。
 * 预期：原始、冻结及完整请求记忆始终为 B，请求正常结束，临时文件与等待工作收敛。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在重复刷新改变内容或挂起时失败；当前仅声明。
 */
export declare function verifyUnchangedRawRefreshIdempotence(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F16：验证重复准备保持已有非空冻结版本，承接 B3。
 * 准备：冻结 A、原始 B，已绑定孔明；随后原始改为 C。
 * 操作：再次 initialize、重复打开和绑定 Agent，再发起普通及工具后续请求。
 * 预期：冻结与每条请求仍为完整 A，原始保留 C，sessionId 保持；刷新等待成功压缩入口。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在重复准备提前发布 C 或重复绑定时失败；当前仅声明。
 */
export declare function verifyRepeatedInitializationRetention(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F17：验证仅有冻结文件时补齐原始文件并保留快照，承接 B3。
 * 准备：冻结 A 已存在，原始路径缺少；初始化前安排该文件状态。
 * 操作：按现有补齐原始文件的设计准备服务，然后发起普通请求。
 * 预期：原始文件被补齐为空，冻结仍完整为 A，请求读取 A，两份实际路径正确。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在补齐原始时覆盖已有冻结或路径不符时失败；当前仅声明。
 */
export declare function verifyMissingRawInitialization(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F18：验证冻结健康时普通读取与原始读取故障彼此隔离，承接 B3。
 * 准备：初始化已完成，冻结 A、原始 B；仅让插件读取原始文件时失败，冻结读取继续可用。
 * 操作：隔离初始化、刷新与助手维护工具，触发冻结读取及真实普通请求。
 * 预期：请求完整使用 A，原始读取调用为零；两份文件与身份保持，维护或刷新错误由其独立场景验证。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在普通读取额外依赖原始文件时失败；当前仅声明。
 */
export declare function verifyHealthyFrozenRawReadIsolation(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F19：保留运行中冻结丢失后重建服务的恢复场景，承接 B3。
 * 准备：原始 B、冻结 A、已有历史；删除冻结并按 F07 观察同实例读取失败。
 * 操作：分别重载插件、完整重启服务，再尝试原消息；两种恢复使用各自私有 home。
 * 预期：原始、历史与身份保留，错误和恢复依据可定位；恢复前后均核对实际请求版本。
 * 待确认：重建时采用首次缺失复制 B，还是沿用故障恢复流程；确认后固定唯一预期及请求准入。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 观察与清理完成后的结果，具体恢复断言待规则确认后实现。
 * @throws 实现后在已确认恢复判据或文件保护不符时失败；当前仅声明。
 */
export declare function verifyMissingFrozenReconstruction(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F20：验证成功压缩后重新读取原始记忆，承接 B4。
 * 准备：冻结 A、原始 B，真实摘要生成停在受控屏障。
 * 操作：摘要期间将原始完整改成 C，再放行摘要与压缩完成，捕获刷新及下一条请求。
 * 预期：冻结及下一请求完整为 C，压缩开始前的 B 保留为输入证据；原始 C 与身份保留。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在发布压缩前缓存版本时失败；当前仅声明。
 */
export declare function verifyRawReadAfterCompaction(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F21：验证取样完成后原始变化留到下一次刷新，承接 B4。
 * 准备：冻结 A、原始 B；成功压缩后的刷新已完整读取 B，停在最终发布前。
 * 操作：将原始改成 C，放行本次发布并请求；再准备历史并成功压缩一次。
 * 预期：本次发布及请求完整为已取样的 B，原始 C 保留；下一次刷新及请求完整为 C。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在已取样版本混合或后续刷新遗漏 C 时失败；当前仅声明。
 */
export declare function verifyRawChangeAfterSnapshotRead(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F22：验证同一实例并发初始化完整发布一次首次快照，承接 B4。
 * 准备：原始 B、冻结路径缺少；用屏障使两次真实 initialize 在文件准备阶段重叠。
 * 操作：分别放行准备与首次发布，等待两次调用完成，再读取冻结并发起请求。
 * 预期：冻结完整为 B，原始保留；独占创建竞争按公开契约收敛，临时文件及等待者清理完成。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在并发准备破坏完整文件或资源残留时失败；当前仅声明。
 */
export declare function verifyConcurrentMemoryInitialization(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F23：验证迟到的初始化保持较新的压缩冻结版本，承接 B4。
 * 准备：原始 B，初始化停在首次发布前；随后安排原始 C 和同实例的真实刷新。
 * 操作：交错 initialize 与刷新并核对准入；可重叠时先发布 C，再释放旧初始化屏障。
 * 预期：最终冻结为较新的完整 C；若入口串行化，记录实际等待次序并在合法顺序结束后核对 C。
 * 观察：首次发布、刷新与请求的先后关系，以及旧操作完成后的完整文件。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在迟到初始化覆盖新版或等待失去收敛时失败；当前仅声明。
 */
export declare function verifyInitializationRefreshOrdering(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F24：保留原始文件原地写入与复制读取交错的完整性场景，承接 B4。
 * 准备：原始与冻结含独有标记；真实文件工具在原地写入中途停住，复制读取亦可控。
 * 操作：用屏障安排写入、读取和发布重叠，保存每一阶段的实际字节及调用顺序。
 * 预期：按已确认的一致性规则核对发布版本或可恢复错误，原始与冻结各自有完整证据。
 * 待确认：原地写入期间的版本选择、同步或重试规则；实现前确定完整版本与错误的唯一验收标准。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 观察与清理完成后的结果，交错断言待规则确认后实现。
 * @throws 实现后在已确认的一致性或恢复规则不符时失败；当前仅声明。
 */
export declare function verifyRawInPlaceWriteSnapshotConsistency(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F25：验证刷新失败后多个独立请求持续暂停，承接 B5。
 * 准备：原始 B、冻结 A，成功压缩后冻结发布失败，第一个等待者已收到错误。
 * 操作：保持故障，先后发起两个新的读取或聊天请求；记录每次错误及实际模型调用数。
 * 预期：每次均保留待更新失败状态，模型调用数保持基线，原始 B、冻结 A 完整；恢复后原消息处理一次。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在第一个等待者结束后提前恢复旧版请求时失败；当前仅声明。
 */
export declare function verifyRefreshFailurePersistentBlocking(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F26：验证刷新失败重试时读取最新原始版本，承接 B5。
 * 准备：原始 B、冻结 A，本次刷新在发布前失败；将原始完整更新为 C。
 * 操作：修复故障，通过计划的显式更新重试入口继续原用户消息。
 * 预期：重试重新读取并发布完整 C，随后请求使用 C，原始与身份保留，原消息处理一次。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在重试复用失败时旧样本 B 或重复处理消息时失败；当前仅声明。
 */
export declare function verifyRefreshRetryLatestRaw(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F27：保留刷新失败状态跨插件重载的恢复场景，承接 B5。
 * 准备：上下文已成功压缩，冻结发布失败，原始 B 与完整旧冻结 A 均保留。
 * 操作：等待旧插件清理后在同一 home 重载，尝试请求，再按恢复入口完成更新。
 * 预期：失败记录与文件完整保留，恢复完成前后的请求版本及次数有实际证据。
 * 待确认：重载后待更新状态的恢复来源、自动恢复或显式重试入口及请求准入规则。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 观察与清理完成后的结果，跨重载断言待规则确认后实现。
 * @throws 实现后在已确认的失败恢复规则或文件保护不符时失败；当前仅声明。
 */
export declare function verifyRefreshFailurePluginReload(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F28：保留压缩成功而冻结待更新时跨服务重启的恢复场景，承接 B5。
 * 准备：会话压缩记录与原始 B 已保存，冻结更新失败并保留完整旧 A；使用真实子进程。
 * 操作：在明确恢复点停止并等待进程退出，同 home 重启后尝试原消息和恢复更新。
 * 预期：身份、原始和上下文事实完整保留，等待真实就绪与清理；逐阶段核对文件及模型请求。
 * 待确认：待更新状态的跨进程保存与恢复机制、重启后的准入和重试规则；强制终止另按恢复设计安排。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 观察与清理完成后的结果，跨重启断言待规则确认后实现。
 * @throws 实现后在已确认恢复规则、文件或身份不符时失败；当前仅声明。
 */
export declare function verifyRefreshFailureServiceRestart(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F29：验证完整读取原始后、发布前取消的冻结保护，承接 B6。
 * 准备：原始 B、冻结 A；刷新已经读完 B，文件发布仍停在屏障。
 * 操作：取消本次刷新，释放屏障并等待操作、等待者与清理结束。
 * 预期：取消被明确报告，原始 B 与完整旧冻结 A 保留，临时工作收敛，原消息保留供恢复。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在发布前取消仍覆盖文件或留下工作时失败；当前仅声明。
 */
export declare function verifyRefreshCancellationAfterRawRead(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F30：验证临时文件写入中途取消时的完整性与清理，承接 B6。
 * 准备：原始 B、冻结 A，较长 B 的临时写入停在中途；最终发布尚待执行。
 * 操作：取消刷新，放行写入并等待全部文件工作及等待者收敛，再尝试后续恢复。
 * 预期：冻结仍为完整 A，原始 B 完整，临时文件清理；恢复按真实结果继续，模型调用保持准入约束。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在部分内容进入冻结或临时资源残留时失败；当前仅声明。
 */
export declare function verifyRefreshCancellationDuringTemporaryWrite(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F31：验证发布前卸载与重新绑定后迟到回调保持版本顺序，承接 B6。
 * 准备：旧实例的 B 发布停在屏障，冻结为 A；关闭旧插件，登记等待其文件工作完成。
 * 操作：受控释放旧操作并等 close 完成，新实例再刷新 C；在旧操作允许的晚到通知位置释放回调。
 * 预期：close 完成后旧实例文件与模型工作保持基线，新实例的完整 C 保留；监听及临时文件收敛。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在关闭完成后的旧回调改变新版或资源残留时失败；当前仅声明。
 */
export declare function verifyRefreshDisposalLateCallbacks(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F32：保留冻结已完整发布后才收到取消的提交边界场景，承接 B6。
 * 准备：原始 B 已完整发布为冻结，调用返回或后续通知仍停在屏障。
 * 操作：此时发送取消，释放后续步骤，记录文件、操作结果、等待者与请求。
 * 预期：已提交的完整 B 与原始保留，发布次数和请求准入有明确证据，清理完成。
 * 待确认：提交后取消的成功/取消返回语义，以及消息继续或重试规则；按实际提交点设计断言。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 观察与清理完成后的结果，提交后取消断言待规则确认后实现。
 * @throws 实现后在已确认提交语义或完整文件不符时失败；当前仅声明。
 */
export declare function verifyCancellationAfterFrozenPublication(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F33：验证一次自动压缩含多次成功摘要后的最终冻结，承接 B7。
 * 准备：冻结 A、原始 B，受控计量使一次 compactIfNeeded 至少执行两次真实摘要后整体成功。
 * 操作：通过真实自动入口执行，按各 compactionId 记录提交与刷新，再捕获首条普通请求。
 * 预期：外层成功后的冻结和请求完整为 B，原始与身份保留；各摘要与发布事件可关联。
 * 待确认：刷新按每个成功摘要事务还是整个调用成功触发，确认后固定发布次数与等待次序。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 观察与清理完成后的结果，发布粒度断言待规则确认后实现。
 * @throws 实现后在最终内容或已确认发布粒度不符时失败；当前仅声明。
 */
export declare function verifyMultiSummaryCompactionSuccess(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F34：保留前次摘要已提交、后次摘要失败时的刷新判据，承接 B7。
 * 准备：一次自动调用需要多次摘要；第一次真实提交，第二次返回指定模型错误，原始 B、冻结 A。
 * 操作：运行到外层失败，记录各 compactionId、实际上下文、冻结发布和后续请求准入。
 * 预期：已提交上下文、真实错误、完整文件与身份保留，按确认的规则执行恢复。
 * 待确认：一次成功对应内层摘要事务还是外层调用，决定冻结版本、发布次数和重试流程。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 观察与清理完成后的结果，部分成功断言待规则确认后实现。
 * @throws 实现后在已确认成功边界或事实记录不符时失败；当前仅声明。
 */
export declare function verifyPartialSummaryCompactionFailure(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F35：保留多次摘要均提交、外层仍超阈值失败时的刷新判据，承接 B7。
 * 准备：多次真实摘要均能缩减上下文，计量保持超阈值直到自动压缩重试预算耗尽。
 * 操作：等待外层返回超阈值错误，逐次关联摘要提交、文件发布及后续恢复请求。
 * 预期：保留每次已提交上下文和最终失败，原始与完整冻结可核对，身份保持。
 * 待确认：事务级或调用级成功规则及这种整体失败后的冻结版本、准入和重试行为。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 观察与清理完成后的结果，整体失败断言待规则确认后实现。
 * @throws 实现后在已确认成功边界或已提交事实不符时失败；当前仅声明。
 */
export declare function verifyCompactionThresholdExhaustion(
  host: MemoryMockHost,
): Promise<void>;

/**
 * F36：验证手动压缩 end 后、flush 完成前的请求与刷新等待，承接 B7。
 * 准备：原始 B、冻结 A；真实 compactNow 已提交摘要和 end，持久化 flush 停在屏障。
 * 操作：提交后续请求，分别让 flush 成功或失败，再观察发布和第一条普通请求。
 * 预期：flush 待定时请求等待、冻结 A 保留；成功后发布 B 并使用 B，失败按 F05 保留 A 与真实错误。
 * 观察：区分摘要请求、end、flush 结果、冻结发布及普通请求，按 compactionId 关联。
 * @param host - 本例独占的真实能力与模型替身宿主。
 * @returns 全部观察与资源清理完成后的结果。
 * @throws 实现后在持久化成功确认前提前发布或请求抢跑时失败；当前仅声明。
 */
export declare function verifyManualCompactionFlushAdmission(
  host: MemoryMockHost,
): Promise<void>;
