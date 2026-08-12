/**
 * Sensitive-page heuristics (DOM-37 proactive auto-block).
 *
 * Full Manual override modal is M4 (DOM-39). Until then, Manual toolbar
 * extract on a protected page still runs without a blocking warning.
 */

export {
  assessDocumentSensitivity,
  assessSensitivePage,
  assessUrlSensitivity,
  isProactiveSensitiveBlocked,
  type SensitiveAssessment,
  type SensitiveCategory,
} from "./assess";
