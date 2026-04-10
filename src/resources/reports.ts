/**
 * ReportsResource — QuickBooks Desktop report endpoints.
 */

import type { NxusHttpTransport, RequestOptions } from '../transport';

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

  async retrieveAging(
    params?: ReportParams & RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/aging', params);
  }

  async retrieveGeneralDetail(
    params?: ReportParams & RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/general-detail', params);
  }

  async retrieveGeneralSummary(
    params?: ReportParams & RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/general-summary', params);
  }

  async retrieveBudgetSummary(
    params?: ReportParams & RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/budget-summary', params);
  }

  async retrieveJob(
    params?: ReportParams & RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/job', params);
  }

  async retrieveTime(
    params?: ReportParams & RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/time', params);
  }

  async retrieveCustomDetail(
    params?: ReportParams & RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/custom-detail', params);
  }

  async retrieveCustomSummary(
    params?: ReportParams & RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/custom-summary', params);
  }

  async retrievePayrollDetail(
    params?: ReportParams & RequestOptions,
  ): Promise<unknown> {
    return this.retrieve('/api/v1/reports/payroll-detail', params);
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private async retrieve(
    path: string,
    params?: ReportParams & RequestOptions,
  ): Promise<unknown> {
    const { connectionId, headers, timeout, ...query } = params ?? {};
    const options: RequestOptions = {};
    if (connectionId) options.connectionId = connectionId;
    if (headers) options.headers = headers as Record<string, string>;
    if (timeout) options.timeout = timeout as number;
    return this.transport.get<unknown>(path, query, options);
  }
}
