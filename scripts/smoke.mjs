import assert from "node:assert/strict";

// Run against an already running Next.js server. No real AI APIs are called.
const base = process.env.AGORA_BASE_URL || "http://localhost:3000";
const sessionCookie = process.env.AGORA_SESSION_COOKIE;
const authenticatedFetch = (url, options = {}) => fetch(url, { ...options, headers: { ...options.headers, ...(sessionCookie ? { Cookie: sessionCookie } : {}) } });
for (const route of ["/", "/settings", "/guide"]) {
  const anonymous = await fetch(new URL(route, base), { redirect: "manual" });
  assert.equal(anonymous.status, 303, `${route} requires Google login`);
  assert.equal(new URL(anonymous.headers.get("location"), base).pathname, "/login");
}
for (const route of ["/api/debate", "/api/history", "/api/gemini-local", "/api/auth/chatgpt/status"]) {
  assert.equal((await fetch(new URL(route, base))).status, 401, `${route} requires a session`);
}
const anonymousPost = await fetch(new URL("/api/debate", base), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ topic: "차단 확인", mode: "demo" }) });
assert.equal(anonymousPost.status, 401);
const forged = await fetch(new URL("/api/debate", base), { headers: { Cookie: "prism-firebase-session=forged" } });
assert.equal(forged.status, 401);
for (const method of ["POST", "DELETE"]) {
  const historyRequest = await fetch(new URL("/api/history", base), { method, headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(historyRequest.status, 401, `history ${method} requires a session`);
}
const login = await fetch(new URL("/login", base));
assert.equal(login.status, 200);
assert.match(await login.text(), /Google로 로그인/);
console.log("PASS Google-only authentication: page redirects, API rejection and login screen");
for (const route of ["/", "/settings", "/guide"]) {
  if (!sessionCookie) break;
  const response = await authenticatedFetch(new URL(route, base), { redirect: "manual" });
  assert.equal(response.status, 200, `${route} should render`);
  assert.match(await response.text(), /<title>Prism\b/);
  console.log(`PASS ${route}`);
}

const manifestResponse = await fetch(new URL("/manifest.webmanifest", base));
assert.equal(manifestResponse.status, 200, "PWA manifest should be served");
const manifest = await manifestResponse.json();
assert.match(manifest.name, /Prism/i);
assert.equal(manifest.display, "standalone");
assert.equal(manifest.start_url, "/");
const installIcons = [192, 512].map(size => {
  const icon = manifest.icons.find(item => item.sizes === `${size}x${size}` && (!item.purpose || item.purpose.includes("any")));
  assert.ok(icon, `manifest needs a ${size}px install icon`);
  return { path: icon.src, size };
});
const maskableIcon = manifest.icons.find(icon => icon.purpose?.includes("maskable"));
assert.ok(maskableIcon, "manifest needs a maskable icon");
installIcons.push({ path: maskableIcon.src, size: Number.parseInt(maskableIcon.sizes, 10) });
installIcons.push({ path: "/icons/apple-touch-icon.png", size: 180 });
for (const { path, size } of installIcons) {
  const icon = await fetch(new URL(path, base));
  assert.equal(icon.status, 200, `${path} should be served`);
  assert.match(icon.headers.get("content-type"), /image\/png/);
  const bytes = new DataView(await icon.arrayBuffer());
  assert.ok(bytes.byteLength >= 24, `${path} should contain a PNG header`);
  assert.equal(bytes.getUint32(0), 0x89504e47, `${path} should be a PNG`);
  assert.equal(bytes.getUint32(16), size, `${path} width`);
  assert.equal(bytes.getUint32(20), size, `${path} height`);
}
const serviceWorker = await fetch(new URL("/sw.js", base));
assert.equal(serviceWorker.status, 200);
assert.match(serviceWorker.headers.get("content-type"), /(?:application|text)\/javascript/);
assert.match(serviceWorker.headers.get("cache-control"), /no-store/);
const offlinePage = await fetch(new URL("/offline.html", base));
assert.equal(offlinePage.status, 200);
assert.match(await offlinePage.text(), /인터넷 연결을 확인/);
console.log("PASS PWA: install manifest, PNG icons, service worker headers and offline page");

if (!sessionCookie) {
  console.log("Protected demo checks need a real Firebase session in AGORA_SESSION_COOKIE. No Google sign-in is simulated.");
  process.exit(0);
}

const configuration = await authenticatedFetch(new URL("/api/debate", base));
assert.equal(configuration.status, 200);
assert.equal((await configuration.json()).providers.length, 3);

for (const input of [
  { topic: "", position: "" },
  { topic: "   " },
  { topic: "입력 검증", position: null },
  { topic: "입력 검증", position: 42 },
  { topic: "입력 검증", position: "가".repeat(4001) },
]) {
  const invalid = await authenticatedFetch(new URL("/api/debate", base), {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, mode: "demo" }),
  });
  assert.equal(invalid.status, 400);
}
console.log("PASS input validation");

const response = await authenticatedFetch(new URL("/api/debate", base), {
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
  const topicOnly = await authenticatedFetch(new URL("/api/debate", base), {
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
