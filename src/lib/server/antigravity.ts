import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import type { LocalGeminiStatus, LocalGeminiModel } from "../gemini-local";
import { InputError } from "./input";
import { getRequestOrigin } from "./request-origin";

export class LocalCliError extends Error {
  constructor(message: string, public readonly status = 502) { super(message); }
}

export function isLocalCliRequest(request: Request) {
  const url = new URL(getRequestOrigin(request));
  return url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)
    && !(process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "development");
}

export function requireLocalCliRequest(request: Request) {
  if (!isLocalCliRequest(request) || request.headers.get("origin") !== getRequestOrigin(request)) {
    throw new InputError("로컬 토론 사이트에서 Google 구독 연결을 사용해주세요.", 403);
  }
}

// The executable path is server configuration, never accepted from HTTP input.
export async function findCli(): Promise<string | null> {
  const configured = process.env.AGORA_ANTIGRAVITY_PATH;
  const defaultPath = process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || path.join(homedir(), "AppData", "Local"), "agy", "bin", "agy.exe") : path.join(homedir(), ".local", "bin", "agy");
  const candidates = configured ? [configured] : [...(process.env.PATH || "").split(path.delimiter).filter(Boolean).map(dir => path.join(dir, process.platform === "win32" ? "agy.exe" : "agy")), defaultPath];
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate) || (process.platform === "win32" && path.extname(candidate).toLowerCase() !== ".exe")) continue;
    try { await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK); return candidate; } catch { /* Try the next PATH entry. */ }
  }
  return null;
}

// Do not forward the web server's provider keys, NODE_OPTIONS, or ADC settings.
export function cliEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "USERPROFILE", "HOME", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME"];
  return { ...Object.fromEntries(allowed.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])), NODE_ENV: process.env.NODE_ENV || "production" };
}

async function requireAccountProvider() {
  // A user may have configured agy to use a paid API key instead of their account.
  const filename = path.join(homedir(), ".gemini", "antigravity-cli", "settings.json");
  try {
    const settings = JSON.parse(await readFile(filename, "utf8"));
    if (settings.modelProvider && settings.modelProvider !== "antigravity") {
      throw new LocalCliError("Antigravity CLI가 API 제공자로 설정되어 있습니다. CLI에서 Google 계정 연결로 전환해주세요.", 409);
    }
  } catch (error) {
    if (error instanceof LocalCliError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new LocalCliError("Antigravity CLI 설정을 읽지 못했습니다. 터미널에서 agy 설정을 확인해주세요.", 409);
  }
}

export function runCli(executable: string, args: string[], cwd: string, signal: AbortSignal, timeout: number, input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(executable, args, { cwd, env: cliEnvironment(), shell: false, windowsHide: true, encoding: "utf8", maxBuffer: 1_048_576, timeout, signal }, (error, stdout, stderr) => {
      if (signal.aborted) return reject(new LocalCliError("로컬 Gemini 요청이 취소되었습니다.", 499));
      if (error) {
        // Only classify diagnostics; never return raw CLI output, paths, or auth URLs.
        const diagnostic = `${stdout}\n${stderr}`;
        if (/authentication required|unauthenticated|sign.?in|log.?in|credentials|oauth/i.test(diagnostic)) return reject(new LocalCliError("터미널에서 agy를 실행해 Google 계정으로 로그인한 뒤 다시 확인해주세요.", 401));
        if (/quota|rate.?limit|resource.?exhausted|usage.?limit/i.test(diagnostic)) return reject(new LocalCliError("Google 구독의 Antigravity 사용 한도에 도달했습니다. 사용량을 확인해주세요.", 429));
        if (error.killed) return reject(new LocalCliError("Antigravity CLI 응답 시간이 초과되었습니다.", 504));
        return reject(new LocalCliError("Antigravity CLI 실행에 실패했습니다. 터미널에서 agy 실행과 모델 접근 권한을 확인해주세요."));
      }
      resolve(stdout);
    });
    child.stdin?.on("error", () => { /* Early process exit is handled by the callback. */ });
    child.stdin?.end(input ?? "");
  });
}

export function parseCliModels(output: string): LocalGeminiModel[] {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  const models = new Map<string, LocalGeminiModel>();
  for (const line of clean.split(/\r?\n/)) {
    const match = /^\s*(gemini-[a-zA-Z0-9._-]{1,110})\s+(.+?)\s*$/.exec(line);
    if (match) models.set(match[1], { id: match[1], label: match[2].slice(0, 160) });
  }
  return [...models.values()].slice(0, 100);
}

