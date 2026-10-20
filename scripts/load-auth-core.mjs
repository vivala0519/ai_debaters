import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import ts from "typescript";

// Load the actual TypeScript implementation in Node tests without writing build artifacts.
export async function loadAuthCore() {
  const source = await readFile(new URL("../src/lib/server/auth-core.ts", import.meta.url), "utf8");
  const require = createRequire(import.meta.url);
  const jose = pathToFileURL(require.resolve("jose")).href;
  const config = await readFile(new URL("../src/lib/firebase-settings.ts", import.meta.url), "utf8");
  const compile = input => ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const configUrl = `data:text/javascript;base64,${Buffer.from(compile(config)).toString("base64")}`;
  const output = compile(source).replaceAll('"jose"', JSON.stringify(jose)).replaceAll('"../firebase-settings"', JSON.stringify(configUrl));
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
}
