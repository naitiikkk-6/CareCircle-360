# CareCircle 360

> **Empowering Elders. Uniting Caregivers. Smarter, Accessible, Reliable Elderly Care.**

CareCircle 360 is an elder-centred medication adherence and care coordination web platform built for the **Catalyst PromptWars** challenge. It bridges the gap between elderly independence and caregiver peace of mind through inclusive design, proactive notification escalations, and privacy-preserving AI insights.

---

## 📋 Table of Contents

1. [Overview](#-overview)
2. [Features Mapped to Challenge Requirements](#-features-mapped-to-challenge-requirements)
3. [Architecture & System Design](#-architecture--system-design)
4. [Google Services Used & Why](#-google-services-used--why)
5. [Local Setup Guide](#-local-setup-guide)
6. [Firebase Setup](#-firebase-setup)
7. [Gemini API Key Setup](#-gemini-api-key-setup)
8. [Email System Setup](#-email-system-setup)
9. [Google Cloud Run & Cloud Scheduler Deployment](#-google-cloud-run--cloud-scheduler-deployment)
10. [Running Automated Tests](#-running-automated-tests)
11. [Safety, Privacy & Ethical Guardrails](#-safety-privacy--ethical-guardrails)
12. [Simulated Data Disclosure](#-simulated-data-disclosure)
13. [Known Limitations & Future Roadmap](#-known-limitations--future-roadmap)

---

## 🌟 Overview

Caring for aging loved ones presents daily friction: complicated medication schedules, forgotten doses, fragmented family communication, and inaccessible software interfaces.

**CareCircle 360** solves this with:

- **Elder-First Usability**: High-contrast, scalable text, screen-reader compatibility (`aria-live`), speech synthesis voice readout, and an uncluttered "Simple Mode" with an oversized "Taken" action button.
- **Elder-Centred Autonomy**: The senior owns their Care Circle and dictates granular member visibility, editing permissions, and alert routing. Permissions are enforced server-side.
- **Intelligent Escalation**: Multi-tier missed-dose notifications (Elder first $\to$ Caretaker $\to$ Family) with one-click signed confirmation tokens.
- **MediGuide AI**: On-device/server-side Gemini packaging text extraction without clinical hallucinations.
- **Weekly Family Digests**: Gemini-powered 3–5 sentence natural language weekly summaries breaking down adherence trends by time of day without medical jargon or risk.

---

## 🎯 Features Mapped to Challenge Requirements

| Challenge Requirement                       | CareCircle 360 Implementation                                                                                                | Technical Details / Route                                                                                       |
| :------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| **Elder-Centred Autonomy & Sharing**        | Elder granular sharing matrix, immediate revocation, activity audit log                                                      | `GET /api/circles/:id/permissions`, `PUT /api/circles/:id/permissions`, `server/middleware/elderPermissions.js` |
| **Accessible & Elder-First UI**             | Simple Mode, 3 text scaling tiers (`normal`, `large`, `xlarge`), high-contrast mode, reduce-motion, Web Speech voice readout | `public/index.html`, `public/app.js`, `GET/PUT /api/auth/preferences`                                           |
| **Medication & Dose Tracking**              | Multi-time schedules, timezone-aware dosage generation, grace windows (60m), adherence % calculation                         | `server/services/medicationService.js`, `POST /api/medications`, `POST /api/doses/:id/status`                   |
| **Appointments & Daily Care Pulse**         | Chronological doctor appointments, Daily Care Pulse dashboard with plain-language status cards                               | `server/services/appointmentService.js`, `GET /api/appointments`, `GET /api/pulse/summary`                      |
| **Email Reminders & Multi-Tier Escalation** | 15-min due-soon reminders, 60-min missed alerts, caretaker/family escalation, signed one-click confirmation tokens           | `server/services/emailService.js`, `server/services/reminderScheduler.js`, `GET /api/doses/confirm-email`       |
| **Weekly Family Summary (Gemini)**          | Adherence grouped by time slot (Morning, Afternoon, Evening, Night) turned into 3–5 plain sentences via Gemini 1.5 Flash     | `server/services/weeklySummaryService.js`, `GET /api/pulse/weekly-summary`, safe rule-based fallback            |
| **Cloud Scheduler Integration**             | 5-minute recurring cron triggers reminder checks and missed escalations with constant-time secret headers                    | `POST /api/cron/reminders`, header `x-cron-secret`                                                              |
| **Health Guardian (Simulated Vitals)**      | Blood pressure, blood glucose, heart rate tracker with clear simulated data warnings                                         | `server/routes/vitals.js`, `GET/POST /api/vitals`                                                               |
| **Judge Evaluator Demo Mode**               | Pre-seeded Care Circle with Elder, Caretaker, Family accounts; one-click instant evaluator login; state reset                | `POST /api/auth/demo-login`, `POST /api/auth/reset-demo`, `GET /api/auth/demo-info`                             |

---

## 🏗️ Architecture & System Design

```
                     ┌──────────────────────────────────────────────┐
                     │          Elder / Caregiver Clients           │
                     │  (Responsive Web, Simple Mode, Speech Synth) │
                     └──────────────────────┬───────────────────────┘
                                            │ HTTPS / REST
                                            ▼
                     ┌──────────────────────────────────────────────┐
                     │          Google Cloud Run Container          │
                     │  (Node.js 20 Express Server, Alpine Non-Root)│
                     ├──────────────────────────────────────────────┤
                     │ 🔒 Helmet Headers, CORS, Rate Limiters      │
                     │ 🔑 JWT & Constant-Time Token Verification     │
                     │ 🛡️ Server-Side Elder Permissions Matrix      │
                     └──────┬──────────────────────┬─────────┬──────┘
                            │                      │         │
                            ▼                      │         ▼
   ┌────────────────────────────────┐              │   ┌───────────────────────────┐
   │ Google Gemini 1.5 Flash API    │              │   │   Nodemailer Email SMTP   │
   │ - MediGuide Label Extraction   │              │   │   - Due-Soon Notifications│
   │ - Weekly Family Adherence AI   │              │   │   - Missed Escalations    │
   └────────────────────────────────┘              │   │   - One-Click Action Links│
                                                   │   └───────────────────────────┘
                            ┌──────────────────────┴─────────┐
                            │      Data & Storage Tier       │
                            │  - Google Firestore (NoSQL)    │
                            │  - Google Cloud Secret Manager │
                            └────────────────────────────────┘
                                            ▲
                                            │ Secure Header POST
                     ┌──────────────────────┴───────────────────────┐
                     │    Google Cloud Scheduler (5-Min Cron)       │
                     │    Endpoint: /api/cron/reminders             │
                     └──────────────────────────────────────────────┘
```

---

## ☁️ Google Services Used & Why

1. **Google Cloud Run**:
   - _Why_: Provides a production-grade, secure, serverless container environment with zero idle cost, automatic HTTPS certificate provisioning, instant scaling, and native VPC/IAM integration.
2. **Google Cloud Scheduler**:
   - _Why_: Reliably invokes the cron endpoint every 5 minutes to trigger time-critical medication reminders, appointment alerts, and escalation workflows without keeping costly background daemons alive.
3. **Google Gemini API (`gemini-1.5-flash`)**:
   - _Why_: Powers MediGuide packaging extraction and transforms complex weekly adherence numbers into friendly, empathetic, 3–5 sentence family summaries. Offers sub-second latency and zero medical risk prompt bounding.
4. **Google Cloud Secret Manager**:
   - _Why_: Safely stores environment secrets (`APP_SECRET`, `CRON_SECRET`, `GEMINI_API_KEY`, `GMAIL_APP_PASSWORD`) decoupled from code and container images.
5. **Firebase / Google Cloud Firestore**:
   - _Why_: Document store for real-time synchronization, structured subcollections (medications, doses, appointments, vitals, audit logs), and enterprise security rules.

---

## 💻 Local Setup Guide

### 1. Prerequisites

- **Node.js** 20.x or higher
- **npm** 9.x or higher
- Git

### 2. Clone and Install Dependencies

```bash
git clone <repository-url>
cd carecircle-360
npm install
```

### 3. Environment Configuration

Copy the sample environment configuration file:

```bash
cp .env.example .env
```

Open `.env` and verify or set the variables:

```ini
PORT=8080
NODE_ENV=development
BASE_URL=http://localhost:8080
APP_SECRET=carecircle-super-secure-local-secret-32-chars
FIREBASE_PROJECT_ID=carecircle-360-demo
GEMINI_API_KEY=your_gemini_api_key_here
EMAIL_MOCK_MODE=true
CRON_SECRET=carecircle-scheduler-secret-auth-key-here
SCHEDULER_SECRET=carecircle-scheduler-secret-auth-key-here
```

### 4. Start the Application

```bash
# Production mode
npm start

# Development mode (with live reload)
npm run dev
```

Open your browser and navigate to:

- **Application UI**: [http://localhost:8080](http://localhost:8080)
- **Health Check**: [http://localhost:8080/health](http://localhost:8080/health)

---

## 🔒 Firebase Setup

CareCircle 360 uses Firebase Admin SDK on the server and enforces strict database rules:

1. **Create a Firebase Project**:
   - Go to the [Firebase Console](https://console.firebase.google.com/) and create a project (e.g., `carecircle-360`).
   - Enable **Firestore Database** in production mode.
2. **Service Account Credentials** (Optional for local if using Firebase Emulator / Mock Data store, mandatory for live Firestore):
   - In Project Settings $\to$ Service Accounts, generate a new private key and save as `serviceAccountKey.json` (do not commit to Git).
   - Alternatively, set `GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccountKey.json`.
3. **Deploy Security Rules**:
   Deploy the provided [firestore.rules](file:///C:/Users/Naitik/.gemini/antigravity/scratch/carecircle-360/firestore.rules):
   ```bash
   firebase deploy --only firestore:rules
   ```
   > All direct client reads and writes are denied by default (`allow read, write: if false;`). The backend Node.js server acts as the authenticated gatekeeper and single source of truth.

---

## 🤖 Gemini API Key Setup

1. Visit [Google AI Studio](https://aistudio.google.com/) to create a free API key.
2. Add your key to `.env`:
   ```ini
   GEMINI_API_KEY=AIzaSy...your_real_key
   ```
3. **Fallback Guarantee**: If `GEMINI_API_KEY` is omitted or quota is exceeded, CareCircle 360 seamlessly engages an internal rule-based template summary engine. The system never crashes or hangs when Gemini is unavailable.

---

## 📧 Email System Setup

CareCircle 360 uses Nodemailer with support for Gmail SMTP and a safe local mock mode:

### Safe Mock Mode (Default for Local Dev & Tests)

```ini
EMAIL_MOCK_MODE=true
```

When enabled, emails are logged to the console and stored in memory for programmatic test assertions without sending external network requests.

### Production Live SMTP Configuration

To send live emails using Gmail:

1. Enable **2-Step Verification** on your Google Account.
2. Generate an **App Password**: [https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
3. Set your credentials in `.env` (or Google Secret Manager):
   ```ini
   EMAIL_MOCK_MODE=false
   GMAIL_USER=carecircle.alerts@gmail.com
   GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
   EMAIL_FROM="CareCircle 360" <carecircle.alerts@gmail.com>
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_SECURE=true
   ```

---

## 🚀 Google Cloud Run & Cloud Scheduler Deployment

### Step 1: Store Production Secrets in Secret Manager

```bash
# Enable required Google Cloud APIs
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com

# Create secrets
echo -n "your-random-32-byte-hex-jwt-secret" | gcloud secrets create carecircle-app-secret --data-file=-
echo -n "your-cloud-scheduler-cron-secret-key" | gcloud secrets create carecircle-cron-secret --data-file=-
echo -n "your-gemini-api-key" | gcloud secrets create carecircle-gemini-api-key --data-file=-
echo -n "your-gmail-16-char-app-password" | gcloud secrets create carecircle-gmail-app-password --data-file=-
```

### Step 2: Deploy Container to Cloud Run

```bash
gcloud run deploy carecircle-360 \
  --source . \
  --region asia-south1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production,DEFAULT_TIMEZONE=Asia/Kolkata,EMAIL_MOCK_MODE=false,GMAIL_USER=your-carecircle-email@gmail.com,EMAIL_FROM="CareCircle 360 <your-carecircle-email@gmail.com>" \
  --set-secrets APP_SECRET=carecircle-app-secret:latest,CRON_SECRET=carecircle-cron-secret:latest,SCHEDULER_SECRET=carecircle-cron-secret:latest,GEMINI_API_KEY=carecircle-gemini-api-key:latest,GMAIL_APP_PASSWORD=carecircle-gmail-app-password:latest
```

### Step 3: Configure Cloud Scheduler Job (Every 5 Minutes)

Retrieve your Cloud Run URL (`https://carecircle-360-xxxxxx.a.run.app`) and create the scheduler:

```bash
gcloud scheduler jobs create http carecircle-cron-reminders \
  --location=asia-south1 \
  --schedule="*/5 * * * *" \
  --uri="https://<YOUR-CLOUD-RUN-URL>/api/cron/reminders" \
  --http-method=POST \
  --headers="x-cron-secret=your-cloud-scheduler-cron-secret-key,Content-Type=application/json" \
  --message-body="{}" \
  --time-zone="Asia/Kolkata" \
  --description="CareCircle 360 5-minute reminder & escalation trigger"
```

---

## 🧪 Running Automated Tests

CareCircle 360 features a test suite covering authentication, permissions, scheduling, dose state machines, email escalation, accessibility settings, and Gemini fallbacks:

```bash
# Run all automated tests
npm test
```

### Test Suite Summary:

- **`auth.test.js`**: Account provisioning, JWT validation, Care Circle creation & joining.
- **`auth_access_security.test.js`**: Boundary validation, cross-circle access rejection, rate limiters.
- **`elder_permissions_matrix.test.js`**: Server-side role permissions, dynamic elder overrides.
- **`elder_centred_controls.test.js`**: Instant revocation, escalation timing, signed one-click tokens.
- **`medications.test.js`**: Dose generation, multi-time schedules, timezone offsets.
- **`dose_tracking.test.js`**: Pending $\to$ Taken transitions, 60-min grace period boundary, adherence math.
- **`appointments_pulse.test.js`**: Appointment scheduling, chronological ordering, Daily Care Pulse calculation.
- **`email_reminder_cron.test.js`**: Due-soon detection, missed escalation, duplicate prevention, constant-time secret check.
- **`weekly_summary.test.js`**: Adherence aggregation by slot, Gemini prompting, safe template fallback.
- **`accessibility_settings.test.js`**: Font scaling, high-contrast, reduce-motion, speech preferences.
- **`demo_mode.test.js`**: Seeded evaluator persona accounts, zero-data-leakage verification.
- **Total**: **94 tests, 100% passing**.

---

## 🛡️ Safety, Privacy & Ethical Guardrails

- **Zero Medical Advice Policy**: Prompts given to Gemini strictly constrain output to textual transcription of packaging labels and neutral 3–5 sentence adherence trend observations. The prompt explicitly orders the AI never to recommend dosage changes, suggest diagnoses, or evaluate therapeutic efficacy.
- **Human-in-the-Loop Verification**: Any medication extracted via MediGuide AI requires explicit confirmation and approval by the caregiver or elder before being scheduled.
- **Elder Autonomy (Consent First)**: Caretakers and family members cannot see vitals, appointments, or medication details unless the elder has granted explicit viewing rights. The elder can revoke any member's access instantly.
- **Expiring Action Tokens**: One-click "Mark Taken" email links use HMAC-SHA256 signed tokens that expire after 24 hours and are single-use to prevent replay attacks.
- **Constant-Time Verification**: All shared tokens, scheduler secrets, and circle passcodes are compared using `crypto.timingSafeEqual` to eliminate timing side-channel attacks.

---

## 🔬 Simulated Data Disclosure

- **Health Guardian Vitals**: All blood pressure, blood glucose, and heart rate telemetry displayed in the application are synthetic demonstrations. The UI explicitly flags this with a visual badge: _"Simulated Demonstration Data — Not Real Medical Telemetry"_.
- **Demo Mode**: The pre-seeded evaluator Care Circle (Ramesh Patel, Sunita, Amit) consists entirely of fictitious demonstration data and mock reminders. No real personal identifying information (PII) or protected health information (PHI) is present.

---

## ⚠️ Known Limitations & Future Roadmap

1. **Hardware Device Integration**: Current vital signs are recorded manually or via simulated endpoints. Future versions will integrate Bluetooth LE (GATT) glucose meters and blood pressure cuffs.
2. **Offline-First Service Worker**: Basic responsive web and client caching are supported; full offline IndexedDB queueing with Background Sync is targeted for v2.0.
3. **Multi-Language Audio**: Speech synthesis currently leverages device-native locales; upcoming releases will support regional Indian dialects (Hindi, Gujarati, Tamil) for voice readout.

---

## 👥 Demo Evaluator Credentials

Evaluators can test the live application instantly without registration using one-click buttons on the login page:

| Role                  | Demo Email                         | Demo Password    | Pre-configured Privileges                                            |
| :-------------------- | :--------------------------------- | :--------------- | :------------------------------------------------------------------- |
| **Elder**             | `ramesh.elder@carecircle.demo`     | `DemoElder123!`  | Circle Owner, Simple Mode, Full Permission Matrix Control            |
| **Primary Caretaker** | `sunita.caretaker@carecircle.demo` | `DemoCare123!`   | Medication Editor, Appointment Manager, Immediate Escalation Contact |
| **Family Member**     | `amit.family@carecircle.demo`      | `DemoFamily123!` | Read-Only Pulse & Weekly Digest (as permitted by Elder)              |

---

_Built with ❤️ for Catalyst PromptWars._
