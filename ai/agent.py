import json
import os

from openai import OpenAI

from engine import load_data, validate, simulate, optimize
from ai.explainer import fallback_analysis

SYSTEM_PROMPT = "Ты аким города. Цель пользователя: {goal}. Предложи набор мер, проверяй каждый набор инструментами validate_plan и simulate_plan, затем улучшай решение. Числа бери только из результатов инструментов. Пиши по-русски, десятичную дробь оформляй запятой, для показателей используй русские названия. Когда готов, верни строго JSON: объект с decisions (список объектов measure_id и district) и explanation (строка)."
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


def _validation_summary(result):
    if result.get("valid"):
        return f"План валиден. Стоимость {_number(result.get('total_cost', 0))}, доступно {_number(result.get('budget', 0))}, остаток {_number(result.get('budget_left', 0))}."
    return "План невалиден: " + "; ".join(result.get("errors", []))


def _simulation_summary(result):
    return f"Score {_number(result.get('score', 0))}, базовый Score {_number(result.get('base_score', 0))}, изменение {_number(result.get('delta', 0))}; самый слабый район — {result.get('min_district', {}).get('name', 'не определён')} ({_number(result.get('min_district', {}).get('score', 0))})."


def _step(action, decisions, summary):
    return {"action": action, "decisions": decisions, "summary": summary}


def _fallback(event_id, steps):
    candidates = optimize(top=1, event_id=event_id)
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


def _tool_result(name, arguments, event_id, steps, valid_plans):
    if name == "list_measures":
        data = load_data()
        return {"budget": data.get("budget", 100), "measures": data.get("measures", []), "districts": data.get("districts", []), "indicators": data.get("indicators", [])}
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
        return _fallback(event_id, steps)
    try:
        client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        prompt = SYSTEM_PROMPT.format(goal=goal or "сбалансированно повысить качество жизни жителей")
        messages = [{"role": "system", "content": prompt}, {"role": "user", "content": f"Подбери план. Событие: {event_id or 'нет'}."}]
        valid_plans = []
        tool_calls_count = 0
        final = None
        while tool_calls_count < TOOL_LIMIT:
            response = client.chat.completions.create(model=os.environ.get("OPENAI_MODEL", "gpt-6-sol"), messages=messages, tools=TOOLS, tool_choice="auto")
            message = response.choices[0].message
            calls = message.tool_calls or []
            if not calls:
                final = _parse_final(message.content)
                break
            messages.append(message.model_dump(exclude_none=True))
            for call in calls:
                if tool_calls_count >= TOOL_LIMIT:
                    break
                tool_calls_count += 1
                try:
                    arguments = json.loads(call.function.arguments or "{}")
                except json.JSONDecodeError:
                    arguments = {}
                result = _tool_result(call.function.name, arguments, event_id, steps, valid_plans)
                messages.append({"role": "tool", "tool_call_id": call.id, "content": json.dumps(result, ensure_ascii=False)})
        if final is None:
            return _fallback(event_id, steps)
        proposed = final["decisions"]
        validation = validate(proposed, event_id=event_id)
        steps.append(_step("validate", proposed, _validation_summary(validation)))
        if validation.get("valid"):
            result = simulate(proposed, event_id=event_id)
            steps.append(_step("simulate", proposed, _simulation_summary(result)))
            return {"decisions": proposed, "simulation": result, "steps": steps, "explanation": final["explanation"], "source": "ai"}
        scored = []
        for decisions in valid_plans:
            check = validate(decisions, event_id=event_id)
            if not check.get("valid"):
                continue
            result = simulate(decisions, event_id=event_id)
            scored.append((result.get("score", float("-inf")), decisions, result))
        if not scored:
            return _fallback(event_id, steps)
        _, decisions, result = max(scored, key=lambda item: item[0])
        steps.append(_step("simulate", decisions, _simulation_summary(result)))
        analysis = fallback_analysis(result)
        explanation = "Лучший валидный проверенный план: " + analysis["summary"]
        return {"decisions": decisions, "simulation": result, "steps": steps, "explanation": explanation, "source": "fallback"}
    except Exception:
        return _fallback(event_id, steps)
