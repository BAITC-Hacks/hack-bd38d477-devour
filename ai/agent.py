import json
import os

from openai import OpenAI

from engine import load_data, validate, simulate, optimize, get_event
from ai.explainer import fallback_analysis, normalize_text_numbers, numbers_supported

SYSTEM_PROMPT = "Ты аким города. Цель пользователя: {goal}. Предложи набор мер, проверяй каждый набор инструментами validate_plan и simulate_plan, затем улучшай решение. Числа бери только из результатов инструментов. Пиши по-русски, каждое число в объяснении оформляй десятичной запятой и ровно двумя знаками после запятой, для показателей используй русские названия. Когда готов, верни строго JSON: объект с decisions (список объектов measure_id и district) и explanation (строка)."
TOOL_LIMIT = 8

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_measures",
            "description": "Показывает доступные меры, районы и бюджет.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "validate_plan",
            "description": "Проверяет план и бюджет с учетом текущего события.",
            "parameters": {
                "type": "object",
                "properties": {"decisions": {"type": "array", "items": {"type": "object", "properties": {"measure_id": {"type": "string"}, "district": {"anyOf": [{"type": "string"}, {"type": "null"}]}}, "required": ["measure_id", "district"], "additionalProperties": False}}},
                "required": ["decisions"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "simulate_plan",
            "description": "Сначала проверяет, затем симулирует план с учетом текущего события.",
            "parameters": {
                "type": "object",
                "properties": {"decisions": {"type": "array", "items": {"type": "object", "properties": {"measure_id": {"type": "string"}, "district": {"anyOf": [{"type": "string"}, {"type": "null"}]}}, "required": ["measure_id", "district"], "additionalProperties": False}}},
                "required": ["decisions"],
                "additionalProperties": False,
            },
        },
    },
]


def _number(value):
    return f"{value:.2f}".replace(".", ",")


def round_floats(value):
    if isinstance(value, float):
        return round(value, 2)
    if isinstance(value, dict):
        rounded = {key: round_floats(item) for key, item in value.items()}
        score = rounded.get("score")
        base_score = rounded.get("base_score")
        if "delta" in rounded and isinstance(score, (int, float)) and isinstance(base_score, (int, float)):
            rounded["delta"] = round(round(score, 2) - round(base_score, 2), 2)
        return rounded
    if isinstance(value, list):
        return [round_floats(item) for item in value]
    if isinstance(value, tuple):
        return [round_floats(item) for item in value]
    return value


def _validation_summary(result):
    if result.get("valid"):
        return f"План валиден. Стоимость {_number(result.get('total_cost', 0))}, доступно {_number(result.get('budget', 0))}, остаток {_number(result.get('budget_left', 0))}."
    return "План невалиден: " + normalize_text_numbers("; ".join(result.get("errors", [])))


def _simulation_summary(result):
    return f"Score {_number(result.get('score', 0))}, базовый Score {_number(result.get('base_score', 0))}, изменение {_number(result.get('delta', 0))}; самый слабый район — {result.get('min_district', {}).get('name', 'не определён')} ({_number(result.get('min_district', {}).get('score', 0))})."


def _step(action, decisions, summary):
    return {"action": action, "decisions": decisions, "summary": summary}


def _fallback(event_id, steps, candidates):
    if not candidates:
        decisions = []
        result = simulate(decisions, event_id=event_id)
        analysis = fallback_analysis(result)
        return {"decisions": decisions, "simulation": result, "steps": steps, "explanation": analysis["summary"], "source": "fallback"}
    decisions = candidates[0]["decisions"]
    validation = validate(decisions, event_id=event_id)
    steps.append(_step("validate", decisions, _validation_summary(validation)))
    if validation.get("valid"):
        result = simulate(decisions, event_id=event_id)
        steps.append(_step("simulate", decisions, _simulation_summary(result)))
    else:
        result = simulate([], event_id=event_id)
        decisions = []
    analysis = fallback_analysis(result)
    explanation = " ".join([analysis["summary"], *analysis["strengths"][:3]])
    return {"decisions": decisions, "simulation": result, "steps": steps, "explanation": explanation, "source": "fallback"}


