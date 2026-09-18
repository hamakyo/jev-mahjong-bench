"""Replay-check the observable portion of imported DecisionSamples."""

from __future__ import annotations

import argparse
import gzip
import json
import sys
from pathlib import Path
from typing import Any

from riichienv import RiichiEnv

from .importer import (
    ImportErrorWithContext,
    dora_indicators_from_events,
    legal_discards,
    mpsz_from_riichi_tile,
    meld_tiles_mpsz,
    remove_one_tile,
    rule_for_platform,
    seat_name,
)


def read_samples(path: Path) -> list[dict[str, Any]]:
    samples: list[dict[str, Any]] = []
    if path.name.lower().endswith(".gz"):
        with gzip.open(path, "rt", encoding="utf-8") as stream:
            lines = stream.read().splitlines()
    else:
        lines = path.read_text(encoding="utf-8").splitlines()
    for line_number, line in enumerate(lines, 1):
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ImportErrorWithContext(f"line {line_number}: invalid JSON: {exc}") from exc
        if not isinstance(value, dict):
            raise ImportErrorWithContext(f"line {line_number}: sample must be an object")
        samples.append(value)
    return samples


def expected_state(observation: Any) -> dict[str, Any]:
    seat = int(observation.player_id)
    winds = ("E", "S", "W", "N")
    oya = int(observation.oya)
    hands = observation.hands
    melds = observation.melds
    drawn = int(observation.drawn_tile) if observation.drawn_tile is not None else None
    return {
        "round": f"{winds[int(observation.round_wind)]}{int(observation.kyoku_index) + 1}",
        "seat": seat_name(seat, oya),
        "honba": int(observation.honba),
        "scores": list(observation.scores),
        "hand": [mpsz_from_riichi_tile(int(tile)) for tile in remove_one_tile(observation.hand, drawn)],
        "drawnTile": mpsz_from_riichi_tile(drawn) if drawn is not None else None,
        "doraIndicators": [mpsz_from_riichi_tile(int(tile)) for tile in observation.dora_indicators],
        "discards": {
            seat_name(index, oya): [mpsz_from_riichi_tile(int(tile)) for tile in tiles]
            for index, tiles in enumerate(observation.discards)
        },
        "melds": {
            seat_name(index, oya): meld_tiles_mpsz(melds[index] if index < len(melds) else [])
            for index in range(4)
        },
        "riichi": {seat_name(index, oya): bool(value) for index, value in enumerate(observation.riichi_declared)},
        "visible_hand": [
            mpsz_from_riichi_tile(int(tile))
            for tile in remove_one_tile(hands[seat], drawn)
        ],
    }


def validate_sample(sample: dict[str, Any]) -> None:
    state = sample.get("state")
    if not isinstance(state, dict) or not state.get("mjaiEvents"):
        return
    provenance = sample.get("provenance")
    if not isinstance(provenance, dict) or not isinstance(provenance.get("seat"), int):
        raise ImportErrorWithContext(f"sample {sample.get('id', '?')}: replay events require provenance.seat")
    seat = int(provenance["seat"])
    if seat not in range(4):
        raise ImportErrorWithContext(f"sample {sample.get('id', '?')}: invalid replay seat")
    platform = provenance.get("platform")
    if platform not in {"tenhou", "majsoul"}:
        raise ImportErrorWithContext(f"sample {sample.get('id', '?')}: invalid replay platform")
    events: list[dict[str, Any]] = []
    for index, raw in enumerate(state["mjaiEvents"]):
        value = json.loads(raw) if isinstance(raw, str) else raw
        if not isinstance(value, dict):
            raise ImportErrorWithContext(f"sample {sample.get('id', '?')}: event {index} is not an object")
        events.append(value)
    if not any(event.get("type") == "start_kyoku" for event in events):
        raise ImportErrorWithContext(f"sample {sample.get('id', '?')}: replay history has no start_kyoku")
    env = RiichiEnv(game_mode="4p-red-half", rule=rule_for_platform(platform), seed=0)
    try:
        for event in events:
            env.apply_event(event)
        observation = env.get_observation(seat)
    except Exception as exc:
        raise ImportErrorWithContext(f"sample {sample.get('id', '?')}: RiichiEnv replay failed: {exc}") from exc
    actual = expected_state(observation)
    if actual["round"] != state.get("round") or actual["seat"] != state.get("seat"):
        raise ImportErrorWithContext(f"sample {sample.get('id', '?')}: round or seat does not match replay")
    for field in ("honba", "scores", "hand", "drawnTile", "discards", "melds", "riichi"):
        if state.get(field) != actual[field]:
            raise ImportErrorWithContext(f"sample {sample.get('id', '?')}: state.{field} does not match replay")
    expected_dora = dora_indicators_from_events([json.dumps(event) for event in events])
    sample_dora = state.get("doraIndicators")
    if sample_dora != expected_dora:
        raise ImportErrorWithContext(f"sample {sample.get('id', '?')}: state.doraIndicators does not match MJAI history")
    replay_legal = legal_discards(observation)
    sample_legal = sample.get("legalActions")
    if (
        not isinstance(sample_legal, list)
        or any(not isinstance(action, str) for action in sample_legal)
        or len(sample_legal) != len(set(sample_legal))
        or set(sample_legal) != set(replay_legal)
    ):
        raise ImportErrorWithContext(
            f"sample {sample.get('id', '?')}: legalActions does not exactly match RiichiEnv replay legalActions"
        )
    observed = sample.get("observedAction")
    if observed is not None and observed not in replay_legal:
        raise ImportErrorWithContext(f"sample {sample.get('id', '?')}: observedAction is not legal in replay")


def validate(path: str) -> dict[str, int]:
    samples = read_samples(Path(path))
    replay_count = 0
    for sample in samples:
        if isinstance(sample.get("state"), dict) and sample["state"].get("mjaiEvents"):
            replay_count += 1
        validate_sample(sample)
    return {
        "samples": len(samples),
        "replaySamples": replay_count,
        "exactReplayLegalSamples": replay_count,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", required=True)
    try:
        result = validate(parser.parse_args(argv).dataset)
        print(json.dumps(result, ensure_ascii=False, sort_keys=True))
        return 0
    except ImportErrorWithContext as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
