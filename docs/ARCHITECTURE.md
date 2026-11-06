\# RecallDesk

\### Context-Aware AI Customer Support with Persistent Memory



\*\*Repository:\*\* \[github.com/mutyalalakshmisrivalli/RecallDesk](https://github.com/mutyalalakshmisrivalli/RecallDesk)



\*\*Architecture \& Technical Documentation\*\*



\---



\## 1. Executive Summary



RecallDesk is an AI-powered customer support platform designed to solve a fundamental limitation of conventional conversational support systems: the loss of customer context between interactions.



Traditional support chatbots often approach each conversation as an isolated request. Customers may have to repeat their device information, explain previously attempted troubleshooting steps, and describe problems that they have already encountered.



RecallDesk introduces persistent, customer-specific memory into the support workflow.



Built with React, FastAPI, Groq, SQLite, and Hindsight, the platform retrieves relevant historical support information, generates context-aware responses, records support interactions, and retains customer-confirmed successful resolutions for future use.



The objective is to make customer support more continuous, personalized, and outcome-aware.



\## 2. The Problem We Address



Conventional AI support systems can struggle with:



\- Repeated troubleshooting across multiple conversations.

\- Losing important customer and device context.

\- Recommending steps that customers have already attempted.

\- Failing to distinguish successful solutions from unsuccessful attempts.

\- Limited visibility into customer interactions and support outcomes.



RecallDesk addresses these challenges through a persistent-memory-based support architecture.



\## 3. Our Approach



RecallDesk connects three important capabilities:



1\. \*\*Conversational intelligence:\*\* Groq generates natural-language support responses.

2\. \*\*Persistent memory:\*\* Hindsight retains and retrieves relevant customer-specific support history.

3\. \*\*Support operations:\*\* SQLite manages customer accounts, conversations, tickets, resolution records, and sentiment information.



The key design principle is that a support interaction should contribute useful context to future interactions.



Importantly, RecallDesk improves continuity through memory retrieval and retention. It does not claim to retrain or fine-tune the underlying language model after every conversation.



\## 4. Technology Stack



| Layer | Technology | Responsibility |

|---|---|---|

| Frontend | React | Interactive customer and admin portals |

| Frontend tooling | Vite | Development and production build tooling |

| Backend | Python, FastAPI | API orchestration and business logic |

| LLM | Groq | AI response generation |

| Memory engine | Hindsight | Persistent memory retention and recall |

| Database | SQLite | Application data persistence |

| Authentication | JWT | Authenticated sessions and role checks |

| Password security | pwdlib | Password hashing and verification |

| API validation | Pydantic | Request validation |



\## 5. System Architecture



```mermaid

flowchart TB

&#x20;   C\[Customer] --> CP\[React Customer Portal]

&#x20;   A\[Administrator] --> AP\[React Admin Portal]



&#x20;   CP --> API\[FastAPI Backend]

&#x20;   AP --> API



&#x20;   API --> AUTH\[JWT Authentication and Authorization]



&#x20;   API --> AGENT\[RecallDesk Support Orchestration]



&#x20;   AGENT --> HM\[Hindsight Memory Layer]

&#x20;   AGENT --> LLM\[Groq LLM]

&#x20;   AGENT --> DB\[(SQLite Database)]



&#x20;   HM --> AGENT

&#x20;   LLM --> AGENT

&#x20;   DB --> AGENT



&#x20;   AGENT --> API

&#x20;   API --> CP

&#x20;   API --> AP

```



\### Component Responsibilities



\*\*React Frontend\*\*



Provides two role-specific experiences:



\- Customer Portal: account access, AI support conversations, saved conversation history, and resolution feedback.

\- Admin Portal: operational overview, customer management, conversations, environments, sentiment, support tickets, and memory inspection.



\*\*FastAPI Backend\*\*



Acts as the central orchestration layer. It validates requests, authenticates users, coordinates AI and memory operations, and manages application data.



\*\*Groq\*\*



Generates responses using the current customer request and the relevant memories retrieved by RecallDesk.



\*\*Hindsight\*\*



Provides the persistent memory layer through its asynchronous `arecall`, `aretain`, and `alist\_memories` operations.



\*\*SQLite\*\*



Maintains structured application records independently of the Hindsight memory service.



\## 6. The Hindsight Memory Architecture



Persistent memory is the central differentiator of RecallDesk.



RecallDesk uses Hindsight to retain customer support exchanges and retrieve relevant historical context when customers return.



\### 6.1 Customer-specific memory tagging



Each authenticated customer receives an application-level memory tag:



```text

customer:{customer\_id}

```



Examples:



```text

customer:1

customer:2

```



RecallDesk uses these tags during memory retrieval with strict tag matching.



This allows the application to scope retrieved support history to the authenticated customer.



The current implementation uses a configured Hindsight bank with customer-specific tags rather than creating a separate bank for every customer.



\### 6.2 Memory retrieval



When a customer submits a support request:



1\. The backend validates the JWT session.

2\. It obtains the authenticated customer ID.

3\. It constructs the customer's memory tag.

4\. Hindsight searches for relevant previous support interactions.

5\. The retrieval query prioritizes:

&#x20;  - Similar previous problems.

&#x20;  - Device and environment details.

&#x20;  - Troubleshooting steps already attempted.

&#x20;  - Recurring issues.

&#x20;  - Explicitly confirmed successful resolutions.

&#x20;  - Failed or unconfirmed attempts when relevant.



6\. Retrieved memory context is passed to the Groq model.



\### 6.3 Context-aware response generation



The AI assistant receives:



\- Its support-assistant instructions.

\- The authenticated customer's identity.

\- Retrieved historical memories.

\- The current customer message.



The response instructions explicitly discourage inventing previous interactions, claiming unverified solutions worked, or unnecessarily repeating completed troubleshooting steps.



\### 6.4 Memory retention



After a support conversation is successfully saved, RecallDesk retains the interaction in Hindsight.



The retained information includes:



\- Customer identity.

\- Customer ID.

\- Ticket ID.

\- Customer message.

\- Assistant response.



The memory receives the corresponding customer-specific tag.



\### 6.5 Learning from confirmed resolutions



A particularly important RecallDesk capability is its resolution-feedback workflow.



The customer can report whether a proposed solution:



\- Worked successfully.

\- Failed.

\- Remains pending.



A resolution is treated as a confirmed success only when the outcome is `success` and the customer explicitly confirms it.



For confirmed successes:



1\. The resolution is saved in SQLite.

2\. The support ticket is closed.

3\. A ticket timeline event is recorded.

4\. The successful solution is retained in Hindsight.

5\. The memory receives customer-specific and successful-resolution tags.



Unsuccessful or unconfirmed feedback is recorded but is not promoted as a confirmed successful resolution.



This creates a foundation for future support responses to prioritize solutions that have actually worked for the customer.



\## 7. End-to-End Support Workflow



```mermaid

sequenceDiagram

&#x20;   actor Customer

&#x20;   participant UI as React Portal

&#x20;   participant API as FastAPI

&#x20;   participant H as Hindsight

&#x20;   participant G as Groq

&#x20;   participant DB as SQLite



&#x20;   Customer->>UI: Submit support question

&#x20;   UI->>API: POST /support/message

&#x20;   API->>API: Validate JWT and customer

&#x20;   API->>H: Recall customer-specific memories

&#x20;   H-->>API: Relevant historical context

&#x20;   API->>G: Current question + memory context

&#x20;   G-->>API: AI-generated support response

&#x20;   API->>DB: Save conversation and ticket

&#x20;   API->>DB: Record sentiment

&#x20;   API->>H: Retain support interaction

&#x20;   API-->>UI: Reply, memories, ticket and status

&#x20;   UI-->>Customer: Display support response



&#x20;   Customer->>UI: Submit resolution feedback

&#x20;   UI->>API: POST resolution feedback

&#x20;   API->>DB: Save resolution and ticket event

&#x20;   opt Customer confirms success

&#x20;       API->>DB: Close ticket

&#x20;       API->>H: Retain confirmed successful solution

&#x20;   end

&#x20;   API-->>UI: Return resolution status

```



\## 8. Customer and Administrator Portals



\### Customer Portal



The customer-facing interface provides:



\- Customer registration and login.

\- Authenticated support conversations.

\- AI-generated troubleshooting responses.

\- Saved conversation history.

\- New conversation functionality.

\- Resolution feedback submission.

\- Automatic browser and operating-system environment synchronization.



\### Administrator Portal



The administrative interface includes:



| Module | Purpose |

|---|---|

| Overview | Customer, conversation, ticket, and frustration metrics |

| Customers | Registered customer records |

| Conversations | Customer and assistant conversation history |

| Customer Environments | Browser, operating system, and device-type information |

| Sentiment Analysis | Sentiment records and supporting evidence |

| Support Tickets | Ticket status and support activity |

| Memory Center | Inspection of retained Hindsight memories |

| Settings | Administrative interface section |



The administrator can also inspect ticket timelines containing ticket events, conversations, and resolution records.



\## 9. Application Data Architecture



SQLite is responsible for structured application persistence.



The principal tables include:



| Table | Stored information |

|---|---|

| users | Accounts, roles, password hashes |

| conversations | Customer messages and assistant responses |

| support\_tickets | Ticket details and status |

| ticket\_events | Ticket activity and status history |

| ticket\_resolutions | Submitted solutions and customer feedback |

| customer\_profiles | Operating system, browser, and device information |

| customer\_sentiment | Sentiment labels, confidence, and evidence |



Hindsight stores the persistent conversational and resolution memories used by the AI support workflow.



This separation allows RecallDesk to use structured relational records for application operations and a dedicated memory system for contextual retrieval.



\## 10. Authentication and Access Control



RecallDesk implements JWT-based authentication.



The authentication workflow includes:



\- Customer registration.

\- Password hashing and verification.

\- Login and access-token generation.

\- Authenticated API access.

\- Customer and administrator role checks.

\- Ownership checks for customer ticket operations.



The backend derives the customer identity from the authenticated token instead of trusting a customer ID supplied in the support message.



Administrator endpoints use an administrator authorization dependency.



\## 11. Sentiment and Customer Environment Intelligence



\### Sentiment Analysis



RecallDesk currently uses a phrase-matching sentiment mechanism to identify:



\- Frustrated interactions.

\- Satisfied interactions.

\- Neutral interactions.



Each result includes a sentiment label, confidence value, and supporting phrase evidence where available.



The resulting information is stored in SQLite and exposed to the administrative dashboard.



This is currently a rule-based implementation rather than a trained sentiment-classification model.



\### Customer Environment Profiles



The application synchronizes customer environment information from the browser's User-Agent header.



Currently supported information includes:



\- Operating system and available version.

\- Browser and available version.

\- Device category: desktop, mobile, or tablet.

\- RecallDesk Web application identifier.



This information helps administrators understand the technical environment associated with support requests.



\## 12. API Overview



The principal backend routes include:



| Method | Endpoint | Purpose |

|---|---|---|

| POST | `/auth/signup` | Customer registration |

| POST | `/auth/login` | Authentication |

| GET | `/auth/me` | Retrieve authenticated account |

| GET | `/` | Backend welcome endpoint |

| GET | `/health` | Backend configuration health check |

| POST | `/support/message` | Context-aware AI support |

| GET | `/customer/conversations` | Customer conversation history |

| POST | `/customer/profile/sync` | Synchronize environment profile |

| POST | `/customer/tickets/{ticket\_id}/resolution` | Submit resolution feedback |

| GET | `/admin/dashboard` | Administrative metrics |

| GET | `/admin/customers` | Customer records |

| GET | `/admin/conversations` | Conversation records |

| GET | `/admin/memories` | Hindsight Memory Center |

| GET | `/admin/environment-profiles` | Environment profiles |

| GET | `/admin/sentiments` | Sentiment records |

| GET | `/admin/tickets` | Support ticket records |

| GET | `/admin/tickets/{ticket\_id}/timeline` | Ticket activity and resolution history |



Interactive API documentation is available through FastAPI Swagger UI at `/docs` when the backend is running.



\## 13. Error Handling and Reliability



RecallDesk includes handling for important service failures:



\- Invalid or expired authentication sessions are rejected.

\- Customer support requests require configured AI and memory services.

\- Hindsight recall failures are logged and allow the response workflow to continue with an empty-memory fallback.

\- Groq generation failures return a service error.

\- Support interactions use SQLite transaction handling.

\- Hindsight retention status is returned to the frontend so a response is not incorrectly presented as successfully memorized.



A successful AI response and successful memory retention are treated as separate outcomes.



\## 14. Project Structure



```text

RecallDesk/

│

├── backend/

│   ├── auth.py

│   ├── auth\_routes.py

│   ├── create\_admin.py

│   ├── database.py

│   ├── environment.py

│   ├── main.py

│   └── sentiment.py

│

├── frontend/

│   ├── public/

│   ├── src/

│   │   ├── App.jsx

│   │   ├── CustomerPortal.jsx

│   │   ├── App.css

│   │   ├── CustomerPortal.css

│   │   ├── index.css

│   │   └── main.jsx

│   ├── package.json

│   └── vite.config.js

│

├── docs/

│   └── ARCHITECTURE.md

│

├── .env.example

├── .gitignore

├── README.md

└── requirements.txt

```



\## 15. Setup and Local Execution



\### Prerequisites



\- Python 3.12 or compatible version.

\- Node.js and npm.

\- Groq API credentials.

\- Hindsight service credentials.



\### Backend



Create and activate the virtual environment:



```powershell

python -m venv .venv

.\\.venv\\Scripts\\Activate.ps1

```



Install dependencies:



```powershell

pip install -r requirements.txt

```



Create a root `.env` file based on `.env.example` and configure your own credentials.



Start the API:



```powershell

python -m uvicorn backend.main:app --reload

```



Backend:



`http://127.0.0.1:8000`



Swagger documentation:



`http://127.0.0.1:8000/docs`



\### Frontend



Open another terminal:



```powershell

cd frontend

npm install

npm run dev

```



Open the local URL displayed by Vite.



If port 5173 is occupied, Vite may select another available port.



\## 16. Security and Production Readiness



RecallDesk includes password hashing, JWT authentication, role checks, customer ownership checks, and environment-based secret configuration.



The current repository represents a development-stage implementation. Before production deployment, additional hardening is required.



Recommended improvements include:



\- Restrict CORS to trusted frontend origins.

\- Configure HTTPS and secure deployment secrets.

\- Introduce rate limiting and abuse protection.

\- Add comprehensive automated authorization and memory-isolation tests.

\- Review data retention, privacy, and deletion workflows.

\- Add production logging, monitoring, and backups.

\- Move frontend API configuration to environment-based settings.

\- Review browser token storage and deployment security.



\## 17. Current Implementation and Future Roadmap



\### Implemented in the current codebase



\- React customer and administrator portals.

\- FastAPI backend.

\- JWT authentication and role-based access checks.

\- Groq-powered support responses.

\- Hindsight persistent memory integration.

\- Customer-tagged memory retrieval.

\- Customer conversation history.

\- Support ticket creation and open-ticket reuse.

\- Customer-confirmed resolution retention.

\- Sentiment records and administrative analysis.

\- Customer environment synchronization.

\- Administrative Memory Center and ticket timelines.



\### Future enhancements



\- Automated memory-quality and retrieval evaluations.

\- Expanded automated cross-customer isolation tests.

\- Memory correction and deletion workflows.

\- Advanced sentiment classification.

\- Document and image-based support.

\- Production deployment and observability.

\- More comprehensive support analytics.



\## 18. Engineering Philosophy



RecallDesk is built around a simple principle:



\*\*A support system should remember what matters, respect what did not work, and learn from what the customer confirms worked.\*\*



By combining conversational AI with persistent memory and structured support operations, RecallDesk aims to move beyond isolated chatbot interactions toward continuous, context-aware customer support.



\---



\*\*RecallDesk — Remembering every interaction. Improving every support experience.\*\*

