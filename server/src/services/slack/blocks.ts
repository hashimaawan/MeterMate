/**
 * Pure Block Kit builders. Each returns a `KnownBlock[]` and touches no Slack
 * client, so they are trivially unit-testable. One builder per "moment" in the
 * transaction narrative (per plan §5).
 */
import type { KnownBlock } from '@slack/types';

/** A single fact rendered in the message's fields grid. */
export interface BillingField {
  label: string;
  value: string;
}

function header(text: string): KnownBlock {
  return {
    type: 'header',
    text: { type: 'plain_text', text: truncate(text, 150), emoji: true },
  };
}

function contextLine(text: string): KnownBlock {
  return {
    type: 'context',
    elements: [{ type: 'mrkdwn', text: truncate(text, 3000) }],
  };
}

function fieldsGrid(fields: BillingField[]): KnownBlock {
  return {
    type: 'section',
    fields: fields
      .slice(0, 10) // Slack caps a section at 10 fields.
      .map((f) => ({ type: 'mrkdwn', text: `*${f.label}*\n${f.value}` })),
  };
}

function linkButton(text: string, url: string): KnownBlock {
  return {
    type: 'actions',
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text, emoji: true },
        url,
      },
    ],
  };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Posted once when a transaction channel is opened. */
export function buildChannelOpened(input: {
  consultantName: string;
  clientName: string;
  clientEmail: string;
  type: string;
}): KnownBlock[] {
  return [
    header(':wave: Transaction started'),
    contextLine(`MeterMate billing concierge · *${escape(input.type)}*`),
    fieldsGrid([
      { label: 'Consultant', value: escape(input.consultantName) },
      { label: 'Client', value: `${escape(input.clientName)} (${escape(input.clientEmail)})` },
    ]),
  ];
}

/** UC1 in-progress message. */
export function buildBookingStarted(planLabel: string): KnownBlock[] {
  return [
    header(':hourglass_flowing_sand: Booking started'),
    contextLine(`Creating your subscription on *${escape(planLabel)}*…`),
  ];
}

/** UC1 completion message. */
export function buildSubscriptionActive(input: {
  customerName: string;
  customerEmail: string;
  planLabel: string;
  mrr: string;
  state: string;
  nextAssessmentAt: string | null;
  manageUrl: string | null;
}): KnownBlock[] {
  const fields: BillingField[] = [
    { label: 'Customer', value: `${escape(input.customerName)} (${escape(input.customerEmail)})` },
    { label: 'Plan', value: escape(input.planLabel) },
    { label: 'MRR', value: escape(input.mrr) },
    { label: 'State', value: `\`${escape(input.state)}\`` },
    {
      label: 'Next assessment',
      value: input.nextAssessmentAt ? escape(formatDate(input.nextAssessmentAt)) : '—',
    },
  ];
  const blocks: KnownBlock[] = [
    header(':tada: Subscription active'),
    fieldsGrid(fields),
  ];
  if (input.manageUrl) blocks.push(linkButton('View in Maxio', input.manageUrl));
  return blocks;
}

/** UC2 in-progress message. */
export function buildUsageRecording(input: {
  quantity: number;
  unit: string;
  componentLabel: string;
}): KnownBlock[] {
  return [
    header(':bar_chart: Recording usage…'),
    contextLine(
      `Recording *${input.quantity} ${escape(input.unit)}* against *${escape(input.componentLabel)}*…`,
    ),
  ];
}

/** UC2 completion message. */
export function buildUsageRecorded(input: {
  componentLabel: string;
  quantity: number;
  unit: string;
  periodTotal: number;
}): KnownBlock[] {
  return [
    header(':white_check_mark: Usage recorded'),
    fieldsGrid([
      { label: 'Component', value: escape(input.componentLabel) },
      { label: 'Recorded', value: `${input.quantity} ${escape(input.unit)}` },
      { label: 'Period total', value: `${input.periodTotal} ${escape(input.unit)}` },
      { label: 'Billing', value: 'Accrues to next invoice' },
    ]),
  ];
}

/** UC3 preview message. */
export function buildPlanChangePreview(input: {
  oldPlanLabel: string;
  newPlanLabel: string;
  paymentDue: string;
  proratedAdjustment: string;
  credit: string;
}): KnownBlock[] {
  return [
    header(':mag: Plan change preview'),
    contextLine(`${escape(input.oldPlanLabel)} → *${escape(input.newPlanLabel)}* (prorated now)`),
    fieldsGrid([
      { label: 'Prorated adjustment', value: escape(input.proratedAdjustment) },
      { label: 'Credit applied', value: escape(input.credit) },
      { label: 'Payment due now', value: escape(input.paymentDue) },
    ]),
  ];
}

