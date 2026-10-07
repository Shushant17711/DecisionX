"""Chart contract: sanitize_chart drops anything that does not validate."""

from agents.charts import sanitize_chart, sanitize_charts

GOOD = {
    "type": "bar",
    "title": "  Monthly   cost breakdown  ",
    "unit": "INR",
    "note": "Assumes 200 subscribers.",
    "data": [{"label": "Kitchen", "value": 40000}, {"label": "Delivery", "value": "₹25,000"}],
}


def test_valid_chart_is_cleaned():
    good = sanitize_chart(GOOD)
    assert good and good["title"] == "Monthly cost breakdown"
    assert good["data"][1]["value"] == 25000.0, "numeric strings must coerce"


def test_invalid_charts_are_dropped():
    assert sanitize_chart(None) is None
    assert sanitize_chart({"type": "pie", "title": "x", "data": [{"label": "a", "value": 1}]}) is None
    assert sanitize_chart({"type": "bar", "title": "", "data": [{"label": "a", "value": 1}]}) is None
    assert sanitize_chart({"type": "bar", "title": "t", "data": [{"label": "a", "value": 1}]}) is None
    assert sanitize_chart({"type": "bar", "title": "t",
                           "data": [{"label": "a", "value": 5}, {"label": "b", "value": 5}]}) is None
    assert sanitize_chart({"type": "split", "title": "t",
                           "data": [{"label": "a", "value": -1}, {"label": "b", "value": 5}]}) is None
    assert sanitize_chart({"type": "bar", "title": "t",
                           "data": [{"label": "a", "value": "n/a"}, {"label": "b", "value": 2}]}) is None


def test_duplicate_labels_and_point_cap():
    dup = sanitize_chart({"type": "bar", "title": "t", "data": [
        {"label": "A", "value": 1}, {"label": "a", "value": 9}, {"label": "B", "value": 2}]})
    assert [p["label"] for p in dup["data"]] == ["A", "B"]
    many = sanitize_chart({"type": "line", "title": "t",
                           "data": [{"label": f"M{i}", "value": i} for i in range(20)]})
    assert len(many["data"]) == 8


def test_mixed_scale_bar_rejected_but_line_kept():
    assert sanitize_chart({"type": "bar", "title": "Cost breakdown", "unit": "INR", "data": [
        {"label": "CAC", "value": 40000}, {"label": "Conversion rate", "value": 0.5},
        {"label": "Fee", "value": 12000}]}) is None
    assert sanitize_chart({"type": "line", "title": "Subscribers", "unit": "", "data": [
        {"label": "M1", "value": 3}, {"label": "M6", "value": 900}, {"label": "M12", "value": 12000}]}) is not None


def test_sanitize_charts_list():
    assert sanitize_charts("not a list") == []
    assert len(sanitize_charts([GOOD, GOOD, GOOD], limit=2)) == 2
