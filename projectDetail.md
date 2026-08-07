# DecisionX: Project Details

## 1. Project Overview
**DecisionX** is a generalized, multi-agent idea evaluation platform. It allows users to input any business, technical, or creative idea (along with optional context or files) and have it rigorously evaluated by a dynamically assembled panel of AI expert personas. 

The system goes beyond a single LLM response by using a specialized multi-agent architecture. It classifies the idea, selects the most relevant built-in experts, dynamically invents custom experts if needed, runs their evaluations in parallel for blazing speed, and then synthesizes their feedback into a unified boardroom-style verdict. It specifically highlights areas of consensus and disagreement.

## 2. System Architecture & Tech Stack

The project is structured as a decoupled frontend/backend application, communicating via a REST API with support for real-time NDJSON streaming.

### Frontend
- **Framework**: Next.js 16.3.0 (React 19)
- **Styling**: Tailwind CSS v4, DaisyUI v5.7
- **Animations & Interactivity**: Framer Motion v13 (focusing on tactile, physical micro-animations)
- **Visualizations**: Recharts v3.10
- **Markdown Parsing**: React Markdown v10.1
- **Role**: Provides the user interface for submitting ideas, selecting the number of personas, and visualizing the multi-agent feedback in real-time, including expert score breakdowns, SWOT analysis, and action plans.

### Backend
- **Framework**: FastAPI (Python)
- **Server**: Uvicorn (ASGI)
- **LLM Integration**: 
  - Supports multiple providers: **Groq**, **OpenRouter**, and **NVIDIA**, managed through a dynamic client (`llm_client.py`) that handles API key rotation and rate limits.
  - Model fallbacks and retry mechanisms are built-in to ensure high availability.
- **Environment Management**: `python-dotenv` for managing API keys. Keys can be loaded from text files (`groqapi`, `nvidiaapi`, `openrouterapi`).
- **File Parsing**: Uses `pdfplumber`, `pandas`, and `openpyxl` to extract context from uploaded files.

## 3. The Multi-Agent Pipeline

The core logic resides in `backend/agents/`. When an idea is submitted to the `/api/evaluate` or `/api/evaluate/stream` endpoint, the orchestrator triggers the following pipeline:

### Step 1: Domain Classification
The system first analyzes the idea to detect its primary domains (e.g., "tech", "finance", "health", "ecommerce") using keyword heuristics (`backend/agents/personas.py`).

### Step 2: Dynamic Persona Assembly
Based on the detected domains, the system dynamically selects the most relevant expert personas from a roster of 12 available experts. 
- **The Critic** ("Devil's Advocate") is *always* included to ensure rigor and find flaws.
- **The Panel Architect**: If the built-in roster cannot cover the requested panel size, or the idea matches no known domain, an LLM-driven "Panel Architect" dynamically designs bespoke personas tailored specifically to the idea.

**The 12 Built-in Personas:**
1. **🦈 The Investor**: Focuses on TAM, unit economics, scalability, and exit potential.
2. **🔧 The Engineer**: Evaluates technical feasibility, architecture, and tech debt.
3. **👤 The User**: Assesses actual utility, pain points, and UX friction.
4. **💰 The Economist**: Analyzes cost structure, burn rate, and financial risks.
5. **📊 The Strategist**: Looks at GTM, competitive moats, and positioning.
6. **⚖️ The Regulator**: Identifies legal, compliance, and IP risks.
7. **🎨 The Designer**: Evaluates UX, accessibility, and cognitive load.
8. **🔬 The Researcher**: Checks scientific validity, prior art, and evidence.
9. **🌍 The Impact Analyst**: Looks at social value, ethics, and sustainability.
10. **📢 The Marketer**: Focuses on distribution, acquisition, and virality.
11. **🏗️ The Operator**: Assesses logistics, supply chain, and real-world execution.
12. **🔥 The Critic**: Actively looks for hidden risks, wrong assumptions, and reasons it will fail.

### Step 3: Parallel Execution & Agent Features
The selected personas evaluate the idea simultaneously. Thanks to `asyncio.gather` and fast inference endpoints, running 5 or 30 agents happens quickly. 
- **Strict JSON Output**: Every persona outputs a standardized JSON response containing their verdict, score (1-10), strengths, concerns, recommendation, and optional charts.
- **Independent Execution**: Agents execute independently, ensuring un-biased multi-faceted critiques.
- **Bespoke Generation**: For domains lacking built-in personas, custom agent prompts are generated on the fly.

### Step 4: Synthesis
The `synthesizer.py` agent takes all the individual persona outputs and acts as the "Board Chairman". It produces a unified JSON verdict containing an overall score, executive summary, consensus points, disagreements, SWOT analysis, action plans, and data charts.
The synthesizer uses a fallback chain (Groq -> NVIDIA -> OpenRouter). If all API calls fail, it gracefully degrades to a deterministic local synthesis function to ensure the user always gets a response.

## 4. The Results Page UI

The results page (`frontend/app/results/page.tsx`) provides a rich, real-time visualization of the evaluation:

- **The Brief**: Displays the original idea in formatted Markdown along with attached context and parsed files.
- **Real-Time Progress State**: Shows a live progress bar ("Awaiting") while the panel is being assembled, and reads "Reading the brief…" as each expert works. 
- **Expert Cards**: Individual cards for each persona detailing their specific verdict, score out of 10, "In favour" points (strengths), "Against" points (concerns), and recommendations. Bespoke experts created by the Panel Architect are tagged.
- **Synthesis View (The Boardroom Verdict)**: 
  - **Overall Score & Verdict**: Shows Go, Caution, or No-Go using distinct styling (e.g., Patina for Go, Vermilion for No-Go).
  - **Executive Summary & Consensus**: Highlights what the panel universally agreed upon.
  - **Where They Split**: A dedicated disagreements section showcasing conflicting views between experts and providing a reconciled resolution.
  - **By the Numbers**: Renders charts (via Recharts) representing quantitative data, such as score spread among experts.
  - **SWOT Quadrants**: Categorizes feedback into Strengths, Weaknesses, Opportunities, and Threats.
  - **Action Plans**: Breaks down actionable next steps into Immediate (7 days) and Follow-through (30 days) horizons.
  - **The Chair's Recommendation**: A final, actionable paragraph summarizing the boardroom's conclusion.
- **Error Handling**: Gracefully handles and displays cases where all agents fail or API keys are missing/expired.
- **Local History Sidebar**: Evaluations are saved locally in the browser. Users can access past evaluations using a sidebar toggle or the `Cmd/Ctrl + K` keyboard shortcut.

## 5. Local Development

The project includes convenient scripts to run the stack locally (`start_dev.bat` for Windows and `start_dev.sh` for Unix/Linux).

- **Behavior**: 
  1. Cleans up any existing processes on ports 3000 and 8001.
  2. Installs or checks dependencies.
  3. Starts the FastAPI backend on `http://localhost:8001`.
  4. Starts the Next.js frontend development server on `http://localhost:3000`.
