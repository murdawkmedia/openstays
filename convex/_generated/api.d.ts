/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as apiKeys from "../apiKeys.js";
import type * as apiV1 from "../apiV1.js";
import type * as auth from "../auth.js";
import type * as automation from "../automation.js";
import type * as availability from "../availability.js";
import type * as bookings from "../bookings.js";
import type * as commerce from "../commerce.js";
import type * as channel_admin from "../channel/admin.js";
import type * as channel_ari from "../channel/ari.js";
import type * as channel_channex from "../channel/channex.js";
import type * as channel_index from "../channel/index.js";
import type * as channel_ingest from "../channel/ingest.js";
import type * as channel_types from "../channel/types.js";
import type * as closeout from "../closeout.js";
import type * as consensus from "../consensus.js";
import type * as consensusReceipts from "../consensusReceipts.js";
import type * as crons from "../crons.js";
import type * as demo from "../demo.js";
import type * as email from "../email.js";
import type * as emailDelivery from "../emailDelivery.js";
import type * as emailTemplates from "../emailTemplates.js";
import type * as frontDesk from "../frontDesk.js";
import type * as groups from "../groups.js";
import type * as http from "../http.js";
import type * as housekeeping from "../housekeeping.js";
import type * as ical from "../ical.js";
import type * as icalImport from "../icalImport.js";
import type * as messages from "../messages.js";
import type * as operations from "../operations.js";
import type * as operationsFoundation from "../operationsFoundation.js";
import type * as operationalSearch from "../operationalSearch.js";
import type * as operationsHealth from "../operationsHealth.js";
import type * as payments_checkout from "../payments/checkout.js";
import type * as payments_index from "../payments/index.js";
import type * as payments_square from "../payments/square.js";
import type * as payments_stripe from "../payments/stripe.js";
import type * as payments_types from "../payments/types.js";
import type * as payments_webhooks from "../payments/webhooks.js";
import type * as payments_zaprite from "../payments/zaprite.js";
import type * as promoCodes from "../promoCodes.js";
import type * as properties from "../properties.js";
import type * as publicMaintenance from "../publicMaintenance.js";
import type * as publicPolicy from "../publicPolicy.js";
import type * as refunds from "../refunds.js";
import type * as rewardPolicy from "../rewardPolicy.js";
import type * as seed from "../seed.js";
import type * as staff from "../staff.js";
import type * as treasury from "../treasury.js";
import type * as treasuryPolicy from "../treasuryPolicy.js";
import type * as wavelength from "../wavelength.js";
import type * as wavelengthRewards from "../wavelengthRewards.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  apiKeys: typeof apiKeys;
  apiV1: typeof apiV1;
  auth: typeof auth;
  automation: typeof automation;
  availability: typeof availability;
  bookings: typeof bookings;
  commerce: typeof commerce;
  "channel/admin": typeof channel_admin;
  "channel/ari": typeof channel_ari;
  "channel/channex": typeof channel_channex;
  "channel/index": typeof channel_index;
  "channel/ingest": typeof channel_ingest;
  "channel/types": typeof channel_types;
  closeout: typeof closeout;
  consensus: typeof consensus;
  consensusReceipts: typeof consensusReceipts;
  crons: typeof crons;
  demo: typeof demo;
  email: typeof email;
  emailDelivery: typeof emailDelivery;
  emailTemplates: typeof emailTemplates;
  frontDesk: typeof frontDesk;
  groups: typeof groups;
  http: typeof http;
  housekeeping: typeof housekeeping;
  ical: typeof ical;
  icalImport: typeof icalImport;
  messages: typeof messages;
  operations: typeof operations;
  operationsFoundation: typeof operationsFoundation;
  operationalSearch: typeof operationalSearch;
  operationsHealth: typeof operationsHealth;
  "payments/checkout": typeof payments_checkout;
  "payments/index": typeof payments_index;
  "payments/square": typeof payments_square;
  "payments/stripe": typeof payments_stripe;
  "payments/types": typeof payments_types;
  "payments/webhooks": typeof payments_webhooks;
  "payments/zaprite": typeof payments_zaprite;
  promoCodes: typeof promoCodes;
  properties: typeof properties;
  publicMaintenance: typeof publicMaintenance;
  publicPolicy: typeof publicPolicy;
  refunds: typeof refunds;
  rewardPolicy: typeof rewardPolicy;
  seed: typeof seed;
  staff: typeof staff;
  treasury: typeof treasury;
  treasuryPolicy: typeof treasuryPolicy;
  wavelength: typeof wavelength;
  wavelengthRewards: typeof wavelengthRewards;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
