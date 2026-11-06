
import { useEffect, useState, useRef } from "react";
import "./CustomerPortal.css";

const API_BASE = "http://127.0.0.1:8000";
const TOKEN_KEY = "recalldesk_customer_token";

async function apiRequest(path, token = "", options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const detail = data.detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : `Request failed (${response.status})`
    );
  }

  return data;
}

export default function CustomerPortal() {
  const [token, setToken] = useState(
    () => sessionStorage.getItem(TOKEN_KEY) || ""
  );

  const [user, setUser] = useState(null);
  const [checking, setChecking] = useState(true);
  const [authMode, setAuthMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authSuccess, setAuthSuccess] = useState("");

  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);

  const [historyItems, setHistoryItems] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [activeConversationId, setActiveConversationId] = useState(null);

  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");

  const [resolutionDrafts, setResolutionDrafts] = useState({});
  const [resolutionLoading, setResolutionLoading] = useState({});
  const [resolutionErrors, setResolutionErrors] = useState({});
  const [resolutionResults, setResolutionResults] = useState({});

  const syncedTokenRef = useRef("");

  // VERIFY CUSTOMER SESSION
  useEffect(() => {
    let cancelled = false;

    async function verifyCustomer() {
      if (!token) {
        setChecking(false);
        return;
      }

      try {
        const data = await apiRequest("/auth/me", token);

        if (cancelled) return;

        if (data.role !== "user") {
          throw new Error("This account is not a customer account.");
        }

        setUser(data);
      } catch {
        sessionStorage.removeItem(TOKEN_KEY);

        if (!cancelled) {
          setToken("");
          setUser(null);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    verifyCustomer();

    return () => {
      cancelled = true;
    };
  }, [token]);

  // AUTOMATIC CUSTOMER ENVIRONMENT SYNC
  useEffect(() => {
    if (!token || !user || user.role !== "user") return;
    if (syncedTokenRef.current === token) return;

    syncedTokenRef.current = token;

    async function syncEnvironment() {
      try {
        const result = await apiRequest(
          "/customer/profile/sync",
          token,
          { method: "POST" }
        );

        console.log(
          "Customer environment synced successfully:",
          result.profile
        );
      } catch (error) {
        console.error(
          "Customer environment sync failed:",
          error.message
        );

        syncedTokenRef.current = "";
      }
    }

    syncEnvironment();
  }, [token, user]);

  // LOAD CUSTOMER CHAT HISTORY
  useEffect(() => {
    if (!token || !user || user.role !== "user") return;

    let cancelled = false;

    async function loadHistory() {
      setHistoryLoading(true);
      setHistoryError("");

      try {
        const data = await apiRequest(
          "/customer/conversations?limit=50",
          token
        );

        if (!cancelled) {
          setHistoryItems(data.conversations || []);
        }
      } catch (error) {
        if (!cancelled) setHistoryError(error.message);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [token, user]);

  // SIGNUP
  async function handleSignup(event) {
    event.preventDefault();

    setAuthError("");
    setAuthSuccess("");
    setAuthLoading(true);

    try {
      await apiRequest("/auth/signup", "", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });

      setAuthSuccess("Account created successfully! Please sign in.");
      setAuthMode("login");
      setPassword("");
      setName("");
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthLoading(false);
    }
  }

  // LOGIN
  async function handleLogin(event) {
    event.preventDefault();

    setAuthError("");
    setAuthSuccess("");
    setAuthLoading(true);

    try {
      const data = await apiRequest("/auth/login", "", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      if (data.user?.role !== "user") {
        throw new Error("Please use a customer account.");
      }

      sessionStorage.setItem(TOKEN_KEY, data.access_token);

      setUser(data.user);
      setToken(data.access_token);
      setPassword("");
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthLoading(false);
    }
  }

  // LOGOUT
  function handleLogout() {
    sessionStorage.removeItem(TOKEN_KEY);
    syncedTokenRef.current = "";

    setToken("");
    setUser(null);
    setMessages([]);
    setHistoryItems([]);
    setActiveConversationId(null);
    setMessage("");
    setChatError("");

    setResolutionDrafts({});
    setResolutionLoading({});
    setResolutionErrors({});
    setResolutionResults({});
  }

  // SEND SUPPORT MESSAGE AND RECEIVE TICKET DETAILS
  async function sendMessage(event) {
    event.preventDefault();

    const text = message.trim();

    if (!text || sending) return;

    setChatError("");
    setMessage("");
    setSending(true);

    const messageId = Date.now();

    setMessages((previous) => [
      ...previous,
      { id: messageId, role: "customer", text },
    ]);

    try {
      const data = await apiRequest("/support/message", token, {
        method: "POST",
        body: JSON.stringify({ message: text }),
      });

      const reply =
        data.assistant_reply ||
        data.reply ||
        data.response ||
        data.answer ||
        data.message ||
        "Your message was processed, but no reply was returned.";

      const resolutionAvailable =
        data.ticket_id != null &&
        data.conversation_id != null;

      setMessages((previous) => [
        ...previous,
        {
          id: Date.now() + 1,
          role: "assistant",
          text:
            typeof reply === "string" ? reply : JSON.stringify(reply),
          memorySaved: data.memory_saved,
          ticketId: data.ticket_id,
          conversationId: data.conversation_id,
          ticketCreated: data.ticket_created,
          resolutionAvailable,
        },
      ]);

      setActiveConversationId(data.conversation_id ?? null);

      try {
        const historyData = await apiRequest(
          "/customer/conversations?limit=50",
          token
        );

        setHistoryItems(historyData.conversations || []);
      } catch (historyLoadError) {
        console.error(
          "Could not refresh customer history:",
          historyLoadError
        );
      }
    } catch (error) {
      setChatError(error.message);

      setMessages((previous) =>
        previous.filter((item) => item.id !== messageId)
      );
    } finally {
      setSending(false);
    }
  }

  // OPEN A SAVED SUPPORT EXCHANGE
  function openHistoryItem(item) {
    setActiveConversationId(item.id);

    setMessages([
      {
        id: `history-customer-${item.id}`,
        role: "customer",
        text: item.customer_message || "",
      },
      {
        id: `history-assistant-${item.id}`,
        role: "assistant",
        text: item.assistant_reply || "No assistant reply was saved.",
        ticketId: item.ticket_id,
        conversationId: item.id,
        resolutionAvailable: false,
      },
    ]);

    setMessage("");
    setChatError("");

    if (window.innerWidth <= 700) {
      setSidebarOpen(false);
    }
  }

  // START A NEW CHAT VIEW
  function startNewChat() {
    setMessages([]);
    setActiveConversationId(null);
    setMessage("");
    setChatError("");

    setResolutionDrafts({});
    setResolutionLoading({});
    setResolutionErrors({});
    setResolutionResults({});

    if (window.innerWidth <= 700) {
      setSidebarOpen(false);
    }
  }

  // UPDATE RESOLUTION DESCRIPTION
  function updateResolutionDraft(messageId, value) {
    setResolutionDrafts((previous) => ({
      ...previous,
      [messageId]: value,
    }));

    setResolutionErrors((previous) => ({
      ...previous,
      [messageId]: "",
    }));
  }

  // SUBMIT CUSTOMER RESOLUTION FEEDBACK
  async function submitResolution(item, outcome) {
    const messageId = item.id;
    const solution = (resolutionDrafts[messageId] || "").trim();

    if (!solution) {
      setResolutionErrors((previous) => ({
        ...previous,
        [messageId]: "Please describe what happened before submitting.",
      }));

      return;
    }

    if (resolutionLoading[messageId] || resolutionResults[messageId]) {
      return;
    }

    setResolutionLoading((previous) => ({
      ...previous,
      [messageId]: true,
    }));

    setResolutionErrors((previous) => ({
      ...previous,
      [messageId]: "",
    }));

    try {
      const customerConfirmed = outcome === "success";

      await apiRequest(
        `/customer/tickets/${item.ticketId}/resolution`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            solution,
            outcome,
            customer_confirmed: customerConfirmed,
            conversation_id: item.conversationId,
            notes: customerConfirmed
              ? "Customer confirmed that the support solution worked."
              : "Customer reported that the issue is still unresolved.",
          }),
        }
      );

      setResolutionResults((previous) => ({
        ...previous,
        [messageId]: customerConfirmed
          ? "Thank you! Your successful resolution has been confirmed."
          : "Your feedback has been recorded. The ticket remains open for further support.",
      }));
    } catch (error) {
      setResolutionErrors((previous) => ({
        ...previous,
        [messageId]: error.message,
      }));
    } finally {
      setResolutionLoading((previous) => ({
        ...previous,
        [messageId]: false,
      }));
    }
  }

  // LOADING
  if (checking) {
    return (
      <div className="customer-loading">
        Checking your customer session...
      </div>
    );
  }

  // LOGIN / SIGNUP
  if (!token || !user) {
    return (
      <div className="customer-auth-page">
        <div className="customer-auth-card">
          <div className="customer-brand-icon">R</div>

          <p className="customer-eyebrow">
            RECALLDESK CUSTOMER PORTAL
          </p>

          <h1>
            {authMode === "login"
              ? "Welcome back"
              : "Create your account"}
          </h1>

          <p className="customer-auth-description">
            {authMode === "login"
              ? "Sign in to get personalized AI-powered support."
              : "Join RecallDesk and get support that remembers your conversations."}
          </p>

          <div className="customer-auth-tabs">
            <button
              className={authMode === "login" ? "active" : ""}
              onClick={() => {
                setAuthMode("login");
                setAuthError("");
                setAuthSuccess("");
              }}
              type="button"
            >
              Sign in
            </button>

            <button
              className={authMode === "signup" ? "active" : ""}
              onClick={() => {
                setAuthMode("signup");
                setAuthError("");
                setAuthSuccess("");
              }}
              type="button"
            >
              Create account
            </button>
          </div>

          <form
            onSubmit={authMode === "login" ? handleLogin : handleSignup}
          >
            {authMode === "signup" && (
              <>
                <label htmlFor="customer-name">Full name</label>

                <input
                  id="customer-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your name"
                  required
                />
              </>
            )}

            <label htmlFor="customer-email">Email address</label>

            <input
              id="customer-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />

            <label htmlFor="customer-password">Password</label>

            <input
              id="customer-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
            />

            {authError && (
              <div className="customer-error">{authError}</div>
            )}

            {authSuccess && (
              <div className="customer-success">{authSuccess}</div>
            )}

            <button
              className="customer-primary-button"
              type="submit"
              disabled={authLoading}
            >
              {authLoading
                ? "Please wait..."
                : authMode === "login"
                  ? "Sign in to RecallDesk"
                  : "Create my account"}
            </button>
          </form>

          <p className="customer-auth-footer">
            Secure customer access · RecallDesk AI
          </p>
        </div>
      </div>
    );
  }

  // CUSTOMER CHAT PORTAL
  return (
    <div className="customer-app">
      <header className="customer-topbar">
        <div className="customer-topbar-left">
          <button
            type="button"
            className="customer-sidebar-toggle"
            onClick={() => setSidebarOpen((previous) => !previous)}
            aria-label="Toggle chat history sidebar"
            title="Toggle sidebar"
          >
            ☰
          </button>

          <div className="customer-brand">
            <div className="customer-brand-icon small">R</div>

            <div>
              <strong>RecallDesk</strong>
              <span>CUSTOMER SUPPORT</span>
            </div>
          </div>
        </div>

        <div className="customer-account">
          <div className="customer-user-avatar">
            {(user.name || "U").charAt(0).toUpperCase()}
          </div>

          <div className="customer-user-info">
            <strong>{user.name}</strong>
            <span>Customer</span>
          </div>

          <button
            onClick={handleLogout}
            className="customer-logout"
            type="button"
          >
            Logout
          </button>
        </div>
      </header>

      <div className="customer-workspace">
        {/* CHAT HISTORY SIDEBAR */}
        <aside
          className={`customer-sidebar ${
            sidebarOpen ? "open" : "closed"
          }`}
        >
          <button
            type="button"
            onClick={startNewChat}
            className="customer-new-chat"
          >
            + New Chat
          </button>

          <h3 className="customer-sidebar-title">
            YOUR CONVERSATIONS
          </h3>

          {historyLoading && (
            <p className="customer-history-empty">
              Loading conversations...
            </p>
          )}

          {historyError && (
            <p className="customer-history-error">
              {historyError}
            </p>
          )}

          {!historyLoading && historyItems.length === 0 && (
            <p className="customer-history-empty">
              No previous conversations yet.
            </p>
          )}

          <div className="customer-history-list">
            {historyItems.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`customer-history-item ${
                  String(activeConversationId) === String(item.id)
                    ? "active"
                    : ""
                }`}
                onClick={() => openHistoryItem(item)}
              >
                <strong>
                  {item.customer_message?.slice(0, 55) ||
                    "Support conversation"}

                  {item.customer_message?.length > 55 ? "..." : ""}
                </strong>

                <span>
                  {item.created_at || "Saved conversation"}

                  {item.ticket_id != null
                    ? ` · Ticket #${item.ticket_id}`
                    : ""}
                </span>
              </button>
            ))}
          </div>

          <div className="customer-sidebar-footer">
            RecallDesk AI · Customer Support
          </div>
        </aside>

        {/* MOBILE SIDEBAR BACKDROP */}
        {sidebarOpen && (
          <button
            type="button"
            className="customer-sidebar-backdrop"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar"
          />
        )}

        {/* MAIN CHAT CONTENT */}
        <main className="customer-main">
          <section className="customer-welcome">
            <p className="customer-eyebrow">
              YOUR PERSONAL SUPPORT ASSISTANT
            </p>

            <h1>Hello, {user.name}!</h1>

            <p>
              How can I help you today? I can remember your previous
              support details and provide more personalized assistance.
            </p>
          </section>

          <section className="customer-chat-card">
            <div className="customer-chat-header">
              <div className="customer-ai-avatar">✦</div>

              <div>
                <h2>RecallDesk AI Assistant</h2>

                <span>
                  <i className="customer-online-dot" />
                  Ready to help
                </span>
              </div>
            </div>

            <div className="customer-chat-messages">
              {messages.length === 0 && (
                <div className="customer-empty-chat">
                  <div className="customer-empty-icon">✦</div>

                  <h3>Start a conversation</h3>

                  <p>
                    Tell me what you need help with. I'll use available
                    customer memory to make support more personalized.
                  </p>

                  <div className="customer-suggestions">
                    <button
                      type="button"
                      onClick={() =>
                        setMessage("I need help with a technical issue.")
                      }
                    >
                      Technical support
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setMessage(
                          "Can you help me with my previous issue?"
                        )
                      }
                    >
                      Previous issue
                    </button>
                  </div>
                </div>
              )}

              {messages.map((item) => (
                <div key={item.id}>
                  <div
                    className={`customer-message ${
                      item.role === "customer" ? "sent" : "received"
                    }`}
                  >
                    <div className="customer-message-label">
                      {item.role === "customer"
                        ? "You"
                        : "RecallDesk AI"}
                    </div>

                    <div className="customer-message-bubble">
                      {item.text}
                    </div>

                    {item.memorySaved && (
                      <small className="customer-memory-indicator">
                        ✦ Memory saved
                      </small>
                    )}

                    {/* TICKET NUMBER DISPLAY */}
                    {item.role === "assistant" &&
                      item.ticketId != null && (
                        <small className="customer-ticket-indicator">
                          🎫 Ticket #{item.ticketId} ·{" "}
                          {item.ticketCreated
                            ? "New ticket created"
                            : "Existing ticket updated"}
                        </small>
                      )}
                  </div>

                  {/* RESOLUTION FEEDBACK */}
                  {item.role === "assistant" &&
                    item.resolutionAvailable && (
                      <div className="customer-resolution-card">
                        <h3>
                          Did this solution resolve your issue?
                        </h3>

                        <p>
                          Your feedback helps RecallDesk learn which
                          support solutions actually work. Please
                          describe the result before submitting your
                          feedback.
                        </p>

                        <textarea
                          value={resolutionDrafts[item.id] || ""}
                          onChange={(event) =>
                            updateResolutionDraft(
                              item.id,
                              event.target.value
                            )
                          }
                          placeholder="Describe what happened after trying the support steps..."
                          rows={3}
                          disabled={
                            !!resolutionResults[item.id] ||
                            !!resolutionLoading[item.id]
                          }
                        />

                        {resolutionErrors[item.id] && (
                          <div className="customer-resolution-error">
                            {resolutionErrors[item.id]}
                          </div>
                        )}

                        {resolutionResults[item.id] ? (
                          <div className="customer-resolution-status">
                            {resolutionResults[item.id]}
                          </div>
                        ) : (
                          <div className="customer-resolution-actions">
                            <button
                              type="button"
                              disabled={!!resolutionLoading[item.id]}
                              onClick={() =>
                                submitResolution(item, "success")
                              }
                            >
                              {resolutionLoading[item.id]
                                ? "Submitting..."
                                : "Yes, resolved"}
                            </button>

                            <button
                              type="button"
                              disabled={!!resolutionLoading[item.id]}
                              onClick={() =>
                                submitResolution(item, "pending")
                              }
                            >
                              {resolutionLoading[item.id]
                                ? "Submitting..."
                                : "No, still need help"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                </div>
              ))}

              {sending && (
                <div className="customer-message received">
                  <div className="customer-message-label">
                    RecallDesk AI
                  </div>

                  <div className="customer-message-bubble typing">
                    Thinking...
                  </div>
                </div>
              )}
            </div>

            {chatError && (
              <div className="customer-error chat-error">
                {chatError}
              </div>
            )}

            <form
              className="customer-chat-form"
              onSubmit={sendMessage}
            >
              <input
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Type your message here..."
                disabled={sending}
              />

              <button
                type="submit"
                disabled={sending || !message.trim()}
              >
                {sending ? "Sending..." : "Send"}
                <span>➤</span>
              </button>
            </form>

            <p className="customer-chat-note">
              RecallDesk AI can make mistakes. Avoid sharing passwords
              or sensitive information.
            </p>
          </section>

          <footer className="customer-footer">
            © 2026 RecallDesk · AI-powered customer support
          </footer>
        </main>
      </div>
    </div>
  );
}
