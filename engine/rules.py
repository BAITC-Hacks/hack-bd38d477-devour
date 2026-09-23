import copy
import json
from functools import lru_cache
from pathlib import Path

from engine.events import event_penalty, resolve_event

DATA_PATH = Path(__file__).with_name("data.json")


@lru_cache(maxsize=1)
def _raw_data():
    with DATA_PATH.open(encoding="utf-8") as handle:
        return json.load(handle)


def load_data():
    return copy.deepcopy(_raw_data())


def measures_index(data):
    return {measure["id"]: measure for measure in data["measures"]}


def district_names(data):
    return [district["name"] for district in data["districts"]]


def direction_names(data):
    return {item["id"]: item["name"] for item in data["directions"]}


def validate(decisions, event_id=None):
    data = load_data()
    event = resolve_event(event_id)
    penalty = event_penalty(event)
    budget = data["budget"] - penalty
    required = data["measures_required"]
    limit = data["max_per_direction"]
    measures = measures_index(data)
    districts = district_names(data)
    directions = direction_names(data)

    if not isinstance(decisions, list):
        return {
            "valid": False,
            "errors": ["Решения должны быть списком объектов"],
            "total_cost": 0,
            "budget": budget,
            "budget_left": budget,
        }

    errors = []
    parsed = []
    total_cost = 0

    for position, item in enumerate(decisions, start=1):
        if not isinstance(item, dict):
            errors.append(
                f"Решение №{position}: ожидается объект с полями measure_id и district"
            )
            continue
        measure_id = item.get("measure_id")
        district = item.get("district")
        if measure_id not in measures:
            errors.append(f"Решение №{position}: неизвестное мероприятие «{measure_id}»")
            continue
        parsed.append((measure_id, district))
        total_cost += measures[measure_id]["cost"]

    if total_cost > budget:
        if event is None:
            errors.append(
                f"Стоимость набора {total_cost} превышает бюджет {budget} на {total_cost - budget}"
            )
        else:
            errors.append(
                f"Стоимость набора {total_cost} превышает бюджет {budget} на {total_cost - budget}: "
                f"из-за события «{event['name']}» на ликвидацию ушло {penalty} из {data['budget']}"
            )

    if len(decisions) != required:
        errors.append(
            f"Нужно выбрать ровно {required} мер, сейчас выбрано {len(decisions)}"
        )

    seen = []
    for measure_id, _ in parsed:
        if measure_id in seen:
            errors.append(f"Мероприятие «{measure_id}» выбрано несколько раз")
        else:
            seen.append(measure_id)

    for measure_id, district in parsed:
        measure = measures[measure_id]
        if measure["type"] == "R":
            if district is None:
                errors.append(
                    f"Для районного мероприятия «{measure_id}» нужно указать район"
                )
            elif district not in districts:
                errors.append(
                    f"Мероприятие «{measure_id}»: неизвестный район «{district}»"
                )
        elif district is not None:
            errors.append(
                f"Городское мероприятие «{measure_id}» действует на весь город, район должен быть null"
            )

    per_direction = {}
    for measure_id, _ in parsed:
        direction = measures[measure_id]["direction"]
        per_direction.setdefault(direction, []).append(measure_id)
    for direction, chosen in per_direction.items():
        if len(chosen) > limit:
            name = directions.get(direction, direction)
            errors.append(
                f"Не более {limit} мер из направления «{name}», выбрано {len(chosen)}: "
                + ", ".join(chosen)
            )

    for rule in data["incompatibilities"]:
        first, second = rule["pair"]
        first_districts = [d for m, d in parsed if m == first]
        second_districts = [d for m, d in parsed if m == second]
        if not first_districts or not second_districts:
            continue
        if rule["scope"] == "any":
            errors.append(f"Мероприятия «{first}» и «{second}» несовместимы")
        else:
            clash = sorted({d for d in first_districts if d in second_districts and d is not None})
            for district in clash:
                errors.append(
                    f"Мероприятия «{first}» и «{second}» нельзя выбрать в одном районе «{district}»"
                )

    return {
        "valid": not errors,
        "errors": errors,
        "total_cost": total_cost,
        "budget": budget,
        "budget_left": budget - total_cost,
    }
