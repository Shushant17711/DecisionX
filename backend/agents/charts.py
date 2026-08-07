"""
DecisionX — Chart contract

An expert may attach ONE chart to its analysis when the point it is making is
genuinely quantitative. Everything here exists to keep a small, fast model from
putting a confident-looking graph in front of the user when it has nothing to
plot: the schema is deliberately narrow, and `sanitize_chart` drops anything
that does not survive validation rather than passing it through half-formed.

Every number a chart carries is the model's own estimate, never a measurement.
The frontend labels it as such — see components/ChartTile.tsx.

Three forms, all single-series, chosen so the reader's job picks the form:
  bar   — compare magnitude across categories
  line  — a trend over an ordered axis (time, stages, volume)
  split — part-to-whole, drawn as one stacked horizontal bar
"""

import math

CHART_TYPES = ("bar", "line", "split")

MAX_POINTS = 8
MIN_POINTS = 2
MAX_LABEL = 28
MAX_TITLE = 80
MAX_NOTE = 160
MAX_UNIT = 8

# Field must be INSIDE the schema shape or models will drop it.
CHART_SCHEMA_FIELD = """\
  "chart": {          // OPTIONAL — see rules below. Omit the key when they don't apply.
    "type": "bar" | "line" | "split",
    "title": "<what the chart shows, under 80 chars>",
    "unit": "<short unit: %, INR, hrs, users — or empty string>",
    "note": "<the key assumption these numbers rest on, one short sentence>",
    "data": [{"label": "<short category>", "value": <number>}, ...]
  }"""

CHART_SCHEMA_PROMPT = """\
Rules for the optional "chart" field:
  - Omit it by default. Most experts should not include one. Only add a chart
    when the numbers are squarely inside YOUR OWN expertise and seeing them
    plotted tells the reader something the sentences cannot.
  - EVERY value must be the same unit and the same kind of quantity. Never mix
    rupees with percentages, counts with rates, or totals with per-unit figures
    in one chart. If two measures are on different scales, drop one.
  - Do not restate figures already given in the brief; a chart that repeats the
    inputs back adds nothing. Do not invent numbers to fill the field.
  - "type": bar = compare amounts across categories. line = a trend across an
    ordered axis (months, stages, volume). split = parts of one whole, which
    must sum to that whole and contain no negatives.
  - "data": between 2 and 8 points, ordered the way they should be read, with
    labels under 28 characters. The values must differ from each other.
"""

# Wild spread in bar charts usually indicates a dual-scale mistake.
MAX_BAR_MAGNITUDE_SPREAD = 100


def _clean_text(value, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit].strip()


def _coerce_number(value):
    """Accept ints, floats, and the numeric strings models like to emit."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        cleaned = value.strip().replace(",", "").replace("%", "")
        # Strip a leading currency symbol or code the model tacked on
        for prefix in ("₹", "$", "€", "£", "INR", "USD", "Rs.", "Rs"):
            if cleaned.startswith(prefix):
                cleaned = cleaned[len(prefix) :].strip()
        try:
            number = float(cleaned)
        except ValueError:
            return None
    else:
        return None

    if math.isnan(number) or math.isinf(number):
        return None
    return round(number, 4)


def sanitize_chart(raw) -> dict | None:
    """
    Validate a model-authored chart. Returns a clean chart dict, or None when it
    is missing, malformed, or too thin to be worth drawing.
    """
    if not isinstance(raw, dict):
        return None

    chart_type = raw.get("type")
    if chart_type not in CHART_TYPES:
        return None

    title = _clean_text(raw.get("title"), MAX_TITLE)
    if not title:
        return None

    points_raw = raw.get("data")
    if not isinstance(points_raw, list):
        return None

    points = []
    seen_labels = set()
    for item in points_raw:
        if not isinstance(item, dict):
            continue
        label = _clean_text(item.get("label"), MAX_LABEL)
        value = _coerce_number(item.get("value"))
        if not label or value is None:
            continue
        # A repeated category means the model lost track of its own axis.
        key = label.lower()
        if key in seen_labels:
            continue
        seen_labels.add(key)
        points.append({"label": label, "value": value})
        if len(points) >= MAX_POINTS:
            break

    if len(points) < MIN_POINTS:
        return None

    # A flat series carries no information a sentence could not carry better.
    values = [p["value"] for p in points]
    if all(v == values[0] for v in values):
        return None

    if chart_type == "split":
        # Part-to-whole is meaningless with negatives or an empty whole.
        if any(v < 0 for v in values) or sum(values) <= 0:
            return None

    if chart_type == "bar" and len(values) >= 3:
        magnitudes = [abs(v) for v in values if v != 0]
        if magnitudes and max(magnitudes) / min(magnitudes) > MAX_BAR_MAGNITUDE_SPREAD:
            # Reject mixed-scale bars; small bars are invisible.
            return None

    return {
        "type": chart_type,
        "title": title,
        "unit": _clean_text(raw.get("unit"), MAX_UNIT),
        "note": _clean_text(raw.get("note"), MAX_NOTE),
        "data": points,
    }


def sanitize_charts(raw, limit: int = 2) -> list[dict]:
    """Validate a list of charts, dropping the ones that fail."""
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        chart = sanitize_chart(item)
        if chart:
            out.append(chart)
        if len(out) >= limit:
            break
    return out
