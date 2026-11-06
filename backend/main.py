import os

import asyncio

import logging

from dotenv import load_dotenv

from fastapi import FastAPI, HTTPException, Depends, Query

from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel, Field

from hindsight_client import Hindsight

from groq import Groq

from backend.database import create_tables, get_connection

from backend.auth_routes import (

    router as auth_router,

    get_current_admin,

    get_current_user,

)

from backend.environment import router as environment_router

from backend.sentiment import (

    detect_sentiment,

    save_customer_sentiment,

)

# --------------------------------------------------

# CONFIGURATION

# --------------------------------------------------

load_dotenv()

logging.basicConfig(level=logging.INFO)

logger = logging.getLogger("recalldesk")

app = FastAPI(

    title="RecallDesk Customer Support Agent",

    description="An AI support agent that remembers customer history",

    version="1.4.0",

)

create_tables()

app.include_router(auth_router)

app.include_router(environment_router)

app.add_middleware(

    CORSMiddleware,

    allow_origins=["*"],

    allow_credentials=False,

    allow_methods=["*"],

    allow_headers=["*"],

)

# --------------------------------------------------

# HINDSIGHT CLIENT

# --------------------------------------------------

HINDSIGHT_BASE_URL = os.getenv("HINDSIGHT_BASE_URL")

HINDSIGHT_API_KEY = os.getenv("HINDSIGHT_API_KEY")

BANK_ID = os.getenv("HINDSIGHT_BANK_ID")

hindsight_client = Hindsight(

    base_url=HINDSIGHT_BASE_URL,

    api_key=HINDSIGHT_API_KEY,

)

# --------------------------------------------------

# GROQ CLIENT

# --------------------------------------------------

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

groq_client = Groq(api_key=GROQ_API_KEY) if GROQ_API_KEY else None

GROQ_MODEL = os.getenv(

    "GROQ_MODEL",

    "openai/gpt-oss-120b",

)

# --------------------------------------------------

# REQUEST MODELS

# --------------------------------------------------

class CustomerMessage(BaseModel):

    message: str = Field(min_length=1, max_length=10000)

class ResolutionData(BaseModel):

    solution: str = Field(min_length=1, max_length=5000)

    outcome: str = Field(pattern="^(success|failed|pending)$")

    customer_confirmed: bool = False

    conversation_id: int | None = None

    notes: str = Field(default="", max_length=2000)

# --------------------------------------------------

# HELPERS

# --------------------------------------------------

def get_customer_id(current_user):

    try:

        return int(current_user["sub"])

    except (KeyError, TypeError, ValueError):

        raise HTTPException(

            status_code=401,

            detail="Your login session is invalid. Please sign in again.",

        )

def get_customer_account(customer_id):

    connection = get_connection()

    try:

        account = connection.execute(

            """

            SELECT id, name, email, role

            FROM users

            WHERE id = ?

            """,

            (customer_id,),

        ).fetchone()

        if not account or account["role"] != "user":

            raise HTTPException(

                status_code=403,

                detail="Customer account required.",

            )

        return account

    finally:

        connection.close()

# --------------------------------------------------

# SAVE SUPPORT INTERACTION

# UPDATED: REUSE EXISTING OPEN TICKET

# --------------------------------------------------

