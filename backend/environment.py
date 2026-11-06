
import re

from fastapi import APIRouter, Depends, HTTPException, Request

from backend.database import get_connection
from backend.auth_routes import get_current_user

router = APIRouter(prefix="/customer", tags=["Customer Profile"])


def detect_environment(user_agent):
    ua = user_agent or ""

    # Operating system
    os_name = "Unknown"
    os_version = None

    if "Windows NT" in ua:
        os_name = "Windows"
        match = re.search(r"Windows NT ([\d.]+)", ua)
        if match:
            os_version = match.group(1)

    elif "Android" in ua:
        os_name = "Android"
        match = re.search(r"Android ([\d.]+)", ua)
        if match:
            os_version = match.group(1)

    elif "iPhone" in ua or "iPad" in ua:
        os_name = "iOS"

    elif "Mac OS X" in ua:
        os_name = "macOS"
        match = re.search(r"Mac OS X ([\d_]+)", ua)
        if match:
            os_version = match.group(1).replace("_", ".")

    elif "Linux" in ua:
        os_name = "Linux"

    # Browser
    browser_name = "Unknown"
    browser_version = None

    browser_patterns = [
        ("Edge", r"Edg/([\d.]+)"),
        ("Opera", r"OPR/([\d.]+)"),
        ("Chrome", r"Chrome/([\d.]+)"),
        ("Firefox", r"Firefox/([\d.]+)"),
        ("Safari", r"Version/([\d.]+).*Safari"),
    ]

    for name, pattern in browser_patterns:
        match = re.search(pattern, ua)
        if match:
            browser_name = name
            browser_version = match.group(1)
            break

    # Device type
    if "iPad" in ua or "Tablet" in ua:
        device_type = "tablet"
    elif any(value in ua for value in ["Mobile", "Android", "iPhone"]):
        device_type = "mobile"
    else:
        device_type = "desktop"

    return {
        "os_name": os_name,
        "os_version": os_version,
        "device_type": device_type,
        "device_name": None,
        "browser_name": browser_name,
        "browser_version": browser_version,
        "app_version": "RecallDesk Web",
        "additional_details": None,
    }


@router.post("/profile/sync")
def sync_customer_profile(
    request: Request,
    current_user=Depends(get_current_user),
):
    try:
        customer_id = int(current_user["sub"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(
            status_code=401,
            detail="Invalid login session.",
        )

    environment = detect_environment(
        request.headers.get("user-agent", "")
    )

    connection = get_connection()

    try:
        account = connection.execute(
            "SELECT id, role FROM users WHERE id = ?",
            (customer_id,),
        ).fetchone()

        if not account or account["role"] != "user":
            raise HTTPException(
                status_code=403,
                detail="Customer account required.",
            )

        connection.execute(
            """
            INSERT INTO customer_profiles (
                user_id,
                os_name,
                os_version,
                device_type,
                device_name,
                browser_name,
                browser_version,
                app_version,
                additional_details,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)

            ON CONFLICT(user_id) DO UPDATE SET
                os_name = excluded.os_name,
                os_version = excluded.os_version,
                device_type = excluded.device_type,
                browser_name = excluded.browser_name,
                browser_version = excluded.browser_version,
                app_version = excluded.app_version,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                customer_id,
                environment["os_name"],
                environment["os_version"],
                environment["device_type"],
                environment["device_name"],
                environment["browser_name"],
                environment["browser_version"],
                environment["app_version"],
                environment["additional_details"],
            ),
        )

        connection.commit()

        return {
            "message": "Customer environment profile updated.",
            "profile": environment,
        }

    finally:
        connection.close()
