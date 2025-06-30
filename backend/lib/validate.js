function validate(str) {
  if (!str) {
    return {
      error: "Missing query paramter: app (please enter an appId)",
      valid: false,
    };
  }

  if (typeof str !== "string") {
    return { valid: false, error: "Not a string", type: "type" };
  }

  if (str.includes("<") || str.includes(">")) {
    return {
      valid: false,
      error: `<!DOCTYPE html>
      <html>
      <head><title>403 Forbidden</title></head>
      <body style="background:#111; color:#eee; font-family:sans-serif; text-align:center; padding:0; margin:0">
      <img src="https://http.cat/403" style="max-width:100%; margin-top:1rem" alt="403 Forbidden">
      <p>Bro what the hell</p>
      </body>
      </html>`,
      type: "forbidden",
    };
  }

  if (str.length > 64) {
    return {
      valid: false,
      error: "ID too looong (max 64 chars)",
      type: "length",
    };
  }

  if (str.length < 4) {
    return {
      valid: false,
      error: "IDs shorter than 4 characters are reserved",
      type: "reserved",
    };
  }

  if (/^\d/.test(str)) {
    return {
      valid: false,
      error: "ID cannot start with a number",
      type: "start-digit",
    };
  }

  if (!/^[a-zA-Z_][\w]*$/.test(str)) {
    return {
      valid: false,
      error:
        "Invalid ID format: use only letters, digits, underscores, and start with a letter",
      type: "format",
    };
  }

  return { valid: true };
}

module.exports = { validate };
