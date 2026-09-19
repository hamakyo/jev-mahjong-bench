"""Import MJAI JSONL replays into deterministic discard DecisionSamples.

The input boundary deliberately stays MJAI-only.  Tenhou XML and Mahjong Soul
protobuf conversion belongs to an external preprocessing step.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterable, Iterator

from riichienv import GameRule, MjaiReplay, RiichiEnv


SUITS = ("m", "p", "s")
WINDS = ("E", "S", "W", "N")
HONOR_MJAI = {"E": "1z", "S": "2z", "W": "3z", "N": "4z", "P": "5z", "F": "6z", "C": "7z"}
HONOR_MPSZ = {v: k for k, v in HONOR_MJAI.items()}
ACCEPTED_SUFFIXES = (".jsonl", ".mjson", ".jsonl.gz", ".mjson.gz")
RULE_FIELDS = (
    "allows_ron_on_ankan_for_kokushi_musou",
    "is_kokushi_musou_13machi_double",
    "is_suuankou_tanki_double",
    "is_junsei_chuurenpoutou_double",
    "is_daisuushii_double",
    "yakuman_pao_is_liability_only",
    "sanchaho_is_draw",
    "kuikae_forbidden",
    "dealer_first_discard_is_tedashi",
)


class ImportErrorWithContext(RuntimeError):
    pass


def rule_for_platform(platform: str) -> GameRule:
    if platform == "tenhou":
        return GameRule.default_tenhou()
    if platform == "majsoul":
        return GameRule.default_mjsoul()
    raise ImportErrorWithContext(f"unsupported replay platform: {platform}")


def replay_rule_name(platform: str) -> str:
    if platform == "tenhou":
        return "tenhou"
    if platform == "majsoul":
        return "mjsoul"
    raise ImportErrorWithContext(f"unsupported replay platform: {platform}")


def rule_signature(rule: GameRule) -> tuple[bool, ...]:
    """Return the rule properties that affect replay and legal observations."""
    return tuple(bool(getattr(rule, field)) for field in RULE_FIELDS)


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def read_text(path: Path) -> str:
    try:
        if path.name.lower().endswith(".gz"):
            with gzip.open(path, "rt", encoding="utf-8") as handle:
                return handle.read()
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ImportErrorWithContext(f"cannot read input {path.name}: {exc}") from exc


def parse_input_events(path: Path) -> list[dict[str, Any]]:
    text = read_text(path)
    stripped = text.lstrip()
    try:
        lower_name = path.name.lower()
        is_mjson = lower_name.endswith(".mjson") or lower_name.endswith(".mjson.gz")
        if is_mjson and stripped.startswith(("[", "{")):
            try:
                raw = json.loads(text)
            except json.JSONDecodeError:
                raw = None
            if isinstance(raw, list):
                values = raw
            elif isinstance(raw, dict) and isinstance(raw.get("events"), list):
                values = raw["events"]
            elif isinstance(raw, dict):
                values = [raw]
            else:
                values = [json.loads(line) for line in text.splitlines() if line.strip()]
        else:
            values = [json.loads(line) for line in text.splitlines() if line.strip()]
    except (json.JSONDecodeError, ValueError) as exc:
        raise ImportErrorWithContext(f"invalid JSON in {path.name}: {exc}") from exc
    if not values:
        raise ImportErrorWithContext(f"input is empty: {path.name}")
    events: list[dict[str, Any]] = []
    for index, value in enumerate(values, 1):
        if not isinstance(value, dict):
            raise ImportErrorWithContext(f"{path.name}:{index}: event must be an object")
        events.append(value)
    return events


def input_files(path: Path) -> list[Path]:
    if path.is_file():
        lower = path.name.lower()
        if not lower.endswith(ACCEPTED_SUFFIXES):
            raise ImportErrorWithContext("input must be .jsonl, .mjson, or a gzip variant")
        return [path]
    if path.is_dir():
        return sorted(
            (item for item in path.rglob("*") if item.is_file() and item.name.lower().endswith(ACCEPTED_SUFFIXES)),
            key=lambda item: item.relative_to(path).as_posix(),
        )
    raise ImportErrorWithContext(f"input does not exist: {path.name}")


def game_id(events: list[dict[str, Any]], fallback: str | None, path: Path) -> str:
    for event in events:
        if event.get("type") == "start_game" and isinstance(event.get("id"), str) and event["id"]:
            return event["id"]
    if fallback:
        return fallback
    raise ImportErrorWithContext(f"{path.name}: start_game.id is missing; --game-id is required")


def mpsz_from_mjai(tile: str) -> str:
    if tile in HONOR_MJAI:
        return HONOR_MJAI[tile]
    if len(tile) == 2 and tile[0] == "0" and tile[1] in SUITS:
        return tile
    if len(tile) == 2 and tile[1] == "z" and tile[0] in "1234567":
        return tile
    if len(tile) not in (2, 3):
        raise ValueError(f"invalid MJAI tile: {tile}")
    number, suit = tile[0], tile[1]
    if suit not in SUITS or number not in "123456789":
        raise ValueError(f"invalid MJAI tile: {tile}")
    if len(tile) == 3 and (tile[2] != "r" or number != "5"):
        raise ValueError(f"invalid MJAI tile: {tile}")
    return f"0{suit}" if len(tile) == 3 else f"{number}{suit}"


def mpsz_from_riichi_tile(tile: int) -> str:
    if not isinstance(tile, int) or tile < 0 or tile >= 136:
        raise ValueError(f"invalid RiichiEnv tile id: {tile}")
    kind, copy = divmod(tile, 4)
    if kind >= 34:
        raise ValueError(f"invalid RiichiEnv tile id: {tile}")
    if kind >= 27:
        return f"{kind - 26}z"
    suit = SUITS[kind // 9]
    number = kind % 9 + 1
    return f"0{suit}" if number == 5 and copy == 0 else f"{number}{suit}"


def compact_event(event: Any) -> str:
    if isinstance(event, str):
        parsed = json.loads(event)
    else:
        parsed = event
    if not isinstance(parsed, dict) or not isinstance(parsed.get("type"), str):
        raise ValueError("event must be an MJAI object with a type")
    return canonical_json(parsed)


def observation_events(observation: Any) -> list[str]:
    events = getattr(observation, "events", [])
    return [compact_event(event) for event in events]


def dora_indicators_from_events(events: Iterable[str]) -> list[str]:
    indicators: list[str] = []
    for event_text in events:
        event = json.loads(event_text)
        if event.get("type") in {"start_kyoku", "dora"} and isinstance(event.get("dora_marker"), str):
            indicators.append(mpsz_from_mjai(event["dora_marker"]))
    return indicators


def visible_event(event: Any, seat: int) -> dict[str, Any]:
    """Apply MJAI visibility rules for one observing seat."""
    parsed = json.loads(event) if isinstance(event, str) else event
    value = json.loads(canonical_json(parsed))
    event_type = value.get("type")
    if event_type == "start_game":
        # A raw game id is metadata, not an observable game event, and must not
        # escape the importer boundary.
        value.pop("id", None)
    elif event_type == "start_kyoku":
        tehais = value.get("tehais")
        if isinstance(tehais, list):
            value["tehais"] = [
                hand if index == seat else ["?"] * len(hand) if isinstance(hand, list) else []
                for index, hand in enumerate(tehais)
            ]
    elif event_type == "tsumo" and value.get("actor") != seat:
        value["pai"] = "?"
    return value


def visible_history(
    events: list[dict[str, Any]],
    global_indices: Iterable[int],
    seat: int,
) -> list[str]:
    return [canonical_json(visible_event(events[index], seat)) for index in global_indices]


def action_matches_event(action: dict[str, Any], event: dict[str, Any], seat: int) -> bool:
    action_type = action.get("type")
    event_type = event.get("type")
    if action_type == "dahai":
        return (
            event_type == "dahai"
            and event.get("actor") == seat
            and isinstance(action.get("pai"), str)
            and isinstance(event.get("pai"), str)
            and mpsz_from_mjai(action["pai"]) == mpsz_from_mjai(event["pai"])
        )
    if action_type == "reach":
        return event_type == "reach" and event.get("actor") == seat
    if action_type in {"chi", "pon", "daiminkan", "ankan", "kakan", "hora", "ryukyoku"}:
        if event_type != action_type:
            return False
        return event.get("actor", event.get("player", seat)) == seat
    return False


def raw_hand_segments(events: list[dict[str, Any]]) -> list[tuple[list[int], list[int]]]:
    starts = [index for index, event in enumerate(events) if event.get("type") == "start_kyoku"]
    if not starts:
        raise ImportErrorWithContext("MJAI replay contains no start_kyoku event")
    game_prefix = [index for index, event in enumerate(events[: starts[0]]) if event.get("type") == "start_game"]
    segments: list[tuple[list[int], list[int]]] = []
    for offset, start in enumerate(starts):
        end = starts[offset + 1] if offset + 1 < len(starts) else len(events)
        segments.append((game_prefix, list(range(start, end))))
    return segments


def attr_or_call(value: Any) -> Any:
    return value() if callable(value) else value


def seat_name(player: int, oya: int) -> str:
    """Return the observing player's relative wind, not its fixed player id."""
    if 0 <= player < 4 and 0 <= oya < 4:
        return WINDS[(player - oya) % 4]
    return str(player)


