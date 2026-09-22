import { resolve } from "node:path";
import { publishBenchmark } from "./publish/benchmark.js";
import { RunStore } from "./server/run-store.js";

function flags(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]!;
    if (!item.startsWith("--")) throw new Error(`unexpected argument ${item}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${item} requires a value`);
    result[item.slice(2)] = value;
    index += 1;
  }
  return result;
}

const options = flags(process.argv.slice(2).filter((argument) => argument !== "--"));
const runId = options["run-id"];
if (!runId) throw new Error("--run-id is required");
const projectRoot = resolve(options["project-root"] ?? process.cwd());
const store = new RunStore(resolve(projectRoot, options["runs-dir"] ?? "results/runs"));
const published = await publishBenchmark({
  projectRoot,
  store,
  runId,
  ...(options.category ? { category: options.category } : {}),
  ...(options.slug ? { slug: options.slug } : {}),
});
console.log(`Published ${published.manifest.id} to ${published.path}`);
