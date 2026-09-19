import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import readline from "node:readline";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}

function key(seat, history) {
  return createHash("sha256").update(`${seat}\n${history.join("\n")}`).digest("hex");
}

function mpszToMjai(tile) {
  const honors = { "1z": "E", "2z": "S", "3z": "W", "4z": "N", "5z": "P", "6z": "F", "7z": "C" };
  if (honors[tile]) return honors[tile];
  if (tile[0] === "0") return `5${tile[1]}r`;
  return tile;
}

const seat = Number(process.argv[2] ?? "0");
const answerPath = process.env.FAKE_MORTAL_DATASET;
if (!answerPath) throw new Error("FAKE_MORTAL_DATASET is required");
const answers = new Map();
for (const line of readFileSync(answerPath, "utf8").split(/\r?\n/)) {
  if (!line.trim()) continue;
  const sample = JSON.parse(line);
  if (sample.provenance?.seat !== seat) continue;
  const history = sample.state?.mjaiEvents?.map((event) => canonical(typeof event === "string" ? JSON.parse(event) : event));
  const action = sample.legalActions?.[0];
  if (!Array.isArray(history) || typeof action !== "string") continue;
  const sampleKey = key(seat, history);
  const previous = answers.get(sampleKey);
  if (previous !== undefined && previous !== action) throw new Error(`conflicting answer for ${sampleKey}`);
  answers.set(sampleKey, action);
}

const history = [];
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const event = JSON.parse(line);
  history.push(canonical(event));
  const action = answers.get(key(seat, history));
  if (action) {
    process.stdout.write(`${JSON.stringify({ type: "dahai", actor: seat, pai: mpszToMjai(action) })}\n`);
  } else if (event.type === "dahai" && event.actor !== seat) {
    // The real wrapper may answer pass/call opportunities before the discard
    // response.  This keeps the test protocol honest about draining them.
    process.stdout.write(`${JSON.stringify({ type: "none", actor: (seat + 1) % 4 })}\n`);
  }
});
