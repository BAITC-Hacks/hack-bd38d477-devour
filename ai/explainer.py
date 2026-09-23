import json
import os

from openai import OpenAI
from engine import load_data

ANALYSIS_KEYS = ("summary", "strengths", "risks", "consequences", "tradeoffs", "recommendations")
SYSTEM_PROMPT = "Ты аналитик городского управления и готовишь вывод для акима. Пиши ясно и по делу, объясняй компромиссы простым русским языком. Используй только числа из входных данных, ничего не придумывай. Для показателей используй русские названия из словаря indicator_names, не коды. В тексте используй десятичную запятую. Не упоминай данные, вход, источник или то, что что-то где-то указано. Верни только JSON-объект со строковыми полями summary и массивами строк strengths, risks, consequences, tradeoffs, recommendations."
EVENT_PROMPT = " Входные данные содержат городское событие: объясни, как оно повлияло на бюджет и показатели, и оцени, насколько сценарий устойчив к нему. Числа используй только из входных данных."


def _indicator_names():
    return {item["id"]: item["name"] for item in load_data().get("indicators", [])}


def _format_number(value, signed=False):
    formatted = f"{value:+.2f}" if signed else f"{value:.2f}"
    return formatted.replace(".", ",")


def _format_amount(value):
    if isinstance(value, (int, float)) and float(value).is_integer():
        return str(int(value))
    return _format_number(value)


def _valid_analysis(value):
    return isinstance(value, dict) and set(value) == set(ANALYSIS_KEYS) and isinstance(value.get("summary"), str) and all(isinstance(value.get(key), list) and all(isinstance(item, str) for item in value[key]) for key in ANALYSIS_KEYS[1:])


def fallback_analysis(simulation):
    data = load_data()
    indicators = {item["id"]: item["name"] for item in data.get("indicators", [])}
    measures = {item["id"]: item for item in data.get("measures", [])}
    districts = {item["name"]: item for item in simulation.get("districts", [])}
    score = simulation.get("score", 0)
    base_score = simulation.get("base_score", 0)
    minimum = simulation.get("min_district", {}) or {}
    weakest_name = minimum.get("name", "не определён")
    weakest_score = minimum.get("score")
    total_cost = simulation.get("total_cost", 0)
    budget_left = simulation.get("budget_left", 0)
    score_direction = "вырос" if score > base_score else "снизился" if score < base_score else "не изменился"
    summary = f"Score {score_direction} с {_format_number(base_score)} до {_format_number(score)}. На меры направлено {_format_amount(total_cost)}, остаток бюджета — {_format_amount(budget_left)}. Самая низкая районная оценка у района «{weakest_name}»"
    if isinstance(weakest_score, (int, float)):
        summary += f" — {_format_number(weakest_score)}"
    summary += "."

    contributions = simulation.get("contributions", []) or []
    strengths = []
    leading = sorted((item for item in contributions if item.get("delta_score", 0) > 0), key=lambda item: item["delta_score"], reverse=True)[:3]
    for item in leading:
        measure_id = item.get("measure_id", "Мера")
        measure_name = measures.get(measure_id, {}).get("name", measure_id)
        strengths.append(f"{measure_id} («{measure_name}») даёт наибольший вклад среди мер: +{_format_number(item['delta_score'])} к Score.")
    for synergy in simulation.get("synergies", []) or []:
        pair = " + ".join(synergy.get("pair", []))
        indicator_name = indicators.get(synergy.get("indicator"), synergy.get("indicator", "показатель"))
        strengths.append(f"Сработала синергия {pair}: «{indicator_name}» дополнительно вырос на {_format_number(synergy.get('bonus', 0))} в районе «{synergy.get('district', 'город')}».")
    if not strengths:
        strengths.append("Положительный вклад мер и сработавшие синергии не зафиксированы.")

    risks = []
    for item in simulation.get("critical", []) or []:
        indicator_name = indicators.get(item.get("indicator"), item.get("indicator", "показатель"))
        risks.append(f"В районе «{item.get('district', 'не определён')}» критическое значение показателя «{indicator_name}» — {_format_number(item.get('value', 0))}, ниже 40.")
    for district_name, district in districts.items():
        before = district.get("before", {}) or {}
        after = district.get("after", {}) or {}
        for indicator_id, before_value in before.items():
            after_value = after.get(indicator_id, before_value)
            change = after_value - before_value
            if change < 0:
                indicator_name = indicators.get(indicator_id, indicator_id)
                risks.append(f"В районе «{district_name}» показатель «{indicator_name}» снизился на {_format_number(abs(change))}.")
    weakest_text = f"Самая низкая районная оценка — у «{weakest_name}»"
    if isinstance(weakest_score, (int, float)):
        weakest_text += f" ({_format_number(weakest_score)})"
    risks.append(weakest_text + ".")

    consequences = []
    for contribution in contributions:
        measure_id = contribution.get("measure_id")
        measure = measures.get(measure_id, {})
        effect_ids = measure.get("effects", {}).keys()
        if measure.get("type") == "C":
            targets = list(districts.items())
        else:
            name = contribution.get("district")
            targets = [(name, districts[name])] if name in districts else []
        changes = []
        for district_name, district in targets:
            before = district.get("before", {}) or {}
            after = district.get("after", {}) or {}
            for indicator_id in effect_ids:
                change = after.get(indicator_id, before.get(indicator_id, 0)) - before.get(indicator_id, 0)
                if change > 0:
                    indicator_name = indicators.get(indicator_id, indicator_id)
                    changes.append(f"«{indicator_name}» +{_format_number(change)} в районе «{district_name}»")
        measure_name = measure.get("name", measure_id or "Мера")
        impact = "; ".join(changes) if changes else "роста целевых показателей в итоговом сценарии нет"
        consequences.append(f"{measure_id} («{measure_name}»): {impact}. Фактическое изменение за двухлетний горизонт уже учитывает лаг и взаимодействие мер.")

    tradeoffs = [f"Неиспользованный бюджет — {_format_amount(budget_left)}."]
    unchanged = []
    for district_name, district in districts.items():
        before_score = district.get("score_before")
        after_score = district.get("score_after")
        if isinstance(before_score, (int, float)) and isinstance(after_score, (int, float)) and after_score <= before_score:
            unchanged.append(district_name)
    if unchanged:
        tradeoffs.append("Итоговая оценка не выросла в районах: " + ", ".join(unchanged) + ".")
    else:
        tradeoffs.append("Итоговая оценка выросла во всех районах.")
    priced = [item for item in contributions if isinstance(item.get("cost"), (int, float)) and isinstance(item.get("delta_score"), (int, float))]
    if priced:
        most_expensive = max(priced, key=lambda item: item["cost"])
        average_gain = sum(item["delta_score"] for item in priced) / len(priced)
        if most_expensive["delta_score"] < average_gain:
            measure_id = most_expensive.get("measure_id", "Мера")
            measure_name = measures.get(measure_id, {}).get("name", measure_id)
            tradeoffs.append(f"Самая дорогая мера — {measure_id} («{measure_name}»), стоимость {_format_amount(most_expensive['cost'])}; её вклад +{_format_number(most_expensive['delta_score'])} ниже среднего вклада мер +{_format_number(average_gain)}.")

    event = simulation.get("event")
    if event:
        effects = event.get("effects", {}) or {}
        target = event.get("district") or "все районы"
        event_impacts = [f"«{indicators.get(indicator_id, indicator_id)}» {_format_number(change, signed=True)}" for indicator_id, change in effects.items()]
        event_description = "; ".join(event_impacts) if event_impacts else "сдвиг показателей не указан"
        consequences.append(f"Событие «{event.get('name', event.get('id', 'городское событие'))}» сократило доступный бюджет на {_format_amount(event.get('budget_penalty', 0))}; осталось {_format_amount(simulation.get('budget', 0))}. В зоне «{target}» оно изменило показатели: {event_description}.")

    return {"summary": summary, "strengths": strengths, "risks": risks, "consequences": consequences, "tradeoffs": tradeoffs, "recommendations": []}

