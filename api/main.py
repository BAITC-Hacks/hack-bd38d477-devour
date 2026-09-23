import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.responses import FileResponse, JSONResponse

from engine import load_data, validate, simulate, optimize, list_events, get_event
from ai.advisor import recommendations
from ai.explainer import explain_simulation, explain_comparison
from ai.agent import run_agent

load_dotenv()

app = FastAPI()
WEB_DIR = Path(__file__).resolve().parent.parent / "web"
WEB_V2_DIR = Path(__file__).resolve().parent.parent / "web-v2"


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


def check_event(event_id):
    if event_id is None:
        return
    try:
        get_event(event_id)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


class DecisionsRequest(BaseModel):
    decisions: list[dict]
    event_id: str | None = None


class Scenario(BaseModel):
    name: str
    decisions: list[dict]
    event_id: str | None = None


class CompareRequest(BaseModel):
    scenarios: list[Scenario]


class AgentRequest(BaseModel):
    goal: str | None = None
    event_id: str | None = None


@app.get("/")
def index():
    index_path = WEB_DIR / "index.html"
    if WEB_DIR.is_dir() and index_path.is_file():
        return FileResponse(index_path)
    return JSONResponse({"status": "frontend not built"})


@app.get("/api/state")
def state():
    data = load_data()
    base = simulate([])
    base_scores = {district.get("name"): district.get("score_before") for district in base.get("districts", [])}
    districts = [dict(district, base_score=base_scores.get(district.get("name"))) for district in data.get("districts", [])]
    weights = {item["id"]: item["weight"] for item in data.get("indicators", [])}
    result = {"budget": data.get("budget", 100), "districts": districts, "measures": data.get("measures", []), "weights": weights, "base_score": base.get("score", base.get("base_score"))}
    return round_floats(result)


@app.get("/api/events")
def events():
    return list_events()


@app.post("/api/validate")
def validate_decisions(request: DecisionsRequest):
    check_event(request.event_id)
    return round_floats(validate(request.decisions, event_id=request.event_id))


@app.post("/api/simulate")
def run_simulation(request: DecisionsRequest):
    check_event(request.event_id)
    result = validate(request.decisions, event_id=request.event_id)
    if not result.get("valid"):
        raise HTTPException(status_code=422, detail={"valid": False, "errors": result.get("errors", [])})
    return round_floats(simulate(request.decisions, event_id=request.event_id))


@app.post("/api/explain")
def explain(request: DecisionsRequest):
    check_event(request.event_id)
    validation = validate(request.decisions, event_id=request.event_id)
    if not validation.get("valid"):
        raise HTTPException(status_code=422, detail={"valid": False, "errors": validation.get("errors", [])})
    simulation = simulate(request.decisions, event_id=request.event_id)
    analysis, source = explain_simulation(round_floats(simulation))
    analysis["recommendations"] = recommendations(request.decisions, simulation, request.event_id)
    return round_floats({"simulation": simulation, "analysis": analysis, "source": source})


@app.post("/api/agent")
def agent(request: AgentRequest):
    check_event(request.event_id)
    return round_floats(run_agent(request.goal, request.event_id))


@app.post("/api/compare")
def compare(request: CompareRequest):
    results = []
    for scenario in request.scenarios:
        check_event(scenario.event_id)
        validation = validate(scenario.decisions, event_id=scenario.event_id)
        if not validation.get("valid"):
            raise HTTPException(status_code=422, detail={"valid": False, "errors": validation.get("errors", []), "scenario": scenario.name})
        results.append({"name": scenario.name, "simulation": simulate(scenario.decisions, event_id=scenario.event_id)})
    analysis, source = explain_comparison(round_floats(results))
    return round_floats({"results": results, "analysis": analysis, "source": source})


@app.get("/api/optimize")
def run_optimizer(top: int = 5, event_id: str | None = None):
    if top < 1 or top > 100:
        raise HTTPException(status_code=422, detail="Параметр top должен быть от 1 до 100")
    check_event(event_id)
    return round_floats(optimize(top=top, event_id=event_id))


if WEB_V2_DIR.is_dir():
    app.mount("/v2", StaticFiles(directory=WEB_V2_DIR, html=True), name="web-v2")

if WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIR), name="web")
