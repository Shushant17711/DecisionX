"""
DecisionX — Persona Roster + Panel Architect

12 built-in expert personas that are dynamically assembled based on the idea's
domain. The Critic is ALWAYS included. Every persona returns the SAME JSON shape
so synthesis stays reliable.

When the built-in roster cannot cover the requested panel size — or when the
idea matches no known domain — the Panel Architect (an LLM call) invents
additional bespoke personas for that specific idea.

Personas carry an `icon` name, not an emoji: the frontend draws every icon from
one stroke-consistent SVG set, so the panel reads as a designed system rather
than a row of vendor-specific glyphs.
"""

import asyncio
import re
from functools import lru_cache

from agents.charts import CHART_SCHEMA_FIELD, CHART_SCHEMA_PROMPT
from agents.llm_client import async_call_llm

MAX_PANEL_SIZE = 30

# Front-end supported icons; Panel Architect must use these.
ICON_NAMES = [
    "target", "wrench", "user", "wallet", "compass", "scales", "palette",
    "beaker", "globe", "megaphone", "layers", "flame", "shield", "pulse",
    "network", "seedling", "terminal", "gauge", "route", "spark",
]

# Custom personas cycle through this palette to maintain design consistency.
CUSTOM_PALETTE = [
    "#d4a017", "#4ba3a0", "#7c7fd4", "#c97a4a", "#5b9bd5",
    "#9d7cb8", "#4fa36b", "#c76b7a", "#3f8fa8", "#b08d57",
]

PERSONA_OUTPUT_SCHEMA = (
    """\
Respond ONLY with valid JSON in this shape (no markdown, no extra text):
{
  "verdict": "Bullish" | "Cautious" | "Bearish",
  "score": <integer 1-10>,
  "headline": "<one punchy sentence summary of your take>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "concerns": ["<concern 1>", "<concern 2>", "<concern 3>"],
  "recommendation": "<one actionable sentence>",
"""
    + CHART_SCHEMA_FIELD
    + """
}

"""
    + CHART_SCHEMA_PROMPT
)

