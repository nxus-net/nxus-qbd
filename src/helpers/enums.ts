/**
 * Runtime coercion for the query enums the API forwards straight into qbXML.
 */

import { QbdActiveStatus } from "../generated/types.gen";

const ACTIVE_STATUS_VALUES = Object.values(QbdActiveStatus);

/**
 * Coerce a string of unknown provenance into a `QbdActiveStatus`.
 *
 * `activeStatus` is typed on `ListParams`, so an enum member or an exact wire
 * literal (`"All"`) needs no help. This exists for the case the type system
 * cannot cover: a value widened to `string` — read from an environment
 * variable, a CLI flag, a database column — which is rejected at compile time
 * precisely because its contents are unknown.
 *
 * Validating here converts a silent mistake into a local error. The API does
 * not check this field: it forwards the value to QuickBooks, which fails the
 * whole request with QBD error 3110 ("The enumerated value ... is unknown or
 * invalid for the qbXML version in use") only after a full round trip.
 *
 * ```ts
 * const status = toActiveStatus(process.env.NXUS_ACTIVE_STATUS ?? "All");
 * await nxus.vendors.list({ limit: 50, activeStatus: status });
 * ```
 *
 * @throws {TypeError} if the value is not one of the three QuickBooks literals.
 */
export function toActiveStatus(value: string): QbdActiveStatus {
  if ((ACTIVE_STATUS_VALUES as string[]).includes(value)) {
    return value as QbdActiveStatus;
  }

  throw new TypeError(
    `Invalid activeStatus ${JSON.stringify(value)}. QuickBooks matches these ` +
      `exactly: ${ACTIVE_STATUS_VALUES.join(", ")}.`,
  );
}

/** Narrow an unknown value to `QbdActiveStatus` without throwing. */
export function isActiveStatus(value: unknown): value is QbdActiveStatus {
  return (
    typeof value === "string" && (ACTIVE_STATUS_VALUES as string[]).includes(value)
  );
}
