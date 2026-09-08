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

## 🎯 Why DecisionX?

Traditional AI chat interfaces generally provide a single perspective. While this can be useful for brainstorming, important decisions often require multiple viewpoints.

For example, a startup idea might look attractive from an investor's perspective but have serious technical limitations. Similarly, a technically impressive product might have weak market demand.

DecisionX addresses this problem by creating a virtual panel containing different expert perspectives.

A typical evaluation can involve:

* 💰 Investor — examines financial potential and investment attractiveness
* 🏗️ Engineer — evaluates technical feasibility
* 📊 Market Analyst — examines market size and competition
* 🎯 Product Strategist — evaluates product-market fit
* ⚠️ Risk Analyst — identifies potential failure points
* 🧠 Critical Thinker — challenges assumptions
* 📈 Growth Strategist — evaluates scalability and growth
* ⚖️ Ethics Advisor — identifies ethical and social concerns

The final decision is not based on one agent's opinion. Instead, DecisionX looks for **patterns, disagreements, risks, and opportunities across the entire panel**.

---

# ✨ Features

### 🤖 Dynamic Persona Assembly

DecisionX can work with a predefined set of expert personas or dynamically create new experts specifically for the submitted idea.

The platform currently supports **12 built-in expert roles**, while the Panel Architect can generate bespoke personas when the problem requires expertise outside the standard panel.

For example, submitting a:

> "Drone-based agricultural monitoring platform"

could result in a panel containing:

* Agricultural Technology Expert
* Drone Systems Engineer
* Investor
* Rural Market Specialist
* Computer Vision Engineer
* Regulatory Analyst
* Sustainability Expert
* Critical Reviewer

This makes the evaluation system adaptable rather than limited to a fixed group of reviewers.

---

### ⚡ Parallel Multi-Agent Execution

Experts evaluate the idea independently and in parallel.

This provides two major advantages:

1. **Reduced evaluation time**
2. **Greater diversity of opinions**

Each expert produces a structured response containing information such as:

* Overall verdict
* Confidence level
* Score
* Strengths
* Weaknesses
* Opportunities
* Threats
* Key assumptions
* Major risks
* Recommendations

The structured output also makes the results easier for the frontend to visualize.

---

### 🏛️ Boardroom Synthesis

After the individual experts finish their evaluations, DecisionX sends their findings to a dedicated synthesis agent.

The synthesizer acts like the chairperson of a boardroom.

It identifies:

* Areas of consensus
* Major disagreements
* Recurring risks
* Strongest opportunities
* Contradictory opinions
* Critical assumptions
* Most important next steps

The final output provides a higher-level perspective instead of simply displaying a collection of unrelated AI responses.

---

### 📊 Decision-Oriented Scoring

DecisionX converts qualitative expert opinions into structured scores.

The result page can present:

* Overall boardroom score
* Individual expert scores
* Confidence indicators
* Strength/risk comparisons
* SWOT analysis
* Consensus information
* Recommended actions

This makes it easier to compare multiple ideas using a consistent evaluation framework.

---

### 🌊 NDJSON Streaming

DecisionX uses NDJSON-based streaming to provide incremental results to the frontend.

Instead of waiting for every agent to finish before displaying anything, completed evaluations can appear progressively.

This creates a more interactive experience where users can watch the virtual boardroom work in real time.

---

### 📚 Local Evaluation History

Previous evaluations are stored locally in the browser.

Users can:

* Reopen previous evaluations
* Compare previous decisions
* Add reviewer notes
* Keep track of ideas
* Export evaluation results

This allows DecisionX to function not only as an evaluation tool but also as a lightweight **personal decision archive**.

---

### 📤 Export Results

Evaluations can be exported for further analysis or sharing.

Supported formats include:

* HTML reports
* CSV data

The exported information can be used for:

* Presentations
* Business planning
* Research
* Documentation
* Internal decision-making
* Comparing multiple ideas

---

# 🧠 How DecisionX Works

The evaluation pipeline can be summarized as:

```text
User Idea
    │
    ▼
Idea Classification
    │
    ▼
Panel Architect
    │
    ├── Built-in Experts
    │
    └── Custom Experts
    │
    ▼
Parallel Expert Evaluation
    │
    ├── Investor
    ├── Engineer
    ├── Critic
    ├── Market Analyst
    ├── Strategist
    └── ...
    │
    ▼
Structured JSON Results
    │
    ▼
Boardroom Synthesizer
    │
    ▼
Consensus + Disagreement Analysis
    │
    ▼
Final Verdict
    │
    ├── Score
    ├── SWOT
    ├── Key Risks
    ├── Opportunities
    └── Action Plan
```

This architecture separates **individual reasoning** from **final synthesis**, reducing the risk of relying on a single AI perspective.

---

# 🔄 Evaluation Workflow

### Step 1 — Submit an Idea

The user provides a description of the idea along with optional:

* Success criteria
* Constraints
* Target audience
* Business context
* Technical requirements
* Additional background information

---

### Step 2 — Classify the Problem

The system analyzes the submitted brief and determines what type of expertise is required.

Possible categories include:

* Business
* Technology
* Product
* Finance
* Research
* Creative
* Social impact
* Strategy

---

### Step 3 — Assemble the Panel

DecisionX selects appropriate experts from the available personas.

If the standard personas are insufficient, the Panel Architect creates custom expert roles.

This allows the panel to adapt to unusual or highly specialized ideas.

---

### Step 4 — Run Expert Evaluations

Each expert independently evaluates the idea.

Experts are instructed to focus on their specific area of expertise rather than attempting to provide a generic response.

The results are returned using structured JSON, allowing the application to process them consistently.

---

### Step 5 — Synthesize the Opinions

The Boardroom Synthesizer receives the individual evaluations.

It analyzes the complete panel and determines:

**Where do experts agree?**

**Where do they disagree?**

**Which risks appear repeatedly?**

**Which assumptions are questionable?**

**What opportunities appear strongest?**

**What should the user do next?**

---

### Step 6 — Generate the Decision

The final result contains a consolidated boardroom verdict.

Instead of simply answering:

> "Yes, this is a good idea."

DecisionX attempts to answer:

> **"Is this idea worth pursuing, what could prevent it from succeeding, and what should you test next?"**

---

# 👥 Expert Persona System

DecisionX uses specialized personas to create diversity in the evaluation process.

Each persona has its own:

* Role
* Objective
* Evaluation criteria
* Perspective
* Risk tolerance
* Domain focus

This prevents every agent from approaching the idea in exactly the same way.

### Built-in Personas

The platform includes 12 predefined expert types covering areas such as:

* Investment
* Engineering
* Product
* Market analysis
* Strategy
* Risk
* Criticism
* Growth
* Ethics
* Operations
* Finance
* User perspective

The system can also generate additional personas dynamically when required.

---

# 🏗️ Architecture

DecisionX follows a decoupled frontend-backend architecture.

### Frontend

The frontend is responsible for:

* User input
* Panel configuration
* File uploads
* Real-time streaming
* Expert cards
* Charts
* Boardroom results
* Evaluation history
* Export functionality

Built using:

* Next.js
* React
* Tailwind CSS
* DaisyUI
* Framer Motion
* Recharts

---

### Backend

The backend handles:

* Request processing
* Idea classification
* Persona generation
* LLM communication
* Parallel execution
* JSON validation
* Result aggregation
* Boardroom synthesis
* Streaming responses

Built using:

* Python
* FastAPI
* Uvicorn

---

# 🔌 LLM Provider Architecture

DecisionX supports multiple LLM providers through a provider chain.

Current providers include:

* **Groq**
* **NVIDIA**
* **OpenRouter**

Groq is used as the primary provider because of its low-latency inference capabilities.

If a provider is unavailable or its API key is not configured, the system can fall back to another configured provider.

Conceptually:

```text
Request
   │
   ▼
Groq
   │
   ├── Available → Continue
   │
   └── Unavailable
          │
          ▼
       NVIDIA
          │
          └── Fallback
                 │
                 ▼
             OpenRouter
```

This improves reliability and reduces dependence on a single provider.

---

# 📁 Project Structure

A simplified project structure looks like:

```text
DecisionX/
│
├── frontend/
│   ├── app/
│   ├── components/
│   ├── public/
│   └── ...
│
├── backend/
│   ├── agents/
│   ├── services/
│   ├── models/
│   ├── main.py
│   ├── groqapi
│   ├── nvidiaapi
│   ├── openrouterapi
│   └── ...
│
├── images/
│   ├── Dashboard_image.png
│   └── Result_page.png
│
├── start_dev.bat
├── start_dev.sh
└── README.md
```

The exact structure may evolve as the project develops.

---

# 🛠 Tech Stack

| Layer         | Technology               |
| ------------- | ------------------------ |
| Frontend      | Next.js 16.3.0           |
| UI            | React 19                 |
| Styling       | Tailwind CSS v4          |
| Components    | DaisyUI                  |
| Animation     | Framer Motion            |
| Charts        | Recharts                 |
| Backend       | FastAPI                  |
| Server        | Uvicorn                  |
| Language      | Python                   |
| LLM Providers | Groq, NVIDIA, OpenRouter |
| Data Format   | JSON / NDJSON            |
| Storage       | Browser Local Storage    |

---

# 💡 Example Use Cases

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

# 📈 Action Plans

One of the main objectives of DecisionX is to move beyond evaluation.

A verdict without an action plan is often not useful.

Therefore, the platform generates practical next steps, including:

### 7-Day Plan

Short-term experiments that can validate the most important assumptions.

Examples:

* Interview potential users
* Build a prototype
* Test pricing
* Analyze competitors
* Run a small experiment

### 30-Day Plan

Longer-term actions such as:

* Building an MVP
* Running a pilot
* Measuring user feedback
* Improving the product
* Testing acquisition channels
* Validating business economics

The objective is to convert AI analysis into **real-world experimentation**.

---

# 🔐 API Key Security

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

Make sure sensitive files are included in `.gitignore`.

**Never publish your API keys in a public repository.**

If a key is accidentally exposed, revoke it immediately through the corresponding provider and generate a replacement.

---

# ⚙️ Configuration

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

---

# 🐛 Troubleshooting

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

Check that at least one LLM provider API key has been configured.

For example:

```text
groqapi
```

should contain only the API key.

---

### Port already in use

The development scripts attempt to stop existing processes using ports:

```text
3000
8001
```

If the problem persists, manually stop the process occupying the port and restart the application.

---

# 🚧 Current Limitations

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

# 🗺️ Roadmap

Future improvements may include:

* [ ] User authentication
* [ ] Cloud-based evaluation history
* [ ] Side-by-side idea comparison
* [ ] Custom persona editor
* [ ] More LLM providers
* [ ] Advanced scoring frameworks
* [ ] Team collaboration
* [ ] PDF report generation
* [ ] Evaluation benchmarking
* [ ] Custom industry-specific panels
* [ ] Persistent project workspaces
* [ ] Human reviewer scoring
* [ ] Automated follow-up evaluations
* [ ] Cost and token tracking
* [ ] More advanced analytics

---

# 🤝 Contributing

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

# ⚠️ Disclaimer

DecisionX is an AI-powered decision-support system.

Its recommendations, scores, and expert opinions are generated by artificial intelligence and should not be interpreted as professional financial, legal, medical, engineering, or investment advice.

Always validate important decisions using reliable data, qualified professionals, and real-world testing.

---

# 🌟 Vision

DecisionX is built around a simple idea:

> **Better decisions come from better questions and diverse perspectives.**

As AI systems become increasingly capable, the next step is not simply asking one model to produce a better answer.

It is creating systems where multiple specialized perspectives can challenge one another, expose blind spots, identify risks, and collectively produce a more useful decision.

DecisionX aims to become a general-purpose **AI boardroom for ideas**—a place where an idea can be challenged before real-world time, money, and resources are invested.

---

## 📄 License

Add your preferred open-source license here, such as MIT, Apache 2.0, or another license appropriate for your project.

---

## ⭐ Support the Project

If you find DecisionX useful, consider:

* ⭐ Starring the repository
* 🐛 Reporting bugs
* 💡 Suggesting new expert personas
* 🔧 Contributing improvements
* 📢 Sharing the project with others

Every contribution helps improve the platform.