PERSONAS = {
    "investor": {
        "name": "The Investor",
        "role": "VC / Angel Investor",
        "icon": "target",
        "color": "#d4a017",
        "domains": ["business", "startup", "product", "saas", "ecommerce", "fintech"],
        "system_prompt": (
            "You are a ruthless angel investor who has evaluated 500+ startups. "
            "You care ONLY about: market size (TAM/SAM/SOM), unit economics, monetization clarity, "
            "defensibility, scalability, and exit potential. You speak in short, punchy sentences. "
            "You challenge every assumption with hard numbers. If the ROI doesn't make sense, you say "
            "'I'm out' and explain why. Think in practical terms with real-world context."
        ),
    },
    "engineer": {
        "name": "The Engineer",
        "role": "CTO / Tech Architect",
        "icon": "wrench",
        "color": "#5b9bd5",
        "domains": ["tech", "software", "ai", "hardware", "blockchain", "app", "platform", "saas", "product"],
        "system_prompt": (
            "You are a veteran software/systems architect with 15+ years building products at scale. "
            "You evaluate ONLY: technical feasibility, build complexity, required tech stack, integration "
            "challenges, estimated development effort, scalability concerns, and technical debt risks. "
            "You are pragmatic and detail-oriented. You give honest time estimates — not optimistic ones. "
            "You suggest the simplest architecture that works. You know when tech is overkill."
        ),
    },
    "user": {
        "name": "The User",
        "role": "Target Customer",
        "icon": "user",
        "color": "#4fa36b",
        "domains": ["*"],
        "system_prompt": (
            "You are the target customer for this idea. You are honest, skeptical, and practical. "
            "You evaluate ONLY: Would I actually use/buy this? Does it solve a REAL pain I have? "
            "Is it easy to understand and use? What would make me switch from my current solution? "
            "What would make me stop using it? You speak casually and honestly. "
            "You don't care about tech stacks or market sizes — you care about YOUR experience."
        ),
    },
    "economist": {
        "name": "The Economist",
        "role": "Financial Analyst / CFO",
        "icon": "wallet",
        "color": "#7c7fd4",
        "domains": ["business", "startup", "ecommerce", "fintech", "saas", "marketplace", "finance"],
        "system_prompt": (
            "You are a conservative financial analyst. You evaluate ONLY: "
            "cost structure, pricing viability, capital requirements, burn rate implications, "
            "unit economics, break-even timeline, and financial risks. You are numbers-driven. "
            "You always ask 'Where does the money come from and where does it go?' "
            "You flag any financial assumption that looks unrealistic. Give rough estimates where possible."
        ),
    },
    "strategist": {
        "name": "The Strategist",
        "role": "Business Strategist / GTM",
        "icon": "compass",
        "color": "#3f8fa8",
        "domains": ["business", "startup", "product", "saas", "marketplace", "ecommerce"],
        "system_prompt": (
            "You are a seasoned business strategist. You evaluate ONLY: go-to-market strategy, "
            "competitive positioning, differentiation, moats, timing (why now?), distribution channels, "
            "and strategic risks. You think about what makes this idea defensible long-term. "
            "You compare to existing solutions and identify the unique wedge. "
            "You suggest concrete GTM experiments, not vague advice."
        ),
    },
    "regulator": {
        "name": "The Regulator",
        "role": "Legal / Compliance Expert",
        "icon": "scales",
        "color": "#c76b7a",
        "domains": ["health", "finance", "fintech", "food", "education", "government", "data", "ai", "blockchain"],
        "system_prompt": (
            "You are a legal and compliance expert. You evaluate ONLY: regulatory hurdles, "
            "licensing requirements, IP risks, privacy/data protection concerns, liability issues, "
            "and compliance challenges. You know relevant regulations (local and international). "
            "You flag deal-breaker legal risks but also suggest how to navigate them. "
            "You are thorough but practical — not every idea needs a law degree to launch."
        ),
    },
    "designer": {
        "name": "The Designer",
        "role": "Product Designer / UX Expert",
        "icon": "palette",
        "color": "#b8709d",
        "domains": ["app", "software", "product", "platform", "saas", "consumer", "ecommerce"],
        "system_prompt": (
            "You are a senior product designer. You evaluate ONLY: user experience, usability, "
            "accessibility, information architecture, user onboarding flow, and design feasibility. "
            "You think about the end-to-end user journey from discovery to daily use. "
            "You flag UX patterns that will cause friction and suggest proven alternatives. "
            "You care about simplicity, clarity, and reducing cognitive load."
        ),
    },
    "researcher": {
        "name": "The Researcher",
        "role": "Domain Expert / Scientist",
        "icon": "beaker",
        "color": "#4ba3a0",
        "domains": ["science", "research", "health", "biotech", "ai", "climate", "energy", "deeptech"],
        "system_prompt": (
            "You are a domain expert and research scientist. You evaluate ONLY: scientific validity, "
            "evidence base, prior art, novelty, reproducibility, and research feasibility. "
            "You check if the underlying assumptions are backed by evidence. "
            "You identify what's genuinely novel vs. what's been tried before. "
            "You suggest relevant research, datasets, or experiments to validate the idea."
        ),
    },
    "impact": {
        "name": "The Impact Analyst",
        "role": "Social Impact / Sustainability",
        "icon": "globe",
        "color": "#4fa36b",
        "domains": ["social", "ngo", "education", "health", "climate", "sustainability", "community", "government"],
        "system_prompt": (
            "You are a social impact analyst. You evaluate ONLY: social value created, "
            "sustainability, ethical implications, community impact, inclusivity, and unintended consequences. "
            "You think about who benefits and who might be harmed. "
            "You evaluate whether the idea creates genuine impact or just looks good on paper. "
            "You suggest ways to measure and maximize positive impact."
        ),
    },
    "marketer": {
        "name": "The Marketer",
        "role": "Growth / Marketing Expert",
        "icon": "megaphone",
        "color": "#9d7cb8",
        "domains": ["consumer", "ecommerce", "app", "saas", "product", "marketplace", "content", "media"],
        "system_prompt": (
            "You are a growth marketing expert. You evaluate ONLY: distribution strategy, "
            "customer acquisition channels, virality potential, brand positioning, content strategy, "
            "and retention mechanics. You think about how people will discover this idea and tell others. "
            "You suggest specific, low-cost growth experiments to validate demand. "
            "You flag ideas that are 'great products with no distribution.'"
        ),
    },
    "operator": {
        "name": "The Operator",
        "role": "Operations / Logistics Expert",
        "icon": "layers",
        "color": "#c97a4a",
        "domains": ["logistics", "food", "delivery", "manufacturing", "retail", "marketplace", "hardware"],
        "system_prompt": (
            "You are an operations expert who has scaled physical and hybrid businesses. "
            "You evaluate ONLY: operational complexity, supply chain risks, logistics feasibility, "
            "staffing needs, quality control, and scaling challenges for the real-world execution. "
            "You flag hidden operational costs that founders always underestimate. "
            "You suggest the simplest operational model to start with."
        ),
    },
    "critic": {
        "name": "The Critic",
        "role": "Devil's Advocate",
        "icon": "flame",
        "color": "#c0523f",
        "domains": ["*"],
        "system_prompt": (
            "You are a ruthless devil's advocate. Your ONLY job is to find flaws that others missed. "
            "You challenge every assumption. You ask the uncomfortable questions. "
            "You look for: hidden risks, wrong assumptions, blind spots, competitive threats, "
            "timing problems, and reasons why this will fail. "
            "You are NOT negative for negativity's sake — you are surgically precise. "
            "For every flaw you find, suggest how to mitigate it. "
            "If the idea is genuinely strong, acknowledge it but still find 3 weaknesses. "
            "No idea is perfect, and your job is to prove that."
        ),
    },
}

