/**
 * ReportsResource — QuickBooks Desktop report endpoints.
 */

import type { NxusHttpTransport, RequestOptions } from "../transport";
import { NxusResponse } from "../helpers/response";
import { assertNoRequestOptionKeys } from "./base";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReportParams = {
  reportType?: string;
  fromReportDate?: string;
  toReportDate?: string;
  period?: string;
  [key: string]: unknown;
};

// ---------------------------------------------------------------------------
// ReportsResource
// ---------------------------------------------------------------------------

export class ReportsResource {
  constructor(private readonly transport: NxusHttpTransport) {}

  retrieveAging(
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown>;
  async retrieveAging(
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve("/api/v1/reports/aging", query, options);
  }

  retrieveGeneralDetail(
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown>;
  async retrieveGeneralDetail(
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve("/api/v1/reports/general-detail", query, options);
  }

  retrieveGeneralSummary(
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown>;
  async retrieveGeneralSummary(
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve("/api/v1/reports/general-summary", query, options);
  }

  retrieveBudgetSummary(
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown>;
  async retrieveBudgetSummary(
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve("/api/v1/reports/budget-summary", query, options);
  }

  retrieveJob(query?: ReportParams, options?: RequestOptions): Promise<unknown>;
  async retrieveJob(
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve("/api/v1/reports/job", query, options);
  }

  retrieveTime(
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown>;
  async retrieveTime(
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve("/api/v1/reports/time", query, options);
  }

  retrieveCustomDetail(
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown>;
  async retrieveCustomDetail(
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve("/api/v1/reports/custom-detail", query, options);
  }

  retrieveCustomSummary(
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown>;
  async retrieveCustomSummary(
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve("/api/v1/reports/custom-summary", query, options);
  }

  retrievePayrollDetail(
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown>;
  async retrievePayrollDetail(
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve("/api/v1/reports/payroll-detail", query, options);
  }

  get withResponse() {
    return {
      retrieveAging: (query?: ReportParams, options?: RequestOptions) =>
        this.retrieveWithResponse("/api/v1/reports/aging", query, options),
      retrieveGeneralDetail: (query?: ReportParams, options?: RequestOptions) =>
        this.retrieveWithResponse(
          "/api/v1/reports/general-detail",
          query,
          options,
        ),
      retrieveGeneralSummary: (
        query?: ReportParams,
        options?: RequestOptions,
      ) =>
        this.retrieveWithResponse(
          "/api/v1/reports/general-summary",
          query,
          options,
        ),
      retrieveBudgetSummary: (query?: ReportParams, options?: RequestOptions) =>
        this.retrieveWithResponse(
          "/api/v1/reports/budget-summary",
          query,
          options,
        ),
      retrieveJob: (query?: ReportParams, options?: RequestOptions) =>
        this.retrieveWithResponse("/api/v1/reports/job", query, options),
      retrieveTime: (query?: ReportParams, options?: RequestOptions) =>
        this.retrieveWithResponse("/api/v1/reports/time", query, options),
      retrieveCustomDetail: (query?: ReportParams, options?: RequestOptions) =>
        this.retrieveWithResponse(
          "/api/v1/reports/custom-detail",
          query,
          options,
        ),
      retrieveCustomSummary: (query?: ReportParams, options?: RequestOptions) =>
        this.retrieveWithResponse(
          "/api/v1/reports/custom-summary",
          query,
          options,
        ),
      retrievePayrollDetail: (query?: ReportParams, options?: RequestOptions) =>
        this.retrieveWithResponse(
          "/api/v1/reports/payroll-detail",
          query,
          options,
        ),
    };
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async retrieve(
    path: string,
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<unknown> {
    assertNoRequestOptionKeys(query as Record<string, unknown> | undefined);
    return this.transport.get<unknown>(
      path,
      query as Record<string, unknown> | undefined,
      options,
    );
  }

  private async retrieveWithResponse(
    path: string,
    query?: ReportParams,
    options?: RequestOptions,
  ): Promise<NxusResponse<unknown>> {
    assertNoRequestOptionKeys(query as Record<string, unknown> | undefined);
    const wire = await this.transport.sendGet<unknown>(
      path,
      query as Record<string, unknown> | undefined,
      options,
    );
    return NxusResponse.fromTransport(wire.body, wire);
  }
}
