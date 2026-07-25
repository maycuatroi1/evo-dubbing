import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const extensionDirectory = fileURLToPath(new URL("..", import.meta.url));
const filters = process.argv.slice(2);
const targets = filters.length > 0 ? filters.map((f) => `test/${f}.test.ts`) : ["test/**/*.test.ts"];

const result = spawnSync(process.execPath, ["--experimental-strip-types", "--test", ...targets], {
  cwd: extensionDirectory,
  stdio: "inherit"
});
process.exit(result.status ?? 1);
