"""Bounded local CP-SAT transport allocation. JSON stdin/stdout only."""
import json
import sys
from ortools.sat.python import cp_model


def companion_for(person, direction):
    return person.get(direction + "CompanionGroup", person["companionGroup"])


def validate(data):
    def require(condition, message):
        if not condition:
            raise ValueError(message)

    def integer(value, low, high):
        return type(value) is int and low <= value <= high

    def text(value, limit=80):
        return isinstance(value, str) and 0 < len(value.strip()) <= limit

    require(isinstance(data, dict), "입력 형식을 확인해 주세요.")
    for name, low, high in [("people", 1, 250), ("vehicles", 1, 80), ("trips", 2, 8), ("locks", 0, 500), ("previousAssignments", 0, 500)]:
        require(isinstance(data.get(name), list) and low <= len(data[name]) <= high, "명단·차량·이동편 개수를 확인해 주세요.")
    require(integer(data.get("revision"), 1, 1000000) and integer(data.get("extraCount"), 0, 50), "버전·추가 인원 범위를 확인해 주세요.")
    require(data.get("objective") in ["cost", "institution"], "우선순위를 확인해 주세요.")
    for name in ["people", "vehicles", "trips"]:
        ids = [x.get("id") if isinstance(x, dict) else None for x in data[name]]
        require(all(isinstance(x, str) and 1 <= len(x) <= 50 and all(c.isascii() and (c.isalnum() or c in "_-") for c in x) for x in ids), "ID 형식을 확인해 주세요.")
        require(len(set(ids)) == len(ids), "ID가 중복됩니다.")
    people = {p["id"]: p for p in data["people"]}
    trips = {t["id"]: t for t in data["trips"]}
    vehicles = {v["id"]: v for v in data["vehicles"]}
    for t in trips.values():
        require(text(t.get("label")) and t.get("direction") in ["outbound", "return"] and integer(t.get("start"), 0, 10080) and integer(t.get("end"), 1, 10080) and t["start"] < t["end"], "이동편 시간·방향을 확인해 주세요.")
    for p in people.values():
        require(text(p.get("name")) and text(p.get("department"), 40), "이름·소속을 확인해 주세요.")
        require(p.get("team", "") == "" or text(p.get("team"), 40), "팀 이름을 확인해 주세요.")
        require(all(isinstance(p.get(k), str) and len(p[k]) <= 40 for k in ["familyId", "companionGroup"]), "가족·동반 묶음을 확인해 주세요.")
        require(all(k not in p or isinstance(p[k], str) and len(p[k]) <= 40 for k in ["outboundCompanionGroup", "returnCompanionGroup"]), "출발·귀가 동반 묶음을 확인해 주세요.")
        for direction in ["outbound", "return"]:
            require(direction + "TripId" in p, "이동편 필드가 없습니다.")
            tid = p[direction + "TripId"]
            require(tid is None or (isinstance(tid, str) and tid in trips and trips[tid]["direction"] == direction), "참가자 이동편 방향을 확인해 주세요.")
        if p["outboundTripId"] and p["returnTripId"]:
            require(trips[p["outboundTripId"]]["end"] <= trips[p["returnTripId"]]["start"], "참가자의 출발·귀가 시간이 겹칩니다.")
    for v in vehicles.values():
        require(text(v.get("label")) and integer(v.get("capacity"), 1, 60), "차량 좌석을 확인해 주세요.")
        if "totalSeats" in v or "vehicleType" in v:
            require(integer(v.get("totalSeats"), v["capacity"], 60), "총 좌석은 배정 가능 좌석 이상이어야 합니다.")
        require(type(v.get("enabled")) is bool and type(v.get("rental")) is bool and integer(v.get("rentalCost"), 0, 10000000), "차량 사용 여부·견적을 확인해 주세요.")
        require("rentalQuoteKnown" not in v or type(v["rentalQuoteKnown"]) is bool, "대여 견적 확인 상태를 확인해 주세요.")
        require(isinstance(v.get("tripIds"), list) and all(isinstance(t, str) and t in trips for t in v["tripIds"]) and len(set(v["tripIds"])) == len(v["tripIds"]), "차량 가용 이동편을 확인해 주세요.")
        require("driverId" in v and (v["driverId"] is None or isinstance(v["driverId"], str) and v["driverId"] in people), "운전자를 확인해 주세요.")
        require(type(v.get("externalDriverConfirmed", False)) is bool, "외부 운전자 확인 상태를 확인해 주세요.")
    for direction in ["outbound", "return"]:
        tid = data.get("extra" + direction.capitalize() + "TripId")
        require(isinstance(tid, str) and tid in trips and trips[tid]["direction"] == direction, "가상 인원의 이동편을 확인해 주세요.")
    if data["extraCount"]:
        require(trips[data["extraOutboundTripId"]]["end"] <= trips[data["extraReturnTripId"]]["start"], "가상 인원의 출발·귀가 시간이 겹칩니다.")
    for direction in ["outbound", "return"]:
        for group in {companion_for(p, direction) for p in people.values() if companion_for(p, direction)}:
            members = [p for p in people.values() if companion_for(p, direction) == group]
            require(len({p[direction + "TripId"] for p in members}) == 1, "필수 동반 묶음의 이동편이 다릅니다.")
    for name in ["locks", "previousAssignments"]:
        seen = set()
        for a in data[name]:
            require(isinstance(a, dict) and isinstance(a.get("personId"), str) and a["personId"] in people and isinstance(a.get("tripId"), str) and a["tripId"] in trips, "배정 참조를 확인해 주세요.")
            require("vehicleId" in a and (a["vehicleId"] is None or isinstance(a["vehicleId"], str) and a["vehicleId"] in vehicles), "배정 차량을 확인해 주세요.")
            require(people[a["personId"]][trips[a["tripId"]]["direction"] + "TripId"] == a["tripId"], "배정 이동편이 참가자 설정과 다릅니다.")
            pair = (a["personId"], a["tripId"])
            require(pair not in seen, "배정 참조가 중복됩니다.")
            seen.add(pair)
    return people, trips, vehicles


