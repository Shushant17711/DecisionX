# DecisionX

DecisionX is a generalized, multi-agent idea evaluation platform designed to simulate a structured expert boardroom for evaluating business, technical, research, product, and creative ideas.

Instead of relying on a single AI response, DecisionX assembles multiple specialized AI experts, gives each expert an independent perspective, and then uses a dedicated synthesis agent to combine their opinions into a final decision-oriented report.

The goal is simple:

> **Don't just ask AI whether an idea is good. Ask multiple experts why it might succeed, why it might fail, and what you should do next.**

![Dashboard Image](images/Dashboard_image.png)
*Main Screen UI - Dashboard*

![Result Page Image](images/Result_page.png)
*Result Page - Boardroom Verdict and individual expert cards*

---

## 📑 Table of Contents

* [Why DecisionX?](#-why-decisionx)
* [Getting Started](#-getting-started)
* [How It Works](#-how-it-works)
* [Features](#-features)
* [Architecture](#️-architecture)
* [LLM Provider Architecture](#-llm-provider-architecture)
* [Project Structure](#-project-structure)
* [Tech Stack](#-tech-stack)
* [Example Use Cases](#-example-use-cases)
* [API Reference](#-api-reference)
* [API Key Security](#-api-key-security)
* [Configuration](#️-configuration)
* [Omarchy / Hyprland launcher](#️-omarchy--hyprland-launcher)
* [Troubleshooting](#-troubleshooting)
* [Current Limitations](#-current-limitations)
* [Roadmap](#️-roadmap)
* [Contributing](#-contributing)
* [Disclaimer](#️-disclaimer)
* [Vision](#-vision)
* [Credits](#-credits)
* [License](#-license)
* [Support the Project](#-support-the-project)

---

## 🎯 Why DecisionX?

Traditional AI chat interfaces generally provide a single perspective. While this can be useful for brainstorming, important decisions often require multiple viewpoints.

For example, a startup idea might look attractive from an investor's perspective but have serious technical limitations. Similarly, a technically impressive product might have weak market demand.

DecisionX addresses this problem by creating a virtual panel containing different expert perspectives.

A typical panel can include:

* 💰 Investor: financial potential and investment attractiveness
* 🏗️ Engineer: technical feasibility
* 👤 User: whether the target customer actually wants it
* 📊 Strategist: go-to-market and competition
* ⚖️ Regulator: legal and compliance risk
* 🧠 Critic: challenges the assumptions everyone else makes

The final decision is not based on one agent's opinion. Instead, DecisionX looks for **patterns, disagreements, risks, and opportunities across the entire panel**.

---

## 🚀 Getting Started

### Prerequisites

| Tool | Version |
| --- | --- |
| Python | 3.12 or newer |
| Node.js | 20 or newer (with npm) |
| Git | any recent version |
| API key | at least one **Groq** key (free at [console.groq.com](https://console.groq.com/keys)). NVIDIA and OpenRouter keys are optional. |

### 1. Clone the repository

```bash
git clone https://github.com/Shushant17711/DecisionX.git
cd DecisionX
```

### 2. Add your API keys

Keys go in plain text files inside `backend/`, **one key per line** (no quotes, no `KEY=` prefix). Empty files are already included; paste your keys into them:

| File | Provider | Needed? |
| --- | --- | --- |
| `backend/groqapi` | [Groq](https://console.groq.com/keys) | **Yes**: runs the Panel Architect and every expert |
| `backend/nvidiaapi` | [NVIDIA](https://build.nvidia.com/) | Optional: first synthesis fallback |
| `backend/openrouterapi` | [OpenRouter](https://openrouter.ai/keys) | Optional: last synthesis fallback |

```bash
printf '%s\n' "gsk_your_key_here" > backend/groqapi
```

You can put several keys in one file. DecisionX rotates through them, and a key that returns 401/403 is skipped for the rest of the run. Lines starting with `#` are ignored.

### 3. (Optional) Settings

* `backend/.env`: backend settings. It's empty by default, so every setting uses its default value. See the **Configuration** section below and `backend/.env.example`.
* `frontend/.env.local`: set `NEXT_PUBLIC_API_BASE=` only if the backend is not at `http://localhost:8001`.

### 4. Run it

**Linux / macOS**

```bash
./start_dev.sh
```

**Windows**

```bat
start_dev.bat
```

The script creates `.venv/`, installs the backend requirements, runs `npm install` in `frontend/` on first use, and starts both servers:

* Frontend: <http://localhost:3000>
* Backend health check: <http://127.0.0.1:8001/api/health>

Press `Ctrl+C` to stop both servers (Linux/macOS). On Windows, close the two server windows.

### Manual setup (without the scripts)

```bash
# Backend
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
cd backend
uvicorn main:app --host 127.0.0.1 --port 8001 --reload

# Frontend (second terminal)
cd frontend
npm install
npm run dev
```

For a production build of the frontend, run `npm run build && npm run start`.

### Check that it works

```bash
curl http://127.0.0.1:8001/api/health
```

`providers` should list `groq`. If it's empty, the backend found no keys. Then open <http://localhost:3000>, type an idea, choose a panel size and press evaluate. To see the interface without any API key, load the built-in sample evaluation (`frontend/public/demo-evaluation.json`).

---

## 🧠 How It Works

```text
Idea + context + files
    │
    ▼
1. Read        long documents are condensed into a shared digest (only when needed)
    │
    ▼
2. Classify    keyword match against known domains (no LLM call)
    │
    ▼
3. Assemble    built-in experts for those domains + the Critic;
    │          the Panel Architect designs custom experts when needed
    ▼
4. Evaluate    every expert runs in parallel and returns structured JSON
    │
    ▼
5. Synthesize  the Boardroom Synthesizer merges the panel into one verdict
    │
    ▼
Go / Caution / No-Go, score, SWOT, disagreements, 7- and 30-day action plans
```

### 1. Submit an idea

Describe the idea (up to 4,000 characters). You can also add context such as success criteria, constraints or a target audience (up to 12,000 characters), and attach up to 8 files (PDF, DOCX, XLSX, CSV, TXT). Choose a panel size from 1 to 30 experts.

### 2. The panel is assembled

DecisionX has **12 built-in experts**:

| Expert | Role |
| --- | --- |
| The Investor | VC / Angel Investor |
| The Engineer | CTO / Tech Architect |
| The User | Target Customer |
| The Economist | Financial Analyst / CFO |
| The Strategist | Business Strategist / GTM |
| The Regulator | Legal / Compliance Expert |
| The Designer | Product Designer / UX Expert |
| The Researcher | Domain Expert / Scientist |
| The Impact Analyst | Social Impact / Sustainability |
| The Marketer | Growth / Marketing Expert |
| The Operator | Operations / Logistics Expert |
| The Critic | Devil's advocate (always on the panel) |

Each expert has its own system prompt and is told to judge only its own area, so two experts don't give the same generic answer. When the built-in experts can't fill the requested panel size, or the idea matches no known domain, the **Panel Architect** (an LLM call) designs custom experts for the idea. For example, a drone-based crop-monitoring idea could get an Agricultural Technology Expert and a Drone Systems Engineer.

### 3. Experts evaluate in parallel

Every expert evaluates the idea independently and at the same time. Each one returns:

* a **verdict**: Bullish, Cautious or Bearish
* a **score** from 1 to 10
* a one-line **headline**
* **strengths** and **concerns**
* a **recommendation**
* optionally a **chart** that supports its argument

If an expert fails or times out, it is shown as failed and the rest of the panel continues.

### 4. Boardroom synthesis

The **Boardroom Synthesizer** works like the chair of a board meeting. It reads every expert's evaluation and produces the final report:

* **Overall score** and verdict: **Go**, **Caution** or **No-Go**
* **Executive summary**
* **Consensus points**: where the experts agree
* **Disagreements**: each topic, with the sides taken and a suggested resolution
* **SWOT**: strengths, weaknesses, opportunities, threats
* **7-day action plan**: quick experiments that test the riskiest assumptions
* **30-day action plan**: larger steps such as an MVP or a pilot
* **Final recommendation** and summary charts

The question it answers is not "is this a good idea?" but **"is this worth pursuing, what could stop it, and what should I test next?"**

---

## ✨ Features

* **Live streaming.** Results arrive over NDJSON, so each expert's card appears as soon as that expert finishes. There's no waiting for the whole panel.
* **Document-aware.** Uploaded files are parsed in an isolated, memory-capped worker. Documents that are too long get condensed instead of cut off, and every attachment reports how much of it the experts actually saw.
* **Local history.** Past evaluations are saved in your browser's local storage, where you can reopen them, add notes and delete them. Nothing is stored on a server.
* **Exports.** Every evaluation has a printable report page that you can save as PDF, plus HTML and CSV exports.
* **Built-in demo.** A sample evaluation shows the full interface without an API key.
* **Graceful failure.** Timeouts, a fallback chain for synthesis, key rotation and readable errors, each with a request id you can find in the server log.

---

## 🏗️ Architecture

DecisionX is a decoupled app: a **Next.js** frontend (port 3000) talks to a **FastAPI** backend (port 8001) over REST and NDJSON streaming.

* **Frontend** (`frontend/`): the idea form, panel size, file uploads, live panel, expert cards, charts, results and report pages, history and exports.
* **Backend** (`backend/`): validates requests, parses files, classifies the idea, assembles the panel, runs the experts in parallel under a global concurrency limit, validates their JSON, runs synthesis and streams the events.

---

## 🔌 LLM Provider Architecture

DecisionX supports multiple LLM providers through a provider chain.

All three providers use OpenAI-compatible endpoints through the `openai` Python SDK. Each stage of the pipeline uses its own model:

| Stage | Provider | Model |
| --- | --- | --- |
| Panel Architect (classification + panel design) | Groq | `llama-3.3-70b-versatile` |
| Expert personas | Groq | `llama-3.1-8b-instant` |
| Document condensation | Groq | `llama-3.1-8b-instant` |
| Boardroom synthesis | Groq → NVIDIA → OpenRouter | `llama-3.3-70b-versatile` → `meta/llama-3.3-70b-instruct` → `nvidia/nemotron-3-ultra-550b-a55b:free` |

So **Groq is required**. NVIDIA and OpenRouter only take over synthesis when Groq fails or times out:

```text
Synthesis request
   │
   ▼
Groq (25 s) ──fail──► NVIDIA (25 s) ──fail──► OpenRouter (35 s)
```

Synthesis has a hard deadline of 55 seconds in total, and a provider without keys is skipped. Within a provider, requests rotate across all keys in its key file, and a key that returns 401/403 is disabled for the rest of the process. Model names are defined in `backend/agents/llm_client.py` and `backend/agents/synthesizer.py`.

---

## 📁 Project Structure

```text
DecisionX/
│
├── frontend/
│   ├── app/
│   │   ├── page.tsx         # main screen: idea form, panel size, uploads, live panel
│   │   ├── results/         # boardroom verdict + expert cards
│   │   ├── report/          # printable report (PDF / HTML / CSV export)
│   │   └── layout.tsx
│   ├── components/          # charts, expert cards, history sidebar, file drop, ...
│   ├── lib/                 # API client (evaluation.ts), types, history, exports
│   ├── public/              # demo-evaluation.json, sample report
│   ├── scripts/             # generate-sample-export.mjs
│   ├── .env.local           # NEXT_PUBLIC_API_BASE (optional)
│   └── package.json
│
├── backend/
│   ├── agents/          # personas, orchestrator, synthesizer, LLM client, context budget
│   ├── parsers/         # upload extraction (isolated parse worker)
│   ├── tests/           # pytest suite (LLM stubbed); tests/integration/ = live calls
│   ├── main.py          # FastAPI app, request guard, endpoints
│   ├── config.py        # every DECISIONX_* setting
│   ├── observability.py # request ids, failure counters
│   ├── concurrency.py   # global limit on LLM calls
│   ├── .env             # optional settings (gitignored)
│   ├── .env.example     # every setting, annotated
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   ├── groqapi
│   ├── nvidiaapi
│   ├── openrouterapi
│   └── ...
│
├── images/
│   ├── Dashboard_image.png
│   └── Result_page.png
│
├── start_dev.sh         # Linux / macOS: start both servers
├── start_dev.bat        # Windows: start both servers
├── start_omarchy.sh     # optional desktop launcher (Omarchy / Hyprland)
├── projectDetail.md     # longer project write-up
├── LICENSE
└── README.md
```

---

## 🛠 Tech Stack

| Layer         | Technology               |
| ------------- | ------------------------ |
| Frontend      | Next.js 16.3.0, TypeScript 5 |
| UI            | React 19.2               |
| Styling       | Tailwind CSS v4          |
| Components    | DaisyUI 5                |
| Animation     | Framer Motion            |
| Charts        | Custom SVG               |
| Backend       | FastAPI                  |
| Server        | Uvicorn                  |
| Language      | Python 3.12+             |
| LLM SDK       | `openai` (OpenAI-compatible endpoints) |
| LLM Providers | Groq, NVIDIA, OpenRouter |
| File parsing  | pdfplumber, openpyxl     |
| Data Format   | JSON / NDJSON            |
| Storage       | Browser Local Storage    |

---

## 💡 Example Use Cases

DecisionX is designed to be domain-agnostic.

### 🚀 Startup Validation

Evaluate:

> "A subscription platform that provides AI tutors for engineering students."

The panel could investigate:

* Market demand
* Competition
* Pricing
* Technical feasibility
* Customer acquisition
* Investment potential
* Scalability

---

### 💻 Technical Projects

Evaluate:

> "Build an offline AI assistant that runs completely on a laptop."

Experts could examine:

* Hardware requirements
* Model selection
* Performance
* Cost
* Security
* User experience
* Deployment complexity

---

### 🎨 Creative Ideas

Evaluate:

> "Launch an AI-generated educational YouTube channel."

The panel could analyze:

* Audience
* Content differentiation
* Monetization
* Competition
* Production workflow
* Platform risks
* Long-term sustainability

---

### 🔬 Research Ideas

DecisionX can also be used to challenge research or engineering concepts by assembling experts around:

* Technical feasibility
* Existing alternatives
* Novelty
* Practical implementation
* Risks
* Scalability

---

## 📡 API Reference

The backend runs on port `8001`. Both evaluation endpoints accept `multipart/form-data`:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `idea` | string | required | up to 4,000 characters |
| `context` | string | `""` | up to 12,000 characters |
| `num_personas` | int | `5` | 1–30 |
| `files` | file[] | none | up to 8 files: PDF, DOCX, XLSX, CSV, TXT |

### `GET /api/health`

Returns `status`, the configured `providers`, `max_panel_size` and failure `counters`.

### `POST /api/evaluate`

Blocking. It returns the full evaluation as one JSON object.

```bash
curl -X POST http://127.0.0.1:8001/api/evaluate \
  -F "idea=A subscription app that matches home cooks with office workers for lunch" \
  -F "num_personas=5"
```

### `POST /api/evaluate/stream`

Streams the evaluation as NDJSON (`application/x-ndjson`), one event per line. The frontend uses this endpoint.

| Event `type` | When |
| --- | --- |
| `attachments` | uploaded files were parsed (sent again after condensation) |
| `stage` | `reading` → `assembling` → `synthesizing` |
| `panel` | the Panel Architect has chosen the experts |
| `persona` | one expert has finished (arrives as each one completes) |
| `done` | final result, including the boardroom synthesis |
| `error` | the run failed; `message` includes the request id |

Every response carries an `X-Request-ID` header that matches the server log lines. If `DECISIONX_API_TOKEN` is set, send it as an `X-DecisionX-Token` header. **The web frontend does not send this header**, so setting the token blocks evaluations from the browser. Use it only when you call the API directly.

---

## 🔐 API Key Security

API keys should never be committed to Git.

The recommended approach is to store credentials locally using environment variables or local key files.

For example:

```text
backend/
├── groqapi
├── nvidiaapi
├── openrouterapi
└── .env
```

`backend/groqapi`, `backend/nvidiaapi`, `backend/openrouterapi`, `backend/.env` and `frontend/.env.local` are already listed in `.gitignore`, so keys you put in them are never committed. Before you share the folder as a zip, empty these files.

**Never publish your API keys in a public repository.**

If a key is accidentally exposed, revoke it immediately through the corresponding provider and generate a replacement.

---

## ⚙️ Configuration

DecisionX can be configured depending on the desired evaluation workflow.

Potential configuration parameters include:

* Number of experts
* Selected provider
* Custom personas
* Evaluation constraints
* Success criteria
* Additional context
* Uploaded reference material

The panel size can be increased up to **30 experts**, allowing users to trade off between evaluation breadth and execution cost.

### Backend environment

The backend reads `DECISIONX_*` variables from the environment, or from `backend/.env` (a real environment variable wins). Provider keys are **not** read from `.env`; they live in the key files above. See `backend/.env.example` for the annotated list.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DECISIONX_HOST` | `127.0.0.1` | Bind address (`python main.py`, `start_dev.*`) |
| `DECISIONX_PORT` | `8001` | Port for `python main.py` |
| `DECISIONX_ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | `/api/evaluate*` returns 403 when an `Origin` header is present and not listed |
| `DECISIONX_API_TOKEN` | unset | If set, `/api/evaluate*` requires header `X-DecisionX-Token` (401 otherwise). The web UI doesn't send it, so this is for direct API use only |
| `DECISIONX_MAX_CONCURRENT_AGENTS` | `12` | Persona LLM calls in flight across all evaluations |
| `DECISIONX_RUN_TIMEOUT` | `120` | Seconds per evaluation; slow experts are reported as timed out |
| `DECISIONX_CONTEXT_BUDGET_CHARS` | `6000` | Characters each expert sees (synthesizer ½, architect ¼). Typed context is never cut for experts or synthesis; documents share the rest (at least ¼ of the budget), split fairly per file |
| `DECISIONX_CONDENSE` | `true` | Condense documents that do not fit their share with one shared LLM pass per run, instead of cutting them off |
| `DECISIONX_PARSE_TIMEOUT` | `20` | Seconds per uploaded file |
| `DECISIONX_PARSER_ISOLATION` | `subprocess` | `subprocess` (killable, memory-capped) or `thread` |
| `DECISIONX_PARSE_MEMORY_MB` | `1024` | Memory cap for the parse worker (POSIX) |
| `DECISIONX_LOG_LEVEL` | `INFO` | Logging level |

Request limits: idea ≤ 4,000 characters, typed context ≤ 12,000, `num_personas` 1–30, ≤ 8 files of ≤ 10 MB each and 40 MB in total. Uploads accept PDF, DOCX, XLSX, CSV and plain text; legacy `.xls`/`.doc` are rejected with a message. Uploaded text is passed to the experts inside delimiters marked as untrusted reference material, and each attachment in the result reports `included`, `truncated`, `condensed`, `coverage`, `chars_extracted` and `chars_included`.

**Long documents.** When a document does not fit its share of the budget, the run starts with an optional `reading` stage: one condensation pass, shared by every expert, turns it into a dense digest of facts, numbers, claims, risks and constraints. Documents over 12,000 characters are condensed in chunks concurrently; beyond 8 chunks, evenly spaced sections are sampled and the digest says so (`coverage` is the fraction actually read; with condensation on, up to 400,000 characters are extracted per file). The pass uses at most a quarter of the remaining run time (≤ 25 s); a document whose condensation fails or runs out of time is cut at its share as before (`condensed: false`, `truncated: true`). The stream then re-sends the `attachments` event so the UI shows the condensed state. Typed context is only condensed for the Panel Architect, and only when the architect is going to run.

If you bind beyond loopback (`DECISIONX_HOST=0.0.0.0`), anyone who can reach the port can spend your LLM quota. `DECISIONX_API_TOKEN` protects the API, but the web frontend can't send the token yet, so the browser UI stops working while it's set. To use the UI from other machines, keep the backend on loopback and put it behind a reverse proxy or VPN that handles access instead.

`GET /api/health` reports configured providers and process-local failure counters (rejected requests, persona failures/timeouts, LLM failure reasons, upload errors). Every evaluation gets a request id, returned as `X-Request-ID` and attached to its log lines; API keys are never logged, only their index in the key file.

### Backend tests

```bash
cd backend
pip install -r requirements-dev.txt
python -m pytest            # LLM calls are stubbed; no network
DECISIONX_LIVE_TESTS=1 python -m pytest tests/integration   # real provider call
```

---

## 🖥️ Omarchy / Hyprland launcher

`start_omarchy.sh` wraps `start_dev.sh` for desktop use: it starts both servers in the background, waits until they answer, and opens the UI as a web-app window (`omarchy-launch-webapp`, falling back to `xdg-open`). Errors show as desktop notifications.

```bash
./start_omarchy.sh install   # adds `decisionx` to ~/.local/bin and a "DecisionX" app-launcher entry
decisionx                    # start if needed, then open the window
decisionx stop | restart | status | logs
decisionx uninstall
```

Server output goes to `~/.local/state/decisionx/server.log`. Right-click the launcher entry for Stop and Restart.

---

## 🐛 Troubleshooting

### Backend does not start

Check that Python is installed and available in your PATH.

```bash
python --version
```

You can also verify the backend dependencies are installed.

---

### Frontend does not start

Verify Node.js and npm are installed.

```bash
node --version
npm --version
```

Then reinstall dependencies if necessary.

---

### No AI response

`backend/groqapi` must contain at least one valid Groq key. The experts and the Panel Architect only run on Groq, and the other providers are used only for synthesis. The file should contain only the key, one per line.

Check that the backend can see your keys:

```bash
curl http://127.0.0.1:8001/api/health
```

If `providers` is empty or doesn't include `groq`, the key file is empty or in the wrong place. If a key was rejected, the `counters` show LLM failure reasons, and the backend log names the key by its line index (never the key itself). Restart the backend after you edit a key file, because keys are read once at startup.

---

### Port already in use

The development scripts check ports `3000` and `8001` before starting. If either is taken, they print which process holds it and exit rather than killing it — stop that process (often a previous dev server) and run the script again.

The scripts also reinstall backend requirements automatically whenever `backend/requirements.txt` changes.

---

## 🚧 Current Limitations

DecisionX is still an evolving project.

Some limitations include:

* AI-generated evaluations can contain factual errors.
* Expert personas represent simulated perspectives rather than real professionals.
* Scores should be treated as decision-support signals, not objective measurements.
* Results depend on the quality of the submitted brief.
* Different LLM providers may produce different outputs.
* Large panels can increase inference cost and execution time.

For high-impact decisions, DecisionX should complement—not replace—human expertise and real-world validation.

---

## 🗺️ Roadmap

Future improvements may include:

* [ ] User authentication
* [ ] Cloud-based evaluation history
* [ ] Side-by-side idea comparison
* [ ] Custom persona editor
* [ ] More LLM providers
* [ ] Advanced scoring frameworks
* [ ] Team collaboration
* [ ] Evaluation benchmarking
* [ ] Custom industry-specific panels
* [ ] Persistent project workspaces
* [ ] Human reviewer scoring
* [ ] Automated follow-up evaluations
* [ ] Cost and token tracking
* [ ] More advanced analytics

---

## 🤝 Contributing

Contributions are welcome.

If you want to contribute:

1. Fork the repository.
2. Create a new branch.

```bash
git checkout -b feature/your-feature
```

3. Make your changes.
4. Test the frontend and backend.
5. Commit your changes.

```bash
git commit -m "Add your feature"
```

6. Push the branch.

```bash
git push origin feature/your-feature
```

7. Open a Pull Request.

When contributing, please try to keep changes focused and document any significant architectural or behavioral changes.

---

## ⚠️ Disclaimer

DecisionX is an AI-powered decision-support system.

Its recommendations, scores, and expert opinions are generated by artificial intelligence and should not be interpreted as professional financial, legal, medical, engineering, or investment advice.

Always validate important decisions using reliable data, qualified professionals, and real-world testing.

---

## 🌟 Vision

DecisionX is built around a simple idea:

> **Better decisions come from better questions and diverse perspectives.**

As AI systems become increasingly capable, the next step is not simply asking one model to produce a better answer.

It is creating systems where multiple specialized perspectives can challenge one another, expose blind spots, identify risks, and collectively produce a more useful decision.

DecisionX aims to become a general-purpose **AI boardroom for ideas**—a place where an idea can be challenged before real-world time, money, and resources are invested.

---

## 👥 Credits

DecisionX was built by **Shushant**, **Aditya** and **Lakshit**.

---

## 📄 License

DecisionX is released under the [MIT License](LICENSE).

Copyright (c) 2026 Shushant, Aditya and Lakshit.

---

## ⭐ Support the Project

If you find DecisionX useful, consider:

* ⭐ Starring the repository
* 🐛 Reporting bugs
* 💡 Suggesting new expert personas
* 🔧 Contributing improvements
* 📢 Sharing the project with others

Every contribution helps improve the platform.
