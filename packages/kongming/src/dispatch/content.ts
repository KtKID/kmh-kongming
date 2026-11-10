/** 校验委派正文，解析孔明会话中已入库的附件引用。 */
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { AttachmentAdmissionPart } from "@deepseek-ai/dsh-attachment/types";
import { z } from "zod";

const attachmentReference = z.object({
  attachment: z.object({ attachmentId: z.string().min(1) }),
});
const contentSchema = z
  .array(
    z.union([
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({
        type: z.literal("image"),
        data: z.string().min(1),
        mediaType: z.enum([
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/gif",
        ]),
        name: z.string().optional(),
      }),
      attachmentReference.extend({ type: z.literal("image") }),
      attachmentReference.extend({ type: z.literal("file") }),
    ]),
  )
  .min(1)
  .refine(
    // 正文至少包含一段有效文本、一张图片或一个文件。
    (parts) =>
      parts.some(
        // 图片和文件直接计入，文本去掉空白后再判断。
        (part) => part.type !== "text" || part.text.trim() !== "",
      ),
    {
      error: "Dispatch content must contain text or an attachment",
    },
  );

/** 校验工具入参，按原顺序返回可交给附件入库服务的正文与附件。 */
export function parseDispatchContent(
  source: Agent,
  input: unknown,
): AttachmentAdmissionPart[] {
  const content = contentSchema.parse(input);
  const originals = content.some(
    // 只有引用已入库附件时才需要扫描源会话历史。
    (part) => "attachment" in part,
  )
    ? source.session.snapshotEvents().flatMap(
        // 附件归属以源会话已记录的用户消息为准。
        (event) => (event.type === "user/message" ? event.data.content : []),
      )
    : [];
  // 逐块保留文本和新图片，并补全历史附件引用。
  return content.map((part) => {
    if (part.type === "text") return part;
    if ("data" in part) {
      const { type, mediaType, data, name } = part;
      return { type, mediaType, data, ...(name === undefined ? {} : { name }) };
    }
    const ref = originals.find(
      // 类型和附件 ID 都匹配时，才复用原生附件记录。
      (block) =>
        (block.type === "image" || block.type === "file") &&
        block.type === part.type &&
        block.attachment.attachmentId === part.attachment.attachmentId,
    );
    if (ref?.type === "image")
      return {
        type: "image",
        attachment: ref.attachment,
        encodedBytes: ref.attachment.bytes,
      };
    if (ref?.type === "file") return ref;
    throw Error(
      `附件 ${part.attachment.attachmentId} 不属于孔明会话中的已入库附件`,
    );
  });
}