def _request_analysis(payload):
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    payload = {**payload, "indicator_names": _indicator_names()}
    contains_event = bool(payload.get("event")) or any(bool((row.get("simulation") or {}).get("event")) for row in payload.get("results", []))
    system_prompt = SYSTEM_PROMPT + (EVENT_PROMPT if contains_event else "")
    messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": json.dumps(payload, ensure_ascii=False)}]
    for attempt in range(2):
        response = client.chat.completions.create(model=os.environ.get("OPENAI_MODEL", "gpt-6-sol"), messages=messages, response_format={"type": "json_object"})
        content = response.choices[0].message.content or ""
        try:
            result = json.loads(content)
        except (TypeError, json.JSONDecodeError):
            result = None
        if _valid_analysis(result):
            return result
        messages.append({"role": "assistant", "content": content})
        messages.append({"role": "user", "content": "Ответ не соответствует схеме. Повтори один раз: только JSON с точными ключами и типами из системного сообщения."})
    return None


def explain_simulation(simulation):
    if not os.environ.get("OPENAI_API_KEY"):
        return fallback_analysis(simulation), "fallback"
    try:
        result = _request_analysis(simulation)
    except Exception:
        result = None
    return (result, "ai") if result else (fallback_analysis(simulation), "fallback")


def explain_comparison(results):
    if not os.environ.get("OPENAI_API_KEY"):
        return _fallback_comparison(results), "fallback"
    try:
        result = _request_analysis({"results": results})
    except Exception:
        result = None
    return (result["summary"], "ai") if result else (_fallback_comparison(results), "fallback")


def _fallback_comparison(results):
    scored = [(row.get("name", "Сценарий"), (row.get("simulation") or {}).get("score")) for row in results]
    scored = [(name, score) for name, score in scored if isinstance(score, (int, float))]
    if not scored:
        return "Сравнение рассчитано движком."
    best = max(scored, key=lambda item: item[1])
    return f"Лучшая итоговая оценка у сценария «{best[0]}»: {_format_number(best[1])}. Сравнивайте также распределение оценок по районам и критические показатели."
