import copy
import json
from functools import lru_cache
from pathlib import Path

EVENTS_PATH = Path(__file__).with_name("events.json")


@lru_cache(maxsize=1)
def _raw_events():
    with EVENTS_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)["events"]


def list_events():
    return copy.deepcopy(_raw_events())


def event_ids():
    return [event["id"] for event in _raw_events()]


def get_event(event_id):
    for event in _raw_events():
        if event["id"] == event_id:
            return copy.deepcopy(event)
    raise ValueError(
        f"Неизвестное событие «{event_id}». Доступные события: " + ", ".join(event_ids())
    )


def resolve_event(event_id):
    if event_id is None:
        return None
    return get_event(event_id)


def event_penalty(event):
    if event is None:
        return 0
    return event["budget_penalty"]
