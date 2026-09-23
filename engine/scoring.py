from engine.events import event_penalty, resolve_event
from engine.rules import district_names, load_data, measures_index


def indicator_ids(data):
    return [indicator["id"] for indicator in data["indicators"]]


def indicator_weights(data):
    return {indicator["id"]: indicator["weight"] for indicator in data["indicators"]}


def _base_values(data):
    return {
        district["name"]: {key: float(value) for key, value in district["indicators"].items()}
        for district in data["districts"]
    }


def _synergy_district(measures, decisions, measure_id):
    for item in decisions:
        if item.get("measure_id") == measure_id:
            if measures[measure_id]["type"] == "C":
                return None
            return item.get("district")
    return None


def _apply(data, decisions, event=None):
    measures = measures_index(data)
    names = district_names(data)
    horizon = data["horizon"]
    values = _base_values(data)

    if event is not None:
        targets = names if event["district"] is None else [event["district"]]
        for target in targets:
            if target not in values:
                continue
            for indicator, shift in event["effects"].items():
                values[target][indicator] += shift

    for item in decisions:
        measure = measures.get(item.get("measure_id"))
        if measure is None:
            continue
        factor = (horizon - measure["lag"]) / horizon
        targets = names if measure["type"] == "C" else [item.get("district")]
        for target in targets:
            if target not in values:
                continue
            for indicator, effect in measure["effects"].items():
                values[target][indicator] += effect * factor

    chosen = {item.get("measure_id") for item in decisions}
    active = []
    for synergy in data["synergies"]:
        first, second = synergy["pair"]
        if first not in chosen or second not in chosen:
            continue
        if first not in measures or second not in measures:
            continue
        district = _synergy_district(measures, decisions, first)
        targets = names if district is None else [district]
        for target in targets:
            if target not in values:
                continue
            values[target][synergy["indicator"]] += synergy["bonus"]
            active.append(
                {
                    "pair": [first, second],
                    "district": target,
                    "indicator": synergy["indicator"],
                    "bonus": synergy["bonus"],
                }
            )

    for district in values:
        for indicator in values[district]:
            values[district][indicator] = min(100.0, max(0.0, values[district][indicator]))

    return values, active


def _evaluate(data, values):
    weights = indicator_weights(data)
    keys = indicator_ids(data)
    district_scores = {
        name: sum(weights[key] * values[name][key] for key in keys) for name in values
    }
    d_avg = sum(
        district["population"] * district_scores[district["name"]]
        for district in data["districts"]
    )
    critical = [
        {"district": district["name"], "indicator": key, "value": values[district["name"]][key]}
        for district in data["districts"]
        for key in keys
        if values[district["name"]][key] < 40
    ]
    score = 0.7 * d_avg + 0.3 * min(district_scores.values()) - 1.0 * len(critical)
    return score, d_avg, district_scores, critical


def _score_only(data, decisions, event=None):
    values, _ = _apply(data, decisions, event)
    return _evaluate(data, values)[0]


def simulate(decisions, event_id=None):
    data = load_data()
    decisions = list(decisions or [])
    measures = measures_index(data)
    event = resolve_event(event_id)
    budget = data["budget"] - event_penalty(event)

    base_values, _ = _apply(data, [], event)
    base_score, _, base_district_scores, _ = _evaluate(data, base_values)

    values, synergies = _apply(data, decisions, event)
    score, d_avg, district_scores, critical = _evaluate(data, values)

    total_cost = sum(
        measures[item["measure_id"]]["cost"]
        for item in decisions
        if item.get("measure_id") in measures
    )

    contributions = []
    for index, item in enumerate(decisions):
        measure = measures.get(item.get("measure_id"))
        if measure is None:
            continue
        rest = decisions[:index] + decisions[index + 1:]
        contributions.append(
            {
                "measure_id": measure["id"],
                "district": item.get("district"),
                "cost": measure["cost"],
                "delta_score": score - _score_only(data, rest, event),
            }
        )

    worst = min(district_scores, key=lambda name: district_scores[name])

    return {
        "total_cost": total_cost,
        "budget": budget,
        "budget_left": budget - total_cost,
        "base_score": base_score,
        "score": score,
        "delta": score - base_score,
        "d_avg": d_avg,
        "min_district": {"name": worst, "score": district_scores[worst]},
        "n_crit": len(critical),
        "critical": critical,
        "event": event,
        "districts": [
            {
                "name": district["name"],
                "population": district["population"],
                "before": dict(base_values[district["name"]]),
                "after": dict(values[district["name"]]),
                "score_before": base_district_scores[district["name"]],
                "score_after": district_scores[district["name"]],
            }
            for district in data["districts"]
        ],
        "contributions": contributions,
        "synergies": synergies,
    }