def remove_one_tile(tiles: Iterable[int], tile: int | None) -> list[int]:
    result = list(tiles)
    if tile is not None:
        try:
            result.remove(tile)
        except ValueError as exc:
            raise ImportErrorWithContext(f"drawn tile {tile} is absent from observation.hand") from exc
    return result


def meld_tiles_mpsz(melds: Iterable[Any]) -> list[str]:
    result: list[str] = []
    for meld in melds:
        tiles = [mpsz_from_riichi_tile(int(tile)) for tile in list(attr_or_call(getattr(meld, "tiles")))]
        # Physical tile ids can be assigned differently when an opponent's
        # concealed copy is masked.  Tile order inside one public meld has no
        # meaning, so canonicalize that order at the boundary.
        result.extend(sorted(tiles))
    return result


def observation_state(observation: Any, seat: int, events: list[str]) -> dict[str, Any]:
    raw = observation.to_dict()
    hands = attr_or_call(getattr(observation, "hands"))
    raw_hand = list(attr_or_call(getattr(observation, "hand")))
    drawn = attr_or_call(getattr(observation, "drawn_tile"))
    current_hand = remove_one_tile(raw_hand, int(drawn) if drawn is not None else None)
    dora = list(attr_or_call(getattr(observation, "dora_indicators")))
    discards = attr_or_call(getattr(observation, "discards"))
    melds = attr_or_call(getattr(observation, "melds"))
    riichi = list(attr_or_call(getattr(observation, "riichi_declared")))
    scores = list(attr_or_call(getattr(observation, "scores")))
    round_wind = int(attr_or_call(getattr(observation, "round_wind")))
    kyoku_index = int(attr_or_call(getattr(observation, "kyoku_index")))
    oya = int(attr_or_call(getattr(observation, "oya")))

    observable_dora = dora_indicators_from_events(events)
    state: dict[str, Any] = {
        "round": f"{WINDS[round_wind]}{kyoku_index + 1}",
        "seat": seat_name(seat, oya),
        "honba": int(attr_or_call(getattr(observation, "honba"))),
        "scores": scores,
        "hand": [mpsz_from_riichi_tile(int(tile)) for tile in current_hand],
        "tileEncoding": "mpsz",
        "mjaiEvents": events,
        # RiichiEnv 0.4.10 can expose a later kan dora in a replay
        # observation before that MJAI event is observable.  The event prefix
        # is authoritative at this boundary so samples never contain lookahead.
        "doraIndicators": observable_dora or [mpsz_from_riichi_tile(int(tile)) for tile in dora],
        "discards": {
            seat_name(index, oya): [mpsz_from_riichi_tile(int(tile)) for tile in tiles]
            for index, tiles in enumerate(discards)
        },
        "melds": {
            seat_name(index, oya): meld_tiles_mpsz(melds[index] if index < len(melds) else [])
            for index in range(4)
        },
        "riichi": {seat_name(index, oya): bool(value) for index, value in enumerate(riichi)},
        "extra": {
            "roundWind": round_wind,
            "kyokuIndex": kyoku_index,
            "oya": oya,
            "riichiSticks": int(attr_or_call(getattr(observation, "riichi_sticks"))),
            "visibleHands": [
                [mpsz_from_riichi_tile(int(tile)) for tile in remove_one_tile(
                    hand,
                    int(drawn) if index == seat and drawn is not None else None,
                )]
                for index, hand in enumerate(hands)
                if hand
            ],
        },
    }
    if drawn is not None:
        state["drawnTile"] = mpsz_from_riichi_tile(int(drawn))
    # Keep the raw observation only in local scope; hidden hands must never be
    # copied into the public sample.
    del raw
    return state


