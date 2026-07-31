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

export function errorHandler(err, req, res, next) {
  // ===== PRINT THE REAL ERROR TO RAILWAY LOGS =====
  console.error("========== SERVER ERROR ==========");
  console.error("Time:", new Date().toISOString());
  console.error("URL:", req.method, req.originalUrl);
  console.error("Message:", err.message);
  console.error("Code:", err.code);
  console.error("SQL Message:", err.sqlMessage);
  console.error("Stack:");
  console.error(err.stack);
  console.error("==================================");

  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      message: "Invalid JSON syntax. Check the request body and try again."
    });
  }

  if (err?.name === "ZodError") {
    const first = err.issues?.[0];
    return res.status(400).json({
      message: first?.message || "Invalid input."
    });
  }

  if (err?.code === "ER_DUP_ENTRY") {
    const key = String(err.sqlMessage || err.message || "");
    const errors = {};

    if (key.includes("username"))
      errors.username = "Username already exists.";
    else if (key.includes("email"))
      errors.email = "Email already exists.";
    else if (key.includes("phone_number"))
      errors.phone = "Phone number already exists.";
    else if (
      key.includes("uq_identity_id_number") ||
      key.includes("id_number")
    )
      errors.idNumber = "Government ID already exists.";

    return res.status(409).json({
      success: false,
      message: "Registration validation failed.",
      errors
    });
  }

  if (err?.code === "ER_PARSE_ERROR") {
    return res.status(500).json({
      message: err.message,
      sql: err.sqlMessage
    });
  }

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "Internal server error",
    code: err.code || null
  });
}