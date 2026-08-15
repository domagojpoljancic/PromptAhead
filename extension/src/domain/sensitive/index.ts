/**
 * Sensitive-page heuristics (DOM-37 proactive + DOM-39 Manual override).
 */

export {
  assessDocumentSensitivity,
  assessDocumentSensitivityInPage,
  assessSensitivePage,
  assessUrlSensitivity,
  isProactiveSensitiveBlocked,
  sensitiveCategoryLabel,
  sensitiveOverrideCopy,
  type SensitiveAssessment,
  type SensitiveCategory,
} from "./assess";
