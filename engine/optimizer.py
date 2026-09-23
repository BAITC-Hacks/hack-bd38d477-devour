import copy
import heapq
import itertools
import math
from functools import lru_cache

from engine.rules import district_names, load_data, measures_index
from engine.scoring import indicator_ids, indicator_weights, simulate

CACHE_STEP = 50


@lru_cache(maxsize=None)
def _assignment_masks(count):
    result = []
    for assignment in itertools.product(range(5), repeat=count):
        masks = [0, 0, 0, 0, 0]
        for position, district in enumerate(assignment):
            masks[district] |= 1 << position
        result.append((assignment, tuple(masks)))
    return tuple(result)


def _precompute(data):
    keys = indicator_ids(data)
    weights = indicator_weights(data)
    horizon = data["horizon"]
    effects = {}
    for measure in data["measures"]:
        factor = (horizon - measure["lag"]) / horizon
        vector = [0.0] * len(keys)
        for indicator, value in measure["effects"].items():
            vector[keys.index(indicator)] = value * factor
        effects[measure["id"]] = vector
    return (
        keys,
        [weights[key] for key in keys],
        [district["population"] for district in data["districts"]],
        [[float(district["indicators"][key]) for key in keys] for district in data["districts"]],
        effects,
    )


def _combo_is_allowed(measures, combo, limit, budget, forbidden_pairs):
    if sum(measures[item]["cost"] for item in combo) > budget:
        return False
    counts = {}
    for item in combo:
        direction = measures[item]["direction"]
        counts[direction] = counts.get(direction, 0) + 1
        if counts[direction] > limit:
            return False
    for first, second in forbidden_pairs:
        if first in combo and second in combo:
            return False
    return True


def _district_table(data, prepared, combo, regional, city, bits):
    keys, weights, populations, base, effects = prepared
    size = len(keys)
    city_delta = [0.0] * size
    for measure_id in city:
        vector = effects[measure_id]
        for index in range(size):
            city_delta[index] += vector[index]

    synergies = []
    for synergy in data["synergies"]:
        first, second = synergy["pair"]
        if first in combo and second in combo:
            synergies.append((first, keys.index(synergy["indicator"]), synergy["bonus"]))

    blocked = []
    for rule in data["incompatibilities"]:
        if rule["scope"] != "same_district":
            continue
        first, second = rule["pair"]
        if first in bits and second in bits:
            blocked.append(bits[first] | bits[second])

    table = []
    for district in range(len(base)):
        row = []
        for mask in range(1 << len(regional)):
            if any(mask & pair == pair for pair in blocked):
                row.append(None)
                continue
            values = [base[district][index] + city_delta[index] for index in range(size)]
            for position, measure_id in enumerate(regional):
                if mask >> position & 1:
                    vector = effects[measure_id]
                    for index in range(size):
                        values[index] += vector[index]
            for first, indicator_index, bonus in synergies:
                if first in bits:
                    if mask & bits[first]:
                        values[indicator_index] += bonus
                else:
                    values[indicator_index] += bonus
            total = 0.0
            critical = 0
            for index in range(size):
                value = values[index]
                if value < 0.0:
                    value = 0.0
                elif value > 100.0:
                    value = 100.0
                if value < 40.0:
                    critical += 1
                total += weights[index] * value
            row.append((0.7 * populations[district] * total, total, critical))
        table.append(row)
    return table


@lru_cache(maxsize=None)
def _search(limit):
    data = load_data()
    prepared = _precompute(data)
    measures = measures_index(data)
    districts = district_names(data)
    budget = data["budget"]
    required = data["measures_required"]
    direction_limit = data["max_per_direction"]
    forbidden_pairs = [
        tuple(rule["pair"]) for rule in data["incompatibilities"] if rule["scope"] == "any"
    ]

    heap = []
    counter = 0
    for combo in itertools.combinations(measures, required):
        if not _combo_is_allowed(measures, combo, direction_limit, budget, forbidden_pairs):
            continue
        regional = [item for item in combo if measures[item]["type"] == "R"]
        city = [item for item in combo if measures[item]["type"] == "C"]
        bits = {measure_id: 1 << position for position, measure_id in enumerate(regional)}
        table = _district_table(data, prepared, combo, regional, city, bits)
        first, second, third, fourth, fifth = table
        for assignment, masks in _assignment_masks(len(regional)):
            cell0 = first[masks[0]]
            if cell0 is None:
                continue
            cell1 = second[masks[1]]
            if cell1 is None:
                continue
            cell2 = third[masks[2]]
            if cell2 is None:
                continue
            cell3 = fourth[masks[3]]
            if cell3 is None:
                continue
            cell4 = fifth[masks[4]]
            if cell4 is None:
                continue
            score = (
                cell0[0] + cell1[0] + cell2[0] + cell3[0] + cell4[0]
                - (cell0[2] + cell1[2] + cell2[2] + cell3[2] + cell4[2])
                + 0.3 * min(cell0[1], cell1[1], cell2[1], cell3[1], cell4[1])
            )
            if len(heap) < limit:
                counter += 1
                heapq.heappush(heap, (score, -counter, combo, assignment))
            elif score > heap[0][0]:
                counter += 1
                heapq.heappushpop(heap, (score, -counter, combo, assignment))

    best = []
    for score, _, combo, assignment in heap:
        regional = [item for item in combo if measures[item]["type"] == "R"]
        placement = {
            measure_id: districts[assignment[position]]
            for position, measure_id in enumerate(regional)
        }
        decisions = [
            {"measure_id": measure_id, "district": placement.get(measure_id)}
            for measure_id in combo
        ]
        result = simulate(decisions)
        best.append(
            {
                "decisions": decisions,
                "score": result["score"],
                "total_cost": result["total_cost"],
            }
        )
    best.sort(key=lambda item: (-item["score"], [d["measure_id"] for d in item["decisions"]]))
    return tuple(best)


def optimize(top=5):
    top = int(top)
    if top <= 0:
        return []
    limit = CACHE_STEP * math.ceil(top / CACHE_STEP)
    return [copy.deepcopy(item) for item in _search(limit)[:top]]
