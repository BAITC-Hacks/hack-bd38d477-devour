import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.responses import FileResponse, JSONResponse

from engine import load_data, validate, simulate, optimize
from ai.advisor import recommendations
from ai.explainer import explain_simulation, explain_comparison

load_dotenv()

app = FastAPI()
WEB_DIR = Path(__file__).resolve().parent.parent / "web"


def round_floats(value):
    if isinstance(value, float):
        return round(value, 2)
    if isinstance(value, dict):
        return {key: round_floats(item) for key, item in value.items()}
    if isinstance(value, list):
        return [round_floats(item) for item in value]
    if isinstance(value, tuple):
        return [round_floats(item) for item in value]
    return value


class DecisionsRequest(BaseModel):
    decisions: list[dict]


class Scenario(BaseModel):
    name: str
    decisions: list[dict]


class CompareRequest(BaseModel):
    scenarios: list[Scenario]


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


@app.post("/api/validate")
def validate_decisions(request: DecisionsRequest):
    return round_floats(validate(request.decisions))


@app.post("/api/simulate")
def run_simulation(request: DecisionsRequest):
    result = validate(request.decisions)
    if not result.get("valid"):
        raise HTTPException(status_code=422, detail={"valid": False, "errors": result.get("errors", [])})
    return round_floats(simulate(request.decisions))


@app.post("/api/explain")
def explain(request: DecisionsRequest):
    validation = validate(request.decisions)
    if not validation.get("valid"):
        raise HTTPException(status_code=422, detail={"valid": False, "errors": validation.get("errors", [])})
    simulation = simulate(request.decisions)
    analysis, source = explain_simulation(round_floats(simulation))
    analysis["recommendations"] = recommendations(request.decisions, simulation)
    return round_floats({"simulation": simulation, "analysis": analysis, "source": source})


@app.post("/api/compare")
def compare(request: CompareRequest):
    results = []
    for scenario in request.scenarios:
        validation = validate(scenario.decisions)
        if not validation.get("valid"):
            raise HTTPException(status_code=422, detail={"valid": False, "errors": validation.get("errors", []), "scenario": scenario.name})
        results.append({"name": scenario.name, "simulation": simulate(scenario.decisions)})
    analysis, source = explain_comparison(round_floats(results))
    return round_floats({"results": results, "analysis": analysis, "source": source})


@app.get("/api/optimize")
def run_optimizer(top: int = 5):
    if top < 1 or top > 100:
        raise HTTPException(status_code=422, detail="Параметр top должен быть от 1 до 100")
    return round_floats(optimize(top=top))


if WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=WEB_DIR), name="web")