def action_dict(action: Any) -> dict[str, Any]:
    raw = action.to_mjai()
    value = json.loads(raw) if isinstance(raw, str) else raw
    if not isinstance(value, dict):
        raise ValueError("RiichiEnv action did not serialize to an object")
    return value


def legal_discards(observation: Any) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for action in observation.legal_actions():
        value = action_dict(action)
        if value.get("type") != "dahai" or not isinstance(value.get("pai"), str):
            continue
        tile = mpsz_from_mjai(value["pai"])
        if tile not in seen:
            seen.add(tile)
            result.append(tile)
    if not result:
        raise ImportErrorWithContext("a discard step has no legal discard action")
    return result


def legal_discards_before_event(
    events: list[dict[str, Any]],
    event_index: int,
    seat: int,
    rule: GameRule,
) -> list[str]:
    """Replay the complete source prefix so rule-only restrictions survive.

    MjaiReplay exposes the source decision observation, but its step helper can
    omit a post-call kuikae restriction from that convenience action list.
    Replaying the raw prefix through RiichiEnv makes the dataset's legal set
    agree with the same rule-aware replay used by the validator.
    """
    env = RiichiEnv(game_mode="4p-red-half", rule=rule, seed=0)
    for event in events[:event_index]:
        env.apply_event(event)
    return legal_discards(env.get_observation(seat))


