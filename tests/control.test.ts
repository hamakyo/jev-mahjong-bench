import { describe, expect, it } from "vitest";
import { TournamentControl, ControlConflictError } from "../src/live/control.js";
import { LiveEventHub } from "../src/live/hub.js";
import { createLiveServer } from "../src/live/server.js";
import { SnapshotStore } from "../src/live/snapshot.js";

describe("TournamentControl", () => {
  it("pauses only at a phase boundary and single-steps one phase", async () => {
    const control = new TournamentControl();
    await control.enter("game-start");
    control.pause();
    control.completePhase("game-start", "decision-batch");
    expect(control.getSnapshot()).toMatchObject({ state: "paused", nextStep: "decision-batch" });

    let entered = false;
    const waiting = control.enter("decision-batch").then(() => { entered = true; });
    await Promise.resolve();
    expect(entered).toBe(false);

    control.step();
    await waiting;
    expect(entered).toBe(true);
    expect(control.getSnapshot()).toMatchObject({ state: "stepping", currentStep: "decision-batch" });
    expect(() => control.step()).toThrow(ControlConflictError);

    control.completePhase("decision-batch", "environment-step");
    expect(control.getSnapshot()).toMatchObject({ state: "paused", nextStep: "environment-step" });
  });

  it("rejects a paused waiter when control is closed", async () => {
    const control = new TournamentControl();
    await control.enter("game-start");
    control.pause();
    control.completePhase("game-start", "decision-batch");
    const waiting = control.enter("decision-batch");
    control.close();
    await expect(waiting).rejects.toMatchObject({ name: "ControlClosedError" });
    expect(control.getSnapshot().state).toBe("failed");
  });
});

describe("live control HTTP API", () => {
  it("serves status and accepts pause/resume/step commands", async () => {
    const hub = new LiveEventHub({ streamId: "control-stream" });
    const snapshots = new SnapshotStore(hub.streamId);
    const control = new TournamentControl();
    const server = createLiveServer({ hub, snapshots, control, port: 0 });
    const port = await server.listen();
    const url = "http://127.0.0.1:" + port;
    try {
      const status = await fetch(url + "/api/control");
      expect(status.status).toBe(200);
      expect((await status.json()).state).toBe("running");

      const pause = await fetch(url + "/api/control/pause", { method: "POST" });
      expect(pause.status).toBe(200);
      control.completePhase("game-start", "decision-batch");
      expect(control.getSnapshot().state).toBe("paused");

      const step = await fetch(url + "/api/control/step", { method: "POST" });
      expect(step.status).toBe(200);
      const duplicate = await fetch(url + "/api/control/step", { method: "POST" });
      expect(duplicate.status).toBe(409);
      control.completePhase("decision-batch", "environment-step");

      const resume = await fetch(url + "/api/control/resume", { method: "POST" });
      expect(resume.status).toBe(200);
      expect((await resume.json()).state).toBe("running");
    } finally {
      await server.close();
    }
  });
});
