export {
  SMART_HOST_ORIGINS,
  SMART_PERMISSION_EDUCATION,
  getChromePermissionsApi,
  hasSmartHostPermission,
  requestSmartHostPermission,
  revokeSmartHostPermission,
  settingsAfterSmartGrant,
  settingsAfterSmartRevoke,
  type HostPermissionOutcome,
  type PermissionsApi,
  type SmartPermissionEducation,
} from "./host-permissions";

export {
  ENGAGEMENT_CONTENT_SCRIPT_ID,
  ENGAGEMENT_CONTENT_SCRIPT_JS,
  ENGAGEMENT_CONTENT_SCRIPT_MATCHES,
  getChromeScriptingRegistrationApi,
  smartOriginsGranted,
  syncEngagementContentScripts,
  type ScriptingRegistrationApi,
} from "./engagement-scripts";
