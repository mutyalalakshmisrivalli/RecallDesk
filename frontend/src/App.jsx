
import { useEffect, useState } from "react";
import "./App.css";
import CustomerPortal from "./CustomerPortal";

const API_BASE = "http://127.0.0.1:8000";

const menu = [
  { name: "Overview", icon: "▦" },
  { name: "Customers", icon: "♙" },
  { name: "Conversations", icon: "☷" },
  { name: "Customer Environments", icon: "▤" },
  { name: "Sentiment Analysis", icon: "♡" },
  { name: "Support Tickets", icon: "▣" },
  { name: "Memory Center", icon: "◈" },
  { name: "Settings", icon: "⚙" },
];

async function apiRequest(path, token, options = {}) {
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
    const detail = Array.isArray(data.detail)
      ? data.detail.map((item) => item.msg).join(", ")
      : data.detail;

    throw new Error(detail || `Request failed (${response.status})`);
  }

  return data;
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString();
}

function initials(name = "") {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join("") || "U"
  );
}

function App() {
  const [portal, setPortal] = useState(() => {
    if (sessionStorage.getItem("recalldesk_token")) return "admin";
    if (sessionStorage.getItem("recalldesk_customer_token")) return "customer";
    return "choose";
  });

  if (portal === "admin") {
    return <AdminPortal onBack={() => setPortal("choose")} />;
  }

  if (portal === "customer") {
    return (
      <CustomerPortal
        onBack={() => {
          sessionStorage.removeItem("recalldesk_customer_token");
          setPortal("choose");
        }}
      />
    );
  }

  return <PortalSelection onSelect={setPortal} />;
}

function PortalSelection({ onSelect }) {
  return (
    <div className="portal-selection">
      <div className="portal-selection-card">
        <div className="brand-icon">R</div>

        <p className="eyebrow">WELCOME TO RECALLDESK</p>

        <h1>How would you like to continue?</h1>

        <p>Choose your portal to get started.</p>

        <button className="portal-choice" onClick={() => onSelect("admin")}>
          <span>▦</span>
          <div>
            <strong>Admin Portal</strong>
            <small>Manage customers, conversations and AI memories.</small>
          </div>
          <b>→</b>
        </button>

        <button className="portal-choice" onClick={() => onSelect("customer")}>
          <span>♙</span>
          <div>
            <strong>Customer Portal</strong>
            <small>Sign in, chat with AI and get personalized support.</small>
          </div>
          <b>→</b>
        </button>

        <p className="portal-footer">
          AI-powered customer support · RecallDesk
        </p>
      </div>
    </div>
  );
}

