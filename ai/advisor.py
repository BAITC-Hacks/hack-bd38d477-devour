from engine import load_data, validate, simulate


def _measures(data):
    items = data.get("measures", [])
    if isinstance(items, dict):
        return [dict(value, id=key) if isinstance(value, dict) else {"id": key} for key, value in items.items()]
    return items if isinstance(items, list) else []


def _decision(measure, district):
    measure_id = measure.get("id", measure.get("measure_id"))
    kind = measure.get("type", measure.get("scope", "R"))
    if isinstance(kind, str):
        city = kind.upper() in ("C", "CITY", "ГОРОД")
    else:
        city = False
    return {"measure_id": measure_id, "district": None if city else district}


def _format_number(value):
    return f"{value:.2f}".replace(".", ",")


def recommendations(decisions, current_simulation, event_id=None):
    current_score = current_simulation.get("score")
    if not isinstance(current_score, (int, float)):
        return []
    data = load_data()
    measures = _measures(data)
    measure_names = {measure.get("id", measure.get("measure_id")): measure.get("name", measure.get("id", measure.get("measure_id"))) for measure in measures}
    districts = data.get("districts", [])
    district_names = [item.get("name") for item in districts if isinstance(item, dict) and item.get("name")]
    if not district_names:
        district_names = ["Есиль", "Алматы", "Сарыарка", "Байконур", "Нура"]
    existing = {item.get("measure_id") for item in decisions}
    ranked = []
    seen = set()
    for index, old in enumerate(decisions):
        for measure in measures:
            measure_id = measure.get("id", measure.get("measure_id"))
            if not measure_id or measure_id in existing:
                continue
            districts_to_try = [None] if str(measure.get("type", measure.get("scope", "R"))).upper() in ("C", "CITY", "ГОРОД") else district_names
            for district in districts_to_try:
                replacement = _decision(measure, district)
                candidate = list(decisions)
                candidate[index] = replacement
                key = tuple(sorted((item.get("measure_id"), item.get("district")) for item in candidate))
                if key in seen:
                    continue
                seen.add(key)
                validation = validate(candidate, event_id=event_id)
                if not validation.get("valid"):
                    continue
                result = simulate(candidate, event_id=event_id)
                score = result.get("score")
                if not isinstance(score, (int, float)):
                    continue
                visible_score = round(score, 2)
                visible_current = round(current_score, 2)
                gain = round(visible_score - visible_current, 2)
                if gain <= 0:
                    continue
                ranked.append((gain, old, replacement, visible_score))
    ranked.sort(key=lambda item: item[0], reverse=True)
    output = []
    for gain, old, new, score in ranked[:3]:
        old_id = old.get("measure_id")
        new_id = new["measure_id"]
        old_name = measure_names.get(old_id, old_id)
        new_name = measure_names.get(new_id, new_id)
        destination = new.get("district") or "город"
        text = f"Заменить {old_id} ({old_name}) на {new_id} ({new_name}, {destination}): +{_format_number(gain)}"
        output.append({"text": text, "replace": {"from": old, "to": new}, "score": score, "delta_score": gain})
    return output