/** UC3 completion message. */
export function buildPlanChanged(input: {
  oldPlanLabel: string;
  newPlanLabel: string;
  prorated: boolean;
  effective: string;
  manageUrl: string | null;
}): KnownBlock[] {
  const blocks: KnownBlock[] = [
    header(':arrows_counterclockwise: Plan changed'),
    fieldsGrid([
      { label: 'From', value: escape(input.oldPlanLabel) },
      { label: 'To', value: escape(input.newPlanLabel) },
      { label: 'Proration', value: input.prorated ? 'Prorated now' : 'None (at renewal)' },
      { label: 'Effective', value: escape(input.effective) },
    ]),
  ];
  if (input.manageUrl) blocks.push(linkButton('View in Maxio', input.manageUrl));
  return blocks;
}

/** UC4 in-progress message. */
export function buildLifecycleInProgress(actionLabel: string): KnownBlock[] {
  return [
    header(':vertical_traffic_light: ' + `${capitalize(actionLabel)} in progress…`),
  ];
}

/** UC4 completion message. */
export function buildLifecycleDone(input: {
  transition: string;
  reason: string | null;
  effective: string;
  manageUrl: string | null;
}): KnownBlock[] {
  const fields: BillingField[] = [
    { label: 'Transition', value: `\`${escape(input.transition)}\`` },
    { label: 'Effective', value: escape(input.effective) },
  ];
  if (input.reason) fields.push({ label: 'Reason', value: escape(input.reason) });
  const blocks: KnownBlock[] = [
    header(':vertical_traffic_light: Lifecycle updated'),
    fieldsGrid(fields),
  ];
  if (input.manageUrl) blocks.push(linkButton('View in Maxio', input.manageUrl));
  return blocks;
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

/** UC5 in-progress message. */
export function buildInvoiceIssuing(): KnownBlock[] {
  return [header(':receipt: Issuing invoice…')];
}

/** UC5 completion message. */
export function buildInvoiceIssued(input: {
  number: string;
  amountDue: string;
  dueDate: string | null;
  emailed: boolean;
  payUrl: string | null;
}): KnownBlock[] {
  const fields: BillingField[] = [
    { label: 'Invoice', value: escape(input.number) },
    { label: 'Amount due', value: escape(input.amountDue) },
    { label: 'Due date', value: input.dueDate ? escape(formatDate(input.dueDate)) : '—' },
    { label: 'Delivery', value: input.emailed ? 'Emailed to client' : 'Not emailed' },
  ];
  const blocks: KnownBlock[] = [header(':receipt: Invoice issued'), fieldsGrid(fields)];
  if (input.payUrl) blocks.push(linkButton('Pay Invoice', input.payUrl));
  return blocks;
}

/** Generic failure message reused across UCs. */
export function buildFailure(input: {
  useCase: string;
  reason: string;
}): KnownBlock[] {
  return [
    header(`:warning: ${input.useCase} failed`),
    fieldsGrid([{ label: 'Reason', value: escape(truncate(input.reason, 2800)) }]),
  ];
}

/** UC6 digest message (posted to a consultant's digest channel). */
export function buildDigest(input: {
  consultantName: string;
  windowDays: number;
  activeCount: number;
  mrr: string;
  newSignups: number;
  churn: number;
  openInvoices: number;
  outstanding: string;
}): KnownBlock[] {
  return [
    header(':chart_with_upwards_trend: Billing digest'),
    contextLine(`*${escape(input.consultantName)}* · last ${input.windowDays} days`),
    fieldsGrid([
      { label: 'Active subscriptions', value: String(input.activeCount) },
      { label: 'MRR', value: escape(input.mrr) },
      { label: 'New signups', value: String(input.newSignups) },
      { label: 'Churn', value: String(input.churn) },
      { label: 'Open invoices', value: String(input.openInvoices) },
      { label: 'Outstanding', value: escape(input.outstanding) },
    ]),
    contextLine(
      ':information_source: Reporting data is for reconciliation, not real-time confirmation; counts may lag live state slightly.',
    ),
  ];
}

/** A short note posted into the channel (e.g. invite fallback). */
export function buildNote(text: string): KnownBlock[] {
  return [contextLine(`:information_source: ${escape(text)}`)];
}

function escape(value: string): string {
  // Slack mrkdwn escaping for the three reserved characters.
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
