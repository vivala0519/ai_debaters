import assert from "node:assert/strict";

// Run against an already running Next.js server. No real AI APIs are called.
const base = process.env.AGORA_BASE_URL || "http://localhost:3000";
for (const route of ["/", "/settings", "/guide"]) {
  const response = await fetch(new URL(route, base));
  assert.equal(response.status, 200, `${route} should render`);
  assert.match(await response.text(), /<title>Prism\b/);
  console.log(`PASS ${route}`);
}
const configuration = await fetch(new URL("/api/debate", base));
assert.equal(configuration.status, 200);
assert.equal((await configuration.json()).providers.length, 3);

for (const input of [
  { topic: "", position: "" },
  { topic: "   " },
  { topic: "입력 검증", position: null },
  { topic: "입력 검증", position: 42 },
  { topic: "입력 검증", position: "가".repeat(4001) },
]) {
  const invalid = await fetch(new URL("/api/debate", base), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, mode: "demo" }),
  });
  assert.equal(invalid.status, 400);
}
console.log("PASS input validation");

const response = await fetch(new URL("/api/debate", base), {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ topic: "AI와 함께 일하는 방식은 어떻게 바뀔까?", position: "AI는 인간을 대체하기보다 협업을 통해 능력을 확장한다고 생각합니다.", mode: "demo" }),
});
assert.equal(response.status, 200);
assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
const events = (await response.text()).split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
assert.equal(events[0].type, "start");
assert.equal(events.at(-1).type, "complete");
assert.equal(events.filter(event => event.type === "message").length, 9);
for (const round of [1, 2, 3]) {
  const messages = events.filter(event => event.type === "message" && event.message.round === round);
  assert.equal(messages.length, 3);
  assert.deepEqual(messages.map(event => event.message.providerId).sort(), ["claude", "gemini", "gpt"]);
  assert.ok(messages.every(event => event.message.content.includes("실제 AI 응답이 아닙니다")));
}
console.log("PASS demo stream: 3 rounds, 9 responses, explicit demo labels");
for (const optionalPosition of [{}, { position: "" }, { position: " \n " }]) {
  const topicOnly = await fetch(new URL("/api/debate", base), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: "학교에서 AI 활용을 허용해야 할까?", mode: "demo", ...optionalPosition }),
  });
  assert.equal(topicOnly.status, 200);
  const topicEvents = (await topicOnly.text()).split("\n").filter(line => line.trim()).map(line => JSON.parse(line));
  assert.equal(topicEvents.at(-1).type, "complete");
  const messages = topicEvents.filter(event => event.type === "message").map(event => event.message);
  assert.equal(messages.length, 9);
  for (const message of messages) {
    assert.equal(message.status, "complete");
    assert.match(message.content, /실제 AI 응답이 아닙니다/);
    assert.doesNotMatch(message.content, /“”|입론을 제시했습니다|사용자 주장을/);
  }
}
console.log("PASS optional position: omitted, empty and whitespace-only inputs complete all 9 responses");
console.log("All HTTP smoke checks passed.");
