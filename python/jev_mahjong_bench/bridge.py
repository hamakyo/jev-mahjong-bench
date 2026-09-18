"""Long-lived JSONL bridge around RiichiEnv 0.4.10."""

from __future__ import annotations

import hashlib
import json
import sys
from typing import Any

from riichienv import GameRule, RiichiEnv

from .importer import canonical_json, compact_event, observation_state, visible_event


def stable_id(value: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def parse_mjai(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict) or not isinstance(value.get("type"), str):
        raise ValueError("MJAI action must be an object with a type")
    return value


def action_payload(action: Any) -> dict[str, Any]:
    raw = action.to_mjai()
    value = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(value, dict) or not isinstance(value.get("type"), str):
        raise ValueError("RiichiEnv action did not serialize to MJAI")
    return value


def action_type(value: dict[str, Any]) -> str:
    return str(value["type"])


def serialize_observation(
    player: int,
    observation: Any,
    game_id: str,
    turn_index: int,
    game_events: list[Any],
    previous_events: list[str],
) -> tuple[dict[str, Any], list[str]]:
    # RiichiEnv 0.4.10 exposes a bounded event window on Observation.events.
    # The bridge owns the per-seat cumulative history so downstream agents can
    # keep one persistent MJAI process and receive a real prefix/delta stream.
    events = [compact_event(visible_event(event, player)) for event in game_events]
    if previous_events and events[:len(previous_events)] != previous_events:
        raise ValueError(f"MJAI history for player {player} is not append-only")
    new_events = events[len(previous_events):]
    state = observation_state(observation, player, events)
    legal: list[dict[str, Any]] = []
    seen: set[str] = set()
    for action in observation.legal_actions():
        mjai = action_payload(action)
        action_id = stable_id(mjai)
        if action_id in seen:
            continue
        seen.add(action_id)
        legal.append({"id": action_id, "type": action_type(mjai), "mjai": mjai})
    return {
        "player": player,
        "newEvents": new_events,
        "events": events,
        "state": state,
        "legalActions": legal,
        "gameId": game_id,
        "handIndex": int(getattr(observation, "kyoku_index")),
        "turnIndex": turn_index,
    }, events


class Bridge:
    def __init__(self) -> None:
        self.env: RiichiEnv | None = None
        self.game_id = ""
        self.turn_index = 0
        self.observations: dict[int, Any] = {}
        self.last_log_length = 0
        self.history: dict[int, list[str]] = {}

    def require_env(self) -> RiichiEnv:
        if self.env is None:
            raise RuntimeError("startGame must be called first")
        return self.env

    def start_game(self, request: dict[str, Any]) -> dict[str, Any]:
        mode = request.get("mode", "4p-red-half")
        if mode != "4p-red-half" and mode != "4p-red-single" and mode != "4p-red-east":
            raise ValueError("v1 bridge supports only a four-player mode")
        rule_name = request.get("rule", "tenhou")
        if rule_name != "tenhou":
            raise ValueError("v1 bridge supports only the tenhou rule")
        seed = request.get("seed")
        if seed is not None and not isinstance(seed, int):
            raise ValueError("seed must be an integer")
        game_id = request.get("gameId")
        if not isinstance(game_id, str) or not game_id:
            raise ValueError("gameId is required")
        self.env = RiichiEnv(game_mode=mode, rule=GameRule.default_tenhou(), seed=seed)
        raw_observations = self.env.reset(seed=seed)
        self.game_id = game_id
        self.turn_index = 0
        self.observations = {int(player): observation for player, observation in raw_observations.items()}
        # Include the initial start_game/start_kyoku/tsumo observation in the
        # first response's event delta.
        self.last_log_length = 0
        self.history = {}
        return self.response_with_observations(raw_observations)

    def response_with_observations(self, raw_observations: Any) -> dict[str, Any]:
        env = self.require_env()
        game_events = list(env.mjai_log)
        observations: list[dict[str, Any]] = []
        for player, observation in sorted(raw_observations.items()):
            player_id = int(player)
            serialized, history = serialize_observation(
                player_id,
                observation,
                self.game_id,
                self.turn_index,
                game_events,
                self.history.get(player_id, []),
            )
            self.history[player_id] = history
            observations.append(serialized)
        current_log = list(env.mjai_log)
        events = current_log[self.last_log_length :]
        self.last_log_length = len(current_log)
        return {
            "ok": True,
            "observations": observations,
            "events": events,
            "done": bool(env.done()),
        }

    def resolve_action(self, player: int, payload: Any) -> Any:
        observation = self.observations.get(player)
        if observation is None:
            raise ValueError(f"player {player} does not have a pending observation")
        legal = observation.legal_actions()
        legal_by_id = {stable_id(action_payload(action)): action for action in legal}
        if isinstance(payload, str):
            if payload not in legal_by_id:
                raise ValueError(f"illegal action id for player {player}")
            return legal_by_id[payload]
        if isinstance(payload, dict) and isinstance(payload.get("id"), str):
            action_id = payload["id"]
            if action_id not in legal_by_id:
                raise ValueError(f"illegal action id for player {player}")
            return legal_by_id[action_id]
        if isinstance(payload, dict) and "mjai" in payload:
            mjai = parse_mjai(payload["mjai"])
        else:
            mjai = parse_mjai(payload)
        selected = observation.select_action_from_mjai(mjai)
        if selected is None:
            raise ValueError(f"MJAI action is not legal for player {player}")
        selected_id = stable_id(action_payload(selected))
        if selected_id not in legal_by_id:
            raise ValueError(f"MJAI action is not in current legal action set for player {player}")
        return legal_by_id[selected_id]

    def step(self, request: dict[str, Any]) -> dict[str, Any]:
        env = self.require_env()
        if env.done():
            raise ValueError("game is already finished")
        values = request.get("actions")
        if not isinstance(values, dict):
            raise ValueError("step.actions must be an object keyed by player id")
        actions: dict[int, Any] = {}
        for raw_player, payload in values.items():
            try:
                player = int(raw_player)
            except ValueError as exc:
                raise ValueError(f"invalid player id: {raw_player}") from exc
            actions[player] = self.resolve_action(player, payload)
        if set(actions) != set(self.observations):
            raise ValueError("step must provide exactly one legal action for every pending player")
        raw_observations = env.step(actions)
        self.turn_index += 1
        self.observations = {int(player): observation for player, observation in raw_observations.items()}
        return self.response_with_observations(raw_observations)

    def finish(self, request: dict[str, Any]) -> dict[str, Any]:
        env = self.require_env()
        return {
            "ok": True,
            "done": bool(env.done()),
            "scores": list(env.scores()),
            "ranks": list(env.ranks()),
            "events": list(env.mjai_log),
            "gameId": self.game_id,
        }


def dispatch(bridge: Bridge, request: dict[str, Any]) -> dict[str, Any]:
    operation = request.get("op")
    if operation == "startGame":
        return bridge.start_game(request)
    if operation == "step":
        return bridge.step(request)
    if operation == "finish":
        return bridge.finish(request)
    raise ValueError(f"unknown operation: {operation}")


def main() -> int:
    bridge = Bridge()
    for line in sys.stdin:
        if not line.strip():
            continue
        request_id: Any = None
        try:
            request = json.loads(line)
            if not isinstance(request, dict):
                raise ValueError("request must be an object")
            request_id = request.get("id")
            response = dispatch(bridge, request)
        except Exception as exc:  # keep the process alive so the caller sees a structured error
            response = {"ok": False, "error": str(exc)}
        if request_id is not None:
            response["id"] = request_id
        sys.stdout.write(canonical_json(response) + "\n")
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
