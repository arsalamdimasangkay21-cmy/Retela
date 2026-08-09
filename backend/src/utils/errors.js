export class HttpError extends Error {
  constructor(status, message, errors = null) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export function asyncHandler(fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

function isDatabaseConnectionError(error) {
  return [
    "ECONNREFUSED",
    "PROTOCOL_CONNECTION_LOST",
    "ER_CON_COUNT_ERROR",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN"
  ].includes(error?.code);
}

function isDatabaseSchemaError(error) {
  return [
    "ER_NO_SUCH_TABLE",
    "ER_BAD_FIELD_ERROR",
    "ER_PARSE_ERROR",
    "ER_NO_DEFAULT_FOR_FIELD",
    "ER_TRUNCATED_WRONG_VALUE",
    "ER_DATA_TOO_LONG"
  ].includes(error?.code);
}

function routeLoadMessage(req) {
  if (req?.method !== "GET") return "";
  const route = String(req.originalUrl || req.url || "");
  if (route === "/api/products" || route.startsWith("/api/products?")) return "Unable to load products";
  if (route === "/api/settings" || route.startsWith("/api/settings?")) return "Unable to load settings";
  if (route === "/api/broadcasts" || route.startsWith("/api/broadcasts?")) return "Unable to load broadcasts";
  return "";
}

function publicErrorFor(err, status, req = null) {
  const routeMessage = status >= 500 ? routeLoadMessage(req) : "";
  if (err?.name === "ZodError") {
    return {
      status: 400,
      message: err.issues?.[0]?.message || "Invalid request.",
      error: "invalid_request"
    };
  }
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return {
      status: 400,
      message: "Invalid JSON syntax. Check the request body and try again.",
      error: "invalid_json"
    };
  }
  if (isDatabaseConnectionError(err)) {
    return {
      status: 503,
      message: routeMessage || "Database unavailable. Please try again shortly.",
      error: "database_unavailable"
    };
  }
  if (isDatabaseSchemaError(err)) {
    return {
      status: 500,
      message: routeMessage || "Server data is not ready. Please contact support if this continues.",
      error: "database_schema_error"
    };
  }
  if (err?.code === "ER_DUP_ENTRY") {
    const errors = duplicateEntryErrors(err);
    return {
      status: 409,
      message: Object.values(errors).find(Boolean) || "A registration value already exists.",
      error: "duplicate_entry",
      errors
    };
  }
  if (err instanceof HttpError || err?.status || err?.statusCode) {
    return {
      status,
      message: err.message || friendlyStatusMessage(status),
      error: statusErrorCode(status),
      ...(err.errors ? { errors: err.errors } : {})
    };
  }
  return {
    status: status >= 400 && status < 600 ? status : 500,
    message: routeMessage || "Internal server error. Please try again shortly.",
    error: "internal_server_error"
  };
}

function duplicateEntryErrors(err) {
  const key = String(err.sqlMessage || err.message || "");
  const errors = {};
  if (key.includes("username")) errors.username = "Username already exists.";
  else if (key.includes("email")) errors.email = "Email already exists.";
  else if (key.includes("phone_number")) errors.phone = "Phone number already exists.";
  else if (key.includes("uq_identity_id_number") || key.includes("id_number")) errors.idNumber = "Government ID already exists.";
  return errors;
}

function friendlyStatusMessage(status) {
  if (status === 400) return "Invalid request.";
  if (status === 401) return "Unauthorized.";
  if (status === 403) return "Forbidden.";
  if (status === 404) return "Resource not found.";
  if (status === 409) return "Request could not be completed because of a conflict.";
  if (status === 429) return "Too many requests. Please slow down.";
  if (status === 503) return "Server unavailable. Please try again shortly.";
  return "Internal server error. Please try again shortly.";
}

function statusErrorCode(status) {
  if (status === 400) return "invalid_request";
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "resource_not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "too_many_requests";
  if (status === 503) return "server_unavailable";
  return "internal_server_error";
}

export function errorHandler(err, req, res, next) {
  const publicError = publicErrorFor(err, err.status || err.statusCode || 500, req);
  // Print full details to server logs only. Do not expose SQL, stack traces, or secrets to clients.
  console.error("========== SERVER ERROR ==========");
  console.error("Time:", new Date().toISOString());
  console.error("Route:", req.originalUrl);
  console.error("Method:", req.method);
  console.error("HTTP status:", publicError.status);
  console.error("Message:", err.message);
  console.error("Code:", err.code);
  console.error("SQL Message:", err.sqlMessage);
  console.error("SQL:", err.sqlText || err.sql || "");
  console.error("Parameters:", JSON.stringify(err.sqlParams ? "[redacted]" : {}, null, 2));
  console.error("Stack:");
  console.error(err.stack);
  console.error("==================================");

  res.status(publicError.status).json({
    success: false,
    message: publicError.message,
    error: publicError.error,
    ...(publicError.errors ? { errors: publicError.errors } : {})
  });
}