def _comparison_sentence(agent_simulation, optimizer_simulation, goal):
    agent_score = round(agent_simulation.get("score", 0), 2)
    optimizer_score = round(optimizer_simulation.get("score", 0), 2)
    if agent_score >= optimizer_score:
        relation = "равен" if agent_score == optimizer_score else "выше"
        return f"Score плана агента {relation} Score оптимизатора: {_number(agent_score)} против {_number(optimizer_score)}."

    data = load_data()
    goal_text = (goal or "").casefold().replace("ё", "е")
    target_names = [district["name"] for district in data.get("districts", []) if district["name"].casefold().replace("ё", "е")[:3] in goal_text]
    names = {item["id"]: item["name"] for item in data.get("indicators", [])}
    agent_districts = {item["name"]: item for item in agent_simulation.get("districts", [])}
    optimizer_districts = {item["name"]: item for item in optimizer_simulation.get("districts", [])}
    candidates = []
    for district_name in target_names or list(agent_districts):
        agent_district = agent_districts.get(district_name, {})
        optimizer_district = optimizer_districts.get(district_name, {})
        agent_before = agent_district.get("before", {}) or {}
        agent_after = agent_district.get("after", {}) or {}
        optimizer_before = optimizer_district.get("before", {}) or {}
        optimizer_after = optimizer_district.get("after", {}) or {}
        for indicator_id in set(agent_before) & set(agent_after) & set(optimizer_before) & set(optimizer_after):
            agent_gain = round(agent_after[indicator_id] - agent_before[indicator_id], 2)
            optimizer_gain = round(optimizer_after[indicator_id] - optimizer_before[indicator_id], 2)
            advantage = round(agent_gain - optimizer_gain, 2)
            if advantage > 0:
                candidates.append((advantage, district_name, indicator_id, agent_gain, optimizer_gain))
    if candidates:
        _, district_name, indicator_id, agent_gain, optimizer_gain = max(candidates)
        indicator_name = names.get(indicator_id, indicator_id)
        return f"Хотя общий Score оптимизатора выше ({_number(optimizer_score)} против {_number(agent_score)}), для цели «{goal or 'улучшить район'}» в районе «{district_name}» показатель «{indicator_name}» вырос сильнее: +{_number(agent_gain)} у плана агента против +{_number(optimizer_gain)} у оптимизатора."
    return f"Score оптимизатора выше ({_number(optimizer_score)} против {_number(agent_score)}); по показателям и районам из симуляций не нашлось преимущества плана агента для цели «{goal or 'пользователя'}»."


def _finish(result, event_id, goal, candidates=None):
    if candidates is None:
        candidates = optimize(top=1, event_id=event_id)
    optimizer_score = None
    comparison = "Оптимизатор не вернул допустимого плана для сравнения."
    if candidates:
        optimizer_decisions = candidates[0]["decisions"]
        optimizer_validation = validate(optimizer_decisions, event_id=event_id)
        if optimizer_validation.get("valid"):
            optimizer_simulation = simulate(optimizer_decisions, event_id=event_id)
            optimizer_score = round(optimizer_simulation.get("score", 0), 2)
            comparison = _comparison_sentence(result["simulation"], optimizer_simulation, goal)
    result["optimizer_score"] = optimizer_score
    result["explanation"] = f"{result['explanation']} {comparison}".strip()
    return result


def _tool_result(name, arguments, event_id, steps, valid_plans):
    if name == "list_measures":
        data = load_data()
        event = get_event(event_id) if event_id is not None else None
        budget = data.get("budget", 100) - (event["budget_penalty"] if event else 0)
        return {"budget": budget, "event": event, "measures": data.get("measures", []), "districts": data.get("districts", []), "indicators": data.get("indicators", [])}
    decisions = arguments.get("decisions", [])
    validation = validate(decisions, event_id=event_id)
    steps.append(_step("validate", decisions, _validation_summary(validation)))
    if validation.get("valid"):
        if not any(existing == decisions for existing in valid_plans):
            valid_plans.append(decisions)
    if name == "validate_plan":
        return validation
    if not validation.get("valid"):
        return {"valid": False, "errors": validation.get("errors", [])}
    result = simulate(decisions, event_id=event_id)
    steps.append(_step("simulate", decisions, _simulation_summary(result)))
    return result


def _parse_final(content):
    if not content:
        return None
    try:
        result = json.loads(content)
    except (TypeError, json.JSONDecodeError):
        return None
    if not isinstance(result, dict) or not isinstance(result.get("decisions"), list) or not isinstance(result.get("explanation"), str):
        return None
    return result


