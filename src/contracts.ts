import type {
  ConnectionModeRequest,
  ConnectionStatus as GeneratedConnectionStatus,
} from './generated/types.gen';

export interface RestrictionSummary {
  code?: string | null;
  reason?: string | null;
  message?: string | null;
  lifecycleState?: string | null;
  requiresPayment?: boolean | null;
  checkoutUrl?: string | null;
  [key: string]: unknown;
}

export interface BillingSummary {
  status?: string | null;
  subscriptionStatus?: string | null;
  requiresPayment?: boolean | null;
  checkoutUrl?: string | null;
  portalUrl?: string | null;
  customerPortalUrl?: string | null;
  currentPeriodEnd?: string | null;
  [key: string]: unknown;
}

export type Connection = GeneratedConnectionStatus & {
  id?: string;
  description?: string | null;
  externalId?: string | null;
  mode?: ConnectionModeRequest | null;
  isActive?: boolean | null;
  lifecycleState?: string | null;
  restrictionReason?: string | null;
  restrictionCode?: string | null;
  isOperational?: boolean | null;
  requiresPayment?: boolean | null;
  archivedAt?: string | null;
  billing?: BillingSummary | null;
  restriction?: RestrictionSummary | null;
};
