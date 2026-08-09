/**
 * App / editor hosts where full-page extraction is rarely useful.
 * Matching is host + subdomain (e.g. docs.google.com, www.notion.so).
 */

const APP_OR_EDITOR_HOSTS: readonly string[] = [
  // Google Workspace
  "docs.google.com",
  "sheets.google.com",
  "slides.google.com",
  "drive.google.com",
  "keep.google.com",
  "calendar.google.com",
  "mail.google.com",
  // Microsoft / Office
  "outlook.live.com",
  "outlook.office.com",
  "outlook.office365.com",
  "office.com",
  "www.office.com",
  "onedrive.live.com",
  "sharepoint.com",
  // Productivity / design / chat
  "notion.so",
  "www.notion.so",
  "figma.com",
  "www.figma.com",
  "canva.com",
  "www.canva.com",
  "miro.com",
  "www.miro.com",
  "linear.app",
  "atlassian.net",
  "slack.com",
  "app.slack.com",
  "discord.com",
  "discordapp.com",
  "trello.com",
  "www.trello.com",
  "asana.com",
  "app.asana.com",
  "airtable.com",
  "www.airtable.com",
  "clickup.com",
  "app.clickup.com",
];

/** True when hostname equals or is a subdomain of a listed app/editor host. */
export function isAppOrEditorHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return APP_OR_EDITOR_HOSTS.some(
    (listed) => host === listed || host.endsWith(`.${listed}`),
  );
}
