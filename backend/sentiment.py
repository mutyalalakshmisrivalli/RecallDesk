
import re

from backend.database import get_connection


FRUSTRATION_PHRASES = [
    "not working",
    "still not working",
    "does not work",
    "doesn't work",
    "not fixed",
    "not solved",
    "same problem",
    "same issue",
    "again and again",
    "tried everything",
    "nothing works",
    "waste of time",
    "very disappointed",
    "extremely frustrated",
    "fed up",
    "angry",
    "frustrated",
    "annoying",
    "ridiculous",
    "terrible",
    "unacceptable",
    "worst experience",
    "no one is helping",
    "not helpful",
    "third time",
    "fourth time",
]

SATISFACTION_PHRASES = [
    "thank you",
    "thanks",
    "that worked",
    "it worked",
    "problem solved",
    "issue resolved",
    "working now",
    "fixed now",
    "appreciate your help",
    "great support",
    "excellent",
    "perfect",
    "helpful",
]


def detect_sentiment(message):
    """
    Detect sentiment signals from customer text.

    Returns a sentiment label, confidence score and
    supporting phrase evidence.
    """

    text = message.lower()
    text = re.sub(r"\s+", " ", text).strip()

    frustration_matches = [
        phrase
        for phrase in FRUSTRATION_PHRASES
        if phrase in text
    ]

    satisfaction_matches = [
        phrase
        for phrase in SATISFACTION_PHRASES
        if phrase in text
    ]

    frustration_score = len(frustration_matches)
    satisfaction_score = len(satisfaction_matches)

    if frustration_score > satisfaction_score:
        sentiment = "frustrated"
        evidence = ", ".join(frustration_matches[:5])
        confidence = min(
            0.60 + (frustration_score * 0.08),
            0.95,
        )

    elif satisfaction_score > frustration_score:
        sentiment = "satisfied"
        evidence = ", ".join(satisfaction_matches[:5])
        confidence = min(
            0.60 + (satisfaction_score * 0.08),
            0.95,
        )

    else:
        sentiment = "neutral"
        evidence = None
        confidence = 0.50

    return {
        "sentiment": sentiment,
        "confidence": round(confidence, 2),
        "evidence": evidence,
    }


def save_customer_sentiment(
    user_id,
    conversation_id,
    sentiment_result,
):
    connection = get_connection()

    try:
        connection.execute(
            """
            INSERT INTO customer_sentiment (
                user_id,
                conversation_id,
                ticket_id,
                sentiment,
                confidence,
                evidence
            )
            VALUES (?, ?, NULL, ?, ?, ?)
            """,
            (
                user_id,
                conversation_id,
                sentiment_result["sentiment"],
                sentiment_result["confidence"],
                sentiment_result["evidence"],
            ),
        )

        connection.commit()

    finally:
        connection.close()
