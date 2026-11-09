/** Loader 中使用真实持久记录读取，全文搜索留给后续阶段。 */
import Query from "@deepseek-ai/dsh-session-query";
export default class PointQuery extends Query {
  override searchSessions(): never {
    throw Error("search is outside M1");
  }
  override searchEvents(): never {
    throw Error("search is outside M1");
  }
}
