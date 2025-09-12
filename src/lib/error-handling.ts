import { toast } from '@/hooks/use-toast';

export enum ErrorCode {
  NETWORK_ERROR = 'NETWORK_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  TRANSACTION_FAILED = 'TRANSACTION_FAILED',
  ACCOUNT_NOT_FOUND = 'ACCOUNT_NOT_FOUND',
  INSUFFICIENT_BALANCE = 'INSUFFICIENT_BALANCE',
  INVALID_XDR = 'INVALID_XDR',
  WALLET_CONNECTION_FAILED = 'WALLET_CONNECTION_FAILED',
  UNEXPECTED_ERROR = 'UNEXPECTED_ERROR',
}

export interface AppError {
  code: ErrorCode;
  message: string;
  details?: unknown;
  isUserFacing: boolean;
  timestamp: Date;
}

/**
 * Centralized error logging and notification function.
 * @param error The error object (can be an Error, string, or AppError).
 * @param context Optional context for logging (e.g., "Transaction submission").
 * @param isUserFacing Whether the error message should be shown to the user.
 */
export function handleError(
  error: unknown,
  context: string = 'Application',
  isUserFacing: boolean = true
): AppError {
  let appError: AppError;

  if (isAppError(error)) {
    appError = error;
  } else if (error instanceof Error) {
    appError = {
      code: ErrorCode.UNEXPECTED_ERROR,
      message: error.message,
      details: error,
      isUserFacing: isUserFacing,
      timestamp: new Date(),
    };
  } else if (typeof error === 'string') {
    appError = {
      code: ErrorCode.UNEXPECTED_ERROR,
      message: error,
      isUserFacing: isUserFacing,
      timestamp: new Date(),
    };
  } else {
    appError = {
      code: ErrorCode.UNEXPECTED_ERROR,
      message: 'An unknown error occurred.',
      details: error,
      isUserFacing: isUserFacing,
      timestamp: new Date(),
    };
  }

  // Log the error for debugging
  console.error(`[${context} Error - ${appError.code}]`, appError.message, appError.details);

  // Show user-facing toast if applicable
  if (appError.isUserFacing) {
    toast({
      title: `Error: ${appError.code}`,
      description: appError.message,
      variant: 'destructive',
    });
  }

  return appError;
}

/**
 * Type guard to check if an error is an AppError.
 */
function isAppError(error: unknown): error is AppError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as AppError).code === 'string' &&
    'message' in error &&
    typeof (error as AppError).message === 'string' &&
    'isUserFacing' in error &&
    typeof (error as AppError).isUserFacing === 'boolean' &&
    'timestamp' in error &&
    (error as AppError).timestamp instanceof Date
  );
}

/**
 * Helper to create a specific AppError.
 */
export function createError(
  code: ErrorCode,
  message: string,
  details?: unknown,
  isUserFacing: boolean = true
): AppError {
  return { 
    code, 
    message, 
    details, 
    isUserFacing,
    timestamp: new Date(),
  };
}

/**
 * Common error handlers for specific scenarios
 */
export const ErrorHandlers = {
  networkError: (error: unknown, context?: string) => 
    handleError(createError(ErrorCode.NETWORK_ERROR, 'Network request failed', error), context),
  
  validationError: (message: string, details?: unknown) => 
    handleError(createError(ErrorCode.VALIDATION_ERROR, message, details)),
  
  transactionError: (error: unknown, context?: string) => 
    handleError(createError(ErrorCode.TRANSACTION_FAILED, 'Transaction failed', error), context),
  
  accountNotFound: (address: string) => 
    handleError(createError(ErrorCode.ACCOUNT_NOT_FOUND, `Account ${address} not found`)),
  
  insufficientBalance: (asset: string, required: string, available: string) => 
    handleError(createError(
      ErrorCode.INSUFFICIENT_BALANCE, 
      `Insufficient ${asset} balance. Required: ${required}, Available: ${available}`
    )),
  
  invalidXdr: (details?: unknown) => 
    handleError(createError(ErrorCode.INVALID_XDR, 'Invalid XDR format', details)),
  
  walletConnectionFailed: (wallet: string, error: unknown) => 
    handleError(createError(
      ErrorCode.WALLET_CONNECTION_FAILED, 
      `Failed to connect to ${wallet}`, 
      error
    )),
};