def save_support_interaction(

    customer_id,

    customer_message,

    assistant_reply,

):

    """

    Reuse the customer's latest open ticket.

    If no open ticket exists, create a new ticket.

    Every customer message gets a separate conversation record,

    but multiple conversations can belong to the same ticket.

    All database changes are saved in one transaction.

    """

    connection = get_connection()

    try:

        subject = customer_message.strip().replace("\n", " ")[:100]

        if not subject:

            subject = "Customer support request"

        # 1. Check whether this customer already has an open ticket.

        existing_ticket = connection.execute(

            """

            SELECT id

            FROM support_tickets

            WHERE user_id = ?

              AND status = 'open'

            ORDER BY created_at DESC, id DESC

            LIMIT 1

            """,

            (customer_id,),

        ).fetchone()

        ticket_created = False

        # 2. Reuse the existing open ticket.

        if existing_ticket:

            ticket_id = existing_ticket["id"]

            connection.execute(

                """

                UPDATE support_tickets

                SET updated_at = CURRENT_TIMESTAMP

                WHERE id = ?

                """,

                (ticket_id,),

            )

        # 3. Otherwise, create a new ticket.

        else:

            ticket_cursor = connection.execute(

                """

                INSERT INTO support_tickets (

                    user_id,

                    subject,

                    description,

                    status,

                    priority

                )

                VALUES (?, ?, ?, 'open', 'normal')

                """,

                (

                    customer_id,

                    subject,

                    customer_message,

                ),

            )

            ticket_id = ticket_cursor.lastrowid

            ticket_created = True

            connection.execute(

                """

                INSERT INTO ticket_events (

                    ticket_id,

                    user_id,

                    event_type,

                    description,

                    old_status,

                    new_status,

                    actor_role

                )

                VALUES (?, ?, ?, ?, ?, ?, ?)

                """,

                (

                    ticket_id,

                    customer_id,

                    "ticket_created",

                    "Support ticket created.",

                    None,

                    "open",

                    "system",

                ),

            )

        # 4. Save this message as a new conversation.

        conversation_cursor = connection.execute(

            """

            INSERT INTO conversations (

                user_id,

                customer_message,

                assistant_reply,

                ticket_id

            )

            VALUES (?, ?, ?, ?)

            """,

            (

                customer_id,

                customer_message,

                assistant_reply,

                ticket_id,

            ),

        )

        conversation_id = conversation_cursor.lastrowid

        # 5. Add conversation event to the ticket timeline.

        connection.execute(

            """

            INSERT INTO ticket_events (

                ticket_id,

                user_id,

                event_type,

                description,

                actor_role

            )

            VALUES (?, ?, ?, ?, ?)

            """,

            (

                ticket_id,

                customer_id,

                "conversation_added",

                "Customer support conversation added.",

                "customer",

            ),

        )

        connection.commit()

        return conversation_id, ticket_id, ticket_created

    except Exception:

        connection.rollback()

        raise

    finally:

        connection.close()

# --------------------------------------------------

# HINDSIGHT MEMORY SERIALIZATION

# --------------------------------------------------

def memory_to_dict(item):

    return {

        "id": str(getattr(item, "id", "")),

        "text": getattr(item, "text", "") or "",

        "context": getattr(item, "context", "") or "",

        "var_date": (

            str(getattr(item, "var_date", ""))

            if getattr(item, "var_date", None) is not None

            else None

        ),

        "fact_type": str(getattr(item, "fact_type", "") or ""),

        "tags": getattr(item, "tags", None) or [],

        "state": str(getattr(item, "state", "") or ""),

    }

# --------------------------------------------------

# HOME

# --------------------------------------------------

@app.get("/")

def home():

    return {

        "message": "Welcome to RecallDesk!",

        "status": "Backend is running",

    }

# --------------------------------------------------

# HEALTH CHECK

# --------------------------------------------------

@app.get("/health")

def health():

    return {

        "status": "healthy",

        "hindsight_configured": bool(BANK_ID and HINDSIGHT_BASE_URL),

        "groq_configured": bool(GROQ_API_KEY),

    }

# --------------------------------------------------

# ADMIN DASHBOARD

# --------------------------------------------------

@app.get("/admin/dashboard")

def admin_dashboard(admin=Depends(get_current_admin)):

    connection = get_connection()

    try:

        total_customers = connection.execute(

            """

            SELECT COUNT(*)

            FROM users

            WHERE role = 'user'

            """

        ).fetchone()[0]

        total_conversations = connection.execute(

            "SELECT COUNT(*) FROM conversations"

        ).fetchone()[0]

        total_tickets = connection.execute(

            "SELECT COUNT(*) FROM support_tickets"

        ).fetchone()[0]

        frustrated_customers = connection.execute(

            """

            SELECT COUNT(*)

            FROM customer_sentiment

            WHERE sentiment = 'frustrated'

            """

        ).fetchone()[0]

        return {

            "total_customers": total_customers,

            "total_conversations": total_conversations,

            "total_tickets": total_tickets,

            "frustrated_customers": frustrated_customers,

        }

    finally:

        connection.close()

