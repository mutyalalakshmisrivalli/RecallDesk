
import os
import jwt

from dotenv import load_dotenv
from datetime import datetime, timedelta, timezone
from pwdlib import PasswordHash

# Load environment variables from project root .env
load_dotenv()

password_hash = PasswordHash.recommended()

SECRET_KEY = os.getenv("AUTH_SECRET_KEY")

if not SECRET_KEY:
    raise RuntimeError(
        "AUTH_SECRET_KEY is missing from project root .env"
    )

ALGORITHM = "HS256"


# Hash customer passwords securely
def hash_password(password: str) -> str:
    return password_hash.hash(password)


# Verify customer passwords
def verify_password(password: str, hashed_password: str) -> bool:
    return password_hash.verify(password, hashed_password)


# Generate JWT login token
def create_access_token(user_id: int, role: str) -> str:
    payload = {
        "sub": str(user_id),
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=8)
    }

    return jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM
    )


# Verify JWT login token
def verify_access_token(token: str):
    try:
        return jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )
    except jwt.InvalidTokenError:
        return None
