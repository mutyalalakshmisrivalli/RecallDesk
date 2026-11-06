
import sqlite3

DATABASE_PATH = "recall_desk.db"


def get_connection():
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def create_tables():
    connection = get_connection()

    try:
        # Existing users table - preserve all existing accounts.
        connection.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'user',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Existing conversations table - preserve chat history.
        connection.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                customer_message TEXT NOT NULL,
                assistant_reply TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)

        # Customer environment profile.
        connection.execute("""
            CREATE TABLE IF NOT EXISTS customer_profiles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL UNIQUE,
                os_name TEXT,
                os_version TEXT,
                device_type TEXT,
                device_name TEXT,
                browser_name TEXT,
                browser_version TEXT,
                app_version TEXT,
                additional_details TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)

        # Customer sentiment history.
        connection.execute("""
            CREATE TABLE IF NOT EXISTS customer_sentiment (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                conversation_id INTEGER,
                ticket_id INTEGER,
                sentiment TEXT NOT NULL,
                confidence REAL,
                evidence TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            )
        """)

        # Customer support tickets.
        connection.execute("""
            CREATE TABLE IF NOT EXISTS support_tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subject TEXT NOT NULL,
                description TEXT,
                status TEXT NOT NULL DEFAULT 'open',
                priority TEXT NOT NULL DEFAULT 'normal',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                closed_at TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)

        # Troubleshooting and resolution history.
        connection.execute("""
            CREATE TABLE IF NOT EXISTS ticket_resolutions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                conversation_id INTEGER,
                solution TEXT NOT NULL,
                outcome TEXT NOT NULL DEFAULT 'unknown',
                customer_confirmed INTEGER NOT NULL DEFAULT 0,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (ticket_id) REFERENCES support_tickets(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                FOREIGN KEY (conversation_id) REFERENCES conversations(id)
            )
        """)

        # Ticket timeline events and status history.
        connection.execute("""
            CREATE TABLE IF NOT EXISTS ticket_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                description TEXT,
                old_status TEXT,
                new_status TEXT,
                actor_role TEXT NOT NULL DEFAULT 'system',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (ticket_id) REFERENCES support_tickets(id),
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)

        connection.execute("""
            CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket
            ON ticket_events(ticket_id, created_at)
        """)

        # Safely add ticket_id to existing conversations.
        conversation_columns = {
            row["name"]
            for row in connection.execute(
                "PRAGMA table_info(conversations)"
            ).fetchall()
        }

        if "ticket_id" not in conversation_columns:
            connection.execute("""
                ALTER TABLE conversations
                ADD COLUMN ticket_id INTEGER
                REFERENCES support_tickets(id)
            """)

        # Performance indexes.
        connection.execute("""
            CREATE INDEX IF NOT EXISTS idx_conversations_user_created
            ON conversations(user_id, created_at)
        """)

        connection.execute("""
            CREATE INDEX IF NOT EXISTS idx_conversations_ticket
            ON conversations(ticket_id)
        """)

        connection.execute("""
            CREATE INDEX IF NOT EXISTS idx_tickets_user_created
            ON support_tickets(user_id, created_at)
        """)

        connection.execute("""
            CREATE INDEX IF NOT EXISTS idx_sentiment_user_created
            ON customer_sentiment(user_id, created_at)
        """)

        connection.execute("""
            CREATE INDEX IF NOT EXISTS idx_resolutions_ticket
            ON ticket_resolutions(ticket_id, created_at)
        """)

        connection.commit()

    except Exception:
        connection.rollback()
        raise

    finally:
        connection.close()
