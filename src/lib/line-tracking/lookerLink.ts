import { getTrackingBaseUrl } from "@/lib/line-tracking/services/trackingService";

/**
 * Builds the one-click Looker Studio links.
 *
 * Looker's Linking API can prefill a community connector's CONFIG fields from the URL,
 * but never its auth credentials — which is exactly why the connector uses AuthType.NONE
 * and carries the project token as a config field. That is the whole reason a single
 * click can land the user on a ready-to-use data source with nothing left to type.
 *
 * The trade-off, accepted deliberately: the token travels in the URL and then sits in
 * the Looker data source's config. It is scoped to one project, grants read-only access,
 * masks PII by default, and can be rotated from the Setup page at any time.
 */

const LOOKER = "https://lookerstudio.google.com";

export type LookerDataset = "summary" | "leads" | "conversions";

/** Apps Script deployment id of the published connector (one per agency, not per project). */
export function getLookerDeploymentId(): string | null {
  return process.env.LOOKER_CONNECTOR_DEPLOYMENT_ID?.trim() || null;
}

/**
 * Every Looker link carries `authuser=<email>` of the person clicking (their MarsOS login),
 * so Looker opens in that Google account even when the browser is signed in to several.
 * Otherwise Looker picks the first account (/u/0/), and switching accounts inside that
 * tab reloads the page without our query string — the classic "gallery with no form".
 */
function withAccount(params: URLSearchParams, accountEmail?: string | null): URLSearchParams {
  const email = accountEmail?.trim();
  if (email) params.set("authuser", email);
  return params;
}

/** Optional: a prebuilt report to copy, styled like the MarsOS dashboard. */
export function getLookerTemplateReportId(): string | null {
  return process.env.LOOKER_TEMPLATE_REPORT_ID?.trim() || null;
}

export interface LookerConnectorConfig {
  baseUrl: string;
  token: string;
  dataset: LookerDataset;
}

export function buildConnectorConfig(token: string, dataset: LookerDataset): LookerConnectorConfig {
  return { baseUrl: getTrackingBaseUrl(), token, dataset };
}

/**
 * "Create a data source" link — lands on Looker's connector config screen with every
 * field already filled in, so the user only presses CONNECT.
 */
export function buildDataSourceUrl(
  deploymentId: string,
  config: LookerConnectorConfig,
  accountEmail?: string | null
): string {
  const params = withAccount(
    new URLSearchParams({
      connectorId: deploymentId,
      connectorConfig: JSON.stringify(config),
    }),
    accountEmail
  );
  return `${LOOKER}/datasources/create?${params.toString()}`;
}

/** Data source aliases used in every report link. Keep the MarsOS template report on these. */
export const LOOKER_DATASETS: { alias: string; dataset: LookerDataset; label: string }[] = [
  { alias: "ds0", dataset: "summary", label: "Dashboard" },
  { alias: "ds1", dataset: "leads", label: "Leads" },
  { alias: "ds2", dataset: "conversions", label: "Conversions" },
];

/**
 * "Create a report" link with all three MarsOS data sources attached in one go.
 *
 * Community-connector data sources are described with individual `ds.<alias>.<field>`
 * params here, NOT the single JSON blob that /datasources/create takes — the two
 * endpoints genuinely differ. Per the Linking API docs the connector is identified by
 * `connectorId` (the Apps Script deployment id) and every CONFIG field travels as
 * `ds.<alias>.<fieldName>`.
 *
 * - Without `reportId`: Looker opens a new report that already has the three data
 *   sources, so the user only has to drop charts on the page.
 * - With `reportId`: Looker copies that report and *replaces* its data sources by alias.
 *   The aliases must already exist in that report, so this only works for the MarsOS
 *   template (built through this same link, hence ds0/ds1/ds2). Pointing it at an
 *   arbitrary existing dashboard fails with "ds0 is not a valid data source alias for
 *   this report" — adding MarsOS to a team's own dashboard goes through
 *   `buildDataSourceUrl` + "Add data → My data sources" instead.
 *
 * `projectName` becomes part of each data source name so a team member with many clients
 * can tell them apart in "My data sources".
 */
export function buildReportUrl(opts: {
  deploymentId: string;
  token: string;
  projectName: string;
  reportId?: string | null;
  accountEmail?: string | null;
}): string {
  const baseUrl = getTrackingBaseUrl();
  const params = withAccount(new URLSearchParams({ "c.mode": "edit" }), opts.accountEmail);
  if (opts.reportId) params.set("c.reportId", opts.reportId);
  for (const { alias, dataset, label } of LOOKER_DATASETS) {
    params.set(`ds.${alias}.connector`, "community");
    params.set(`ds.${alias}.connectorId`, opts.deploymentId);
    params.set(`ds.${alias}.baseUrl`, baseUrl);
    params.set(`ds.${alias}.token`, opts.token);
    params.set(`ds.${alias}.dataset`, dataset);
    params.set(`ds.${alias}.datasourceName`, `MarsOS — ${opts.projectName} — ${label}`);
    // Let Looker re-read the schema from the connector rather than trusting whatever
    // field list the template was saved with.
    params.set(`ds.${alias}.refreshFields`, "true");
  }
  return `${LOOKER}/reporting/create?${params.toString()}`;
}

/** Direct feed URL, for smoke-testing the connection in a browser tab. */
export function buildFeedUrl(dataset: LookerDataset, token: string): string {
  return `${getTrackingBaseUrl()}/api/line-tracking/looker/${dataset}?token=${encodeURIComponent(token)}`;
}