# --------------------------------------------------

# ADMIN CUSTOMERS

# --------------------------------------------------

@app.get("/admin/customers")

def admin_customers(

    limit: int = Query(default=20, ge=1, le=500),

    offset: int = Query(default=0, ge=0),

    admin=Depends(get_current_admin),

):

    connection = get_connection()

    try:

        total = connection.execute(

            """

            SELECT COUNT(*)

            FROM users

            WHERE role = 'user'

            """

        ).fetchone()[0]

        rows = connection.execute(

            """

            SELECT id, name, email, created_at

            FROM users

            WHERE role = 'user'

            ORDER BY id DESC

            LIMIT ? OFFSET ?

            """,

            (limit, offset),

        ).fetchall()

        return {

            "total": total,

            "limit": limit,

            "offset": offset,

            "customers": [dict(row) for row in rows],

        }

    finally:

        connection.close()

# --------------------------------------------------

# ADMIN CONVERSATION HISTORY

# --------------------------------------------------

@app.get("/admin/conversations")

def admin_conversations(

    limit: int = Query(default=20, ge=1, le=500),

    offset: int = Query(default=0, ge=0),

    admin=Depends(get_current_admin),

):

    connection = get_connection()

    try:

        total = connection.execute(

            "SELECT COUNT(*) FROM conversations"

        ).fetchone()[0]

        rows = connection.execute(

            """

            SELECT

                c.id,

                c.user_id,

                c.ticket_id,

                u.name AS customer_name,

                u.email AS customer_email,

                c.customer_message,

                c.assistant_reply,

                c.created_at

            FROM conversations AS c

            INNER JOIN users AS u ON c.user_id = u.id

            ORDER BY c.created_at DESC, c.id DESC

            LIMIT ? OFFSET ?

            """,

            (limit, offset),

        ).fetchall()

        return {

            "total": total,

            "limit": limit,

            "offset": offset,

            "conversations": [dict(row) for row in rows],

        }

    finally:

        connection.close()

# --------------------------------------------------

# ADMIN HINDSIGHT MEMORY CENTER

# --------------------------------------------------

@app.get("/admin/memories")

async def get_admin_memories(

    limit: int = Query(default=20, ge=1, le=100),

    offset: int = Query(default=0, ge=0),

    admin=Depends(get_current_admin),

):

    if not BANK_ID:

        raise HTTPException(

            status_code=503,

            detail="The memory service is not configured.",

        )

    try:

        result = await hindsight_client.alist_memories(

            bank_id=BANK_ID,

            limit=limit,

            offset=offset,

        )

        items = getattr(result, "items", None) or []

        memories = [memory_to_dict(item) for item in items]

        return {

            "total": getattr(result, "total", len(memories)),

            "limit": limit,

            "offset": offset,

            "items": memories,

        }

    except Exception:

        logger.exception("Hindsight memory listing failed")

        raise HTTPException(

            status_code=503,

            detail="The memory service is temporarily unavailable. Please try again.",

        )

# --------------------------------------------------

# ADMIN CUSTOMER ENVIRONMENT PROFILES

# --------------------------------------------------

@app.get("/admin/environment-profiles")

def admin_environment_profiles(

    limit: int = Query(default=100, ge=1, le=500),

    offset: int = Query(default=0, ge=0),

    admin=Depends(get_current_admin),

):

    connection = get_connection()

    try:

        total = connection.execute(

            "SELECT COUNT(*) FROM customer_profiles"

        ).fetchone()[0]

        rows = connection.execute(

            """

            SELECT

                p.user_id,

                u.name AS customer_name,

                u.email AS customer_email,

                p.os_name,

                p.os_version,

                p.device_type,

                p.device_name,

                p.browser_name,

                p.browser_version,

                p.app_version,

                p.additional_details,

                p.updated_at

            FROM customer_profiles p

            INNER JOIN users u ON u.id = p.user_id

            ORDER BY p.updated_at DESC

            LIMIT ? OFFSET ?

            """,

            (limit, offset),

        ).fetchall()

        return {

            "total": total,

            "limit": limit,

            "offset": offset,

            "profiles": [dict(row) for row in rows],

        }

    finally:

        connection.close()

