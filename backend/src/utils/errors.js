export class HttpError extends Error {
  constructor(status, message, errors = null) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

export function errorHandler(err, req, res, next) {
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      message: "Invalid JSON syntax. Check the request body and try again."
    });
  }

  if (err?.name === "ZodError") {
    const first = err.issues?.[0];
    return res.status(400).json({
      message: first?.message || "Invalid input. Please check the details and try again."
    });
  }

  if (err?.code === "ER_DUP_ENTRY") {
    const key = String(err.sqlMessage || err.message || "");
    const errors = {};
    if (key.includes("username")) errors.username = "Username already exists.";
    else if (key.includes("email")) errors.email = "Email already exists.";
    else if (key.includes("phone_number")) errors.phone = "Phone number already exists.";
    else if (key.includes("uq_identity_id_number") || key.includes("id_number")) errors.idNumber = "Government ID already exists.";
    return res.status(409).json({
      message: "Registration validation failed.",
      success: false,
      errors
    });
  }

  if (err?.code === "ER_PARSE_ERROR") {
    return res.status(500).json({
      message: "Database query syntax error. Please check the server logs."
    });
  }

  const status = err.status || 500;
  res.status(status).json({
    message: err instanceof HttpError ? err.message : status === 500 ? "Internal server error" : err.message,
    ...(err instanceof HttpError && err.errors ? { success: false, errors: err.errors } : {})
  });
}
