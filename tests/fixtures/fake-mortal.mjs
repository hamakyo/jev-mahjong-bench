import readline from "node:readline";

const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const event = JSON.parse(line);
  // The first imported fixture sample has 0m as a legal discard.  The CI
  // smoke test intentionally uses only that one sample.
  if (event.type === "tsumo") {
    // Simulate a response for another seat that arrived while the replay
    // prefix was being consumed.  The adapter must drain it before accepting
    // the requested discard response.
    process.stdout.write(`${JSON.stringify({ type: "none", actor: 1 })}\n`);
    process.stdout.write(`${JSON.stringify({ type: "none", actor: 0 })}\n`);
    process.stdout.write(`${JSON.stringify({ type: "dahai", actor: 0, pai: "0m" })}\n`);
  }
});
