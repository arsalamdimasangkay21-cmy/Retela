import { ShieldPlus } from "lucide-react";

export function getPasswordBlueprint(password) {
  const value = password || "";
  return [
    { key: "length", met: value.length >= 8 },
    { key: "uppercase", met: /[A-Z]/.test(value) },
    { key: "lowercase", met: /[a-z]/.test(value) },
    { key: "number", met: /\d/.test(value) },
    { key: "special", met: /[^A-Za-z0-9]/.test(value) }
  ];
}

export function getPasswordStrength(blueprint) {
  const score = blueprint.filter((item) => item.met).length;
  if (score <= 2) return { score, tone: "weak" };
  if (score <= 4) return { score, tone: "good" };
  return { score, tone: "strong" };
}

export function PasswordBlueprint({ blueprint, strength }) {
  const hasInput = blueprint.some((item) => item.met) || strength.score > 0;
  if (!hasInput) return null;
  const isStrong = strength.tone === "strong";

  return (
    <div className={`password-blueprint password-blueprint-${strength.tone}`}>
      <div className="flex items-center gap-2">
        <ShieldPlus size={17} className="shrink-0" />
        <span className="password-strength-hint">
          {isStrong ? "Strong password ready" : "Use 8+ chars with uppercase, lowercase, number, and symbol"}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-5 gap-1.5" aria-label="Password strength">
        {blueprint.map((item) => <span key={item.key} className={`password-strength-dot ${item.met ? "is-met" : "is-missing"}`} />)}
      </div>
    </div>
  );
}