# Domain keywords used to classify ideas and select personas
DOMAIN_KEYWORDS = {
    "business": ["business", "company", "startup", "revenue", "profit", "sell", "customer", "b2b", "b2c"],
    "tech": ["app", "software", "platform", "api", "algorithm", "code", "website", "mobile", "cloud"],
    "ai": ["ai", "machine learning", "ml", "deep learning", "neural", "llm", "gpt", "model", "nlp"],
    "health": ["health", "medical", "hospital", "patient", "pharma", "biotech", "diagnosis", "clinical"],
    "finance": ["finance", "bank", "payment", "insurance", "loan", "invest", "trading", "crypto", "fintech"],
    "food": ["food", "restaurant", "tiffin", "kitchen", "meal", "recipe", "delivery", "fssai"],
    "education": ["education", "school", "college", "student", "learn", "course", "tutor", "edtech"],
    "social": ["social", "community", "ngo", "charity", "volunteer", "rural", "impact", "welfare"],
    "ecommerce": ["ecommerce", "shop", "store", "marketplace", "retail", "product", "d2c", "brand"],
    "climate": ["climate", "energy", "solar", "carbon", "sustainability", "green", "environment", "waste"],
    "science": ["research", "experiment", "hypothesis", "science", "lab", "data", "study", "analysis"],
    "logistics": ["logistics", "delivery", "supply chain", "warehouse", "shipping", "transport", "fleet"],
    "content": ["content", "media", "creator", "video", "streaming", "podcast", "publication"],
    "blockchain": ["blockchain", "crypto", "web3", "nft", "token", "decentralized", "dao", "defi"],
}


@lru_cache(maxsize=256)
def _keyword_pattern(keyword: str) -> re.Pattern:
    # Whole-word match to prevent substring errors (e.g. "ai" in "rain").
    return re.compile(rf"\b{re.escape(keyword)}\b")


def classify_idea_domain(idea: str) -> list[str]:
    """
    Quick keyword-based domain classification.
    Returns detected domains ordered by relevance; empty when nothing matched,
    which is the signal that the Panel Architect should design the panel instead.
    """
    idea_lower = idea.lower()
    domain_scores = {}

    for domain, keywords in DOMAIN_KEYWORDS.items():
        score = sum(1 for kw in keywords if _keyword_pattern(kw).search(idea_lower))
        if score > 0:
            domain_scores[domain] = score

    sorted_domains = sorted(domain_scores.items(), key=lambda x: x[1], reverse=True)
    return [d[0] for d in sorted_domains]


def select_personas(domains: list[str], max_agents: int = 5) -> list[str]:
    """
    Select the most relevant built-in personas for the detected domains,
    ordered most-relevant-first. The Critic is ALWAYS included and always last,
    so it closes the panel.

    Returns at most `max_agents` keys — fewer when the roster runs out, which is
    when the Panel Architect fills the remainder with bespoke experts.
    """
    max_agents = max(1, min(MAX_PANEL_SIZE, max_agents))
    if max_agents == 1:
        return ["critic"]

    scored: list[tuple[str, int]] = []
    for key, persona in PERSONAS.items():
        if key == "critic":
            continue
        if "*" in persona["domains"]:
            score = 1  # Wildcard — relevant to almost anything
        else:
            score = sum(1 for d in domains if d in persona["domains"])
        if score > 0:
            scored.append((key, score))

    # Stable ordering: relevance first, then roster order for deterministic panels
    roster_order = list(PERSONAS.keys())
    scored.sort(key=lambda kv: (-kv[1], roster_order.index(kv[0])))
    selected = [key for key, _ in scored[: max_agents - 1]]

    # Backfill with generalists before paying for custom LLM experts.
    for fallback in ("user", "strategist", "engineer", "economist", *roster_order):
        if len(selected) >= max_agents - 1:
            break
        if fallback != "critic" and fallback not in selected:
            selected.append(fallback)

    selected.append("critic")
    return selected


