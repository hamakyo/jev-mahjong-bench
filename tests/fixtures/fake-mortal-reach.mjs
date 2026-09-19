import readline from "node:readline";

const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const event = JSON.parse(line);
  if (event.type === "tsumo" || event.type === "reach") {
    process.stdout.write(`${JSON.stringify({ type: "dahai", actor: 0, pai: "1m" })}\n`);
  }
});
