/**
 * ReportsResource — QuickBooks Desktop report endpoints.
 */

import type { NxusHttpTransport, RequestOptions } from '../transport';
import { splitBodyAndOptions } from './base';

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

  retrieveAging(params?: ReportParams & RequestOptions): Promise<unknown>;
  retrieveAging(query?: ReportParams, options?: RequestOptions): Promise<unknown>;
  async retrieveAging(
    params?: ReportParams & RequestOptions,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/aging', params, options);
  }

  retrieveGeneralDetail(params?: ReportParams & RequestOptions): Promise<unknown>;
  retrieveGeneralDetail(query?: ReportParams, options?: RequestOptions): Promise<unknown>;
  async retrieveGeneralDetail(
    params?: ReportParams & RequestOptions,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/general-detail', params, options);
  }

  retrieveGeneralSummary(params?: ReportParams & RequestOptions): Promise<unknown>;
  retrieveGeneralSummary(query?: ReportParams, options?: RequestOptions): Promise<unknown>;
  async retrieveGeneralSummary(
    params?: ReportParams & RequestOptions,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/general-summary', params, options);
  }

  retrieveBudgetSummary(params?: ReportParams & RequestOptions): Promise<unknown>;
  retrieveBudgetSummary(query?: ReportParams, options?: RequestOptions): Promise<unknown>;
  async retrieveBudgetSummary(
    params?: ReportParams & RequestOptions,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/budget-summary', params, options);
  }

  retrieveJob(params?: ReportParams & RequestOptions): Promise<unknown>;
  retrieveJob(query?: ReportParams, options?: RequestOptions): Promise<unknown>;
  async retrieveJob(
    params?: ReportParams & RequestOptions,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/job', params, options);
  }

  retrieveTime(params?: ReportParams & RequestOptions): Promise<unknown>;
  retrieveTime(query?: ReportParams, options?: RequestOptions): Promise<unknown>;
  async retrieveTime(
    params?: ReportParams & RequestOptions,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/time', params, options);
  }

  retrieveCustomDetail(params?: ReportParams & RequestOptions): Promise<unknown>;
  retrieveCustomDetail(query?: ReportParams, options?: RequestOptions): Promise<unknown>;
  async retrieveCustomDetail(
    params?: ReportParams & RequestOptions,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/custom-detail', params, options);
  }

  retrieveCustomSummary(params?: ReportParams & RequestOptions): Promise<unknown>;
  retrieveCustomSummary(query?: ReportParams, options?: RequestOptions): Promise<unknown>;
  async retrieveCustomSummary(
    params?: ReportParams & RequestOptions,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/custom-summary', params, options);
  }

  retrievePayrollDetail(params?: ReportParams & RequestOptions): Promise<unknown>;
  retrievePayrollDetail(query?: ReportParams, options?: RequestOptions): Promise<unknown>;
  async retrievePayrollDetail(
    params?: ReportParams & RequestOptions,
    options?: RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/payroll-detail', params, options);
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async retrieve(
    path: string,
    params?: ReportParams & RequestOptions,
    options?: RequestOptions,
  ): Promise<unknown> {
    const { body: query, options: requestOptions } = splitBodyAndOptions(
      params as Record<string, unknown> | undefined,
      options,
    );
    return this.transport.get<unknown>(path, query, requestOptions);
  }
}