# --------------------------------------------------

# ADMIN CUSTOMER SENTIMENT

# --------------------------------------------------

@app.get("/admin/sentiments")

def admin_sentiments(

    limit: int = Query(default=100, ge=1, le=500),

    offset: int = Query(default=0, ge=0),

    admin=Depends(get_current_admin),

):

    connection = get_connection()

    try:

        total = connection.execute(

            "SELECT COUNT(*) FROM customer_sentiment"

        ).fetchone()[0]

        rows = connection.execute(

            """

            SELECT

                s.id,

                s.user_id,

                u.name AS customer_name,

                u.email AS customer_email,

                s.conversation_id,

                COALESCE(s.ticket_id, c.ticket_id) AS ticket_id,

                s.sentiment,

                s.confidence,

                s.evidence,

                s.created_at

            FROM customer_sentiment s

            INNER JOIN users u ON u.id = s.user_id

            LEFT JOIN conversations c ON c.id = s.conversation_id

            ORDER BY s.created_at DESC, s.id DESC

            LIMIT ? OFFSET ?

            """,

            (limit, offset),

        ).fetchall()

        return {

            "total": total,

            "limit": limit,

            "offset": offset,

            "sentiments": [dict(row) for row in rows],

        }

    finally:

        connection.close()

# --------------------------------------------------

# ADMIN AUTOMATIC SUPPORT TICKETS

# --------------------------------------------------

@app.get("/admin/tickets")

def admin_tickets(

    limit: int = Query(default=100, ge=1, le=500),

    offset: int = Query(default=0, ge=0),

    admin=Depends(get_current_admin),

):

    connection = get_connection()

    try:

        total = connection.execute(

            "SELECT COUNT(*) FROM support_tickets"

        ).fetchone()[0]

        rows = connection.execute(

            """

            SELECT

                t.id AS ticket_id,

                t.user_id,

                u.name AS customer_name,

                u.email AS customer_email,

                t.subject,

                t.description,

                t.status,

                t.priority,

                t.created_at,

                t.updated_at,

                t.closed_at

            FROM support_tickets t

            INNER JOIN users u ON u.id = t.user_id

            ORDER BY t.created_at DESC, t.id DESC

            LIMIT ? OFFSET ?

            """,

            (limit, offset),

        ).fetchall()

        return {

            "total": total,

            "limit": limit,

            "offset": offset,

            "tickets": [dict(row) for row in rows],

        }

    finally:

        connection.close()

# --------------------------------------------------

# ADMIN TICKET TIMELINE

# --------------------------------------------------

@app.get("/admin/tickets/{ticket_id}/timeline")

def admin_ticket_timeline(

    ticket_id: int,

    admin=Depends(get_current_admin),

):

    connection = get_connection()

    try:

        ticket = connection.execute(

            """

            SELECT

                t.id AS ticket_id,

                t.user_id,

                u.name AS customer_name,

                u.email AS customer_email,

                t.subject,

                t.description,

                t.status,

                t.priority,

                t.created_at,

                t.updated_at,

                t.closed_at

            FROM support_tickets t

            INNER JOIN users u ON u.id = t.user_id

            WHERE t.id = ?

            """,

            (ticket_id,),

        ).fetchone()

        if not ticket:

            raise HTTPException(

                status_code=404,

                detail="Ticket not found.",

            )

        events = connection.execute(

            """

            SELECT *

            FROM ticket_events

            WHERE ticket_id = ?

            ORDER BY created_at ASC, id ASC

            """,

            (ticket_id,),

        ).fetchall()

        conversations = connection.execute(

            """

            SELECT

                id,

                user_id,

                ticket_id,

                customer_message,

                assistant_reply,

                created_at

            FROM conversations

            WHERE ticket_id = ?

            ORDER BY created_at ASC, id ASC

            """,

            (ticket_id,),

        ).fetchall()

        resolutions = connection.execute(

            """

            SELECT

                id,

                ticket_id,

                user_id,

                conversation_id,

                solution,

                outcome,

                customer_confirmed,

                notes,

                created_at

            FROM ticket_resolutions

            WHERE ticket_id = ?

            ORDER BY created_at ASC, id ASC

            """,

            (ticket_id,),

        ).fetchall()

        return {

            "ticket": dict(ticket),

            "events": [dict(row) for row in events],

            "conversations": [dict(row) for row in conversations],

            "resolutions": [dict(row) for row in resolutions],

        }

    finally:

        connection.close()

