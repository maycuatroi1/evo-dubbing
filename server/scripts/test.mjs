import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const serverDirectory = fileURLToPath(new URL("..", import.meta.url));
const filter = process.argv[2];
const target = filter ? `test/${filter}.test.ts` : "test";

const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", target], {
  cwd: serverDirectory,
  stdio: "inherit"
});
process.exit(result.status ?? 1);
