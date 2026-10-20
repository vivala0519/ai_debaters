export class PlanStreamError extends Error {
  constructor(message: string, public readonly status = 502) { super(message); }
}

function failed(code: unknown): never {
  if (code === "subscription_sharing_usage_limit_exceeded") throw new PlanStreamError("ChatGPT 플랜 사용량 한도에 도달했습니다. ChatGPT의 사용량 설정을 확인해주세요.", 429);
  if (code === "subscription_sharing_usage_unavailable") throw new PlanStreamError("이 계정에서 ChatGPT 플랜을 사용할 수 없습니다. 설정에서 연결 권한을 확인해주세요.", 403);
  throw new PlanStreamError("ChatGPT가 응답을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.");
}

// Plan-usage inference is successful only after the terminal completed event.
// A partial delta followed by a usage-limit error is never a successful answer.
export async function readPlanResponse(response: Response): Promise<string> {
  if (!response.body) throw new PlanStreamError("ChatGPT 응답 스트림을 열지 못했습니다.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let completed = false;
  let total = 0;
  function event(block: string) {
    const data = block.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data || data === "[DONE]") return;
    const value = JSON.parse(data);
    if (value.type === "response.output_text.delta" && typeof value.delta === "string") text += value.delta;
    if (value.type === "response.failed" || value.type === "error") failed(value.response?.error?.code ?? value.error?.code ?? value.code);
    if (value.type === "response.incomplete") throw new PlanStreamError("ChatGPT 답변이 중단되었습니다. 다시 시도해주세요.");
    if (value.type === "response.completed") {
      const final = value.response?.output?.filter((item: { type?: string }) => item.type === "message").flatMap((item: { content?: unknown[] }) => item.content || []).filter((part: { type?: string; text?: unknown }) => part.type === "output_text" && typeof part.text === "string").map((part: { text: string }) => part.text).join("\n");
      if (typeof final === "string" && final.trim()) text = final;
      completed = true;
    }
  }
  try {
    while (!completed) {
      const { done, value } = await reader.read();
      total += value?.byteLength || 0;
      if (total > 2_000_000) throw new PlanStreamError("ChatGPT 응답이 너무 큽니다.");
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, "\n");
      let split: number;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, split); buffer = buffer.slice(split + 2); event(block);
        if (completed) break;
      }
      if (done) { if (buffer.trim()) event(buffer); break; }
    }
    if (!completed || !text.trim()) throw new PlanStreamError("ChatGPT 응답이 완료되기 전에 연결이 종료되었습니다.");
    return text.trim();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