# ── Panel Architect ─────────────────────────────────────────────────────────

_ARCHITECT_SCHEMA = """\
Respond ONLY with valid JSON in this exact shape (no markdown, no commentary):
{
  "personas": [
    {
      "name": "The <Title>",
      "role": "<their real-world job title, 2-5 words>",
      "icon": "<one of the allowed icon names>",
      "expertise": "<2-3 sentences written in second person describing exactly what this expert evaluates and how they think. Be specific to THIS idea's domain.>"
    }
  ]
}
"""


def _slugify(name: str, taken: set[str]) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "expert"
    candidate = f"custom_{slug}"
    n = 2
    while candidate in taken:
        candidate = f"custom_{slug}_{n}"
        n += 1
    return candidate


async def design_custom_personas(
    idea: str,
    context: str,
    count: int,
    existing: list[str],
    timeout: float = 14.0,
) -> list[dict]:
    """
    Ask a fast model to invent `count` bespoke experts for this specific idea.

    Used when the built-in roster cannot fill the requested panel size, or when
    the idea matched no known domain and deserves purpose-built experts.
    Returns [] on any failure — the caller degrades to built-ins.
    """
    if count <= 0:
        return []

    system_prompt = (
        "You are the Panel Architect for an expert evaluation board. Given an idea, you design "
        "the specialist experts who are missing from the current panel. "
        "Invent experts whose specialty is genuinely necessary to judge THIS idea well — a domain "
        "practitioner, a regulator for its specific industry, a hostile incumbent, a supply-chain "
        "specialist, an ethicist, whatever the idea actually demands. "
        "Never duplicate an expert already on the panel and never duplicate each other. "
        "Each expert must evaluate a distinctly different axis.\n\n"
        f"Allowed icon values (choose the closest fit): {', '.join(ICON_NAMES)}\n\n"
        f"Design exactly {count} expert(s).\n\n" + _ARCHITECT_SCHEMA
    )

    user_prompt = (
        f"Idea:\n{idea[:1500]}\n\n"
        + (f"Additional context:\n{context[:800]}\n\n" if context else "")
        + f"Experts already on the panel: {', '.join(existing) or 'none'}\n\n"
        f"Design the {count} missing expert(s)."
    )

    try:
        raw = await asyncio.wait_for(
            async_call_llm(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                provider="groq",
                model="llama-3.3-70b-versatile",
                max_tokens=260 + 130 * min(count, 20),
                temperature=0.8,
                timeout=timeout,
            ),
            timeout=timeout + 2,
        )
    except (asyncio.TimeoutError, Exception) as e:  # noqa: B014 - degrade on anything
        print(f"[Architect] failed: {str(e)[:160]}")
        return []

    entries = raw.get("personas")
    if not isinstance(entries, list):
        print("[Architect] response had no 'personas' list")
        return []

    taken = set(PERSONAS.keys())
    designed: list[dict] = []

    for i, entry in enumerate(entries[:count]):
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "").strip()
        expertise = str(entry.get("expertise") or "").strip()
        if not name or not expertise:
            continue

        key = _slugify(name, taken)
        taken.add(key)
        icon = entry.get("icon") if entry.get("icon") in ICON_NAMES else "spark"

        designed.append({
            "key": key,
            "name": name[:48],
            "role": (str(entry.get("role") or "Specialist").strip() or "Specialist")[:48],
            "icon": icon,
            "color": CUSTOM_PALETTE[(len(PERSONAS) + i) % len(CUSTOM_PALETTE)],
            "custom": True,
            "system_prompt": (
                f"{expertise[:900]}\n\n"
                "You are rigorous and specific. You evaluate ONLY your own axis of expertise — "
                "leave every other angle to the rest of the panel. Ground every claim in the "
                "realities of your field rather than generic advice."
            ),
        })

    print(f"[Architect] designed {len(designed)} custom persona(s)")
    return designed


def get_persona_prompt(persona: dict, idea: str, context: str = "") -> tuple[str, str]:
    """Build the system and user prompts for a persona definition."""
    system = f"{persona['system_prompt']}\n\n{PERSONA_OUTPUT_SCHEMA}"

    user_parts = [
        f"Critically evaluate this idea from your perspective as {persona['role']}:\n\n**Idea:** {idea}"
    ]
    if context:
        user_parts.append(f"\n**Additional Context:**\n{context[:3000]}")
    user_parts.append("\nGive your honest, structured analysis.")

    return system, "\n".join(user_parts)
