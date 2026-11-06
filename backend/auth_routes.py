
from fastapi import APIRouter, HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from .database import get_connection
from .auth import (
    hash_password,
    verify_password,
    create_access_token,
    verify_access_token
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

security = HTTPBearer()


class SignupData(BaseModel):
    name: str
    email: str
    password: str


class LoginData(BaseModel):
    email: str
    password: str


@router.post("/signup")
def signup(data: SignupData):
    name = data.name.strip()
    email = data.email.strip().lower()

    if not name or not email or len(data.password) < 8:
        raise HTTPException(
            status_code=400,
            detail="Enter a name, valid email and password of at least 8 characters."
        )

    connection = get_connection()

    try:
        connection.execute(
            """
            INSERT INTO users (name, email, password_hash, role)
            VALUES (?, ?, ?, 'user')
            """,
            (name, email, hash_password(data.password))
        )
        connection.commit()

        return {
            "message": "Customer account created successfully"
        }

    except Exception as error:
        if "UNIQUE constraint failed" in str(error):
            raise HTTPException(
                status_code=409,
                detail="This email is already registered."
            )

        raise HTTPException(
            status_code=500,
            detail="Could not create account."
        )

    finally:
        connection.close()


@router.post("/login")
def login(data: LoginData):
    email = data.email.strip().lower()
    connection = get_connection()

    try:
        user = connection.execute(
            "SELECT * FROM users WHERE email = ?",
            (email,)
        ).fetchone()
    finally:
        connection.close()

    if not user or not verify_password(
        data.password, user["password_hash"]
    ):
        raise HTTPException(
            status_code=401,
            detail="Incorrect email or password."
        )

    token = create_access_token(user["id"], user["role"])

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "name": user["name"],
            "email": user["email"],
            "role": user["role"]
        }
    }


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    payload = verify_access_token(credentials.credentials)

    if not payload:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired login session."
        )

    return payload


def get_current_admin(
    user=Depends(get_current_user)
):
    connection = get_connection()

    try:
        account = connection.execute(
            "SELECT id, role FROM users WHERE id = ?",
            (int(user["sub"]),)
        ).fetchone()
    finally:
        connection.close()

    if not account or account["role"] != "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin access required."
        )

    return {
        "id": account["id"],
        "role": account["role"]
    }


@router.get("/me")
def my_account(user=Depends(get_current_user)):
    connection = get_connection()

    try:
        account = connection.execute(
            "SELECT id, name, email, role FROM users WHERE id = ?",
            (int(user["sub"]),)
        ).fetchone()
    finally:
        connection.close()

    if not account:
        raise HTTPException(
            status_code=404,
            detail="Account not found."
        )

    return dict(account)