def run_agent(goal=None, event_id=None):
    steps = []
    if not os.environ.get("OPENAI_API_KEY"):
        candidates = optimize(top=1, event_id=event_id)
        return _finish(_fallback(event_id, steps, candidates), event_id, goal, candidates)
    try:
        client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        prompt = SYSTEM_PROMPT.format(goal=goal or "сбалансированно повысить качество жизни жителей")
        messages = [{"role": "system", "content": prompt}, {"role": "user", "content": f"Подбери план. Событие: {event_id or 'нет'}."}]
        valid_plans = []
        tool_calls_count = 0
        final = None
        final_content = None
        tool_results = []
        while True:
            if tool_calls_count >= TOOL_LIMIT:
                messages.append({"role": "user", "content": "Лимит инструментов исчерпан. Выбери лучший валидный план среди уже проверенных и верни итоговый JSON без новых инструментов."})
                response = client.chat.completions.create(model=os.environ.get("OPENAI_MODEL", "gpt-6-sol"), messages=messages, reasoning_effort="none")
                final_content = response.choices[0].message.content
                final = _parse_final(final_content)
                break
            response = client.chat.completions.create(model=os.environ.get("OPENAI_MODEL", "gpt-6-sol"), messages=messages, tools=TOOLS, tool_choice="auto", reasoning_effort="none")
            message = response.choices[0].message
            calls = message.tool_calls or []
            if not calls:
                final_content = message.content
                final = _parse_final(final_content)
                break
            messages.append(message.model_dump(exclude_none=True))
            for call in calls:
                if tool_calls_count >= TOOL_LIMIT:
                    result = {"error": "Лимит вызовов инструментов исчерпан; новых проверок выполнить нельзя."}
                    messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(result, ensure_ascii=False)})
                    continue
                tool_calls_count += 1
                try:
                    arguments = json.loads(call.function.arguments or "{}")
                except json.JSONDecodeError:
                    arguments = {}
                result = _tool_result(call.function.name, arguments, event_id, steps, valid_plans)
                tool_result = round_floats(result)
                tool_results.append(tool_result)
                messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(tool_result, ensure_ascii=False)})
        if final is not None and not numbers_supported(final["explanation"], tool_results):
            messages.append({"role": "assistant", "content": final_content})
            messages.append({"role": "user", "content": "В объяснении есть числа, которых нет в результатах инструментов. Исправь ответ один раз: верни JSON с decisions и explanation, используй только числа из результатов инструментов, без собственных вычислений. Неподтверждённые числа убери. Новые инструменты не вызывай."})
            response = client.chat.completions.create(model=os.environ.get("OPENAI_MODEL", "gpt-6-sol"), messages=messages, reasoning_effort="none")
            final = _parse_final(response.choices[0].message.content)
            if final is not None and not numbers_supported(final["explanation"], tool_results):
                final = None
        if final is None:
            candidates = optimize(top=1, event_id=event_id)
            return _finish(_fallback(event_id, steps, candidates), event_id, goal, candidates)
        proposed = final["decisions"]
        validation = validate(proposed, event_id=event_id)
        steps.append(_step("validate", proposed, _validation_summary(validation)))
        if validation.get("valid"):
            result = simulate(proposed, event_id=event_id)
            steps.append(_step("simulate", proposed, _simulation_summary(result)))
            response = {"decisions": proposed, "simulation": result, "steps": steps, "explanation": normalize_text_numbers(final["explanation"]), "source": "ai"}
            return _finish(response, event_id, goal)
        scored = []
        for decisions in valid_plans:
            check = validate(decisions, event_id=event_id)
            if not check.get("valid"):
                continue
            result = simulate(decisions, event_id=event_id)
            scored.append((result.get("score", float("-inf")), decisions, result))
        if not scored:
            candidates = optimize(top=1, event_id=event_id)
            return _finish(_fallback(event_id, steps, candidates), event_id, goal, candidates)
        _, decisions, result = max(scored, key=lambda item: item[0])
        steps.append(_step("simulate", decisions, _simulation_summary(result)))
        analysis = fallback_analysis(result)
        explanation = "Лучший валидный проверенный план: " + analysis["summary"]
        response = {"decisions": decisions, "simulation": result, "steps": steps, "explanation": explanation, "source": "fallback"}
        return _finish(response, event_id, goal)
    except Exception:
        candidates = optimize(top=1, event_id=event_id)
        return _finish(_fallback(event_id, steps, candidates), event_id, goal, candidates)
