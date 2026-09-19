import readline from "node:readline";

const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const event = JSON.parse(line);
  // Dataset reference protocol receives the reach event and then exactly one
  // discard response; the preceding tsumo is the decision being replaced.
  if (event.type === "reach") {
    process.stdout.write(`${JSON.stringify({ type: "dahai", actor: 0, pai: "1m" })}\n`);
  }
});