export async function getLocalGeminiStatus(request: Request): Promise<LocalGeminiStatus> {
  const base = { enabled: isLocalCliRequest(request), installed: false, ready: false, models: [] as LocalGeminiModel[] };
  if (!base.enabled) return { ...base, message: "Google 구독 연결은 이 PC의 로컬 실행에서 사용할 수 있습니다. Vercel에서는 API 키를 사용해주세요." };
  const executable = await findCli();
  if (!executable) return { ...base, message: "Antigravity CLI가 필요합니다. 공식 CLI를 설치하고 터미널에서 agy로 로그인한 뒤 다시 확인해주세요." };
  let directory: string | undefined;
  try {
    await requireAccountProvider();
    directory = await mkdtemp(path.join(tmpdir(), "agora-cli-check-"));
    const models = parseCliModels(await runCli(executable, ["models"], directory, request.signal, 12_000));
    return { ...base, installed: true, ready: models.length > 0, models, message: models.length ? "CLI와 Gemini 모델 목록을 확인했습니다. 연결 테스트로 Google 계정의 실제 응답을 확인하세요." : "Gemini 모델 목록을 확인하지 못했습니다. 터미널에서 agy로 로그인해주세요." };
  } catch (error) {
    return { ...base, installed: true, message: error instanceof LocalCliError ? error.message : "CLI 상태를 확인하지 못했습니다. 터미널에서 agy 실행을 확인해주세요." };
  } finally { if (directory) await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

export function parseCliResponse(output: string): string {
  let result: { status?: string; response?: string; error?: string } | undefined;
  let initialized = false;
  for (const line of output.split(/\r?\n/).filter(line => line.trim())) {
    let event;
    try { event = JSON.parse(line); } catch { throw new LocalCliError("CLI 응답 형식을 확인하지 못했습니다. Antigravity CLI를 업데이트해주세요."); }
    if (!event || typeof event !== "object") throw new LocalCliError("CLI가 올바른 응답 이벤트를 반환하지 않았습니다.");
    if (event.event === "init") {
      // CLI 1.4.2 advertises the registered tool catalog here, including for a
      // custom agent with tools: []. This is not an effective permission list.
      if (initialized || !Array.isArray(event.init?.tools) || !event.init.tools.every((tool: unknown) => typeof tool === "string")) throw new LocalCliError("CLI 초기화 응답 형식을 확인하지 못했습니다.");
      if (event.init.agent !== undefined && event.init.agent !== "agora-debater") throw new LocalCliError("토론 전용 CLI 에이전트가 선택되지 않았습니다.");
      initialized = true;
    }
    if (event.event === "step_update" && (event.step_update?.step_type === "tool" || event.step_update?.tool_info || event.step_update?.subagent_info)) {
      throw new LocalCliError("CLI가 토론 답변 외의 도구 작업을 실행해 응답을 채택하지 않았습니다. 다시 테스트해주세요.");
    }
    if (event.event === "result") {
      if (result) throw new LocalCliError("CLI가 예상하지 못한 중복 응답을 반환했습니다.");
      result = event.result;
    }
  }
  if (!initialized) throw new LocalCliError("CLI 초기화 확인을 받지 못했습니다. Antigravity CLI를 업데이트해주세요.");
  if (result?.status !== "SUCCESS") {
    if (/quota|rate.?limit|resource.?exhausted/i.test(result?.error || "")) throw new LocalCliError("Google 구독의 Antigravity 사용 한도에 도달했습니다.", 429);
    if (/auth|sign.?in|log.?in|credentials/i.test(result?.error || "")) throw new LocalCliError("터미널에서 agy로 Google 계정에 다시 로그인해주세요.", 401);
    throw new LocalCliError("로컬 Gemini가 답변을 완료하지 못했습니다. CLI 로그인과 모델 접근 권한을 확인해주세요.");
  }
  if (typeof result.response !== "string" || !result.response.trim()) throw new LocalCliError("로컬 Gemini가 텍스트 답변을 반환하지 않았습니다.");
  return result.response.trim();
}

export async function callLocalGemini(options: { model: string; system: string; prompt: string; signal: AbortSignal; timeoutMs?: number }): Promise<string> {
  if (!/^gemini-[a-zA-Z0-9._-]{1,110}$/.test(options.model)) throw new LocalCliError("CLI 모델 목록에서 Gemini 모델을 선택해주세요.", 400);
  if (process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "development") throw new LocalCliError("Google 구독 연결은 로컬 실행에서만 사용할 수 있습니다.", 403);
  const executable = await findCli();
  if (!executable) throw new LocalCliError("Antigravity CLI를 설치하고 agy로 로그인해주세요.", 422);
  await requireAccountProvider();
  const directory = await mkdtemp(path.join(tmpdir(), "agora-cli-debate-"));
  try {
    // Isolated workspace, a custom agent declaring no tools, no shell interpolation.
    await mkdir(path.join(directory, ".agents", "agents"), { recursive: true });
    // Enforce the text-only boundary before tool execution; init.tools is only
    // catalog metadata. Keep this hook local to the disposable workspace.
    const hookFile = path.join(directory, ".agents", "deny-tools.cjs");
    await writeFile(hookFile, 'process.stdout.write(JSON.stringify({decision:"deny",reason:"This session accepts text-only debate answers; tools are disabled."}));\n', { mode: 0o600 });
    const quote = (value: string) => process.platform === "win32" ? `"${value}"` : `'${value.replaceAll("'", "'\\''")}'`;
    await writeFile(path.join(directory, ".agents", "hooks.json"), JSON.stringify({ "agora-text-only": { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `${quote(process.execPath)} ${quote(hookFile)}`, timeout: 5 }] }] } }), { mode: 0o600 });
    await writeFile(path.join(directory, ".agents", "agents", "agora-debater.md"), `---\nname: agora-debater\ndescription: Text-only AI debate participant\ntools: []\nmainAgent: true\nsubagent: false\ncommandExecutionPolicy: off\n---\n${options.system}\nAnswer only from the provided debate text. Do not use tools or access files.\n`, { mode: 0o600 });
    const timeout = options.timeoutMs ?? 65_000;
    const output = await runCli(executable, ["--agent", "agora-debater", "--disable-slash-commands", "--model", options.model, "--input-format", "stream-json", "--output-format", "stream-json", "--print-timeout", `${Math.ceil(timeout / 1000)}s`], directory, options.signal, timeout,
      JSON.stringify({ event: "user", message: { content: options.prompt } }) + "\n");
    return parseCliResponse(output);
  } finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}