# --------------------------------------------------

# --------------------------------------------------
# CUSTOMER CHAT HISTORY
# --------------------------------------------------

@app.get("/customer/conversations")
def customer_conversations(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user=Depends(get_current_user),
):
    """Return the authenticated customer's saved support exchanges."""
    customer_id = get_customer_id(current_user)
    get_customer_account(customer_id)

    connection = get_connection()
    try:
        total = connection.execute(
            """
            SELECT COUNT(*)
            FROM conversations
            WHERE user_id = ?
            """,
            (customer_id,),
        ).fetchone()[0]

        rows = connection.execute(
            """
            SELECT
                id,
                ticket_id,
                customer_message,
                assistant_reply,
                created_at
            FROM conversations
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            (customer_id, limit, offset),
        ).fetchall()

        return {
            "total": total,
            "limit": limit,
            "offset": offset,
            "conversations": [dict(row) for row in rows],
        }
    finally:
        connection.close()


# CUSTOMER RESOLUTION MEMORY

# --------------------------------------------------

@app.post("/customer/tickets/{ticket_id}/resolution")

async def submit_ticket_resolution(

    ticket_id: int,

    data: ResolutionData,

    current_user=Depends(get_current_user),

):

    """

    Customers can submit a solution outcome for their own ticket.

    Only a successful solution explicitly confirmed by the customer

    closes the ticket and is retained as successful Hindsight memory.

    """

    customer_id = get_customer_id(current_user)

    get_customer_account(customer_id)

    confirmed_success = (

        data.outcome == "success"

        and data.customer_confirmed is True

    )

    connection = get_connection()

    try:

        ticket = connection.execute(

            """

            SELECT id, user_id, status

            FROM support_tickets

            WHERE id = ?

            """,

            (ticket_id,),

        ).fetchone()

        if not ticket:

            raise HTTPException(

                status_code=404,

                detail="Ticket not found.",

            )

        if int(ticket["user_id"]) != customer_id:

            raise HTTPException(

                status_code=403,

                detail="You cannot update another customer's ticket.",

            )

        if ticket["status"] == "closed":

            raise HTTPException(

                status_code=409,

                detail="This ticket is already closed.",

            )

        if data.conversation_id is not None:

            conversation = connection.execute(

                """

                SELECT id

                FROM conversations

                WHERE id = ?

                  AND ticket_id = ?

                  AND user_id = ?

                """,

                (

                    data.conversation_id,

                    ticket_id,

                    customer_id,

                ),

            ).fetchone()

            if not conversation:

                raise HTTPException(

                    status_code=400,

                    detail="The conversation does not belong to this ticket.",

                )

        old_status = ticket["status"]

        if confirmed_success:

            new_status = "closed"

        else:

            new_status = old_status

        cursor = connection.execute(

            """

            INSERT INTO ticket_resolutions (

                ticket_id,

                user_id,

                conversation_id,

                solution,

                outcome,

                customer_confirmed,

                notes

            )

            VALUES (?, ?, ?, ?, ?, ?, ?)

            """,

            (

                ticket_id,

                customer_id,

                data.conversation_id,

                data.solution.strip(),

                data.outcome,

                int(data.customer_confirmed),

                data.notes.strip(),

            ),

        )

        resolution_id = cursor.lastrowid

        if confirmed_success:

            connection.execute(

                """

                UPDATE support_tickets

                SET status = 'closed',

                    updated_at = CURRENT_TIMESTAMP,

                    closed_at = CURRENT_TIMESTAMP

                WHERE id = ? AND user_id = ?

                """,

                (ticket_id, customer_id),

            )

        event_description = (

            "Customer confirmed that the support solution worked."

            if confirmed_success

            else (

                "Customer submitted resolution feedback: "

                f"{data.outcome}. Ticket remains {old_status}."

            )

        )

        connection.execute(

            """

            INSERT INTO ticket_events (

                ticket_id,

                user_id,

                event_type,

                description,

                old_status,

                new_status,

                actor_role

            )

            VALUES (?, ?, ?, ?, ?, ?, ?)

            """,

            (

                ticket_id,

                customer_id,

                "resolution_confirmed" if confirmed_success else "resolution_feedback",

                event_description,

                old_status,

                new_status,

                "customer",

            ),

        )

        connection.commit()

    except HTTPException:

        connection.rollback()

        raise

    except Exception:

        connection.rollback()

        logger.exception(

            "Resolution storage failed for ticket_id=%s",

            ticket_id,

        )

        raise HTTPException(

            status_code=500,

            detail="Could not save the resolution.",

        )

    finally:

        connection.close()

    # Retain only confirmed successful resolutions in Hindsight.

    memory_saved = False

    if confirmed_success and BANK_ID:

        try:

            await hindsight_client.aretain(

                bank_id=BANK_ID,

                content=(

                    f"Customer ID: {customer_id}. "

                    f"Ticket ID: {ticket_id}. "

                    f"Confirmed successful support resolution: "

                    f"{data.solution.strip()}. "

                    f"The customer explicitly confirmed that this solution worked."

                ),

                context="Customer-confirmed successful support resolution",

                tags=[

                    f"customer:{customer_id}",

                    "resolution:successful",

                ],

            )

            memory_saved = True

        except Exception:

            logger.exception(

                "Successful resolution Hindsight retain failed "

                "for customer_id=%s ticket_id=%s",

                customer_id,

                ticket_id,

            )

    return {

        "message": (

            "Resolution confirmed and ticket closed."

            if confirmed_success

            else "Resolution feedback saved. Ticket remains open."

        ),

        "resolution_id": resolution_id,

        "ticket_id": ticket_id,

        "outcome": data.outcome,

        "customer_confirmed": data.customer_confirmed,

        "ticket_status": new_status,

        "successful_resolution": confirmed_success,

        "hindsight_memory_saved": memory_saved,

    }

# --------------------------------------------------

# CUSTOMER SUPPORT

# --------------------------------------------------

@app.post("/support/message")

async def support_message(

    data: CustomerMessage,

    current_user=Depends(get_current_user),

):

    if not groq_client:

        raise HTTPException(

            status_code=503,

            detail="Customer support is temporarily unavailable. Please try again later.",

        )

    if not BANK_ID:

        raise HTTPException(

            status_code=503,

            detail="Customer support is temporarily unavailable. Please try again later.",

        )

    customer_id = get_customer_id(current_user)

    account = get_customer_account(customer_id)

    customer_tag = f"customer:{customer_id}"

    # 1. Recall customer-specific support history and resolutions.

    previous_memories = []

    memory_context = "No previous support history was found."

    try:

        previous = await hindsight_client.arecall(

            bank_id=BANK_ID,

            query=(

                f"The customer is asking: {data.message}. "

                f"Find relevant previous support conversations and memories "

                f"for customer {account['name']} (customer ID {customer_id}). "

                "Prioritize similar problems, the customer's device and "

                "environment, troubleshooting steps already attempted, "

                "known recurring issues, and solutions that the customer "

                "explicitly confirmed as successful. Include failed or "

                "unconfirmed attempts only when they help avoid repeating "

                "unsuccessful troubleshooting."

            ),

            tags=[customer_tag],

            tags_match="any_strict",

            budget="low",

            max_tokens=3000,

        )

        previous_memories = [

            memory.text

            for memory in (getattr(previous, "results", None) or [])

            if getattr(memory, "text", None)

        ]

        if previous_memories:

            memory_context = "\n".join(previous_memories)

    except Exception:

        logger.exception(

            "Hindsight recall failed for customer_id=%s",

            customer_id,

        )

    # 2. Generate the AI response.

    messages = [

        {

            "role": "system",

            "content": (

                "You are RecallDesk, a friendly and intelligent customer "

                "support assistant. Use relevant customer-specific Hindsight "

                "memories to personalize every response. Prioritize explicitly "

                "customer-confirmed successful resolutions when they match "

                "the current problem. Never claim that an earlier solution "

                "worked unless the customer explicitly confirmed it. Treat "

                "failed or unconfirmed solutions as unverified. Do not invent "

                "previous conversations, device details, or troubleshooting "

                "history. Avoid repeating steps the customer has already "

                "tried unless there is a good reason. If relevant history is "

                "unavailable, ask useful clarifying questions. Give clear, "

                "practical, concise guidance."

            ),

        },

        {

            "role": "user",

            "content": (

                f"Customer name: {account['name']}\n"

                f"Customer ID: {customer_id}\n\n"

                f"Previous support memories:\n{memory_context}\n\n"

                f"Current customer message:\n{data.message}"

            ),

        },

    ]

    try:

        completion = await asyncio.to_thread(

            groq_client.chat.completions.create,

            model=GROQ_MODEL,

            messages=messages,

            temperature=0.3,

            max_completion_tokens=350,

        )

        assistant_reply = (

            completion.choices[0].message.content

            or "I'm sorry, I couldn't prepare a response. Could you try again?"

        )

    except Exception:

        logger.exception(

            "Groq response generation failed for customer_id=%s",

            customer_id,

        )

        raise HTTPException(

            status_code=503,

            detail=(

                "I'm having trouble preparing a response right now. "

                "Please try again in a moment."

            ),

        )

    # 3. Save conversation and reuse an open ticket when possible.

    try:

        conversation_id, ticket_id, ticket_created = save_support_interaction(

            customer_id,

            data.message,

            assistant_reply,

        )

    except Exception:

        logger.exception(

            "Support interaction save failed for customer_id=%s",

            customer_id,

        )

        raise HTTPException(

            status_code=500,

            detail="Your support interaction could not be saved. Please try again.",

        )

    # 4. Detect and save customer sentiment.

    sentiment_result = detect_sentiment(data.message)

    try:

        save_customer_sentiment(

            customer_id,

            conversation_id,

            sentiment_result,

        )

    except Exception:

        logger.exception(

            "Sentiment storage failed for customer_id=%s conversation_id=%s",

            customer_id,

            conversation_id,

        )

    # 5. Retain conversation in Hindsight.

    memory_saved = False

    try:

        await hindsight_client.aretain(

            bank_id=BANK_ID,

            content=(

                f"Customer name: {account['name']}. "

                f"Customer ID: {customer_id}. "

                f"Ticket ID: {ticket_id}. "

                f"Customer message: {data.message}. "

                f"RecallDesk response: {assistant_reply}"

            ),

            context="Customer support conversation",

            tags=[customer_tag],

        )

        memory_saved = True

    except Exception:

        logger.exception(

            "Hindsight retain failed for customer_id=%s conversation_id=%s",

            customer_id,

            conversation_id,

        )

    # 6. Return response.

    return {

        "ticket_id": ticket_id,

        "conversation_id": conversation_id,

        "customer_id": customer_id,

        "message_received": data.message,

        "previous_memories": previous_memories,

        "assistant_reply": assistant_reply,

        "sentiment": sentiment_result,

        "memory_saved": memory_saved,

        "conversation_saved": True,

        "ticket_created": ticket_created,

    }

# --------------------------------------------------

# SHUTDOWN

# --------------------------------------------------

@app.on_event("shutdown")

async def shutdown_clients():

    try:

        await hindsight_client.aclose()

    except Exception:

        logger.exception("Error while closing Hindsight client")