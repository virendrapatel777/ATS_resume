# 🎯 ATS Resume Builder — AI-Powered Resume Optimization Tool

> **Bridge the gap between your resume and your dream job — intelligently.**

---

## 📌 Overview

**ATS Resume Builder** is an AI-assisted resume optimization tool designed to help job seekers maximize their chances of passing Applicant Tracking Systems (ATS) and landing more interviews.

The tool intelligently analyzes your existing resume against a target job description, identifies missing keywords and skills, generates professionally written achievement statements, and delivers an updated, ATS-optimized resume — ready to download as a PDF.

---

## 🚀 Key Features

- 📄 **Resume & JD Analysis** — Upload your resume and paste the job description; the AI engine extracts and cross-references all critical keywords, skills, and requirements
- 🔍 **ATS Keyword Gap Detection** — Automatically identifies keywords and skills present in the job description but missing from your resume
- ✅ **Selective Keyword Control** — Presents missing keywords as selectable options, giving you full control to choose only those that genuinely reflect your experience
- ✍️ **AI-Generated Achievement Statements** — For every keyword you select, the AI generates a strong, professionally written bullet point tailored to your background using the CAR method *(Challenge → Action → Result)*
- 📝 **Automated Resume Update** — Selected keywords and generated statements are seamlessly incorporated into the appropriate sections of your existing resume
- 📥 **PDF Download** — Download your fully updated, ATS-optimized resume in PDF format — ready to submit

---

## 🔄 How It Works

```
Step 1 — Upload          Upload your resume + provide the target job description
     ↓
Step 2 — AI Analysis     AI engine scans both documents, performs ATS keyword
                         matching, and identifies critical gaps
     ↓
Step 3 — Select Keywords Browse missing keywords and skills; select only those
                         that accurately reflect your real experience
     ↓
Step 4 — AI Generation   AI generates professional, quantified bullet points
                         for each selected keyword using your actual background
     ↓
Step 5 — Download PDF    Updated resume with all optimized content delivered
                         as a downloadable PDF
```

---

## 🧠 AI Engine

Built on **Claude AI (Anthropic)** with two specialized prompt pipelines:

| Pipeline | Purpose |
|----------|---------|
| **ATS Analyzer** | Parses JD, extracts keywords, performs gap analysis, scores resume across 6 dimensions |
| **Resume Skill Updater** | Generates professional, ATS-optimized bullet points for each selected keyword using the RICE-POT framework |

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React (JSX) |
| AI Engine | Claude API (Anthropic) |
| Prompt Framework | RICE-POT Structured Prompting |
| PDF Generation | Client-side PDF rendering |
| Styling | Inline CSS with design tokens |

---

## 📂 Project Structure

```
ATS-Resume-Builder/
├── src/
│   ├── ATS_Resume_Builder.jsx        # Main application component
│   ├── prompts/
│   │   ├── ATS_Analyzer_Prompt.md    # ATS analysis RICE-POT prompt
│   │   └── Resume_Skill_Updater.md   # Skill updater RICE-POT prompt
│   └── components/
│       ├── DropZone.jsx              # File upload component
│       ├── KeywordPills.jsx          # Keyword selection UI
│       └── ResumePreview.jsx         # Resume preview & PDF export
├── public/
├── README.md
└── package.json
```

---

## ⚙️ Getting Started

### Prerequisites
- Node.js 16+
- Anthropic API key ([Get one here](https://console.anthropic.com))

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/ats-resume-builder.git

# Navigate to project directory
cd ats-resume-builder

# Install dependencies
npm install

# Add your Anthropic API key
echo "REACT_APP_ANTHROPIC_KEY=your_api_key_here" > .env

# Start the development server
npm start
```

---

## 💡 Why ATS Resume Builder?

> **75% of resumes are rejected by ATS before a human ever reads them.**
> The #1 reason: missing keywords from the job description.

Most candidates write one generic resume and apply everywhere. ATS Resume Builder solves this by tailoring your resume to each specific job — in minutes, not hours — while ensuring every addition is professional, impactful, and truthful.

---

## 🎯 Who Is This For?

- 👨‍💻 **Software Engineers & QA Professionals** targeting competitive tech roles
- 📡 **Telecom & Semiconductor Engineers** applying to domain-specific positions
- 🔄 **Career Switchers** who need to reframe existing experience for new domains
- 🎓 **Fresh Graduates** looking to align academic projects with industry JD requirements
- 👔 **Anyone** who wants their resume to work harder for them

---

## ✅ What Makes It Different

| Feature | Generic Resume Tools | ATS Resume Builder |
|---------|--------------------|--------------------|
| Keyword gap detection | ❌ | ✅ |
| AI-generated bullets from your background | ❌ | ✅ |
| User controls which keywords to add | ❌ | ✅ |
| Grounded in real experience — no fabrication | ❌ | ✅ |
| Downloadable PDF output | 🔶 Sometimes | ✅ |
| RICE-POT structured prompting | ❌ | ✅ |

---

## 🤝 Contributing

Contributions are welcome. Please open an issue first to discuss what you would like to change.

```bash
# Fork the repo → create your feature branch
git checkout -b feature/your-feature-name

# Commit your changes
git commit -m "feat: add your feature description"

# Push to the branch
git push origin feature/your-feature-name

# Open a Pull Request
```

---

## 📜 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

## 👤 Author

**Virendra Patel**
Lead Engineer | Telecom & Semiconductor | AI Automation

[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-blue?style=flat&logo=linkedin)](https://www.linkedin.com/in/virendra-patel-4897668a/)
[![GitHub](https://img.shields.io/badge/GitHub-Follow-black?style=flat&logo=github)](https://github.com/virendrapatel777)

---

<div align="center">
  <sub>Built with ❤️ using Claude AI · Designed to get you more interviews</sub>
</div>
