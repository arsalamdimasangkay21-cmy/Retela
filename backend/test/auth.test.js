import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";
import { createRequireAuth } from "../src/middleware/auth.js";
import { pool } from "../src/config/db.js";
import { signToken } from "../src/utils/auth.js";

const testUser = {
  id: 42,
  username: "auth_test_user",
  display_name: "Auth Test User",
  email: "auth-test@example.com",
  role: "customer",
  status: "approved",
  is_verified: 1,
  isVerified: 1
};

before(() => {
  process.env.JWT_SECRET = "unit-test-jwt-secret";
  process.env.JWT_EXPIRES_IN = "1h";
});

after(async () => {
  await pool.end();
});

function createLogger() {
  const entries = [];
  return {
    entries,
    debug(...args) {
      entries.push(args);
    }
  };
}

function createQueryFn(user = testUser) {
  const calls = [];
  const queryFn = async (sql) => {
    calls.push(sql);
    if (sql.includes("FROM users WHERE id")) return user ? [user] : [];
    if (sql.includes("UPDATE users SET last_active_at")) return { affectedRows: 1 };
    return [];
  };
  queryFn.calls = calls;
  return queryFn;
}

function runMiddleware(middleware, headers = {}) {
  return new Promise((resolve) => {
    const req = {
      headers,
      method: "GET",
      originalUrl: "/api/users/me"
    };
    middleware(req, {}, (error) => resolve({ req, error }));
  });
}

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

test("signToken creates a JWT that verifies with JWT_SECRET", () => {
  const token = signToken(testUser);
  const payload = jwt.verify(token, process.env.JWT_SECRET);

  assert.equal(payload.id, testUser.id);
  assert.equal(payload.role, testUser.role);
  assert.equal(payload.status, testUser.status);
});

test("requireAuth returns clear 401 for missing Authorization header", async () => {
  const logger = createLogger();
  const middleware = createRequireAuth({
    queryFn: createQueryFn(),
    ensureColumns: async () => {},
    logger
  });

  const { error } = await runMiddleware(middleware);

  assert.equal(error.status, 401);
  assert.equal(error.message, "Missing Authorization header");
  assert.equal(logger.entries[0][1].hasAuthorizationHeader, false);
});

test("requireAuth returns clear 401 for invalid token", async () => {
  const middleware = createRequireAuth({
    queryFn: createQueryFn(),
    ensureColumns: async () => {},
    logger: createLogger()
  });

  const { error } = await runMiddleware(middleware, {
    authorization: "Bearer not-a-real-token"
  });

  assert.equal(error.status, 401);
  assert.equal(error.message, "Invalid token. Please log in again.");
});

test("requireAuth returns clear 401 for expired token", async () => {
  const expiredToken = jwt.sign(
    { id: testUser.id, role: testUser.role, status: testUser.status },
    process.env.JWT_SECRET,
    { expiresIn: "-1s" }
  );
  const middleware = createRequireAuth({
    queryFn: createQueryFn(),
    ensureColumns: async () => {},
    logger: createLogger()
  });

  const { error } = await runMiddleware(middleware, {
    authorization: `Bearer ${expiredToken}`
  });

  assert.equal(error.status, 401);
  assert.equal(error.message, "Token expired. Please log in again.");
});

test("login-issued JWT authorizes protected route paths", async () => {
  const logger = createLogger();
  const auth = createRequireAuth({
    queryFn: createQueryFn(),
    ensureColumns: async () => {},
    logger
  });
  const app = express();
  app.use(express.json());
  app.post("/api/auth/login", (req, res) => {
    res.json({ token: signToken(testUser), user: testUser });
  });

  for (const path of ["/api/users", "/api/users/me", "/api/reviews", "/api/notifications", "/api/returns"]) {
    app.get(path, auth, (req, res) => {
      res.json({ ok: true, path, userId: req.user.id });
    });
  }

  app.use((error, req, res, next) => {
    res.status(error.status || 500).json({ message: error.message });
  });

  const { server, baseUrl } = await listen(app);
  try {
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "auth_test_user", password: "password" })
    });
    const login = await loginResponse.json();
    assert.equal(loginResponse.status, 200);
    assert.match(login.token, /^[\w-]+\.[\w-]+\.[\w-]+$/);

    for (const path of ["/api/users", "/api/users/me", "/api/reviews", "/api/notifications", "/api/returns"]) {
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { authorization: `Bearer ${login.token}` }
      });
      const body = await response.json();
      assert.equal(response.status, 200, `${path} should accept a valid token`);
      assert.equal(body.userId, testUser.id);
    }

    assert.ok(logger.entries.some((entry) => entry[1].message === "Authorization header received" && entry[1].hasAuthorizationHeader));
    assert.ok(logger.entries.some((entry) => entry[1].message === "Token verification succeeded" && entry[1].userId === testUser.id));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("protected route paths reject requests without Authorization", async () => {
  const auth = createRequireAuth({
    queryFn: createQueryFn(),
    ensureColumns: async () => {},
    logger: createLogger()
  });
  const app = express();
  for (const path of ["/api/users", "/api/users/me", "/api/reviews", "/api/notifications", "/api/returns"]) {
    app.get(path, auth, (req, res) => {
      res.json({ ok: true });
    });
  }
  app.use((error, req, res, next) => {
    res.status(error.status || 500).json({ message: error.message });
  });

  const { server, baseUrl } = await listen(app);
  try {
    for (const path of ["/api/users", "/api/users/me", "/api/reviews", "/api/notifications", "/api/returns"]) {
      const response = await fetch(`${baseUrl}${path}`);
      const body = await response.json();
      assert.equal(response.status, 401, `${path} should require auth`);
      assert.equal(body.message, "Missing Authorization header");
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
