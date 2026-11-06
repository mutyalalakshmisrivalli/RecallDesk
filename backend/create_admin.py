
from getpass import getpass

from .database import get_connection
from .auth import hash_password


def create_admin():
    print("\n=== RecallDesk Admin Setup ===")

    name = input("Admin name: ").strip()
    email = input("Admin email: ").strip().lower()
    password = getpass("Create admin password: ")
    confirm_password = getpass("Confirm admin password: ")

    if not name or not email:
        print("Name and email are required.")
        return

    if len(password) < 12:
        print("Password must contain at least 12 characters.")
        return

    if password != confirm_password:
        print("Passwords do not match.")
        return

    connection = get_connection()

    try:
        existing = connection.execute(
            "SELECT id, role FROM users WHERE email = ?",
            (email,)
        ).fetchone()

        if existing:
            print("This email already has an account.")
            print("No account changes were made.")
            return

        connection.execute(
            """
            INSERT INTO users (name, email, password_hash, role)
            VALUES (?, ?, ?, 'admin')
            """,
            (name, email, hash_password(password))
        )

        connection.commit()
        print("\nAdmin account created successfully!")

    finally:
        connection.close()


if __name__ == "__main__":
    create_admin()