def make_sample(
    *,
    platform: str,
    game_hash: str,
    hand_index: int,
    event_index: int,
    seat: int,
    observation: Any,
    action: Any,
    history: list[str],
    legal: list[str],
) -> dict[str, Any] | None:
    value = action_dict(action)
    if value.get("type") != "dahai" or not isinstance(value.get("pai"), str):
        return None
    try:
        observed = mpsz_from_mjai(value["pai"])
        if observed not in legal:
            raise ImportErrorWithContext(
                f"replay inconsistency at hand={hand_index} event={event_index} seat={seat}: "
                f"observed action {observed} is not legal"
            )
        state = observation_state(observation, seat, history)
    except (ValueError, TypeError, AttributeError) as exc:
        raise ImportErrorWithContext(
            f"cannot convert hand={hand_index} event={event_index} seat={seat}: {exc}"
        ) from exc
    identity = f"{platform}/{game_hash}/{hand_index}/{event_index}/{seat}"
    return {
        "id": sha256_text(identity),
        "state": state,
        "legalActions": legal,
        "observedAction": observed,
        "provenance": {
            "platform": platform,
            "gameIdHash": game_hash,
            "handIndex": hand_index,
            "eventIndex": event_index,
            "seat": seat,
        },
    }


def replay_file(path: Path, platform: str, fallback_game_id: str | None) -> list[dict[str, Any]]:
    events = parse_input_events(path)
    raw_game_id = game_id(events, fallback_game_id, path)
    game_hash = sha256_text(platform + raw_game_id)
    # MjaiReplay.from_jsonl is intentionally used at the boundary.  A temp file
    # keeps gzip and .mjson handling out of the dependency and is removed before
    # returning.
    with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", encoding="utf-8", delete=False) as handle:
        temp_path = Path(handle.name)
        for event in events:
            handle.write(canonical_json(event))
            handle.write("\n")
    try:
        replay_rule = rule_for_platform(platform)
        replay = MjaiReplay.from_jsonl(str(temp_path), rule=replay_rule_name(platform))
        samples: list[dict[str, Any]] = []
        segments = raw_hand_segments(events)
        for hand_index, kyoku in enumerate(replay.take_kyokus()):
            # Do not let a platform-specific replay silently fall back to the
            # library default.  The Kyoku carries the rule selected by
            # MjaiReplay, so a regression in the rule argument fails at the
            # import boundary instead of producing a plausible wrong dataset.
            if rule_signature(kyoku.rule) != rule_signature(replay_rule):
                raise ImportErrorWithContext(
                    f"{path.name}: replay rule does not match platform {platform}"
                )
            if hand_index >= len(segments):
                raise ImportErrorWithContext(f"{path.name}: replay returned more kyokus than source MJAI")
            prefix_indices, segment_indices = segments[hand_index]
            cursor = 0
            for step_index, step in enumerate(kyoku.steps(skip_single_action=False)):
                if not isinstance(step, tuple) or len(step) != 3:
                    raise ImportErrorWithContext(f"unexpected RiichiEnv step shape in {path.name}")
                seat, observation, action = step
                action_value = action_dict(action)
                source_event_index: int | None = None
                for position in range(cursor, len(segment_indices)):
                    candidate_index = segment_indices[position]
                    if action_matches_event(action_value, events[candidate_index], int(seat)):
                        source_event_index = candidate_index
                        cursor = position + 1
                        break
                sample = make_sample(
                    platform=platform,
                    game_hash=game_hash,
                    hand_index=hand_index,
                    event_index=source_event_index if source_event_index is not None else step_index,
                    seat=int(seat),
                    observation=observation,
                    action=action,
                    history=visible_history(
                        events,
                        [*prefix_indices, *[index for index in segment_indices if source_event_index is None or index < source_event_index]],
                        int(seat),
                    ),
                    legal=(
                        legal_discards_before_event(events, source_event_index, int(seat), replay_rule)
                        if action_value.get("type") == "dahai" and source_event_index is not None
                        else []
                    ),
                )
                if sample is not None:
                    if source_event_index is None:
                        raise ImportErrorWithContext(
                            f"{path.name}: could not align discard step with source MJAI event "
                            f"at hand={hand_index} step={step_index}"
                        )
                    samples.append(sample)
        return samples
    except ImportErrorWithContext:
        raise
    except Exception as exc:
        raise ImportErrorWithContext(f"RiichiEnv could not replay {path.name}: {exc}") from exc
    finally:
        try:
            temp_path.unlink()
        except OSError:
            pass