def solve(data):
    people, trips, vehicles = validate(data)
    model = cp_model.CpModel()
    assignments, unassigned, used, reserved, shortages, enabled = {}, {}, {}, {}, {}, {}
    demands = [(p["id"], t["id"]) for p in people.values() for t in trips.values() if p[t["direction"] + "TripId"] == t["id"]]
    extra_trips = {data["extraOutboundTripId"], data["extraReturnTripId"]}
    for vid, v in vehicles.items():
        enabled[vid] = model.new_bool_var("vehicle_" + vid)
        for tid, t in trips.items():
            driver = people.get(v["driverId"])
            if v["enabled"] and tid in v["tripIds"] and ((driver and driver[t["direction"] + "TripId"] == tid) or (not driver and v.get("externalDriverConfirmed", False))):
                used[tid, vid] = model.new_bool_var(f"use_{tid}_{vid}")
                if tid in extra_trips:
                    reserved[tid, vid] = model.new_int_var(0, data["extraCount"], f"reserve_{tid}_{vid}")
        choices = [y for (t, v), y in used.items() if v == vid]
        model.add_max_equality(enabled[vid], choices or [0])
        for direction in ["outbound", "return"]:
            model.add(sum(y for (tid, v), y in used.items() if v == vid and trips[tid]["direction"] == direction) <= 1)
    for pid, tid in demands:
        unassigned[pid, tid] = model.new_bool_var(f"missing_{pid}_{tid}")
        choices = []
        for vid in vehicles:
            if (tid, vid) in used:
                x = model.new_bool_var(f"x_{pid}_{tid}_{vid}")
                assignments[pid, tid, vid] = x
                model.add(x <= used[tid, vid])
                choices.append(x)
        model.add(sum(choices) + unassigned[pid, tid] == 1)
    for (tid, vid), y in used.items():
        riders = [x for (p, t, v), x in assignments.items() if t == tid and v == vid]
        total = sum(riders) + reserved.get((tid, vid), 0)
        model.add(total <= vehicles[vid]["capacity"] * y)
        model.add(total >= y)
        driver = vehicles[vid]["driverId"]
        if driver:
            model.add(assignments[driver, tid, vid] == y)
    for tid in extra_trips:
        shortages[tid] = model.new_int_var(0, data["extraCount"], "extra_missing_" + tid)
        model.add(sum(r for (t, v), r in reserved.items() if t == tid) + shortages[tid] == data["extraCount"])
    uses = list(used.items())
    for i, ((ta, va), ya) in enumerate(uses):
        for (tb, vb), yb in uses[i + 1:]:
            overlap = trips[ta]["start"] < trips[tb]["end"] and trips[tb]["start"] < trips[ta]["end"]
            same_driver = vehicles[va]["driverId"] is not None and vehicles[va]["driverId"] == vehicles[vb]["driverId"]
            if overlap and (va == vb or same_driver):
                model.add(ya + yb <= 1)
    for tid in trips:
        groups = {}
        for pid, t in demands:
            group = companion_for(people[pid], trips[tid]["direction"])
            if t == tid and group:
                groups.setdefault(group, []).append(pid)
        for group in groups.values():
            for pid in group[1:]:
                for vid in vehicles:
                    model.add(assignments.get((group[0], tid, vid), 0) == assignments.get((pid, tid, vid), 0))
    for a in data["locks"]:
        term = unassigned[a["personId"], a["tripId"]] if a["vehicleId"] is None else assignments.get((a["personId"], a["tripId"], a["vehicleId"]), 0)
        model.add(term == 1)
    changes = []
    for a in data["previousAssignments"]:
        term = unassigned[a["personId"], a["tripId"]] if a["vehicleId"] is None else assignments.get((a["personId"], a["tripId"], a["vehicleId"]), 0)
        changes.append(1 - term)
    splits = []
    if data["objective"] == "institution":
        for tid in trips:
            departments = {p: people[p]["department"] for p, t in demands if t == tid}
            for department in sorted(set(departments.values())):
                group = [p for p, label in departments.items() if label == department]
                for vid in vehicles:
                    xs = [assignments[p, tid, vid] for p in group if (p, tid, vid) in assignments]
                    if xs:
                        g = model.new_bool_var(f"dept_{tid}_{department}_{vid}")
                        model.add_max_equality(g, xs)
                        splits.append(g)
    # Optimize actual coverage and virtual coverage before considering preferences/cost.
    rentals = {vid: v for vid, v in vehicles.items() if v["rental"] and v["enabled"] and v["tripIds"]}
    quotes_known = all(v.get("rentalQuoteKnown", v["rentalCost"] > 0) for v in rentals.values())
    # Missing quotes cannot become cheaper than recorded prices.
    priced = rentals if quotes_known else {}
    cost = sum(v["rentalCost"] * enabled[vid] for vid, v in priced.items())
    cost_cap = sum(v["rentalCost"] for v in priced.values())
    tie_cap = len(demands) + len(vehicles) + 1
    secondary = cost * tie_cap + sum(changes) + sum(enabled.values())
    secondary_cap = (cost_cap + 1) * tie_cap
    if splits:
        secondary += sum(splits) * (secondary_cap + 1)
        secondary_cap += len(splits) * (secondary_cap + 1)
    engine = cp_model.CpSolver()
    engine.parameters.max_time_in_seconds = 3.0
    engine.parameters.num_search_workers = 2
    engine.parameters.random_seed = 1
    saved = None
    variables = list(assignments.values()) + list(unassigned.values()) + list(used.values()) + list(reserved.values()) + list(shortages.values()) + list(enabled.values())
    all_optimal = True
    objectives = [sum(unassigned.values()), sum(shortages.values())]
    if changes:
        objectives.append(sum(changes))
    objectives.append(secondary)
    for objective in objectives:
        model.minimize(objective)
        status = engine.solve(model)
        if status not in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
            all_optimal = False
            break
        saved = {var.index: engine.value(var) for var in variables}
        if status != cp_model.OPTIMAL:
            all_optimal = False
            break
        model.add(objective == engine.value(objective))
    status_name = ("optimal" if all_optimal else "feasible") if saved is not None else ("infeasible" if status == cp_model.INFEASIBLE else "unknown")
    result = {"revision": data["revision"], "status": status_name, "assignments": [], "reservations": [], "usedVehicleIds": [], "cost": 0, "unassignedCount": len(demands), "unreservedCount": 2 * data["extraCount"], "message": ""}
    if saved is None:
        result["message"] = "잠금·동반·가용 이동편 조건이 충돌합니다. 조건을 확인해 주세요." if status == cp_model.INFEASIBLE else "제한 시간 내 배정안을 찾지 못했습니다. 조건을 확인하고 다시 계산해 주세요."
        return result
    value = lambda var: saved[var.index]
    result["assignments"] = [{"personId": pid, "tripId": tid, "vehicleId": next((vid for vid in vehicles if (pid, tid, vid) in assignments and value(assignments[pid, tid, vid])), None)} for pid, tid in demands]
    result["reservations"] = [{"tripId": tid, "vehicleId": vid, "count": value(r)} for (tid, vid), r in reserved.items() if value(r)]
    result["usedVehicleIds"] = [vid for vid in vehicles if value(enabled[vid])]
    result["cost"] = sum(v["rentalCost"] for vid, v in vehicles.items() if v["rental"] and value(enabled[vid]))
    result["unassignedCount"] = sum(value(x) for x in unassigned.values())
    result["unreservedCount"] = sum(value(x) for x in shortages.values())
    result["message"] = "최적성 확인" if all_optimal else "시간 내 찾은 배정안 · 최적성 미확인"
    if not quotes_known:
        result["message"] += " · 일부 견적 미확인으로 비용 기준 제외"
    return result


if __name__ == "__main__":
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        print(json.dumps(solve(json.load(sys.stdin)), ensure_ascii=False))
    except (ValueError, KeyError, TypeError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        sys.exit(2)
