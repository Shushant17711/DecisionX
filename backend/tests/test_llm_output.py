"""JSON extraction from messy model output, and normalisation of what it contains."""

import json
import math

import pytest

from agents.llm_client import _extract_json
from agents.validation import (
    coerce_score,
    coerce_str_list,
    json_safe,
    normalize_persona_analysis,
    normalize_synthesis,
)


# ── _extract_json ───────────────────────────────────────────────────────────

def test_plain_and_fenced():
    assert _extract_json('{"a": 1}') == {"a": 1}
    assert _extract_json('```json\n{"a": 1}\n```') == {"a": 1}
    assert _extract_json('```\n{"a": 1}\n```') == {"a": 1}


def test_code_fence_after_prose_and_second_fence():
    text = 'Sure! Here is a sketch:\n```python\nprint("hi")\n```\nAnd the answer:\n```json\n{"score": 7}\n```'
    assert _extract_json(text) == {"score": 7}


def test_trailing_and_leading_commentary():
    assert _extract_json('Here you go: {"a": 2} — hope that helps') == {"a": 2}


def test_brace_in_preamble():
    text = 'Using the {framework} you asked for, my answer is {"score": 6, "verdict": "Cautious"}'
    assert _extract_json(text)["score"] == 6


def test_unbalanced_brace_in_preamble():
    text = 'Note: set {x = 1 first.\n{"score": 4}'
    assert _extract_json(text) == {"score": 4}


def test_brace_inside_string_and_nesting():
    assert _extract_json('{"note": "a } brace in a string", "a": 3}')["a"] == 3
    assert _extract_json('{"nested": {"deep": true}, "a": 4}')["a"] == 4


def test_array_wrapping_single_object_is_unwrapped():
    assert _extract_json('[{"score": 8}]') == {"score": 8}
    assert _extract_json('```json\n[{"score": 8}]\n```') == {"score": 8}


def test_array_of_many_or_scalars_is_a_failure():
    with pytest.raises(json.JSONDecodeError):
        _extract_json("[1, 2, 3]")
    with pytest.raises(json.JSONDecodeError):
        _extract_json('"just a string"')
    with pytest.raises(json.JSONDecodeError):
        _extract_json("")


def test_expected_keys_skip_example_object():
    text = 'Format example: {"example": true}. Answer: {"score": 9, "verdict": "Bullish"}'
    assert _extract_json(text, expect_keys=("score",)) == {"score": 9, "verdict": "Bullish"}
    # Without a match, the first dict still beats failure.
    assert _extract_json('{"other": 1}', expect_keys=("score",)) == {"other": 1}


def test_raw_newline_inside_string_is_tolerated():
    assert _extract_json('{"headline": "line one\nline two", "score": 5}')["score"] == 5


def test_nan_literal_is_parsed_then_sanitised():
    parsed = _extract_json('{"score": NaN, "x": Infinity}')
    assert math.isnan(parsed["score"])
    safe = json_safe(parsed)
    assert safe == {"score": None, "x": None}
    json.dumps(safe, allow_nan=False)


# ── Score / field coercion ──────────────────────────────────────────────────

@pytest.mark.parametrize("raw,expected", [
    (8, 8), (8.0, 8), ("8", 8), ("8/10", 8), ("8 / 10", 8), ("8 out of 10", 8),
    ("7.5", 8), (7.4, 7), ("Score: 6", 6), ("4/5", 8), (0, 1), (10, 10),
])
def test_score_coercion(raw, expected):
    assert coerce_score(raw) == expected


@pytest.mark.parametrize("raw", [None, True, "eight", "", float("nan"), float("inf"), 11, -2, "80%", [], {}])
def test_score_rejection(raw):
    assert coerce_score(raw) is None


def test_list_coercion():
    assert coerce_str_list("one\ntwo\n- three") == ["one", "two", "three"]
    assert coerce_str_list(["a", 3, None, {"text": "b"}, ""]) == ["a", "3", "b"]
    assert coerce_str_list(None) == []
    assert coerce_str_list("single") == ["single"]


def test_persona_normalisation():
    out = normalize_persona_analysis({
        "verdict": "bullish", "score": "9/10", "headline": ["Great", "idea"],
        "strengths": "fast", "concerns": [1, 2], "recommendation": None,
    })
    assert out == {
        "verdict": "Bullish", "score": 9, "headline": "Great; idea", "strengths": ["fast"],
        "concerns": ["1", "2"], "recommendation": "",
    }


def test_persona_normalisation_failures():
    assert normalize_persona_analysis(["not", "a", "dict"])["_failed"]
    assert normalize_persona_analysis({"score": "great"})["_failed"]
    assert normalize_persona_analysis({"score": 7})["_failed"]  # no content at all
    kept = normalize_persona_analysis({"_failed": True, "headline": "x", "_reason": "auth"})
    assert kept["_failed"] and kept["_reason"] == "auth"


def test_verdict_derived_from_score_when_invalid():
    assert normalize_persona_analysis({"score": 3, "headline": "h", "verdict": "Meh"})["verdict"] == "Bearish"


def test_synthesis_normalisation():
    out = normalize_synthesis({
        "overall_score": "7.26/10", "verdict": "no go", "strengths": "s", "weaknesses": [],
        "disagreements": [{"topic": "Cost", "sides": {"A": "cheap", "B": 2}}, "Timing", 5],
    })
    assert out["overall_score"] == 7.3 and out["verdict"] == "No-Go"
    assert out["disagreements"][0]["sides"] == {"A": "cheap", "B": "2"}
    assert out["disagreements"][1]["topic"] == "Timing" and len(out["disagreements"]) == 2
    assert normalize_synthesis({"overall_score": "n/a", "strengths": ["s"]}) is None
    assert normalize_synthesis({"overall_score": 7, "strengths": []}) is None
    assert normalize_synthesis({"overall_score": 7, "strengths": ["s"], "_failed": True}) is None