function AdminPortal({ onBack }) {
  const [token, setToken] = useState(
    () => sessionStorage.getItem("recalldesk_token") || ""
  );

  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [active, setActive] = useState("Overview");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(false);

  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [search, setSearch] = useState("");

  const [dashboard, setDashboard] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [memories, setMemories] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [sentiments, setSentiments] = useState([]);
  const [tickets, setTickets] = useState([]);

  // Ticket details and timeline.
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [ticketTimeline, setTicketTimeline] = useState([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");

  // Verify existing administrator session.
  useEffect(() => {
    let cancelled = false;

    async function verifySession() {
      if (!token) {
        setAuthReady(true);
        return;
      }

      try {
        const data = await apiRequest("/auth/me", token);

        if (cancelled) return;

        if (data.role !== "admin") {
          throw new Error("Administrator access required.");
        }

        setUser(data);
      } catch {
        sessionStorage.removeItem("recalldesk_token");

        if (!cancelled) {
          setToken("");
          setUser(null);
        }
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    }

    verifySession();

    return () => {
      cancelled = true;
    };
  }, [token]);

  // Administrator login.
  async function handleLogin(event) {
    event.preventDefault();
    setLoginError("");
    setLoading(true);

    try {
      const data = await apiRequest("/auth/login", "", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      if (data.user?.role !== "admin") {
        throw new Error("This account is not an administrator account.");
      }

      sessionStorage.setItem("recalldesk_token", data.access_token);
      setUser(data.user);
      setToken(data.access_token);
      setPassword("");
    } catch (error) {
      setLoginError(error.message);
    } finally {
      setLoading(false);
    }
  }

  // Administrator logout.
  function handleLogout() {
    sessionStorage.removeItem("recalldesk_token");

    setToken("");
    setUser(null);
    setDashboard(null);
    setCustomers([]);
    setConversations([]);
    setMemories([]);
    setProfiles([]);
    setSentiments([]);
    setTickets([]);
    setSelectedTicket(null);
    setTicketTimeline([]);
    setActive("Overview");
    setAuthReady(true);

    onBack();
  }

  // Load ticket activity timeline.
  async function openTicketDetails(ticket) {
    setSelectedTicket(ticket);
    setTicketTimeline([]);
    setTimelineError("");
    setTimelineLoading(true);

    try {
      const data = await apiRequest(
        `/admin/tickets/${ticket.ticket_id}/timeline`,
        token
      );

      // Accept the timeline collection returned by the backend.
      const events = Array.isArray(data)
        ? data
        : data.events || data.timeline || data.items || [];

      setTicketTimeline(events);
    } catch (error) {
      setTimelineError(error.message);
    } finally {
      setTimelineLoading(false);
    }
  }

  function closeTicketDetails() {
    setSelectedTicket(null);
    setTicketTimeline([]);
    setTimelineError("");
    setTimelineLoading(false);
  }

  // Load data for the selected dashboard section.
  useEffect(() => {
    if (!token || !user || !authReady) return;

    let cancelled = false;

    async function loadPage() {
      setPageLoading(true);
      setPageError("");

      try {
        if (active === "Overview") {
          const [dashboardData, conversationData] = await Promise.all([
            apiRequest("/admin/dashboard", token),
            apiRequest("/admin/conversations?limit=5&offset=0", token),
          ]);

          if (cancelled) return;

          setDashboard(dashboardData);
          setConversations(conversationData.conversations || []);
        }

        if (active === "Customers") {
          const data = await apiRequest(
            "/admin/customers?limit=100&offset=0",
            token
          );

          if (!cancelled) setCustomers(data.customers || []);
        }

        if (active === "Conversations") {
          const data = await apiRequest(
            "/admin/conversations?limit=100&offset=0",
            token
          );

          if (!cancelled) setConversations(data.conversations || []);
        }

        if (active === "Customer Environments") {
          const data = await apiRequest(
            "/admin/environment-profiles?limit=100&offset=0",
            token
          );

          if (!cancelled) setProfiles(data.profiles || []);
        }

        if (active === "Sentiment Analysis") {
          const data = await apiRequest(
            "/admin/sentiments?limit=100&offset=0",
            token
          );

          if (!cancelled) setSentiments(data.sentiments || []);
        }

        if (active === "Support Tickets") {
          const data = await apiRequest(
            "/admin/tickets?limit=100&offset=0",
            token
          );

          if (!cancelled) setTickets(data.tickets || []);
        }

        if (active === "Memory Center") {
          const data = await apiRequest(
            "/admin/memories?limit=100&offset=0",
            token
          );

          if (!cancelled) setMemories(data.items || []);
        }
      } catch (error) {
        if (!cancelled) setPageError(error.message);
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    }

    loadPage();

    return () => {
      cancelled = true;
    };
  }, [active, token, user, authReady, refreshKey]);

  // Search filters.
  const filteredCustomers = customers.filter((customer) =>
    `${customer.name} ${customer.email}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const filteredConversations = conversations.filter((conversation) =>
    `${conversation.customer_name} ${conversation.customer_email} ${conversation.customer_message} ${conversation.assistant_reply}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const filteredMemories = memories.filter((memory) =>
    `${memory.text} ${memory.context} ${(memory.tags || []).join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const filteredProfiles = profiles.filter((profile) =>
    `${profile.customer_name} ${profile.customer_email} ${profile.os_name} ${profile.os_version} ${profile.device_type} ${profile.browser_name} ${profile.browser_version}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const filteredSentiments = sentiments.filter((item) =>
    `${item.customer_name} ${item.customer_email} ${item.sentiment} ${item.evidence} ${item.ticket_id}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const filteredTickets = tickets.filter((ticket) =>
    `${ticket.ticket_id} ${ticket.customer_name} ${ticket.customer_email} ${ticket.subject} ${ticket.status} ${ticket.priority}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  if (!authReady) {
    return (
      <div className="auth-loading">
        Checking your RecallDesk session...
      </div>
    );
  }

  // Administrator login screen.
  if (!token || !user) {
    return (
      <div className="login-page">
        <form className="login-card" onSubmit={handleLogin}>
          <div className="brand-icon login-brand">R</div>

          <p className="eyebrow">RECALLDESK ADMINISTRATION</p>
          <h1>Welcome back</h1>

          <p className="login-description">
            Sign in with your administrator account to manage RecallDesk.
          </p>

          <label htmlFor="admin-email">Email address</label>

          <input
            id="admin-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Enter your admin email"
            required
          />

          <label htmlFor="admin-password">Password</label>

          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            required
          />

          {loginError && <p className="error-message">{loginError}</p>}

          <button className="login-button" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in to dashboard"}
          </button>

          <button
            className="portal-back-button"
            type="button"
            onClick={onBack}
          >
            ← Back to portal selection
          </button>

          <p className="login-footnote">
            Secure administrator access · RecallDesk
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">R</div>
          <div>
            <h2>RecallDesk</h2>
            <span>AI SUPPORT PLATFORM</span>
          </div>
        </div>

        <div className="workspace-label">WORKSPACE</div>

        <nav className="navigation">
          {menu.map((item) => (
            <button
              key={item.name}
              className={`nav-item ${
                active === item.name ? "selected" : ""
              }`}
              onClick={() => {
                setActive(item.name);
                setSearch("");
                closeTicketDetails();
              }}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.name}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="status-card">
            <span className="online-dot" />
            <div>
              <strong>Backend connection</strong>
              <small>Authenticated admin session</small>
            </div>
          </div>

          <div className="profile">
            <div className="avatar admin-avatar">{initials(user.name)}</div>

            <div className="profile-info">
              <strong>{user.name}</strong>
              <small>Administrator</small>
            </div>

            <button
              className="logout-button"
              onClick={handleLogout}
              title="Logout"
            >
              ↪
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span> <strong>{active}</strong>
            {selectedTicket && (
              <>
                <span>/</span>
                <strong>Ticket #{selectedTicket.ticket_id}</strong>
              </>
            )}
          </div>

          <div className="topbar-right">
            <div className="system-status">
              <span className="online-dot" />
              Admin session
            </div>
            <div className="avatar admin-avatar">{initials(user.name)}</div>
          </div>
        </header>

        <div className="page-content">
          <section className="welcome-section">
            <div>
              <div className="eyebrow">ADMINISTRATION</div>

              <h1>
                {active === "Overview"
                  ? `Welcome back, ${user.name}`
                  : selectedTicket
                    ? `Ticket #${selectedTicket.ticket_id}`
                    : active}
                <span className="wave"> ✦</span>
              </h1>

              <p>
                {active === "Overview"
                  ? "Your RecallDesk platform data, directly from the backend."
                  : selectedTicket
                    ? "Review customer details and ticket activity."
                    : `Manage your RecallDesk ${active.toLowerCase()}.`}
              </p>
            </div>

            <div className="date-label">Admin Workspace</div>
          </section>

          {pageError && (
            <div className="error-message page-error">
              {pageError}
              <button onClick={() => setRefreshKey((value) => value + 1)}>
                Retry
              </button>
            </div>
          )}

          {pageLoading && (
            <p className="loading-message">
              Loading real backend data...
            </p>
          )}

          {!pageLoading && !pageError && active === "Overview" && (
            <>
              <section className="stats-grid">
                <StatCard
                  title="Total Customers"
                  value={dashboard?.total_customers ?? "—"}
                  icon="♙"
                  color="purple"
                />

                <StatCard
                  title="Total Conversations"
                  value={dashboard?.total_conversations ?? "—"}
                  icon="☷"
                  color="blue"
                />

                <StatCard
                  title="Support Tickets"
                  value={dashboard?.total_tickets ?? "—"}
                  icon="▣"
                  color="purple"
                />

                <StatCard
                  title="Frustrated Messages"
                  value={dashboard?.frustrated_customers ?? "—"}
                  icon="♡"
                  color="blue"
                />
              </section>

              <section className="content-grid">
                <div className="panel conversations-panel">
                  <div className="panel-header">
                    <div>
                      <h3>Recent Conversations</h3>
                      <p>Latest records from your database</p>
                    </div>

                    <button
                      className="text-button"
                      onClick={() => setActive("Conversations")}
                    >
                      View all →
                    </button>
                  </div>

                  {conversations.length === 0 ? (
                    <p className="empty-state">
                      No conversations have been recorded yet.
                    </p>
                  ) : (
                    conversations.map((item) => (
                      <ConversationRow
                        key={item.id}
                        conversation={item}
                      />
                    ))
                  )}
                </div>

                <div className="right-column">
                  <div className="panel activity-panel">
                    <div className="panel-header">
                      <div>
                        <h3>Platform Overview</h3>
                        <p>Live database totals</p>
                      </div>
                    </div>

                    <OverviewItem
                      icon="♙"
                      title="Registered Customers"
                      description="Customer accounts in SQLite"
                      value={dashboard?.total_customers ?? "—"}
                      color="purple-bg"
                    />

                    <OverviewItem
                      icon="☷"
                      title="Conversations"
                      description="Saved support interactions"
                      value={dashboard?.total_conversations ?? "—"}
                      color="blue-bg"
                    />

                    <OverviewItem
                      icon="▣"
                      title="Support Tickets"
                      description="Automatically created tickets"
                      value={dashboard?.total_tickets ?? "—"}
                      color="purple-bg"
                    />
                  </div>

                  <div className="panel quick-panel">
                    <h3>Quick Actions</h3>

                    {[
                      ["♙", "Manage Customers", "Customers"],
                      ["☷", "View Conversations", "Conversations"],
                      ["▤", "Customer Environments", "Customer Environments"],
                      ["♡", "Sentiment Analysis", "Sentiment Analysis"],
                      ["▣", "Support Tickets", "Support Tickets"],
                      ["◈", "Explore AI Memory", "Memory Center"],
                    ].map(([icon, label, page]) => (
                      <button key={page} onClick={() => setActive(page)}>
                        <span>{icon}</span>
                        {label}
                        <b>→</b>
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            </>
          )}

          {!pageLoading && !pageError && active === "Customers" && (
            <DataPanel
              title="Customer Management"
              description={`${customers.length} customer records loaded`}
              search={search}
              setSearch={setSearch}
            >
              {filteredCustomers.length === 0 ? (
                <p className="empty-state">No customer records found.</p>
              ) : (
                <div className="data-list">
                  {filteredCustomers.map((customer) => (
                    <div className="data-row" key={customer.id}>
                      <div className="avatar customer-avatar">
                        {initials(customer.name)}
                      </div>

                      <div className="data-details">
                        <strong>{customer.name}</strong>
                        <span>{customer.email}</span>
                      </div>

                      <small>{formatDate(customer.created_at)}</small>
                    </div>
                  ))}
                </div>
              )}
            </DataPanel>
          )}

          {!pageLoading && !pageError && active === "Conversations" && (
            <DataPanel
              title="Conversation History"
              description={`${conversations.length} conversation records loaded`}
              search={search}
              setSearch={setSearch}
            >
              {filteredConversations.length === 0 ? (
                <p className="empty-state">No conversation records found.</p>
              ) : (
                filteredConversations.map((item) => (
                  <ConversationRow
                    key={item.id}
                    conversation={item}
                    expanded
                  />
                ))
              )}
            </DataPanel>
          )}

          {!pageLoading && !pageError && active === "Customer Environments" && (
            <DataPanel
              title="Customer Environment Profiles"
              description={`${profiles.length} device profiles loaded`}
              search={search}
              setSearch={setSearch}
            >
              {filteredProfiles.length === 0 ? (
                <p className="empty-state">
                  No environment profiles found. Profiles are collected when
                  customers sign in to the customer portal.
                </p>
              ) : (
                <div className="table-scroll">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Operating System</th>
                        <th>Device</th>
                        <th>Browser</th>
                        <th>Last Updated</th>
                      </tr>
                    </thead>

                    <tbody>
                      {filteredProfiles.map((profile) => (
                        <tr key={profile.user_id}>
                          <td>
                            <strong>{profile.customer_name}</strong>
                            <small>{profile.customer_email}</small>
                          </td>

                          <td>
                            {profile.os_name || "—"}
                            <small>{profile.os_version || ""}</small>
                          </td>

                          <td>
                            {profile.device_type || "—"}
                            <small>{profile.device_name || ""}</small>
                          </td>

                          <td>
                            {profile.browser_name || "—"}
                            <small>{profile.browser_version || ""}</small>
                          </td>

                          <td>{formatDate(profile.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DataPanel>
          )}

          {!pageLoading && !pageError && active === "Sentiment Analysis" && (
            <DataPanel
              title="Customer Sentiment Analysis"
              description={`${sentiments.length} sentiment records loaded`}
              search={search}
              setSearch={setSearch}
            >
              <div className="sentiment-summary">
                <div>
                  <strong>
                    {sentiments.filter((s) => s.sentiment === "frustrated").length}
                  </strong>
                  <span>Frustrated</span>
                </div>

                <div>
                  <strong>
                    {sentiments.filter((s) => s.sentiment === "neutral").length}
                  </strong>
                  <span>Neutral</span>
                </div>

                <div>
                  <strong>
                    {sentiments.filter((s) => s.sentiment === "satisfied").length}
                  </strong>
                  <span>Satisfied</span>
                </div>
              </div>

              {filteredSentiments.length === 0 ? (
                <p className="empty-state">
                  No sentiment records found.
                </p>
              ) : (
                <div className="table-scroll">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Customer</th>
                        <th>Sentiment</th>
                        <th>Confidence</th>
                        <th>Evidence</th>
                        <th>Ticket</th>
                        <th>Date</th>
                      </tr>
                    </thead>

                    <tbody>
                      {filteredSentiments.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <strong>{item.customer_name}</strong>
                            <small>{item.customer_email}</small>
                          </td>

                          <td>
                            <SentimentBadge sentiment={item.sentiment} />
                          </td>

                          <td>
                            {Math.round((item.confidence || 0) * 100)}%
                          </td>

                          <td>{item.evidence || "No matching phrase"}</td>

                          <td>{item.ticket_id ? `#${item.ticket_id}` : "—"}</td>

                          <td>{formatDate(item.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DataPanel>
          )}

          {!pageLoading && !pageError && active === "Support Tickets" && (
            selectedTicket ? (
              <TicketDetails
                ticket={selectedTicket}
                timeline={ticketTimeline}
                loading={timelineLoading}
                error={timelineError}
                onBack={closeTicketDetails}
                onRetry={() => openTicketDetails(selectedTicket)}
              />
            ) : (
              <DataPanel
                title="Automatic Support Tickets"
                description={`${tickets.length} ticket records loaded`}
                search={search}
                setSearch={setSearch}
              >
                {filteredTickets.length === 0 ? (
                  <p className="empty-state">
                    No support tickets found. Tickets are created when customers
                    send support messages.
                  </p>
                ) : (
                  <div className="table-scroll">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Ticket</th>
                          <th>Customer</th>
                          <th>Subject</th>
                          <th>Status</th>
                          <th>Priority</th>
                          <th>Created</th>
                          <th>Details</th>
                        </tr>
                      </thead>

                      <tbody>
                        {filteredTickets.map((ticket) => (
                          <tr key={ticket.ticket_id}>
                            <td>#{ticket.ticket_id}</td>

                            <td>
                              <strong>{ticket.customer_name}</strong>
                              <small>{ticket.customer_email}</small>
                            </td>

                            <td>{ticket.subject || "Support request"}</td>

                            <td>
                              <StatusBadge status={ticket.status} />
                            </td>

                            <td>{ticket.priority || "normal"}</td>

                            <td>{formatDate(ticket.created_at)}</td>

                            <td>
                              <button
                                className="ticket-view-button"
                                onClick={() => openTicketDetails(ticket)}
                              >
                                View Details →
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </DataPanel>
            )
          )}

          {!pageLoading && !pageError && active === "Memory Center" && (
            <DataPanel
              title="Hindsight Memory Center"
              description={`${memories.length} memory records returned by Hindsight`}
              search={search}
              setSearch={setSearch}
            >
              {filteredMemories.length === 0 ? (
                <p className="empty-state">
                  No matching memories were returned by Hindsight.
                </p>
              ) : (
                <div className="memory-list">
                  {filteredMemories.map((memory) => (
                    <article className="memory-card" key={memory.id}>
                      <div className="memory-heading">
                        <strong>{memory.fact_type || "Memory"}</strong>
                        <span>{memory.state || "—"}</span>
                      </div>

                      <p>{memory.text || "No memory text available."}</p>

                      {memory.context && <small>{memory.context}</small>}

                      <div className="memory-meta">
                        <span>{formatDate(memory.var_date)}</span>

                        {(memory.tags || []).map((tag) => (
                          <span className="memory-tag" key={tag}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </DataPanel>
          )}

          {!pageLoading && !pageError && active === "Settings" && (
            <section className="panel settings-panel">
              <h3>Administrator Profile</h3>

              <p>
                Account information returned by your authenticated session.
              </p>

              <div className="settings-row">
                <span>Name</span>
                <strong>{user.name}</strong>
              </div>

              <div className="settings-row">
                <span>Email</span>
                <strong>{user.email}</strong>
              </div>

              <div className="settings-row">
                <span>Role</span>
                <strong>{user.role}</strong>
              </div>

              <button className="primary-button" onClick={handleLogout}>
                Logout
              </button>
            </section>
          )}

          <footer>
            <span>© 2026 RecallDesk</span>
            <span>AI-Powered Customer Support Platform</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

// Ticket details and activity timeline.
function TicketDetails({
  ticket,
  timeline,
  loading,
  error,
  onBack,
  onRetry,
}) {
  return (
    <section className="panel ticket-details-panel">
      <div className="ticket-details-header">
        <div>
          <div className="eyebrow">SUPPORT TICKET</div>
          <h2>Ticket #{ticket.ticket_id}</h2>
          <p>{ticket.subject || "Customer support request"}</p>
        </div>

        <button className="ticket-back-button" onClick={onBack}>
          ← Back to tickets
        </button>
      </div>

      <div className="ticket-info-grid">
        <div className="ticket-info-card">
          <span>Customer</span>
          <strong>{ticket.customer_name || "Unknown customer"}</strong>
          <small>{ticket.customer_email || "—"}</small>
        </div>

        <div className="ticket-info-card">
          <span>Status</span>
          <strong>
            <StatusBadge status={ticket.status} />
          </strong>
        </div>

        <div className="ticket-info-card">
          <span>Priority</span>
          <strong>{ticket.priority || "Normal"}</strong>
        </div>

        <div className="ticket-info-card">
          <span>Created</span>
          <strong>{formatDate(ticket.created_at)}</strong>
        </div>
      </div>

      <div className="ticket-section">
        <h3>Ticket Activity Timeline</h3>
        <p>Recorded events and resolution activity for this ticket.</p>

        {loading && (
          <p className="loading-message">Loading ticket activity...</p>
        )}

        {error && (
          <div className="error-message">
            {error}
            <button onClick={onRetry}>Retry</button>
          </div>
        )}

        {!loading && !error && timeline.length === 0 && (
          <p className="empty-state">
            No activity events have been recorded for this ticket yet.
          </p>
        )}

        {!loading && !error && timeline.length > 0 && (
          <div className="ticket-timeline">
            {timeline.map((event, index) => (
              <article
                className="ticket-timeline-item"
                key={event.id ?? index}
              >
                <div className="timeline-marker" />

                <div className="timeline-event-content">
                  <div className="timeline-event-header">
                    <strong>
                      {(event.event_type || "Ticket event")
                        .replaceAll("_", " ")}
                    </strong>

                    <small>
                      {formatDate(event.created_at)}
                    </small>
                  </div>

                  <p>
                    {event.description || "Ticket activity recorded."}
                  </p>

                  {(event.old_status || event.new_status) && (
                    <div className="timeline-status">
                      {event.old_status || "—"}
                      {" → "}
                      {event.new_status || "—"}
                    </div>
                  )}

                  {event.actor_role && (
                    <small className="timeline-actor">
                      Actor: {event.actor_role}
                    </small>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function StatCard({ title, value, icon, color }) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{title}</span>
        <div className={`stat-icon ${color}`}>{icon}</div>
      </div>

      <h2>{value}</h2>

      <div className="stat-bottom">
        <span>Live backend data</span>
      </div>
    </div>
  );
}

function OverviewItem({ icon, title, description, value, color }) {
  return (
    <div className="overview-item">
      <div className={`overview-icon ${color}`}>{icon}</div>

      <div>
        <strong>{title}</strong>
        <small>{description}</small>
      </div>

      <b>{value}</b>
    </div>
  );
}

function DataPanel({ title, description, search, setSearch, children }) {
  return (
    <section className="panel data-panel">
      <div className="panel-header">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>

      <div className="search-box">
        <span>⌕</span>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search records..."
        />
      </div>

      {children}
    </section>
  );
}

function SentimentBadge({ sentiment }) {
  const value = (sentiment || "neutral").toLowerCase();

  return (
    <span className={`record-badge sentiment-${value}`}>
      {value}
    </span>
  );
}

function StatusBadge({ status }) {
  const value = (status || "open").toLowerCase();

  return (
    <span className={`record-badge status-${value}`}>
      {value}
    </span>
  );
}

function ConversationRow({ conversation, expanded = false }) {
  return (
    <article className="conversation-entry">
      <div className="conversation-row">
        <div className="avatar customer-avatar">
          {initials(conversation.customer_name)}
        </div>

        <div className="conversation-details">
          <strong>
            {conversation.customer_name || "Unknown customer"}
          </strong>

          <span>
            {conversation.customer_email || "No email available"}
          </span>

          <span>{conversation.customer_message}</span>
        </div>

        <div className="conversation-meta">
          <small>{formatDate(conversation.created_at)}</small>
        </div>
      </div>

      {expanded && (
        <div className="conversation-reply">
          <strong>AI Assistant Reply</strong>
          <p>{conversation.assistant_reply || "No reply recorded."}</p>
        </div>
      )}
    </article>
  );
}

export default App;
