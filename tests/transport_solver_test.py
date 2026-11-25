import copy
import importlib.util
from pathlib import Path
import unittest


def solver():
    path = Path(__file__).resolve().parents[1] / "scripts" / "transport_solver.py"
    spec = importlib.util.spec_from_file_location("transport_solver", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.solve


def fixture():
    return {
        "revision": 1, "objective": "cost", "extraCount": 0,
        "extraOutboundTripId": "out", "extraReturnTripId": "back", "locks": [], "previousAssignments": [],
        "trips": [
            {"id": "out", "label": "본대", "direction": "outbound", "start": 600, "end": 720},
            {"id": "back", "label": "정상 귀가", "direction": "return", "start": 1980, "end": 2100}],
        "people": [{"id": "P1", "name": "가상1", "department": "장년부", "familyId": "", "companionGroup": "", "outboundTripId": "out", "returnTripId": "back"}],
        "vehicles": [{"id": "V1", "label": "버스", "capacity": 2, "driverId": None, "externalDriverConfirmed": True, "rental": True, "rentalCost": 100, "enabled": True, "tripIds": ["out", "back"]}],
    }


class TransportSolverTests(unittest.TestCase):
    def test_complete_roundtrip(self):
        result = solver()(fixture())
        self.assertIn(result["status"], ["optimal", "feasible"])
        self.assertEqual(result["unassignedCount"], 0)
        self.assertEqual(len(result["assignments"]), 2)
        self.assertEqual(result["cost"], 100)

    def test_additional_reservations_do_not_create_people(self):
        data = fixture(); data["extraCount"] = 2
        result = solver()(data)
        self.assertEqual(len(result["assignments"]), 2)
        self.assertEqual(result["unreservedCount"], 2)

    def test_late_arrival_needs_return_seat(self):
        data = fixture(); data["people"][0]["outboundTripId"] = None
        result = solver()(data)
        self.assertEqual(len(result["assignments"]), 1)
        self.assertEqual(result["assignments"][0]["tripId"], "back")

    def test_unavailable_return_cannot_reuse_early_car(self):
        data = fixture(); data["vehicles"][0]["tripIds"] = ["out"]
        result = solver()(data)
        self.assertEqual(result["unassignedCount"], 1)
        self.assertIsNone(next(x for x in result["assignments"] if x["tripId"] == "back")["vehicleId"])

    def test_lock_over_capacity_is_infeasible_not_relaxed(self):
        data = fixture(); data["vehicles"][0]["capacity"] = 1
        person = copy.deepcopy(data["people"][0]); person["id"] = "P2"; data["people"].append(person)
        data["locks"] = [{"personId": p, "tripId": "out", "vehicleId": "V1"} for p in ["P1", "P2"]]
        result = solver()(data)
        self.assertEqual(result["status"], "infeasible")

    def test_companion_group_is_not_split(self):
        data = fixture(); data["people"][0]["companionGroup"] = "G1"
        other = copy.deepcopy(data["people"][0]); other["id"] = "P2"; data["people"].append(other)
        data["vehicles"][0]["capacity"] = 1
        second = copy.deepcopy(data["vehicles"][0]); second["id"] = "V2"; data["vehicles"].append(second)
        result = solver()(data)
        self.assertEqual(result["unassignedCount"], 4)

    def test_driver_consumes_a_seat_and_must_ride_the_vehicle(self):
        data = fixture(); data["vehicles"][0]["driverId"] = "P1"; data["vehicles"][0]["capacity"] = 1
        data["extraCount"] = 1
        result = solver()(data)
        self.assertEqual(result["unassignedCount"], 0)
        self.assertEqual(result["unreservedCount"], 2)

    def test_cheaper_feasible_vehicle_is_selected(self):
        data = fixture(); other = copy.deepcopy(data["vehicles"][0]); other["id"] = "V2"; other["rentalCost"] = 50
        data["vehicles"].append(other)
        result = solver()(data)
        self.assertEqual(result["cost"], 50)
        self.assertEqual(result["usedVehicleIds"], ["V2"])

    def test_missing_quotes_do_not_participate_in_cost_optimization(self):
        data = fixture()
        other = copy.deepcopy(data["vehicles"][0])
        other.update(id="V2", rentalCost=0)
        data["vehicles"].append(other)
        result = solver()(data)
        self.assertEqual(result["unassignedCount"], 0)
        self.assertIn("비용 기준 제외", result["message"])
        other["rentalQuoteKnown"] = True
        confirmed = solver()(data)
        self.assertEqual(confirmed["usedVehicleIds"], ["V2"])
        self.assertNotIn("비용 기준 제외", confirmed["message"])

    def test_preserve_mode_prioritizes_existing_assignments_over_cost_savings(self):
        data = fixture(); other = copy.deepcopy(data["vehicles"][0]); other["id"] = "V2"; other["rentalCost"] = 50
        data["vehicles"].append(other)
        data["previousAssignments"] = [{"personId": "P1", "tripId": t, "vehicleId": "V1"} for t in ["out", "back"]]
        result = solver()(data)
        self.assertEqual(result["cost"], 100)
        self.assertTrue(all(a["vehicleId"] == "V1" for a in result["assignments"]))

    def test_vehicle_cannot_depart_twice_in_one_direction(self):
        data = fixture(); data["trips"].append({"id": "advance", "label": "선발", "direction": "outbound", "start": 400, "end": 500})
        other = copy.deepcopy(data["people"][0]); other["id"] = "P2"; other["outboundTripId"] = "advance"; data["people"].append(other)
        data["vehicles"][0]["tripIds"].append("advance")
        result = solver()(data)
        self.assertEqual(result["unassignedCount"], 1)

    def test_rejects_malformed_input(self):
        data = fixture(); data["vehicles"][0]["capacity"] = -3
        with self.assertRaises(ValueError): solver()(data)

    def test_does_not_solve_with_unset_or_over_total_seats(self):
        for seats in (
            {"capacity": 0, "totalSeats": 5},
            {"capacity": 2, "totalSeats": 0},
            {"capacity": 6, "totalSeats": 5},
            {"capacity": 2, "vehicleType": "car-5"},
        ):
            with self.subTest(seats=seats):
                data = fixture()
                data["vehicles"][0].update(seats)
                with self.assertRaisesRegex(ValueError, "좌석"):
                    solver()(data)

    def test_uses_allocatable_seats_not_total_seats(self):
        data = fixture(); data["extraCount"] = 2
        data["vehicles"][0]["totalSeats"] = 5
        result = solver()(data)
        self.assertEqual(result["unreservedCount"], 2)

    def test_vehicle_without_confirmed_driver_is_not_used(self):
        data = fixture(); data["vehicles"][0]["externalDriverConfirmed"] = False
        result = solver()(data)
        self.assertEqual(result["unassignedCount"], 2)
        self.assertEqual(result["usedVehicleIds"], [])

    def test_rejects_companions_on_conflicting_trips(self):
        data = fixture(); data["people"][0]["companionGroup"] = "G1"
        data["trips"].append({"id": "advance", "label": "선발", "direction": "outbound", "start": 400, "end": 500})
        other = copy.deepcopy(data["people"][0]); other["id"] = "P2"; other["outboundTripId"] = "advance"; data["people"].append(other)
        with self.assertRaises(ValueError): solver()(data)

    def test_rejects_overlapping_virtual_travel(self):
        data = fixture(); data["people"][0]["returnTripId"] = None; data["extraCount"] = 1
        data["trips"][1]["start"] = 650; data["trips"][1]["end"] = 800
        with self.assertRaises(ValueError): solver()(data)

    def test_outbound_companions_can_use_different_return_trips(self):
        data = fixture(); data["people"][0]["outboundCompanionGroup"] = "G1"; data["people"][0]["returnCompanionGroup"] = ""
        data["trips"].append({"id": "early", "label": "사전 귀가", "direction": "return", "start": 1600, "end": 1700})
        other = copy.deepcopy(data["people"][0]); other["id"] = "P2"; other["returnTripId"] = "early"; data["people"].append(other)
        data["vehicles"][0]["tripIds"].append("early")
        vehicle = copy.deepcopy(data["vehicles"][0]); vehicle["id"] = "V2"; data["vehicles"].append(vehicle)
        result = solver()(data)
        self.assertEqual(result["unassignedCount"], 0)
        self.assertEqual(len({a["vehicleId"] for a in result["assignments"] if a["tripId"] == "out"}), 1)


if __name__ == "__main__":
    unittest.main()
