import assert from "node:assert/strict";

// Exercise public authentication boundaries without minting fake Firebase sessions.
const base = new URL(process.env.AGORA_BASE_URL || "http://localhost:3000");
const exchange = (body, extra = {}) => fetch(new URL("/api/auth/firebase/session", base), {
  method: "POST", headers: { Origin: base.origin, "Content-Type": "application/json", ...extra }, body,
});
for (const [body, status] of [["{}", 400], ['{"idToken":null}', 400], ['{"idToken":""}', 400], ["invalid-json", 400], [JSON.stringify({ idToken: "a".repeat(3801) }), 400], ['{"idToken":"forged"}', 401]]) {
  const response = await exchange(body);
  assert.equal(response.status, status);
  assert.equal(response.headers.get("set-cookie"), null, "Invalid tokens must not issue cookies");
}
assert.equal((await exchange("{}", { Origin: "https://other.example" })).status, 403);
assert.equal((await fetch(new URL("/api/auth/firebase/session", base), { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } })).status, 403);
assert.equal((await exchange("{}", { "Content-Type": "text/plain" })).status, 415);
assert.equal((await fetch(new URL("/api/auth/session", base))).status, 401);
const crossSiteLogout = await fetch(new URL("/api/auth/logout", base), { method: "POST", headers: { Origin: "https://other.example" } });
assert.equal(crossSiteLogout.status, 403);
const logout = await fetch(new URL("/api/auth/logout", base), { method: "POST", headers: { Origin: base.origin } });
assert.equal(logout.status, 200);
assert.match(logout.headers.get("set-cookie"), /prism-firebase-session=.*Max-Age=0/i);
console.log("PASS Firebase session exchange: forged/malformed token rejection, login CSRF and logout");
await import("./smoke.mjs");