def import_dataset(input_path: str, platform: str, output_path: str, fallback_game_id: str | None = None) -> dict[str, int]:
    if platform not in {"tenhou", "majsoul"}:
        raise ImportErrorWithContext("platform must be tenhou or majsoul")
    files = input_files(Path(input_path))
    if not files:
        raise ImportErrorWithContext("input directory contains no accepted replay files")
    by_id: dict[str, dict[str, Any]] = {}
    duplicates = 0
    for path in files:
        for sample in replay_file(path, platform, fallback_game_id):
            sample_id = sample["id"]
            previous = by_id.get(sample_id)
            if previous is None:
                by_id[sample_id] = sample
            elif canonical_json(previous) == canonical_json(sample):
                duplicates += 1
            else:
                raise ImportErrorWithContext(f"sample id collision with different content: {sample_id}")
    ordered = sorted(
        by_id.values(),
        key=lambda item: (
            item["provenance"]["platform"],
            item["provenance"]["gameIdHash"],
            item["provenance"]["handIndex"],
            item["provenance"]["eventIndex"],
            item["provenance"]["seat"],
        ),
    )
    destination = Path(output_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("w", encoding="utf-8", newline="\n") as handle:
        for sample in ordered:
            handle.write(canonical_json(sample))
            handle.write("\n")
    return {"samples": len(ordered), "duplicates": duplicates, "files": len(files)}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Import MJAI replay JSONL into DecisionSamples")
    parser.add_argument("--input", required=True)
    parser.add_argument("--platform", required=True, choices=("tenhou", "majsoul"))
    parser.add_argument("--out", required=True)
    parser.add_argument("--game-id")
    return parser


def main(argv: list[str] | None = None) -> int:
    try:
        args = build_parser().parse_args(argv)
        summary = import_dataset(args.input, args.platform, args.out, args.game_id)
        print(json.dumps(summary, ensure_ascii=False, sort_keys=True))
        return 0
    except ImportErrorWithContext as exc:
        print(str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
